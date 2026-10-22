import json
import os
import re
import base64
import tempfile
import urllib.request
import urllib.parse
from typing import Dict, Any

try:
    import requests
    _REQUESTS_AVAILABLE = True
except ImportError:
    _REQUESTS_AVAILABLE = False

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


def transcribe_audio_file(file_path: str) -> str:
    """
    Transcribes audio/video file using Gemini API (gemini-3.8-flash) or AssemblyAI.
    """
    if not os.path.exists(file_path):
        return ""

    # 1. Try Gemini Multimodal Speech Transcription
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        # Check parent/sibling .env locations
        for env_path in [
            r"C:\Users\HP\Desktop\Saniya\content-factory-work\content-factory\.env",
            r"C:\Users\HP\Desktop\Saniya\System tracking\.env"
        ]:
            if os.path.exists(env_path):
                try:
                    with open(env_path, "r", encoding="utf-8") as ef:
                        for line in ef:
                            if line.startswith("GEMINI_API_KEY="):
                                gemini_key = line.split("=", 1)[1].strip().strip('"\'')
                                break
                except Exception:
                    pass
            if gemini_key:
                break

    if gemini_key and _REQUESTS_AVAILABLE:
        try:
            with open(file_path, "rb") as f:
                b64_audio = base64.b64encode(f.read()).decode("utf-8")

            models_to_try = [
                "gemini-3.5-flash",
                "gemini-3.6-flash",
                "gemini-3.8-flash",
                "gemini-3-flash-preview",
                "gemini-flash-latest"
            ]

            payload = {
                "contents": [{
                    "parts": [
                        {
                            "text": (
                                "You are an expert audio transcriptionist. Listen to this video audio and transcribe "
                                "every spoken word verbatim in the spoken language (English, Hindi, or Hinglish). "
                                "Do not add commentary, notes, or intros. Return only the verbatim spoken dialogue transcript."
                            )
                        },
                        {"inline_data": {"mime_type": "video/mp4", "data": b64_audio}}
                    ]
                }],
                "generationConfig": {
                    "temperature": 0.1
                }
            }

            for model_name in models_to_try:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                    res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=45)
                    if res.status_code == 200:
                        res_data = res.json()
                        candidates = res_data.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            if parts and "text" in parts[0]:
                                transcript = parts[0]["text"].strip()
                                if transcript:
                                    print(f"[Extractor] Successfully transcribed audio via {model_name} ({len(transcript.split())} words)")
                                    return transcript
                    else:
                        print(f"[Extractor] {model_name} returned status {res.status_code}, trying next model...")
                except Exception as m_err:
                    print(f"[Extractor] {model_name} error: {m_err}, trying next model...")
        except Exception as g_err:
            print(f"[Extractor] Gemini transcription error: {g_err}")

    # 2. Try AssemblyAI Fallback
    aai_key = os.getenv("ASSEMBLYAI_API_KEY")
    if aai_key and _AAI_AVAILABLE:
        try:
            aai.settings.api_key = aai_key
            transcriber = aai.Transcriber()
            transcript_obj = transcriber.transcribe(file_path)
            if transcript_obj.status == aai.TranscriptStatus.completed and transcript_obj.text:
                print(f"[Extractor] Successfully transcribed audio via AssemblyAI ({len(transcript_obj.text.split())} words)")
                return transcript_obj.text.strip()
        except Exception as aai_err:
            print(f"[Extractor] AssemblyAI transcription error: {aai_err}")

    return ""


def extract_content_from_url(url: str, timeout: int = 25) -> Dict[str, Any]:
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

    # 1. Advanced Extraction with yt-dlp & AI Speech Transcription (Meta Ad Library, Facebook, Instagram, YouTube, TikTok)
    is_video_platform = any(k in url.lower() for k in [
        "facebook.com/ads", "fb.watch", "facebook.com", "instagram.com", "youtube.com", "youtu.be", "tiktok.com"
    ])

    if _YTDLP_AVAILABLE and is_video_platform:
        downloaded_file = None
        try:
            # Download audio/lightweight video stream for transcription
            temp_dir = tempfile.gettempdir()
            out_tmpl = os.path.join(temp_dir, "ad_audio_%(id)s.%(ext)s")
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "format": "bestaudio/best[height<=480]/best",
                "outtmpl": out_tmpl,
                "max_filesize": 35 * 1024 * 1024,
                "socket_timeout": timeout
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info:
                    result["source_type"] = info.get("extractor", "social_ad")
                    result["title"] = info.get("title", "")
                    uploader = info.get("uploader", "")
                    ad_description = info.get("description", "")
                    result["video_stream_url"] = info.get("url", "")

                    downloaded_file = ydl.prepare_filename(info)
                    if not os.path.exists(downloaded_file):
                        # Find matching file in temp_dir
                        base_prefix = os.path.join(temp_dir, f"ad_audio_{info.get('id', '')}")
                        for ext in [".mp4", ".m4a", ".webm", ".mkv"]:
                            cand = base_prefix + ext
                            if os.path.exists(cand):
                                downloaded_file = cand
                                break

                    # Transcribe downloaded media
                    if downloaded_file and os.path.exists(downloaded_file):
                        transcript = transcribe_audio_file(downloaded_file)
                        if transcript:
                            result["audio_transcript"] = transcript

                    # Build structured extracted content
                    parts = []
                    if result["audio_transcript"]:
                        parts.append(f"SPOKEN VIDEO SCRIPT (AI TRANSCRIBED VERBATIM):\n\"{result['audio_transcript']}\"")
                    elif result["title"]:
                        parts.append(f"AD / VIDEO TITLE:\n{result['title']}")

                    if uploader:
                        parts.append(f"ADVERTISER / BRAND:\n{uploader}")

                    if ad_description:
                        parts.append(f"PRIMARY AD COPY & CAPTION:\n{ad_description}")

                    if not result["audio_transcript"]:
                        parts.append("[Note: No spoken dialogue detected or audio track was instrumental]")

                    result["extracted_text"] = "\n\n".join(parts)
                    result["status"] = "SUCCESS"
                    return result
        except Exception as yt_err:
            print(f"[Extractor] yt-dlp extraction fallback: {yt_err}")
            # Try flat extract if download failed
            try:
                with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True}) as ydl_flat:
                    info_flat = ydl_flat.extract_info(url, download=False)
                    if info_flat:
                        result["title"] = info_flat.get("title", "")
                        ad_desc = info_flat.get("description", "")
                        result["extracted_text"] = f"AD TITLE: {result['title']}\n\nAD CAPTION: {ad_desc}"
                        result["status"] = "SUCCESS"
                        return result
            except Exception:
                pass
        finally:
            if downloaded_file and os.path.exists(downloaded_file):
                try:
                    os.remove(downloaded_file)
                except Exception:
                    pass

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
            print(f"[Extractor] YouTube oEmbed fallback: {yt_err}")

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
        print(f"[Extractor] Failed to fetch URL {url}: {e}")
        result["status"] = "FALLBACK"
        result["extracted_text"] = f"Reference Link: {url}\n(Provide ad script/transcript text if link is protected or behind a login.)"
        return result
