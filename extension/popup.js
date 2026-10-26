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
 const r=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:()=>{
  const links=[];
  for(const a of document.querySelectorAll("a[href]")){
   const label=(a.textContent||"").replace(/\s+/g," ").trim().slice(0,100);
   if(!a.hasAttribute("download")&&!/(다운로드|download|파일 받기)/i.test(label)&&!/\.(mp4|webm|mov)(?:$|[?#])/i.test(a.href))continue;
   links.push({url:a.href,label:label||a.href,source:"dom"});
  }
  for(const v of document.querySelectorAll("video[src],video source[src]"))links.push({url:v.src,label:"공개 video 태그",source:"dom"});
  return links.slice(0,60);
 }});
 return r.flatMap(x=>x.result||[]).filter(x=>{try{return direct.test(new URL(x.url).pathname)}catch{return false}});
}
$("scan").onclick=async()=>{
 try{
  const tab=await getTab();
  const origin=new URL(tab.url).origin+"/*";
  const permitted=await chrome.permissions.contains({origins:[origin]});
  if(!permitted){
   const granted=await chrome.permissions.request({origins:[origin]});
   if(!granted)throw Error("사이트 접근 권한이 허용되지 않았습니다.");
  }
  let dom=[];
  try{dom=await scanDom(tab)}catch(e){$("status").textContent="일부 프레임 분석 제한: "+e.message}
  const network=await chrome.runtime.sendMessage({type:"getCandidates",tabId:tab.id});
  if(network.error)throw Error(network.error);
  await show([...dom,...(network.items||[])]);
  if(!dom.length&&!(network.items||[]).length)$("status").textContent+="\n사이트 권한을 허용한 후 페이지를 새로고침하고, 허가된 영상의 공식 다운로드 링크가 표시되는지 확인한 뒤 다시 분석하세요.";
 }catch(e){$("status").textContent="분석 실패: "+e.message}
};
$("clear").onclick=async()=>{try{const tab=await getTab();await chrome.runtime.sendMessage({type:"clearCandidates",tabId:tab.id});await show([])}catch(e){$("status").textContent=e.message}};
