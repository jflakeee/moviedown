const MAX=60;
const direct=/\.(mp4|webm|mov)(?:$|[?#])/i;
const allowed=new Set(["https:","http:"]);
const records=new Map();
function push(tabId,url,source){
  try{
    const u=new URL(url);
    if(!allowed.has(u.protocol)||!direct.test(u.href))return;
    const list=records.get(tabId)||[];
    if(!list.some(x=>x.url===u.href))list.unshift({url:u.href,source,detectedAt:Date.now()});
    records.set(tabId,list.slice(0,MAX));
  }catch{}
}
chrome.webRequest.onBeforeRequest.addListener(details=>{
  if(details.tabId>=0&&details.type!=="main_frame")push(details.tabId,details.url,"network");
},{urls:["<all_urls>"]});
chrome.tabs.onRemoved.addListener(id=>records.delete(id));
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message.type==="getCandidates"){sendResponse({items:records.get(message.tabId)||[]});return}
  if(message.type==="clearCandidates"){records.delete(message.tabId);sendResponse({ok:true})}
});
