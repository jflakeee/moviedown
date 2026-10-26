const $=id=>document.getElementById(id);
let currentTab=null;
const direct=/\.(mp4|webm|mov)(?:$|[?#])/i;
function safeUrl(raw){try{const u=new URL(raw);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
async function getTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:\/\//.test(tab.url||""))throw Error("일반 웹페이지에서만 분석할 수 있습니다.");currentTab=tab;return tab}
async function show(items){
 const results=$("results");results.replaceChildren();
 const unique=[...new Map(items.filter(x=>safeUrl(x.url)).map(x=>[x.url,x])).values()];
 $("status").textContent=unique.length+"개의 공개 미디어 링크 후보를 찾았습니다.";
 if(!unique.length){$("status").textContent+=" 재생 스트림 또는 보호된 콘텐츠는 다운로드 대상으로 제공하지 않습니다.";return}
 for(const item of unique){
  const li=document.createElement("li"),a=document.createElement("a");a.href=item.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=item.label||item.url;
  const small=document.createElement("small");small.textContent=item.source==="network"?"네트워크 요청":"페이지에 공개된 링크";
  const button=document.createElement("button");button.textContent="Drive 앱으로 전달";button.onclick=()=>chrome.tabs.create({url:"https://jflakeee.github.io/moviedown/?media="+encodeURIComponent(item.url)});
  li.append(a,small,button);results.append(li);
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
 return r.flatMap(x=>x.result||[]).filter(x=>direct.test(x.url||""));
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
  const dom=await scanDom(tab);
  const network=await chrome.runtime.sendMessage({type:"getCandidates",tabId:tab.id});
  await show([...dom,...(network.items||[])]);
 }catch(e){$("status").textContent="분석 실패: "+e.message}
};
$("clear").onclick=async()=>{try{const tab=await getTab();await chrome.runtime.sendMessage({type:"clearCandidates",tabId:tab.id});await show([])}catch(e){$("status").textContent=e.message}};
