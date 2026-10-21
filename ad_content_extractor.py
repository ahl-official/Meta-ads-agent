import json
import os
import re
import urllib.request
import urllib.parse
from typing import Dict, Any

try:
    import yt_dlp
    _YTDLP_AVAILABLE = True
except ImportError:
    _YTDLP_AVAILABLE = False

try:
    import assemblyai as aai
    _AAI_AVAILABLE = True
except ImportError:
    aai = None
    _AAI_AVAILABLE = False


def _extract_meta(html: str, attr_name: str, attr_val: str) -> str:
    try:
        p1 = rf'{attr_name}=["\']?{attr_val}["\']?[^>]*content=["\']([^"\'>]+)["\']'
        m = re.search(p1, html, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        p2 = rf'content=["\']([^"\'>]+)["\'][^>]*{attr_name}=["\']?{attr_val}["\']?'
        m = re.search(p2, html, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    except Exception:
        pass
    return ""


def extract_content_from_url(url: str, timeout: int = 15) -> Dict[str, Any]:
    url = url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    result = {
        "url": url,
        "title": "",
        "description": "",
        "extracted_text": "",
        "video_stream_url": "",
        "audio_transcript": "",
        "source_type": "webpage",
        "status": "SUCCESS"
    }

    # 1. Advanced Extraction with yt-dlp (Meta Ad Library, Instagram, YouTube, TikTok)
    is_video_platform = any(k in url.lower() for k in [
        "facebook.com/ads", "fb.watch", "facebook.com", "instagram.com", "youtube.com", "youtu.be", "tiktok.com"
    ])

    if _YTDLP_AVAILABLE and is_video_platform:
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'skip_download': True,
                'extract_flat': False
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if info:
                    result["source_type"] = info.get("extractor", "social_ad")
                    result["title"] = info.get("title", "")
                    uploader = info.get("uploader", "")
                    ad_description = info.get("description", "")
                    video_url = info.get("url", "")
                    result["video_stream_url"] = video_url

                    parts = []
                    if result["title"]:
                        parts.append(f"AD / VIDEO TITLE:\n{result['title']}")
                    if uploader:
                        parts.append(f"ADVERTISER / BRAND:\n{uploader}")
                    if ad_description:
                        parts.append(f"PRIMARY AD COPY & CAPTION:\n{ad_description}")

                    # Attempt speech-to-text audio transcription if AssemblyAI is configured
                    aai_key = os.getenv("ASSEMBLYAI_API_KEY")
                    if aai_key and _AAI_AVAILABLE and video_url:
                        try:
                            aai.settings.api_key = aai_key
                            transcriber = aai.Transcriber()
                            transcript_obj = transcriber.transcribe(video_url)
                            if transcript_obj.status == aai.TranscriptStatus.completed and transcript_obj.text:
                                result["audio_transcript"] = transcript_obj.text
                                parts.append(f"SPOKEN VIDEO AUDIO TRANSCRIPT (AssemblyAI):\n\"{transcript_obj.text}\"")
                        except Exception as aai_err:
                            print(f"[Info] Video transcription via AssemblyAI skipped: {aai_err}")

                    if not result["audio_transcript"]:
                        parts.append("NOTE: Add ASSEMBLYAI_API_KEY in .env if you want automatic spoken audio voiceover transcription.")

                    result["extracted_text"] = "\n\n".join(parts)
                    result["status"] = "SUCCESS"
                    return result
        except Exception as yt_err:
            print(f"[Info] yt-dlp extraction fallback ({yt_err})")

    # 2. YouTube oEmbed Fallback
    if "youtube.com" in url or "youtu.be" in url:
        result["source_type"] = "youtube"
        try:
            oembed_url = f"https://www.youtube.com/oembed?url={urllib.parse.quote(url)}&format=json"
            req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8", errors="ignore"))
                    result["title"] = data.get("title", "")
                    result["description"] = f"Author: {data.get('author_name', '')} | Video Type: {data.get('type', 'video')}"
                    result["extracted_text"] = f"YouTube Video: {result['title']} by {data.get('author_name', '')}."
                    return result
        except Exception as yt_err:
            print(f"[Info] YouTube oEmbed fallback ({yt_err})")

    # 3. Generic Webpage / Landing Page Scraper
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            html = response.read().decode("utf-8", errors="ignore")

            title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
            if title_match:
                result["title"] = title_match.group(1).strip()

            og_title = _extract_meta(html, "property", "og:title")
            if og_title and not result["title"]:
                result["title"] = og_title

            og_desc = _extract_meta(html, "property", "og:description")
            meta_desc = _extract_meta(html, "name", "description")
            result["description"] = og_desc or meta_desc

            clean_html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
            clean_text = re.sub(r"<[^>]+>", " ", clean_html)
            clean_text = " ".join(clean_text.split())

            body_snippet = clean_text[:1500] if clean_text else ""
            summary_parts = []
            if result["title"]:
                summary_parts.append(f"Title: {result['title']}")
            if result["description"]:
                summary_parts.append(f"Description: {result['description']}")
            if body_snippet:
                summary_parts.append(f"Content Snippet: {body_snippet}")

            result["extracted_text"] = "\n\n".join(summary_parts) if summary_parts else f"URL Source: {url}"
            return result
    except Exception as e:
        print(f"[Warning] Failed to fetch URL {url}: {e}")
        result["status"] = "FALLBACK"
        result["extracted_text"] = f"Reference Link: {url}\n(Provide ad script/transcript text if link is protected or behind a login.)"
        return result
