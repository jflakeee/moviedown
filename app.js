const $=id=>document.getElementById(id);
let token="",aborter=null;
const log=s=>$("status").textContent=s;
const key="moviedown_history";
const sharedMedia=new URL(location.href).searchParams.get("media");
if(sharedMedia){
 try{
  const u=new URL(sharedMedia);
  if(["https:","http:"].includes(u.protocol)&&/\.(mp4|webm|mov)$/i.test(u.pathname)&&!u.username&&!u.password){
   $("url").value=u.href;
   history.replaceState(null,"",location.pathname+location.hash);
   $("status").textContent="확장프로그램에서 탐지한 미디어 주소를 받았습니다. 파일 보관 권한을 확인하고 업로드하세요.";
  }
 }catch{}
}

function refresh(){const signed=!!token;const allowed=signed&&$("rights").checked;$("upload").disabled=!allowed;$("transfer").disabled=!allowed;$("createFolder").disabled=!signed;$("cancel").disabled=!aborter;$("logout").disabled=!signed}
$("rights").addEventListener("change",refresh);
refresh();
function history(){const items=JSON.parse(localStorage.getItem(key)||"[]");$("history").replaceChildren(...items.map(x=>{const d=document.createElement("div"),a=document.createElement("a");a.href="https://drive.google.com/file/d/"+encodeURIComponent(x.id)+"/view";a.target="_blank";a.rel="noopener noreferrer";a.textContent=x.name+" ("+x.time+")";d.append(a);return d}))}
history();$("clearHistory").onclick=()=>{localStorage.removeItem(key);history()};
$("login").onclick=()=>{const client_id=window.MOVIEDOWN_CONFIG?.googleClientId||"";if(!client_id||!client_id.endsWith(".apps.googleusercontent.com"))return log("사이트 운영자의 Google 로그인 설정이 필요합니다. README를 확인하세요.");if(!window.google?.accounts?.oauth2)return log("Google 인증 스크립트가 로드되지 않았습니다.");google.accounts.oauth2.initTokenClient({client_id,scope:"https://www.googleapis.com/auth/drive.file",callback:r=>{if(r.error)return log("인증 실패: "+r.error);token=r.access_token;refresh();log("Google 로그인 완료")}}).requestAccessToken()};
$("logout").onclick=()=>{if(token)google.accounts.oauth2.revoke(token,()=>{});token="";refresh();log("로그아웃 완료")};
function requireAuth(){if(!token)throw Error("Google 로그인이 필요합니다.");if(!$("rights").checked)throw Error("영상 보관 권한을 확인하세요.")}
async function api(url,options={}){if(!token)throw Error("로그인이 필요합니다.");const h=new Headers(options.headers||{});h.set("Authorization","Bearer "+token);const r=await fetch(url,{...options,headers:h});if(!r.ok)throw Error("Google Drive API "+r.status+" "+(await r.text()).slice(0,150));return r}
$("createFolder").onclick=async()=>{try{requireAuth();const name=$("newFolder").value.trim();if(!name)throw Error("폴더 이름을 입력하세요.");const r=await api("https://www.googleapis.com/drive/v3/files?fields=id,name",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder"})});const f=await r.json();$("folder").value=f.id;log("폴더 생성 완료: "+f.name)}catch(e){log(e.message)}};
function record(name,id){if(!id)return;const items=JSON.parse(localStorage.getItem(key)||"[]");items.unshift({name,id,time:new Date().toLocaleString()});localStorage.setItem(key,JSON.stringify(items.slice(0,30)));history()}
function classify(raw){try{const u=new URL(raw);if(!["https:","http:"].includes(u.protocol))throw Error();if(/\.(mp4|webm|mov)$/i.test(u.pathname))return {kind:"direct",url:u.href,message:"직접 파일 URL입니다. CORS와 HTTP Range 지원이 필요합니다."};return {kind:"page",message:"영상 페이지·스트리밍 주소의 추출은 지원하지 않습니다. 공식 다운로드 파일을 사용하세요."}}catch{return {kind:"invalid",message:"유효한 URL을 입력하세요."}}}

const candidates=$("candidates");
const mediaPath=/\.(mp4|webm|mov)$/i;
function officialCandidates(doc,base){
  const found=new Map();
  for(const a of doc.querySelectorAll("a[href]")){
    const href=a.getAttribute("href")||"";
    let u;try{u=new URL(href,base)}catch{continue}
    if(!["https:","http:"].includes(u.protocol)||u.username||u.password)continue;
    const label=(a.textContent||"").replace(/\s+/g," ").trim().slice(0,90);
    const isMedia=mediaPath.test(u.pathname);
    const explicit=a.hasAttribute("download")||/\bdownload\b/i.test(a.rel)||/(다운로드|download|파일 받기)/i.test(label);
    if(!isMedia&&!explicit)continue;
    if(!isMedia&&!explicit)continue;
    found.set(u.href,{url:u.href,label:label||u.pathname.split("/").pop()||"다운로드 링크",direct:isMedia});
  }
  return [...found.values()].slice(0,30);
}
function renderCandidates(items){
  candidates.replaceChildren();
  if(!items.length){candidates.textContent="공개된 공식 다운로드 링크를 찾지 못했습니다.";return}
  for(const item of items){
    const row=document.createElement("div");row.className="history-item";
    const a=document.createElement("a");a.href=item.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=item.label+" — "+item.url;
    row.append(a);
    if(item.direct){const btn=document.createElement("button");btn.textContent="이 파일 선택";btn.className="secondary";btn.onclick=()=>{$("url").value=item.url;log("직접 파일 URL을 선택했습니다. 다운로드 권한을 확인한 뒤 Drive로 업로드하세요.")};row.append(btn)}
    candidates.append(row);
  }
}
$("inspect").onclick=async()=>{
  candidates.textContent="페이지의 공개 링크를 확인하는 중...";
  const info=classify($("url").value);
  if(info.kind==="invalid"){candidates.textContent=info.message;return}
  if(info.kind==="direct"){renderCandidates([{url:info.url,label:"직접 미디어 파일",direct:true}]);return}
  try{
    const u=new URL($("url").value);
    if(u.protocol!=="https:")throw Error("보안상 HTTPS 페이지만 분석합니다.");
    const response=await fetch(u.href,{method:"GET",mode:"cors",credentials:"omit",redirect:"follow",headers:{Accept:"text/html"},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error("페이지 접근 실패: HTTP "+response.status);
    if(!response.headers.get("Content-Type")?.toLowerCase().includes("text/html"))throw Error("HTML 페이지가 아닙니다.");
    const length=Number(response.headers.get("Content-Length")||0);
    if(length>2_000_000)throw Error("페이지가 너무 큽니다.");
    const html=await response.text();
    if(html.length>2_000_000)throw Error("페이지가 너무 큽니다.");
    const doc=new DOMParser().parseFromString(html,"text/html");
    const items=officialCandidates(doc,response.url);
    renderCandidates(items);
    log(items.length+"개의 공개 다운로드 링크 후보를 찾았습니다. 공식 제공 및 저장 권한을 확인하세요.");
  }catch(e){candidates.textContent="페이지 분석 불가: "+e.message+"\n브라우저 CORS 정책으로 다른 사이트의 HTML을 읽지 못할 수 있습니다. 사이트에서 제공한 공식 다운로드 링크를 직접 입력하세요."}
};
$("cancel").onclick=()=>{aborter?.abort();aborter=null;refresh();log("업로드 취소 요청")};
async function upload(name,size,getSlice){requireAuth();if(!Number.isSafeInteger(size)||size<1||size>5*1024**4)throw Error("지원하지 않는 파일 크기입니다.");aborter=new AbortController();refresh();const signal=aborter.signal;const metadata={name,mimeType:"application/octet-stream"};const folder=$("folder").value.trim();if(folder)metadata.parents=[folder];const r=await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name",{method:"POST",headers:{"Content-Type":"application/json","X-Upload-Content-Type":"application/octet-stream","X-Upload-Content-Length":String(size)},body:JSON.stringify(metadata),signal});const session=r.headers.get("Location");if(!session)throw Error("Drive 업로드 세션을 받지 못했습니다.");let offset=0;const chunkSize=8*1024*1024;while(offset<size){if(signal.aborted)throw Error("취소됨");const end=Math.min(size,offset+chunkSize);const body=await getSlice(offset,end,signal);if(body.size!==end-offset)throw Error("영상 데이터 크기 오류");let response;try{response=await fetch(session,{method:"PUT",headers:{"Content-Range":`bytes ${offset}-${end-1}/${size}`,"Content-Type":"application/octet-stream"},body,signal})}catch(e){if(signal.aborted)throw e;response=null}if(response?.status===200||response?.status===201){const f=await response.json();record(name,f.id);$("progress").value=100;log("업로드 완료: "+name);return}if(response?.status!==308){const check=await fetch(session,{method:"PUT",headers:{"Content-Range":`bytes */${size}`},signal});if(check.status===200||check.status===201){const f=await check.json();record(name,f.id);$("progress").value=100;log("업로드 완료");return}if(check.status!==308)throw Error("업로드 재개 실패: "+check.status);response=check}const range=response.headers.get("Range");const m=range?.match(/^bytes=0-(\d+)$/);const next=m?Number(m[1])+1:0;if(!Number.isSafeInteger(next)||next<0||next>end)throw Error("Drive 오프셋 오류");if(next===offset)throw Error("전송 진행이 없습니다. 다시 시도하세요.");offset=next;$("progress").value=Math.floor(offset/size*100);log("업로드 중 "+$("progress").value+"%")}throw Error("업로드 완료 응답 없음")}
$("upload").onclick=async()=>{try{const f=$("file").files[0];if(!f)throw Error("영상 파일을 선택하세요.");await upload(f.name,f.size,(a,b)=>Promise.resolve(f.slice(a,b)))}catch(e){log("업로드 실패: "+e.message)}};
$("transfer").onclick=async()=>{try{requireAuth();const info=classify($("url").value);if(info.kind!=="direct")throw Error(info.message);const head=await fetch(info.url,{method:"HEAD"});if(!head.ok)throw Error("원본 파일 접근 실패");if(head.headers.get("Accept-Ranges")!=="bytes")throw Error("원본 서버가 Range 요청을 지원하지 않습니다.");const size=Number(head.headers.get("Content-Length"));if(!Number.isSafeInteger(size)||size<1)throw Error("파일 크기 확인 실패");const name=decodeURIComponent(new URL(info.url).pathname.split("/").pop())||"video.mp4";await upload(name,size,async(a,b,signal)=>{const r=await fetch(info.url,{headers:{Range:`bytes=${a}-${b-1}`},signal});if(r.status!==206)throw Error("원본 서버의 HTTP 206 응답 필요");const cr=r.headers.get("Content-Range");if(cr!==`bytes ${a}-${b-1}/${size}`)throw Error("원본 Content-Range 불일치");return r.blob()})}catch(e){log("URL 업로드 실패: "+e.message)}};