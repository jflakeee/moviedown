"""Common, browser-only URL extractors for Media to Drive v1.0.

Only classifies public link *candidates*. No network access, DRM handling,
authentication, or claim that a file can actually be downloaded.
"""
import ipaddress
import json
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote

DIRECT_EXTENSIONS = {".mp4": "MP4", ".webm": "WebM", ".mov": "MOV"}
STREAM_EXTENSIONS = {".m3u8": "HLS", ".mpd": "DASH"}
MAX_CANDIDATES = 100
MAX_URL_LENGTH = 8192


def _result(kind, code, reason, url=None, format=None):
    kinds = {
        "direct": "direct_file", "stream": "stream_manifest",
        "page": "html_or_unknown_page", "invalid": "unsupported",
    }
    return {
        "kind": kind,
        "type": kinds[kind],
        "code": code,
        "reason": reason,
        "url": url,
        "format": format,
        "upload_candidate": kind == "direct",
        "verified": False,
    }


def _normalize(raw, base=None):
    if not isinstance(raw, str) or not raw.strip():
        return None, "INVALID_URL"
    if len(raw) > MAX_URL_LENGTH:
        return None, "URL_TOO_LONG"
    if raw.lstrip().lower().startswith("blob:"):
        return None, "BLOB_CONTEXT"
    try:
        value = urljoin(base, raw.strip()) if base else raw.strip()
        parts = urlsplit(value)
        if parts.scheme.lower() not in ("http", "https"):
            return None, "SCHEME_UNSUPPORTED"
        if not parts.hostname:
            return None, "INVALID_HOST"
        if parts.username is not None or parts.password is not None:
            return None, "USERINFO_UNSUPPORTED"
        hostname = parts.hostname.lower().rstrip(".")
        if hostname in ("localhost",) or hostname.endswith((".localhost", ".local")):
            return None, "LOCAL_ADDRESS"
        try:
            if not ipaddress.ip_address(hostname).is_global:
                return None, "LOCAL_ADDRESS"
        except ValueError:
            pass
        if parts.port is not None and not (1 <= parts.port <= 65535):
            return None, "INVALID_URL"
        return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, "")), None
    except (ValueError, TypeError):
        return None, "INVALID_URL"


ERROR_REASONS = {
    "INVALID_URL": "유효한 URL이 아닙니다.",
    "URL_TOO_LONG": "URL이 허용 길이를 초과했습니다.",
    "BLOB_CONTEXT": "blob: 주소는 해당 페이지 내부에서만 사용되며 직접 다운로드 URL이 아닙니다.",
    "SCHEME_UNSUPPORTED": "HTTP(S) 주소만 분석할 수 있습니다.",
    "INVALID_HOST": "URL의 호스트를 확인할 수 없습니다.",
    "USERINFO_UNSUPPORTED": "인증정보가 포함된 URL은 지원하지 않습니다.",
    "LOCAL_ADDRESS": "내부·로컬 주소는 분석하지 않습니다.",
}


def extract_direct(path, url):
    for extension, media_format in DIRECT_EXTENSIONS.items():
        if path.endswith(extension):
            return _result("direct", "DIRECT_FILE", "직접 미디어 파일 후보입니다. 접근·저장 권한은 아직 확인되지 않았습니다.", url, media_format)


def extract_stream(path, url):
    for extension, media_format in STREAM_EXTENSIONS.items():
        if path.endswith(extension):
            return _result("stream", media_format + "_STREAM", "스트리밍 목록입니다. 직접 파일 업로드 대상이 아닙니다.", url, media_format)


def extract_page(path, url):
    if path.endswith((".html", ".htm", ".php", ".asp", ".aspx")) or not path or path.endswith("/"):
        return _result("page", "HTML_PAGE", "웹페이지일 수 있습니다. 공개 링크 분석은 CORS 접근 허용 여부에 좌우됩니다.", url)
    return _result("page", "UNKNOWN_RESOURCE", "확장자만으로 파일 형식을 확인할 수 없습니다. 공개 링크 또는 HTML 응답을 확인해야 합니다.", url)


EXTRACTORS = (extract_direct, extract_stream, extract_page)


def analyze(raw, base=None):
    url, error = _normalize(raw, base)
    if error:
        return _result("invalid", error, ERROR_REASONS[error])
    path = unquote(urlsplit(url).path).lower()
    for extractor in EXTRACTORS:
        result = extractor(path, url)
        if result is not None:
            return result
    return _result("invalid", "UNKNOWN", "분석할 수 없는 URL입니다.")


def inspect_candidates(items):
    result = []
    seen = set()
    counts = {"direct": 0, "stream": 0, "page": 0, "invalid": 0}
    if not isinstance(items, list):
        return {"items": [], "summary": counts, "code": "INVALID_CANDIDATES"}
    for item in items[:MAX_CANDIDATES]:
        if not isinstance(item, dict):
            counts["invalid"] += 1
            continue
        info = analyze(item.get("url"), item.get("base"))
        counts[info["kind"]] += 1
        if info["kind"] == "invalid" or info["url"] in seen:
            continue
        seen.add(info["url"])
        info["label"] = str(item.get("label") or "")[:120]
        info["source"] = str(item.get("source") or "page")[:30]
        result.append(info)
    return {"items": result, "summary": counts, "code": "OK"}


def dispatch(payload):
    if not isinstance(payload, dict):
        return {"error": "잘못된 분석 요청"}
    operation = payload.get("operation")
    if operation == "analyze":
        return analyze(payload.get("url"), payload.get("base"))
    if operation == "inspect_candidates":
        return inspect_candidates(payload.get("items"))
    if operation == "candidates":
        return inspect_candidates(payload.get("items"))["items"]
    return {"error": "지원하지 않는 작업"}
