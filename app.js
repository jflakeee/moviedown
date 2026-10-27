import {analyzePython} from "./python-client.js";
import {createTaskManager} from "./task-manager.js";

const $ = id => document.getElementById(id);
const HISTORY_KEY = "moviedown_history";
let token = "";
let tokenExpiresAt = 0;
let tokenTimer = null;
let aborter = null;
const log = message => { $("status").textContent = message; };
const cancelled = error => error?.name === "AbortError" || error?.message === "취소됨";
const jobs = createTaskManager(renderJobs);

function renderJobs(state) {
  const root = $("jobs");
  const entries = [...(state.active ? [state.active] : []), ...state.recent];
  const labels = {queued:"대기", analyzing:"분석 중", uploading:"업로드 중",
    completed:"완료", failed:"실패", cancelled:"취소"};
  root.replaceChildren();
  if (!entries.length) {
    root.textContent = "시작한 작업이 없습니다.";
    return;
  }
  for (const entry of entries) {
    const line = document.createElement("div");
    line.className = "history-item";
    const name = document.createElement("span");
    name.textContent = entry.label + " · " + (labels[entry.status] || entry.status);
    const detail = document.createElement("small");
    detail.textContent = entry.detail + (entry.status === "uploading" ? " (" + entry.progress + "%)" : "");
    line.append(name, detail);
    root.append(line);
  }
}

function isSignedIn() {
  return Boolean(token && Date.now() < tokenExpiresAt);
}
function refresh() {
  const signed = isSignedIn();
  const busy = jobs.busy();
  $("login").textContent = signed ? "로그인됨" : "Google 로그인";
  $("login").disabled = signed || busy;
  $("login").setAttribute("aria-label", signed ? "Google 로그인됨" : "Google 로그인");
  $("logout").disabled = !signed || busy;
  $("upload").disabled = !signed || !$("rights").checked || busy;
  $("transfer").disabled = !signed || !$("rights").checked || busy;
  $("createFolder").disabled = !signed || busy;
  $("inspect").disabled = busy;
  $("pythonTest").disabled = busy;
  $("cancel").disabled = !aborter;
}
$("rights").addEventListener("change", refresh);
refresh();

function isLocalOrPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") ||
      host === "::1" || host === "::" || host.startsWith("fe80:") ||
      host.startsWith("fc") || host.startsWith("fd")) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split(".").map(Number);
  return parts.some(part => part > 255) || parts[0] === 0 ||
    parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

const sharedMedia = new URL(location.href).searchParams.get("media");
if (sharedMedia) {
  // Never retain incoming signed URLs in the browser's visible address bar.
  window.history.replaceState(null, "", location.pathname + location.hash);
  try {
    const u = new URL(sharedMedia);
    if (["https:", "http:"].includes(u.protocol) &&
        /\.(mp4|webm|mov)$/i.test(u.pathname) && !u.username && !u.password &&
        !isLocalOrPrivateHost(u.hostname)) {
      $("url").value = u.href;
      log("확장프로그램에서 직접 파일 주소를 받았습니다. 보관 권한을 확인하세요.");
    }
  } catch {}
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value.slice(0, 30) : [];
  } catch { return []; }
}
function renderHistory() {
  const root = $("history");
  root.replaceChildren();
  const items = readHistory();
  if (!items.length) { root.textContent = "저장된 업로드 기록이 없습니다."; return; }
  for (const item of items) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id || "")) continue;
    const row = document.createElement("div");
    row.className = "history-item";
    const link = document.createElement("a");
    link.href = "https://drive.google.com/file/d/" + encodeURIComponent(item.id) + "/view";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = (item.name || "영상") + " (" + (item.time || "") + ")";
    row.append(link);
    root.append(row);
  }
}
renderHistory();
$("clearHistory").onclick = () => {localStorage.removeItem(HISTORY_KEY);renderHistory();};
function record(name, id) {
  if (!id) return;
  const items = readHistory();
  items.unshift({name, id, time:new Date().toLocaleString()});
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
  renderHistory();
}

$("login").onclick = () => {
  const client_id = window.MOVIEDOWN_CONFIG?.googleClientId || "";
  if (!client_id.endsWith(".apps.googleusercontent.com"))
    return log("Google OAuth 클라이언트 ID 설정이 필요합니다.");
  if (!window.google?.accounts?.oauth2)
    return log("Google 인증 스크립트가 로드되지 않았습니다.");
  google.accounts.oauth2.initTokenClient({
    client_id,
    scope:"https://www.googleapis.com/auth/drive.file",
    callback: result => {
      if (result.error || !result.access_token)
        return log("인증 실패: " + (result.error || "토큰 없음"));
      token = result.access_token;
      tokenExpiresAt = Date.now() + Math.max(1, Number(result.expires_in) || 3600) * 1000;
      clearTimeout(tokenTimer);
      tokenTimer = setTimeout(refresh, Math.max(1000, tokenExpiresAt - Date.now()));
      refresh();
      log("Google 로그인 완료");
    }
  }).requestAccessToken();
};
$("logout").onclick = () => {
  if (token && window.google?.accounts?.oauth2)
    google.accounts.oauth2.revoke(token, () => {});
  token = "";
  tokenExpiresAt = 0;
  clearTimeout(tokenTimer);
  refresh();
  log("로그아웃 완료");
};
function requireAuth() {
  if (!isSignedIn()) throw Error("Google 로그인이 필요하거나 토큰이 만료되었습니다.");
  if (!$("rights").checked) throw Error("영상 다운로드 및 보관 권한을 확인하세요.");
}
async function api(url, options={}) {
  requireAuth();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  const response = await fetch(url, {...options, headers, redirect:"error"});
  if (!response.ok)
    throw Error("Google Drive API " + response.status + " " + (await response.text()).slice(0, 150));
  return response;
}

async function runJob(kind, label, work) {
  try {jobs.start(kind, label);} catch (error) {log(error.message);return;}
  refresh();
  try {
    const detail = await work();
    jobs.finish("completed", detail || "완료");
    return true;
  } catch (error) {
    const status = cancelled(error) ? "cancelled" : "failed";
    const message = error?.message || String(error);
    jobs.finish(status, message);
    log((status === "cancelled" ? "작업 취소: " : "작업 실패: ") + message);
    return false;
  } finally {
    aborter = null;
    refresh();
  }
}

$("createFolder").onclick = async () => {
  try {
    requireAuth();
    if (jobs.busy()) throw Error("다른 작업 중에는 폴더를 만들 수 없습니다.");
    const name = $("newFolder").value.trim();
    if (!name) throw Error("폴더 이름을 입력하세요.");
    const response = await api("https://www.googleapis.com/drive/v3/files?fields=id,name", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder"})
    });
    const folder = await response.json();
    $("folder").value = folder.id;
    log("폴더 생성 완료: " + folder.name);
  } catch (error) { log(error.message); }
};

function officialCandidates(doc, base) {
  const found = new Map();
  const mediaPattern = /\.(mp4|webm|mov|m3u8|mpd)$/i;
  function add(href, label, source, explicit=false) {
    if (!href) return;
    try {
      const url = new URL(href, base);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
      if (!explicit && !mediaPattern.test(url.pathname)) return;
      found.set(url.href, {url:url.href, label:label || "공개 링크", source, base});
    } catch {}
  }
  const anchors = doc.querySelectorAll("a[href]");
  for (const a of anchors) {
    const label = (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90);
    const explicit = a.hasAttribute("download") || /\bdownload\b/i.test(a.rel || "") ||
      /(다운로드|download|파일 받기)/i.test(label);
    add(a.getAttribute("href"), label, "anchor", explicit);
  }
  const media = doc.querySelectorAll("video[src], video source[src], source[src]");
  for (const element of media)
    add(element.getAttribute("src"), "공개 미디어 요소", "media");
  return {items:[...found.values()].slice(0, 100),
    stats:{anchors:anchors.length,media:media.length,iframes:doc.querySelectorAll("iframe").length}};
}

function renderCandidates(items) {
  const root = $("candidates");
  root.replaceChildren();
  if (!items.length) {
    root.textContent = "공개된 직접 파일 후보가 없습니다. 페이지 접근·CORS 제약 또는 다른 미디어 형식일 수 있습니다.";
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "history-item";
    const info = document.createElement("div");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const display = new URL(item.url);
    link.textContent = (item.label || item.format || "링크") + " — " + display.origin + display.pathname;
    const detail = document.createElement("small");
    detail.textContent = item.format || item.code || item.kind;
    info.append(link, detail);
    row.append(info);
    if (item.upload_candidate) {
      const select = document.createElement("button");
      select.className = "secondary";
      select.textContent = "이 파일 선택";
      select.onclick = () => {
        $("url").value = item.url;
        log("직접 파일 후보를 선택했습니다. 저장 권한 및 서버 접근을 별도로 확인하세요.");
      };
      row.append(select);
    }
    root.append(row);
  }
}

async function py(payload) {
  try {
    const result = await analyzePython(payload);
    $("pythonStatus").textContent = "Python 분석 엔진 작동 중";
    if (result.error) throw Error(result.error);
    return result;
  } catch (error) {
    $("pythonStatus").textContent = "Python 분석 오류: " + error.message;
    throw error;
  }
}
$("pythonTest").onclick = () => runJob("analysis", "Python 엔진 테스트", async () => {
  jobs.update("analyzing", "Pyodide 초기화·주소 분류");
  const result = await py({operation:"analyze", url:$("url").value});
  $("analysisSummary").textContent = result.code + " · " + result.reason;
  return "분류: " + result.code;
});
$("inspect").onclick = () => runJob("analysis", "링크 분석", async () => {
  $("analysisSummary").textContent = "분석 중...";
  $("candidates").textContent = "링크를 검사하는 중...";
  jobs.update("analyzing", "URL 유형 분류");
  const info = await py({operation:"analyze", url:$("url").value});
  if (info.kind === "invalid") {
    $("candidates").textContent = info.reason;
    $("analysisSummary").textContent = info.code + " · " + info.reason;
    throw Error(info.reason);
  }
  if (info.kind === "direct") {
    renderCandidates([info]);
    $("analysisSummary").textContent = "직접 파일 후보 1개 · 접근 및 보관 권한 미확인";
    return "직접 파일 URL을 분류했습니다.";
  }
  if (info.kind === "stream") {
    renderCandidates([info]);
    $("analysisSummary").textContent = info.code + " · 스트리밍 목록은 직접 URL 업로드 대상이 아닙니다.";
    return "스트림 형식을 분류했습니다.";
  }
  jobs.update("analyzing", "CORS 허용 HTML 분석");
  if (new URL(info.url).protocol !== "https:") throw Error("보안상 HTTPS 페이지만 HTML 분석합니다.");
  const controller = new AbortController();
  aborter = controller;
  refresh();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(info.url, {
      mode:"cors",credentials:"omit",redirect:"follow",
      headers:{Accept:"text/html"},signal:controller.signal
    });
    if (!response.ok) throw Error("PAGE_HTTP_" + response.status + ": 페이지 접근 실패");
    if (!response.headers.get("Content-Type")?.toLowerCase().includes("text/html"))
      throw Error("NOT_HTML: 응답이 HTML이 아닙니다.");
    const length = Number(response.headers.get("Content-Length") || 0);
    if (length > 2000000) throw Error("HTML_TOO_LARGE: 페이지가 너무 큽니다.");
    const html = await response.text();
    if (html.length > 2000000) throw Error("HTML_TOO_LARGE: 페이지가 너무 큽니다.");
    const extracted = officialCandidates(new DOMParser().parseFromString(html, "text/html"), response.url);
    const classified = await py({operation:"inspect_candidates",items:extracted.items});
    renderCandidates(classified.items);
    const stats = extracted.stats;
    const summary = classified.summary;
    $("analysisSummary").textContent =
      "HTML 링크 " + stats.anchors + "개 · media 요소 " + stats.media +
      "개 · iframe " + stats.iframes + "개\n" +
      "직접 파일 " + summary.direct + "개 · 스트림 " + summary.stream +
      "개 · 기타 " + summary.page + "개 · 무효 " + summary.invalid + "개\n" +
      (classified.items.length ? "후보는 다운로드 가능 여부를 아직 확인하지 않았습니다." :
      "찾은 후보가 없습니다. 외부 iframe·스크립트·CORS 제한은 분석되지 않을 수 있습니다.");
    return "후보 " + classified.items.length + "개 분류 완료";
  } catch (error) {
    const message = cancelled(error) ? "HTML 분석을 중단했습니다." :
      "페이지 분석 실패 (" + (error instanceof TypeError ? "CORS_OR_NETWORK" : error.message) +
      "). 브라우저가 외부 응답을 읽지 못할 수 있습니다.";
    $("analysisSummary").textContent = message;
    throw error;
  } finally {
    clearTimeout(timer);
  }
});

$("cancel").onclick = () => {
  aborter?.abort();
  log("현재 전송 또는 페이지 분석의 중단을 요청했습니다.");
};

async function upload(name, size, getSlice, signal) {
  requireAuth();
  if (!Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 ** 4)
    throw Error("지원하지 않는 파일 크기입니다.");
  if (signal.aborted) throw Error("취소됨");
  jobs.update("uploading", "Google Drive 전송 세션 생성", 0);
  const metadata = {name,mimeType:"application/octet-stream"};
  const folder = $("folder").value.trim();
  if (folder) metadata.parents = [folder];
  const init = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name", {
    method:"POST",
    headers:{"Content-Type":"application/json",
      "X-Upload-Content-Type":"application/octet-stream",
      "X-Upload-Content-Length":String(size)},
    body:JSON.stringify(metadata),signal
  });
  const session = init.headers.get("Location");
  if (!session) throw Error("Drive 업로드 세션을 받지 못했습니다.");
  let sessionUrl;
  try { sessionUrl = new URL(session); } catch { throw Error("Drive 업로드 세션 주소가 올바르지 않습니다."); }
  if (sessionUrl.protocol !== "https:" || sessionUrl.hostname !== "www.googleapis.com" ||
      sessionUrl.username || sessionUrl.password || !sessionUrl.pathname.startsWith("/upload/"))
    throw Error("허용되지 않은 Drive 업로드 세션 주소입니다.");
  let offset = 0;
  while (offset < size) {
    if (signal.aborted) throw Error("취소됨");
    const end = Math.min(size, offset + 8 * 1024 * 1024);
    const body = await getSlice(offset, end, signal);
    if (body.size !== end - offset) throw Error("원본 영상 데이터 크기 오류");
    let response;
    try {
      response = await fetch(session, {
        method:"PUT",headers:{"Content-Range":"bytes " + offset + "-" + (end - 1) + "/" + size,
          "Content-Type":"application/octet-stream"},body,signal,redirect:"error"
      });
    } catch (error) {
      if (signal.aborted) throw error;
      response = null;
    }
    if (response?.status === 200 || response?.status === 201) {
      const file = await response.json();
      record(name, file.id);
      $("progress").value = 100;
      log("업로드 완료: " + name);
      return "Drive 저장 완료: " + name;
    }
    if (response?.status !== 308) {
      response = await fetch(session, {method:"PUT",
        headers:{"Content-Range":"bytes */" + size},signal,redirect:"error"});
      if (response.status === 200 || response.status === 201) {
        const file = await response.json();
        record(name, file.id);
        $("progress").value = 100;
        log("업로드 완료: " + name);
        return "Drive 저장 완료: " + name;
      }
      if (response.status !== 308) throw Error("업로드 재개 실패: HTTP " + response.status);
    }
    const range = response.headers.get("Range");
    const match = range?.match(/^bytes=0-(\d+)$/);
    const next = match ? Number(match[1]) + 1 : 0;
    if (!Number.isSafeInteger(next) || next < 0 || next > end)
      throw Error("Drive 업로드 오프셋 오류");
    if (next === offset) throw Error("전송 진행이 없습니다. 다시 시도하세요.");
    offset = next;
    const percent = Math.floor(offset / size * 100);
    $("progress").value = percent;
    jobs.update("uploading", "Drive로 전송 중", percent);
    log("업로드 중 " + percent + "%");
  }
  throw Error("Google Drive 완료 응답이 없습니다.");
}
$("upload").onclick = () => runJob("upload", "로컬 영상 업로드", async () => {
  requireAuth();
  const file = $("file").files[0];
  if (!file) throw Error("영상 파일을 선택하세요.");
  $("progress").value = 0;
  aborter = new AbortController();
  refresh();
  return upload(file.name, file.size, (start,end) => Promise.resolve(file.slice(start,end)), aborter.signal);
});
$("transfer").onclick = () => runJob("upload", "직접 URL 업로드", async () => {
  requireAuth();
  const result = await py({operation:"analyze",url:$("url").value});
  if (result.kind !== "direct") throw Error(result.reason);
  aborter = new AbortController();
  refresh();
  const signal = aborter.signal;
  const head = await fetch(result.url, {method:"HEAD",credentials:"omit",signal});
  if (!head.ok) throw Error("원본 파일 HEAD 요청 실패: HTTP " + head.status);
  if ((head.headers.get("Accept-Ranges") || "").toLowerCase() !== "bytes")
    throw Error("원본 서버에서 HTTP Range 지원을 확인할 수 없습니다.");
  const size = Number(head.headers.get("Content-Length"));
  if (!Number.isSafeInteger(size) || size < 1)
    throw Error("원본 파일 크기를 확인하지 못했습니다.");
  const name = decodeURIComponent(new URL(result.url).pathname.split("/").pop()) || "video.mp4";
  $("progress").value = 0;
  return upload(name, size, async (start,end,chunkSignal) => {
    const response = await fetch(result.url, {
      credentials:"omit",headers:{Range:"bytes=" + start + "-" + (end - 1)},signal:chunkSignal
    });
    if (response.status !== 206) throw Error("원본 서버 HTTP 206 응답 필요");
    if (response.headers.get("Content-Range") !== "bytes " + start + "-" + (end - 1) + "/" + size)
      throw Error("원본 파일 Content-Range 불일치");
    return response.blob();
  }, signal);
});
