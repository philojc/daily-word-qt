(() => {
"use strict";
const api=window.DailyWordLocalAPI;
const endpoint=String(window.DW_SYNC_ENDPOINT||"").trim();
const STORE="dailyword.sync.names.v2",QUEUE="dailyword.sync.queue.v1";
const read=k=>{try{return JSON.parse(localStorage.getItem(k)||"{}")}catch{return{}}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const names=read(STORE),pending=read(QUEUE);
let frame=null,frameOrigin="",readyPromise=null,readyResolve=null,readyReject=null,idSeq=0,busy=false;
let status="내 ID를 입력하고 새로 등록하거나 기존 기록을 불러오세요.";
const waiting=new Map();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const connected=()=>names[api.active()]||null;
const parentOrigin=origin=>{try{const u=new URL(origin),h=u.hostname;return u.protocol==="https:"&&(h==="script.google.com"||h==="script.googleusercontent.com"||h.endsWith("-script.googleusercontent.com"));}catch{return false;}};

function ready(){
  if(!endpoint)return Promise.reject(Error("동기화 서버가 아직 연결되지 않았습니다."));
  if(readyPromise)return readyPromise;
  readyPromise=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  frame=document.createElement("iframe");frame.src=endpoint;frame.title="매일 말씀 동기화";
  frame.style.cssText="display:none;width:1px;height:1px;border:0";
  document.body.appendChild(frame);
  setTimeout(()=>{if(!frameOrigin&&readyReject){readyReject(Error("서버 연결 시간 초과"));readyReject=null;}},15000);
  return readyPromise;
}
window.addEventListener("message",ev=>{
  if(!frame||ev.source!==frame.contentWindow||!parentOrigin(ev.origin))return;
  const data=ev.data;if(!data||typeof data!=="object")return;
  if(data.type==="DW_SYNC_READY"){frameOrigin=ev.origin;if(readyResolve){readyResolve();readyResolve=null;readyReject=null;}return;}
  if(data.type!=="DW_SYNC_RESPONSE")return;
  const item=waiting.get(data.id);if(!item)return;
  waiting.delete(data.id);clearTimeout(item.timeout);
  if(data.error)item.reject(Error(String(data.error).replaceAll('이름','ID')));else item.resolve(data.result);
});
async function rpc(request){
  await ready();if(!frameOrigin)throw Error("서버 준비 중");
  const id=++idSeq;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{waiting.delete(id);reject(Error("서버 응답 시간 초과"));},25000);
    waiting.set(id,{resolve,reject,timeout});
    frame.contentWindow.postMessage({type:"DW_SYNC_REQUEST",id,request},frameOrigin);
  });
}
const notify=s=>{status=s;render();};
function render(){
  const root=document.getElementById("dw-sync-root");if(!root)return;
  if(!endpoint){
    root.innerHTML='<div class="q-profile-pane"><strong>내 ID로 기록 이어 읽기</strong><p class="q-tiny">ID만 입력하는 방식으로 준비했습니다. 서버 배포 주소를 아직 연결하지 않아, 현재는 이 기기에 기록이 저장됩니다.</p></div>';
    return;
  }
  const account=connected();
  if(account){
    const n=(pending[api.active()]||[]).length;
    root.innerHTML='<div class="q-profile-pane dw-panel"><strong>기록 연결됨 · '+esc(account.name)+'</strong><p class="q-tiny">'+esc(status)+'</p><p class="q-tiny">서버에 보내지 못한 변경 '+n+'건</p><button class="dw-btn" data-sync="refresh">진도 새로 불러오기</button><button class="dw-secondary" data-sync="retry">미전송 기록 다시 보내기</button><button class="dw-secondary" data-sync="disconnect">이 기기 연결 해제</button></div>';
  }else{
    root.innerHTML='<div class="q-profile-pane dw-panel"><strong>내 ID로 읽던 곳 이어가기</strong><p class="q-tiny">같은 ID를 입력하면 다른 기기에서도 읽던 진도를 불러올 수 있습니다. 새 ID 등록 시 중복 여부를 확인합니다.</p><div class="dw-fields"><label>내 ID<input id="dw-sync-name" maxlength="30" autocomplete="nickname" placeholder="예: reader01"/></label></div><div class="dw-actions"><button class="dw-btn" data-sync="load">기존 ID로 이어 읽기</button><button class="dw-secondary" data-sync="create">새 ID 등록</button></div><p class="q-tiny">'+esc(status)+'</p><p class="q-tiny">※ 별도의 비밀번호가 없습니다. <strong>같은 ID를 아는 사람은 읽기 기록을 보고 수정할 수 있습니다.</strong> 성경 진도 외의 개인 정보는 저장하지 마세요.</p></div>';
  }
}
window.DWRenderSync=render;
function normalizeName(v){return String(v||"").normalize("NFC").trim().replace(/\s+/g," ");}
async function enter(op){
  const name=normalizeName(document.getElementById("dw-sync-name")?.value);
  if(!name||name.length>30)return notify("ID를 1~30자로 입력해 주세요.");
  notify("읽기 기록을 확인하는 중입니다…");
  try{
    const before=api.current();
    const data=await rpc({op,name});
    if(!data?.ok||!data.state)throw Error("서버에서 기록을 불러오지 못했습니다.");
    const profileId=api.activateCloud(data.name,data.state);
    names[profileId]={name:data.name};
    save(STORE,names);
    notify(op==="create"?"새 ID로 등록했습니다.":"기존 기록을 불러왔습니다.");
    if(op==="create"&&((before.completed||[]).length||(before.favorites||[]).length||before.last)){
      if(confirm("이 기기에 기존 읽기 기록이 있습니다. 새 ID의 기록에 복사하시겠습니까?")){
        const actions=[
          ...(before.completed||[]).map(id=>({kind:"mark",sessionId:id,value:true})),
          ...(before.favorites||[]).map(id=>({kind:"favorite",sessionId:id,value:true})),
          ...Object.entries(before.lastByTrack||{}).map(([track,sessionId])=>({kind:"open",track,sessionId}))
        ];
        const q=pending[profileId]||(pending[profileId]=[]);
        q.push(...actions);
        save(QUEUE,pending);
        flush();
      }
    }
  }catch(err){notify("연결되지 않았습니다: "+err.message);}
}
async function flush(){
  const profileId=api.active(),account=connected(),q=pending[profileId];
  if(busy||!account||!q?.length)return;
  busy=true;
  try{
    while(q.length){
      const result=await rpc({op:"apply",name:account.name,change:q[0]});
      if(!result?.ok)throw Error("서버가 저장을 거절했습니다.");
      q.shift();save(QUEUE,pending);
      if(!q.length&&api.active()===profileId)api.activateCloud(account.name,result.state);
    }
    notify("변경 사항이 서버에 저장됐습니다.");
  }catch(err){notify("기기에는 기록됐지만 서버 동기화가 실패했습니다: "+err.message);}
  finally{busy=false;}
}
window.DWOnLocalChange=change=>{
  const profileId=api.active(),account=connected();
  if(!account)return;
  const q=pending[profileId]||(pending[profileId]=[]);
  if(q.length>=200){notify("저장 대기가 너무 많습니다. 인터넷 연결을 확인해 주세요.");return;}
  q.push(change);save(QUEUE,pending);flush();
};
async function refresh(){
  const profileId=api.active(),account=connected();if(!account)return;
  if((pending[profileId]||[]).length){await flush();if((pending[profileId]||[]).length)return;}
  notify("서버에서 기록을 불러오는 중입니다…");
  try{
    const result=await rpc({op:"load",name:account.name});
    if(!result?.ok)throw Error("서버 응답 오류");
    if(api.active()===profileId)api.activateCloud(result.name,result.state);
    notify("최근 기록을 불러왔습니다.");
  }catch(err){notify("불러오기에 실패했습니다: "+err.message);}
}
document.addEventListener("click",e=>{
  const node=e.target.closest("[data-sync]");if(!node)return;
  const action=node.dataset.sync;
  if(action==="create"||action==="load")enter(action);
  else if(action==="refresh")refresh();
  else if(action==="retry")flush();
  else if(action==="disconnect"){
    if(!confirm("이 기기의 서버 연결만 해제할까요? 서버에 있는 기록은 그대로 유지됩니다."))return;
    delete names[api.active()];save(STORE,names);notify("연결을 해제했습니다.");
  }
});
window.DWOnProfileChange=()=>{if(connected())refresh();};
window.addEventListener("online",()=>{if(connected())flush();});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&connected())refresh();});
render();
if(endpoint&&connected())refresh();
})();