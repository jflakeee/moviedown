# Media to Drive v0.5

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
