// One active browser task at a time; completed tasks are kept only in memory.
export function createTaskManager(onChange, limit=8) {
  let active=null;
  const recent=[];
  const emit=()=>onChange({active:active?{...active}:null,recent:recent.map(x=>({...x}))});
  const start=(kind,label)=>{
    if(active)throw Error("다른 작업이 실행 중입니다.");
    active={kind,label,status:"queued",progress:0,detail:"작업 대기",startedAt:Date.now()};
    emit();
  };
  const update=(status,detail,progress)=>{
    if(!active)return;
    if(!["queued","analyzing","uploading"].includes(status))throw Error("잘못된 작업 상태");
    active.status=status;
    active.detail=String(detail||"");
    if(Number.isFinite(progress))active.progress=Math.max(0,Math.min(100,Math.floor(progress)));
    emit();
  };
  const finish=(status,detail)=>{
    if(!active)return;
    if(!["completed","failed","cancelled"].includes(status))throw Error("잘못된 종료 상태");
    active.status=status;
    active.detail=String(detail||"");
    if(status==="completed")active.progress=100;
    recent.unshift({...active,finishedAt:Date.now()});
    recent.length=Math.min(recent.length,limit);
    active=null;
    emit();
  };
  const busy=()=>active!==null;
  emit();
  return {start,update,finish,busy};
}
