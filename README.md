# Media to Drive v1.0

Browser-first media URL analysis and rights-confirmed file uploads to Google Drive.

- Web app: https://jflakeee.github.io/moviedown/
- Chrome extension: [extension/](extension/)
- Python analyzer: [python/analyzer.py](python/analyzer.py)
- Tests: [tests/](tests/)

## Architecture

1. The public static web app obtains a Google OAuth access token with the Drive `drive.file` scope. Tokens are **only stored in memory**, never in localStorage.
2. The `python-worker.js` worker lazily loads Pyodide 0.27.7 and the `python/analyzer.py` source. It classifies URLs and batches of public link candidates without requesting those URLs.
3. The app reads HTML only if the destination expressly permits browser cross-origin access (CORS). HTML `a` and media elements provide candidate URLs for Python to classify. A separate optional Chrome extension can analyze permitted pages.
4. `task-manager.js` tracks one active analysis/upload operation and up to eight recent operations per open tab.
5. JavaScript streams rights-confirmed local files or public direct video files to the user's Drive through resumable 8 MiB chunks. Remote URLs still need CORS and byte-range support.

No Playwright server, credentials proxy, DRM bypass, access-control bypass, stream decryption, or forced cross-origin access is provided.

## Extraction result contract

The Pyodide worker accepts `{operation:"analyze",url:"https://..."}` and
`{operation:"inspect_candidates",items:[{"url":"https://...", "label":"..."}]}`.

Example result from `analyze`:

```json
{
  "kind": "direct",
  "type": "direct_file",
  "code": "DIRECT_FILE",
  "reason": "직접 미디어 파일 후보입니다. 접근·저장 권한은 아직 확인되지 않았습니다.",
  "url": "https://example.com/video.mp4",
  "format": "MP4",
  "upload_candidate": true,
  "verified": false
}
```

- `direct` -> MP4, WebM, or MOV *candidate*. Does **not** verify rights, reachability, or CORS.
- `stream` -> HLS (`.m3u8`) or DASH (`.mpd`), not a direct-file upload candidate.
- `page` -> HTML or an unknown URL path.
- `invalid` -> unsupported schemes, embedded URL credentials, loopback/private IP literals, `blob:` URLs, or malformed URLs.

`inspect_candidates` returns `{items, summary, code}`, with summary counts for direct/stream/page/invalid results. URLs are deduplicated. Classifiers never fetch or decode media.

## Setup

1. Enable the Google Drive API in Google Cloud Console.
2. Configure the OAuth consent screen, and add a test account if the consent screen is in testing mode.
3. Create an OAuth **Web application** client. Add JavaScript origin `https://jflakeee.github.io` (no path).
4. Put only the public OAuth **client ID** in `config.js`. Never commit OAuth client secrets, access tokens, `.env` secrets, databases, or ZIP archives with credentials.
5. Configure GitHub Pages to deploy using GitHub Actions.

## Validation

Run Python tests:

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
```

Run JavaScript task tests (Node.js 22+):

```bash
npm run test:js
```

The Pages workflow runs these tests and JS syntax checks before deployment. A successful commit does not prove a workflow passed or browser features worked.

In a browser, test these scenarios:
- Python engine test with `https://example.com/video.mp4` -> `DIRECT_FILE`.
- Analyze `https://example.com/playlist.m3u8` -> `HLS_STREAM`.
- Analyze `https://example.com/movie/8717` -> `UNKNOWN_RESOURCE`; this is **not evidence** that a downloadable file exists.
- Analyze a CORS-allowed HTML page with an explicit public download link -> classified candidate(s), count summary.
- Analyze inaccessible HTML -> appropriate CORS/network failure, no inferred DRM.
- After OAuth login, the button becomes `로그인됨`.
- Upload a small local test file; verify Drive file and recent history. Repeat with cancellation and errors.
- Upload an authorized remote file with CORS, `HEAD`, `Content-Length`, and HTTP Range `206` support.

## Known limits

- Pyodide cannot bypass CORS, permissions, site authentication, or DRM. Chrome extensions require appropriate site host permissions.
- Pages using cross-origin iframe content, runtime-generated streams, blob URLs, or JavaScript-only players can produce zero directly downloadable candidates.
- Do **not** interpret a direct-file URL classification as proof of permission to download.
- Remote uploads are limited to publicly accessible, CORS-enabled, byte-range-enabled MP4/WebM/MOV URLs. The app does not assemble HLS/DASH streams.
- Job history is in-memory per tab. Recent successful upload records (file name/id/time only) stay in that browser's localStorage (max 30). There is no persistent resumable job queue.
- Browser/CDN access and actual OAuth/Drive integration must be tested on the deployed site. The GitHub connector can update source but does not run a Chrome instance.

## Planned improvements

- Browser integration tests and Drive resumable-upload recovery testing.
- Optional, independently hosted Playwright service for explicitly authorized site analysis, with DNS/IP/redirect protections if enabled.
- Improved extension-to-page URL transfer to avoid placing signed link query strings in navigational URLs.
