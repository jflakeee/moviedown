let worker;
let sequence=0;
const pending=new Map();
export function analyzePython(payload){
  if(!worker){
    worker=new Worker(new URL("./python-worker.js",import.meta.url));
    worker.onmessage=({data})=>{
      const entry=pending.get(data.id);
      if(!entry)return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      if(data.error)entry.reject(Error(data.error));else entry.resolve(data.result);
    };
    worker.onerror=()=>{
      for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error("Python Worker 실행 오류"))}
      pending.clear();worker.terminate();worker=null;
    };
  }
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error("Python 분석 시간 초과"))},45000);
    pending.set(id,{resolve,reject,timer});
    worker.postMessage({id,payload});
  });
}
