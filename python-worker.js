/* Pyodide runs only in this worker; no browser credentials or video bytes enter Python. */
let runtimePromise;
async function runtime(){
  if(!runtimePromise){
    runtimePromise=(async()=>{
      importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");
      const py=await loadPyodide({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.27.7/full/"});
      const response=await fetch("./python/analyzer.py",{cache:"no-cache"});
      if(!response.ok)throw Error("Python 분석 모듈 로드 실패");
      py.runPython(await response.text());
      return py;
    })().catch(e=>{runtimePromise=null;throw e});
  }
  return runtimePromise;
}
self.onmessage=async({data})=>{
  const {id,payload}=data;
  try{
    const py=await runtime();
    py.globals.set("_md_payload",JSON.stringify(payload));
    const result=py.runPython("json.dumps(dispatch(json.loads(_md_payload)), ensure_ascii=False)");
    self.postMessage({id,result:JSON.parse(result)});
  }catch(e){self.postMessage({id,error:String(e?.message||e)})}
};
