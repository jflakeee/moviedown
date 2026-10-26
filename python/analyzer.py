"""Media to Drive browser-side public media URL analyzer (Pyodide)."""
from urllib.parse import urlsplit, urlunsplit, urljoin, unquote
import ipaddress
import json
import re

EXTENSIONS = {".mp4": "MP4", ".webm": "WebM", ".mov": "MOV"}
MAX_CANDIDATES = 100

def normalize(raw, base=None):
    if not isinstance(raw, str) or len(raw) > 8192:
        return None
    raw = raw.strip()
    try:
        url = urljoin(base, raw) if base else raw
        parts = urlsplit(url)
        if parts.scheme not in ("https", "http") or not parts.hostname:
            return None
        if parts.username or parts.password:
            return None
        hostname = parts.hostname.lower()
        if hostname == "localhost" or hostname.endswith((".localhost", ".local")):
            return None
        try:
            if not ipaddress.ip_address(hostname).is_global:
                return None
        except ValueError:
            pass
        return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    except (ValueError, TypeError):
        return None

def analyze(raw, base=None):
    url = normalize(raw, base)
    if not url:
        return {"kind": "invalid", "url": None, "format": None, "reason": "유효한 공개 HTTP(S) URL이 아닙니다."}
    path = unquote(urlsplit(url).path).lower()
    extension = next((ext for ext in EXTENSIONS if path.endswith(ext)), None)
    if extension:
        return {"kind": "direct", "url": url, "format": EXTENSIONS[extension], "reason": "직접 미디어 파일 후보"}
    if path.endswith(".m3u8"):
        return {"kind": "stream", "url": url, "format": "HLS", "reason": "스트리밍 목록입니다. 직접 파일 업로드 대상이 아닙니다."}
    if path.endswith(".mpd"):
        return {"kind": "stream", "url": url, "format": "DASH", "reason": "스트리밍 목록입니다. 직접 파일 업로드 대상이 아닙니다."}
    return {"kind": "page", "url": url, "format": None, "reason": "웹페이지 또는 확장자를 확인할 수 없는 링크"}

def candidates(items):
    results = []
    seen = set()
    for item in items[:MAX_CANDIDATES]:
        if not isinstance(item, dict):
            continue
        info = analyze(item.get("url"), item.get("base"))
        if info["kind"] == "invalid" or info["url"] in seen:
            continue
        seen.add(info["url"])
        info["label"] = str(item.get("label") or "")[:120]
        info["source"] = str(item.get("source") or "page")[:30]
        results.append(info)
    return results

def dispatch(payload):
    if not isinstance(payload, dict):
        return {"error": "잘못된 분석 요청"}
    operation = payload.get("operation")
    if operation == "analyze":
        return analyze(payload.get("url"), payload.get("base"))
    if operation == "candidates":
        return candidates(payload.get("items") or [])
    return {"error": "지원하지 않는 작업"}
