const $=id=>document.getElementById(id);
let currentTab=null;
const direct=/\.(mp4|webm|mov)(?:$|[?#])/i;
function safeUrl(raw){try{const u=new URL(raw);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
async function getTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:\/\//.test(tab.url||""))throw Error("일반 웹페이지에서만 분석할 수 있습니다.");currentTab=tab;return tab}
async function show(items){
 const results=$("results");results.replaceChildren();
 const unique=[...new Map(items.filter(x=>safeUrl(x.url)).map(x=>[x.url,x])).values()];
 $("status").textContent=unique.length+"개의 공개 미디어 링크 후보를 찾았습니다.";
 if(!unique.length){$("status").textContent+=" 현재 권한과 탐지 범위에서 직접 파일 주소가 확인되지 않았습니다. DRM 여부를 의미하지 않습니다.";return}
 for(const item of unique){
  const li=document.createElement("li"),a=document.createElement("a");a.href=item.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=item.label||item.url;
  const small=document.createElement("small");small.textContent=item.source==="network"?"네트워크 요청":"페이지에 공개된 링크";
  const button=document.createElement("button");button.textContent="Drive 앱으로 전달";button.onclick=()=>chrome.tabs.create({url:"https://jflakeee.github.io/moviedown/?media="+encodeURIComponent(item.url)});
  const check=document.createElement("button");check.className="secondary";check.textContent="파일 확인";
  const detail=document.createElement("small");
  check.onclick=async()=>{
   try{
    const u=new URL(item.url);
    if(!await chrome.permissions.contains({origins:[u.origin+"/*"]})){
     if(!await chrome.permissions.request({origins:[u.origin+"/*"]}))throw Error("파일 호스트 권한이 필요합니다.");
    }
    const r=await chrome.runtime.sendMessage({type:"checkCandidate",tabId:currentTab.id,url:item.url});
    if(r.error)throw Error(r.error);
    detail.textContent=r.status==="reachable"?("HTTP "+r.httpStatus+" · "+(r.contentType||"형식 미확인")+" · "+(r.size===null?"크기 미확인":(r.size/1048576).toFixed(1)+" MiB")+" · Range "+(r.range?"지원":"미확인")):("확인 실패: "+r.status+" "+(r.httpStatus||""));
   }catch(e){detail.textContent="확인 실패: "+e.message}
  };
  li.append(a,small,check,button,detail);results.append(li);
 }
}
async function scanDom(tab){
 const frames=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:()=>{
  const links=[],stats={anchors:0,videos:0,iframes:document.querySelectorAll("iframe").length,streams:0,blob:0,direct:0};
  const direct=/\.(mp4|webm|mov)$/i;
  const stream=/\.(m3u8|mpd)$/i;
  const add=(url,label)=>{
   if(!url)return;
   try{
    const u=new URL(url,document.baseURI);
    if(u.protocol==="blob:"){stats.blob++;return}
    if(!["https:","http:"].includes(u.protocol))return;
    if(stream.test(u.pathname)){stats.streams++;return}
    if(direct.test(u.pathname)){stats.direct++;links.push({url:u.href,label,source:"dom"})}
   }catch{}
  };
  for(const a of document.querySelectorAll("a[href]")){
   stats.anchors++;
   const label=(a.textContent||"").replace(/\s+/g," ").trim().slice(0,100);
   if(a.hasAttribute("download")||/(다운로드|download|파일 받기)/i.test(label)||direct.test(a.pathname))add(a.href,label||"공개 링크");
  }
  for(const v of document.querySelectorAll("video,video source")){
   stats.videos++;
   add(v.currentSrc||v.src||v.getAttribute("src"),"공개 video 태그");
  }
  return {links:links.slice(0,60),stats};
 }});
 return {items:frames.flatMap(x=>x.result?.links||[]),stats:frames.reduce((acc,x)=>{
  const s=x.result?.stats||{};
  for(const key of ["anchors","videos","iframes","streams","blob","direct"])acc[key]=(acc[key]||0)+(s[key]||0);
  return acc;
 },{frames:frames.length})};
}


function setBusy(busy) {
 $("scan").disabled = busy;
 $("clear").disabled = busy;
}
function diagnosticsText(stats) {
 return [
  "검사한 프레임: " + (stats.frames || 0),
  "링크: " + (stats.anchors || 0),
  "비디오 요소: " + (stats.videos || 0),
  "iframe: " + (stats.iframes || 0),
  "직접 파일: " + (stats.direct || 0),
  "스트림(HLS/DASH): " + (stats.streams || 0),
  "blob 주소: " + (stats.blob || 0)
 ].join("\n");
}
$("scan").addEventListener("click", async () => {
 setBusy(true);
 $("status").textContent = "현재 페이지를 분석하고 있습니다.";
 try {
  const tab = await getTab();
  const dom = await scanDom(tab);
  const response = await chrome.runtime.sendMessage({type:"getCandidates",tabId:tab.id});
  if (response?.error) throw Error(response.error);
  await show([...dom.items, ...(response.items || [])]);
  $("diagnostics").textContent = diagnosticsText(dom.stats);
 } catch (error) {
  $("status").textContent = "분석 실패: " + String(error.message || error);
  $("diagnostics").textContent = "페이지 접근 권한 또는 확장프로그램 상태를 확인하세요.";
 } finally { setBusy(false); }
});
$("clear").addEventListener("click", async () => {
 setBusy(true);
 try {
  const tab = await getTab();
  const response = await chrome.runtime.sendMessage({type:"clearCandidates",tabId:tab.id});
  if (response?.error) throw Error(response.error);
  $("results").replaceChildren();
  $("status").textContent = "이 탭의 탐지 기록을 지웠습니다.";
  $("diagnostics").textContent = "분석 후 진단 정보가 표시됩니다.";
 } catch (error) {
  $("status").textContent = "기록 삭제 실패: " + String(error.message || error);
 } finally { setBusy(false); }
});
