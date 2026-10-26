const MAX=60;
const direct=/\.(mp4|webm|mov)$/i;
const records=new Map();
function media(url){
 try{const u=new URL(url);return ["https:","http:"].includes(u.protocol)&&direct.test(u.pathname)&&!u.username&&!u.password}catch{return false}
}
async function push(tabId,url){
 if(tabId<0||!media(url))return;
 const list=(await chrome.storage.session.get(String(tabId)))[String(tabId)]||[];
 if(!list.some(x=>x.url===url))list.unshift({url,source:"network",detectedAt:Date.now()});
 await chrome.storage.session.set({[String(tabId)]:list.slice(0,MAX)});
}
chrome.webRequest.onBeforeRequest.addListener(d=>{
 if(d.type!=="main_frame")push(d.tabId,d.url).catch(()=>{});
},{urls:["http://*/*","https://*/*"]});
chrome.tabs.onRemoved.addListener(id=>chrome.storage.session.remove(String(id)));
function safeURL(raw){
 try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||!direct.test(u.pathname)||u.username||u.password)return null;return u}catch{return null}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 (async()=>{
  const id=message.tabId;
  if(!Number.isInteger(id)||id<0)throw Error("잘못된 탭");
  const tab=await chrome.tabs.get(id);
  if(!tab||!/^https?:\/\//.test(tab.url||""))throw Error("지원하지 않는 탭");
  if(message.type==="getCandidates")return {items:(await chrome.storage.session.get(String(id)))[String(id)]||[]};
  if(message.type==="clearCandidates"){await chrome.storage.session.remove(String(id));return {ok:true}}
  if(message.type==="checkCandidate"){
   const u=safeURL(message.url);
   if(!u)throw Error("직접 미디어 URL만 확인할 수 있습니다.");
   const permitted=await chrome.permissions.contains({origins:[u.origin+"/*"]});
   if(!permitted)return {status:"permission_required",origin:u.origin+"/*"};
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
   try{
    const response=await fetch(u.href,{method:"HEAD",credentials:"omit",redirect:"follow",signal:controller.signal});
    const contentType=response.headers.get("content-type")||"";
    const length=response.headers.get("content-length");
    return {status:response.ok?"reachable":"http_error",httpStatus:response.status,contentType,size:length&&/^\d+$/.test(length)?Number(length):null,range:response.headers.get("accept-ranges")==="bytes"};
   }finally{clearTimeout(timer)}
  }
  throw Error("알 수 없는 요청");
 })().then(reply,e=>reply({error:String(e.message||e)}));
 return true;
});
