import sys
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def _safe_print(*args, **kwargs):
    try:
        print(*args, **kwargs)
    except Exception:
        try:
            cleaned = [str(a).encode("ascii", "replace").decode("ascii") for a in args]
            print(*cleaned, **kwargs)
        except Exception:
            pass

import time
import traceback
import json
import os
import re
import base64
import tempfile
import urllib.request
import urllib.parse
from typing import Dict, Any, Optional

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


# Two-Tier Persistent Cache (Memory + Disk JSON)
_CACHE_FILE = os.path.join(tempfile.gettempdir(), "meta_ads_transcript_cache.json")
_MEMORY_CACHE: Dict[str, Dict[str, Any]] = {}


def _load_cache():
    global _MEMORY_CACHE
    if os.path.exists(_CACHE_FILE):
        try:
            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                _MEMORY_CACHE = json.load(f)
        except Exception:
            _MEMORY_CACHE = {}


def _save_cache_entry(url_key: str, data: Dict[str, Any]):
    if not url_key:
        return
    _MEMORY_CACHE[url_key] = data
    # Also index by canonical query id if available (e.g. id=1835955614065211)
    if "id=" in url_key:
        m = re.search(r"id=(\d+)", url_key)
        if m:
            _MEMORY_CACHE[m.group(1)] = data
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_MEMORY_CACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _get_cache_entry(url_key: str) -> Optional[Dict[str, Any]]:
    if not _MEMORY_CACHE:
        _load_cache()
    if url_key in _MEMORY_CACHE:
        return _MEMORY_CACHE[url_key]
    if "id=" in url_key:
        m = re.search(r"id=(\d+)", url_key)
        if m and m.group(1) in _MEMORY_CACHE:
            return _MEMORY_CACHE[m.group(1)]
    return None


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


def _upload_file_to_gemini(file_path: str, mime_type: str, gemini_key: str):
    file_size = os.path.getsize(file_path)
    upload_url_init = f"https://generativelanguage.googleapis.com/upload/v1beta/files?key={gemini_key}"
    headers = {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(file_size),
        "X-Goog-Upload-Header-Content-Type": mime_type,
        "Content-Type": "application/json"
    }
    metadata = {
        "file": {
            "display_name": os.path.basename(file_path)
        }
    }
    init_res = requests.post(upload_url_init, headers=headers, json=metadata, timeout=20)
    upload_url = init_res.headers.get("X-Goog-Upload-URL")
    if not upload_url:
        _safe_print(f"[Extractor] Gemini File API init failed ({init_res.status_code}): {init_res.text}")
        return None, None

    upload_headers = {
        "Content-Length": str(file_size),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize"
    }
    # Stream file to handle large files (e.g. 100MB+) efficiently
    with open(file_path, "rb") as f:
        upload_res = requests.post(upload_url, headers=upload_headers, data=f, timeout=300)

    if upload_res.status_code != 200:
        _safe_print(f"[Extractor] Gemini File API upload error ({upload_res.status_code}): {upload_res.text}")
        return None, None

    file_info = upload_res.json().get("file", {})
    file_uri = file_info.get("uri")
    file_name = file_info.get("name")
    state = file_info.get("state")
    _safe_print(f"[Extractor] Video uploaded ({file_size / (1024*1024):.1f}MB). State: {state}")

    # Wait for processing if video
    retries = 0
    while state == "PROCESSING" and retries < 35:
        time.sleep(2)
        get_res = requests.get(f"https://generativelanguage.googleapis.com/v1beta/{file_name}?key={gemini_key}", timeout=15)
        if get_res.status_code == 200:
            state = get_res.json().get("state")
            _safe_print(f"[Extractor] Video processing state: {state}")
        retries += 1

    return file_uri, file_name


def _get_gemini_api_key() -> str:
    k = os.getenv("GEMINI_API_KEY")
    if k and len(k.strip()) > 10:
        return k.strip().strip('"\'')
    try:
        import base64
        return base64.b64decode(b'QVEuQWI4Uk42THJBSDU4Wlh1b002S3lleVpBamc5WDdMOGxtZHdWZC0yempzXzY5cGZSX2c=').decode('utf-8')
    except Exception:
        return ""


def transcribe_audio_file(file_path: str) -> str:
    """
    Transcribes and analyzes audio/video file using Gemini Multimodal File API.
    Extracts spoken dialogue verbatim AND visual hook/creative breakdown.
    """
    if not os.path.exists(file_path):
        return ""

    # 1. Obtain Gemini API Key
    gemini_key = _get_gemini_api_key()
    if not gemini_key:
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
            import mimetypes
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                ext_l = os.path.splitext(file_path)[1].lower()
                if ext_l in ['.mp3']:
                    mime_type = 'audio/mp3'
                elif ext_l in ['.m4a', '.aac']:
                    mime_type = 'audio/mp4'
                elif ext_l in ['.wav']:
                    mime_type = 'audio/wav'
                elif ext_l in ['.webm']:
                    mime_type = 'video/webm'
                elif ext_l in ['.mov']:
                    mime_type = 'video/quicktime'
                else:
                    mime_type = 'video/mp4'

            prompt_text = (
                "You are an expert Meta Ads creative director and video analyst. "
                "Analyze this ad video/audio thoroughly for winning ad reproduction:\n\n"
                "1. VERBATIM SPOKEN DIALOGUE / TRANSCRIPT:\n"
                "Transcribe every spoken word verbatim in the spoken language (English, Hindi, or Hinglish). "
                "If the ad has no speech (visual only with music), clearly write: '[Visual Ad - No Spoken Dialogue]'.\n\n"
                "2. VISUAL HOOK & SCENE BREAKDOWN:\n"
                "- Opening Hook (0-3s): Describe the exact visual hook, actor action, or pattern interrupt.\n"
                "- Agitation & Pain: How the customer's problem or frustration is visually depicted.\n"
                "- Product / Solution Reveal: How the product/offer is demonstrated.\n"
                "- Text Overlays & Badges: Any on-screen text, offers, or proof elements.\n"
                "- Call to Action (CTA): The final offer and closing scene.\n\n"
                "Format your response clearly starting with the transcript and followed by the breakdown."
            )

            file_size = os.path.getsize(file_path)
            is_video = mime_type.startswith("video/") or file_size > 10 * 1024 * 1024

            if is_video:
                _safe_print(f"[Extractor] Uploading {file_size / (1024*1024):.1f}MB video to Gemini File API...")
                file_uri, file_name = _upload_file_to_gemini(file_path, mime_type, gemini_key)
                if not file_uri:
                    raise RuntimeError("Failed to upload video to Gemini File API")
                parts = [
                    {"text": prompt_text},
                    {"file_data": {"mime_type": mime_type, "file_uri": file_uri}}
                ]
            else:
                with open(file_path, "rb") as f:
                    b64_audio = base64.b64encode(f.read()).decode("utf-8")
                parts = [
                    {"text": prompt_text},
                    {"inline_data": {"mime_type": mime_type, "data": b64_audio}}
                ]

            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {"temperature": 0.2}
            }

            models_to_try = [
                "gemini-flash-lite-latest",
                "gemini-3.5-flash-lite",
                "gemini-3-flash",
                "gemini-3.5-flash",
                "gemini-3.6-flash",
                "gemini-2.5-flash"
            ]

            for model_name in models_to_try:
                for retry_attempt in range(2):
                    try:
                        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                        res = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=60)
                        if res.status_code == 200:
                            res_data = res.json()
                            candidates = res_data.get("candidates", [])
                            if candidates:
                                res_parts = candidates[0].get("content", {}).get("parts", [])
                                if res_parts and "text" in res_parts[0]:
                                    transcript = res_parts[0]["text"].strip()
                                    if transcript:
                                        _safe_print(f"[Extractor] Successfully analyzed video via {model_name} ({len(transcript.split())} words)")
                                        return transcript
                        elif res.status_code in [429, 503]:
                            _safe_print(f"[Extractor] {model_name} returned {res.status_code}, waiting 3s before retry/failover...")
                            time.sleep(3)
                        else:
                            _safe_print(f"[Extractor] {model_name} status {res.status_code}: {res.text[:120]}")
                            break
                    except Exception as m_err:
                        _safe_print(f"[Extractor] {model_name} error: {m_err}")
                        time.sleep(2)
        except Exception as g_err:
            _safe_print(f"[Extractor] Gemini multimodal processing error: {g_err}")
            traceback.print_exc()

    # 2. Try AssemblyAI Fallback    # 2. Try AssemblyAI Fallback    # 2. Try AssemblyAI Fallback
    aai_key = os.getenv("ASSEMBLYAI_API_KEY")
    if aai_key and _AAI_AVAILABLE:
        try:
            aai.settings.api_key = aai_key
            transcriber = aai.Transcriber()
            transcript_obj = transcriber.transcribe(file_path)
            if transcript_obj.status == aai.TranscriptStatus.completed and transcript_obj.text:
                _safe_print(f"[Extractor] Successfully transcribed audio via AssemblyAI ({len(transcript_obj.text.split())} words)")
                return transcript_obj.text.strip()
        except Exception as aai_err:
            _safe_print(f"[Extractor] AssemblyAI transcription error: {aai_err}")

    return ""



def _extract_meta_ad_library_fast(url: str, timeout: int = 5) -> Optional[Dict[str, Any]]:
    """
    Ultra-fast scraper for Meta Ad Library links (under 0.5s).
    Extracts brand/advertiser and verbatim ad copy text directly from page JSON payload,
    bypassing slow yt-dlp media downloads and Vercel serverless timeouts.
    """
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as res:
            html = res.read().decode("utf-8", errors="ignore")

        bodies = re.findall(r'"body":\s*\{\s*"text":\s*"([^"]+)"', html)
        page_names = re.findall(r'"page_name":\s*"([^"]+)"', html)

        brand = page_names[0] if page_names else ""
        ad_copy = ""
        if bodies:
            try:
                ad_copy = json.loads('"' + bodies[0] + '"')
            except Exception:
                ad_copy = bodies[0]

        # Filter out generic bot-wall titles
        generic_placeholders = [
            "ad library", "meta ad library", "facebook", "log in", "see ad details",
            "विज्ञापन लाइब्रेरी", "विज्ञापन", "library", "facebook ad library"
        ]
        if brand and brand.lower().strip() in generic_placeholders:
            brand = ""

        if not brand and not ad_copy:
            t_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I)
            if t_match:
                cand = t_match.group(1).strip()
                if cand.lower() not in generic_placeholders:
                    brand = cand

        # Only return SUCCESS if we extracted substantive ad copy or a verified real brand
        if (ad_copy and len(ad_copy.strip()) > 15) or (brand and brand.lower() not in generic_placeholders and len(brand) > 2):
            parts = []
            if brand:
                parts.append(f"ADVERTISER / BRAND:\n{brand}")
            if ad_copy:
                parts.append(f"PRIMARY AD COPY & CAPTION:\n{ad_copy}")

            return {
                "url": url,
                "title": brand or "Meta Library Ad",
                "uploader": brand,
                "description": ad_copy,
                "extracted_text": "\n\n".join(parts),
                "video_stream_url": "",
                "audio_transcript": "",
                "source_type": "meta_ad_library",
                "status": "SUCCESS"
            }
    except Exception as e:
        _safe_print(f"[Extractor] Fast Meta Library scrape notice: {e}")
    return None



def _extract_meta_ad_via_jina_proxy(url: str, timeout: int = 6) -> Optional[Dict[str, Any]]:
    """
    Bypasses Vercel datacenter IP blocks by requesting public Meta Ad Library links
    through Jina Reader (https://r.jina.ai/<url>), returning clean text/markdown.
    """
    try:
        jina_url = "https://r.jina.ai/" + url
        req = urllib.request.Request(
            jina_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/plain,text/markdown,*/*"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text_data = res.read().decode("utf-8", errors="ignore")

        brand = ""
        brand_matches = re.findall(r'\[([^\]]+)\]\(https?://(?:www\.)?facebook\.com/[0-9]+\)', text_data)
        if brand_matches:
            for b in brand_matches:
                b_clean = b.strip()
                if not any(sw in b_clean.lower() for sw in ["log in", "ad library", "meta", "facebook", "report", "cookies"]):
                    brand = b_clean
                    break

        lines = [line.strip() for line in text_data.split("\n") if line.strip()]
        filtered_lines = []
        skip_words = [
            "meta ad library", "ad library report", "branded content", "log in",
            "cookie", "privacy", "system status", "subscribe to email", "about ads and data",
            "url source:", "markdown content:", "title: ad library"
        ]
        for line in lines:
            l_lower = line.lower()
            if not any(sw in l_lower for sw in skip_words) and not line.startswith("[?") and not line.startswith("!["):
                if len(line) > 15:
                    filtered_lines.append(line)

        ad_text = "\n\n".join(filtered_lines[:8]) if filtered_lines else ""

        if brand or ad_text:
            parts = []
            if brand:
                parts.append(f"ADVERTISER / BRAND:\n{brand}")
            if ad_text:
                parts.append(f"PRIMARY AD COPY & CAPTION:\n{ad_text}")

            return {
                "url": url,
                "title": brand or "Meta Library Ad",
                "uploader": brand,
                "description": ad_text,
                "extracted_text": "\n\n".join(parts),
                "video_stream_url": "",
                "audio_transcript": "",
                "source_type": "meta_ad_library_proxy",
                "status": "SUCCESS"
            }
    except Exception as e:
        _safe_print(f"[Extractor] Jina proxy notice: {e}")
    return None


def extract_content_from_url(url: str, timeout: int = 20) -> Dict[str, Any]:
    url = url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

        # 0. Check Permanent Cache First (0 API requests hit, 0.001s return)
    cached = _get_cache_entry(url)
    if cached and cached.get("status") == "SUCCESS" and len(cached.get("extracted_text", "")) > 100:
        _safe_print(f"[Extractor] Cache HIT for {url} (returning from local cache)")
        return dict(cached)

    # (Fast and Jina scrapers are available as fallback if yt-dlp is unavailable or challenged)

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

    # 1. Advanced Extraction with yt-dlp & Fast AI Speech Transcription
    is_video_platform = any(k in url.lower() for k in [
        "facebook.com/ads", "fb.watch", "facebook.com", "instagram.com", "youtube.com", "youtu.be", "tiktok.com"
    ])

    if _YTDLP_AVAILABLE and is_video_platform:
        downloaded_file = None
        try:
            temp_dir = tempfile.gettempdir()
            out_tmpl = os.path.join(temp_dir, "ad_audio_%(id)s.%(ext)s")
            
            # Fast SD download (75% smaller file, ~1.3MB instead of 5.4MB)
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "format": "sd/worst/best",
                "outtmpl": out_tmpl,
                "max_filesize": 25 * 1024 * 1024,
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
                        base_prefix = os.path.join(temp_dir, f"ad_audio_{info.get('id', '')}")
                        for ext in [".mp4", ".m4a", ".webm", ".mkv"]:
                            cand = base_prefix + ext
                            if os.path.exists(cand):
                                downloaded_file = cand
                                break

                    # Transcribe downloaded media (lightweight SD format)
                    if downloaded_file and os.path.exists(downloaded_file):
                        transcript = transcribe_audio_file(downloaded_file)
                        if transcript:
                            result["audio_transcript"] = transcript

                    # Build structured extracted content with full video analysis
                    parts = []
                    if uploader:
                        parts.append(f"ADVERTISER / BRAND:\n{uploader}")

                    if ad_description:
                        parts.append(f"PRIMARY AD COPY & CAPTION:\n{ad_description}")

                    if result["audio_transcript"]:
                        parts.append(result["audio_transcript"])
                    elif result["title"]:
                        parts.append(f"AD / VIDEO TITLE:\n{result['title']}")

                    if not result["audio_transcript"] and not ad_description:
                        parts.append("[Note: No spoken dialogue or visual breakdown detected]")

                    result["extracted_text"] = "\n\n".join(parts)
                    result["status"] = "SUCCESS"

                    # Save to Cache so future requests never hit API again
                    _save_cache_entry(url, result)
                    return result
        except Exception as yt_err:
            _safe_print(f"[Extractor] yt-dlp extraction notice: {yt_err}")
            # Fallback 1: Fast Meta Ad Library parser
            if "facebook.com/ads" in url.lower() or "meta.com/ads" in url.lower():
                fast_res = _extract_meta_ad_library_fast(url, timeout=5)
                if fast_res and fast_res.get("extracted_text"):
                    _safe_print(f"[Extractor] Fast Meta Ad Library fallback success for {url}")
                    _save_cache_entry(url, fast_res)
                    return fast_res

                # Fallback 2: Jina Reader Proxy (bypasses datacenter IP blocks on Vercel)
                jina_res = _extract_meta_ad_via_jina_proxy(url, timeout=6)
                if jina_res and jina_res.get("extracted_text"):
                    _safe_print(f"[Extractor] Jina proxy Meta fallback success for {url}")
                    _save_cache_entry(url, jina_res)
                    return jina_res
            try:
                with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True}) as ydl_flat:
                    info_flat = ydl_flat.extract_info(url, download=False)
                    if info_flat:
                        result["title"] = info_flat.get("title", "")
                        ad_desc = info_flat.get("description", "")
                        result["extracted_text"] = f"AD TITLE: {result['title']}\n\nAD CAPTION: {ad_desc}"
                        result["status"] = "SUCCESS"
                        _save_cache_entry(url, result)
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
                    _save_cache_entry(url, result)
                    return result
        except Exception as yt_err:
            _safe_print(f"[Extractor] YouTube oEmbed fallback: {yt_err}")

    # 3. Generic Webpage Scraper (Googlebot & Browser UA Failover)
    user_agents = [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ]
    html = None
    for ua in user_agents:
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": ua,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            )
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if response.status == 200:
                    html = response.read().decode("utf-8", errors="ignore")
                    if html:
                        break
        except Exception as fetch_err:
            _safe_print(f"[Extractor] Scraper attempt fallback: {fetch_err}")

    if html:
        try:
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
            # Check for dummy Facebook Ad Library placeholders and anti-bot challenge pages
            t_clean = (result["title"] or "").strip().lower()
            b_clean = (body_snippet or "").strip().lower()
            bot_keywords = [
                "ad library", "meta ad library", "facebook", "log in", "see ad details",
                "विज्ञापन लाइब्रेरी", "विज्ञापन", "library"
            ]
            is_bot_title = any(kw in t_clean for kw in bot_keywords)
            is_bot_body = (not b_clean) or any(b_clean == kw for kw in bot_keywords) or len(b_clean) < 30
            has_challenge_js = "executechallenge" in html.lower() or "__rd_verify" in html.lower()

            if is_bot_title or is_bot_body or has_challenge_js:
                result["status"] = "FALLBACK"
                result["extracted_text"] = f"Reference Ad Link: {url}\n\n[Note: This Facebook Ad Library link is protected by Facebook's login bot-wall. Please switch to the 'Upload Media' tab to upload the video file directly, or paste the ad script text.]"
                return result

            summary_parts = []
            bot_list = ["ad library", "meta ad library", "facebook", "log in", "विज्ञापन लाइब्रेरी", "विज्ञापन"]
            if result["title"] and not any(kw in result["title"].lower() for kw in bot_list):
                summary_parts.append(f"Title: {result['title']}")
            if result["description"]:
                summary_parts.append(f"Description: {result['description']}")
            if body_snippet and not any(body_snippet.lower().strip() == kw for kw in bot_list) and len(body_snippet) > 30:
                summary_parts.append(f"Content Snippet: {body_snippet}")

            result["extracted_text"] = "\n\n".join(summary_parts) if summary_parts else f"URL Source: {url}"
            result["status"] = "SUCCESS" if summary_parts else "FALLBACK"
            _save_cache_entry(url, result)
            return result
        except Exception as parse_err:
            _safe_print(f"[Extractor] HTML parse fallback: {parse_err}")

    result["status"] = "FALLBACK"
    result["extracted_text"] = f"Reference Link: {url}\n(Please paste the ad script or hook details directly if this link requires authentication or is restricted.)"
    # Never save failed fallback to cache, allowing subsequent retries
    return result
