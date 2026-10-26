# Media to Drive v0.8

GitHub Pages: https://jflakeee.github.io/moviedown/

## One-time operator setup

1. Google Cloud Console: create or select a project; enable Google Drive API.
2. Configure OAuth consent screen (including test users while in testing mode).
3. Create OAuth client of type **Web application**.
4. Add authorized JavaScript origin: `https://jflakeee.github.io` (origin only, no /moviedown path).
5. In `config.js`, replace `REPLACE_WITH_GOOGLE_OAUTH_WEB_CLIENT_ID` with the issued **client ID** ending in `.apps.googleusercontent.com`. Commit the change to main. The client ID is public; **never put the client secret in frontend code**.
6. Repository Settings > Pages > Source: GitHub Actions. Verify workflow succeeds.

Visitors then use the **Google 로그인** button, without entering an OAuth client ID. No OAuth access token is persisted.

Note: Google Drive `drive.file` scope may require OAuth app verification for general public use, depending on publishing status. Actual login/upload remains to be verified in a browser with a configured Google Cloud project. The app supports local files and direct CORS/HTTP Range-enabled video URLs, not extracting videos from web pages or bypassing DRM.

## v0.8 Browser Python architecture

- `python/analyzer.py`: pure Python URL normalization, media format classification, deduplication, and rejection of private/localhost IP literals.
- `python-worker.js`: lazy-loads Pyodide 0.27.7 from jsDelivr in a dedicated Web Worker; downloads `python/analyzer.py` on first use.
- `python-client.js`: request/response messaging, timeouts, worker error propagation.
- `app.js`: extracts public links from CORS-readable HTML and delegates URL candidate classification to Python. Video bytes and OAuth tokens remain in JavaScript; uploads still use Google Drive resumable upload.
- `extension/`: optional Chrome MV3 detector. It can pass selected public direct-file URLs to the web app.

### Test checklist
1. Open GitHub Pages, enter `https://example.com/movie.mp4`, and click **Python 엔진 테스트**. Confirm the status says Python is ready and MP4 is classified as a direct file.
2. Click **Python으로 공식 링크 분석** and verify the direct-file candidate appears.
3. Try a `.m3u8` URL and confirm it is identified as a stream, not a direct file.
4. Try an invalid URL and confirm rejection.
5. Test a CORS-enabled HTML page containing public `<a download>` links; verify candidates are listed.
6. With a test Google account, validate login, local-file upload, direct URL upload, cancellation, and history in a real browser.

### Limitations
Pyodide does not bypass CORS, browser permissions, authentication, DRM, or protected streaming. Cross-origin HTML analysis requires CORS permission. The first Python analysis needs to download Pyodide and requires access to jsDelivr. URLs and candidate metadata are processed in the user's browser. Remote file upload still requires the origin server to allow CORS and support HTTP Range requests.

### Deployment
Commit to main; GitHub Actions Pages workflow deploys the static app if Pages is configured to use GitHub Actions. A successful commit is not proof of a successful deployment or browser integration test.
