(() => {
  "use strict";
  const api = window.DailyWordLocalAPI;
  const endpoint = String(window.DW_SYNC_ENDPOINT || "").trim();
  const STORE = "dailyword.sync.credentials.v1";
  const QUEUE = "dailyword.sync.queue.v1";
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const get = key => {try{return JSON.parse(localStorage.getItem(key)||"{}")}catch{return{}}};
  const store = (key,obj) => {try{localStorage.setItem(key,JSON.stringify(obj))}catch{}};
  const credentials=get(STORE), pending=get(QUEUE);
  let iframe=null, iframeOrigin="", resolveReady=null, rejectReady=null, readyPromise=null;
  let nextId=0, busy=false, status="코드를 입력하면 다른 기기에서 기록을 불러올 수 있습니다.";
  const waiting=new Map();
  const validOrigin=origin=>{
    try{
      const u=new URL(origin),h=u.hostname;
      return u.protocol==="https:"&&(h==="script.google.com"||h==="script.googleusercontent.com"||h.endsWith("-script.googleusercontent.com"));
    }catch{return false;}
  };
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function ready(){
    if(!endpoint) return Promise.reject(Error("동기화 서버를 아직 연결하지 않았습니다."));
    if(readyPromise)return readyPromise;
    readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    iframe=document.createElement("iframe");
    iframe.src=endpoint;
    iframe.title="매일 말씀 동기화 연결";
    iframe.style.cssText="display:none;width:1px;height:1px;border:0";
    document.body.appendChild(iframe);
    setTimeout(()=>{if(!iframeOrigin&&rejectReady){rejectReady(Error("동기화 서버 연결 실패"));rejectReady=null;}},15000);
    return readyPromise;
  }
  window.addEventListener("message",ev=>{
    if(!iframe||ev.source!==iframe.contentWindow||!validOrigin(ev.origin))return;
    const d=ev.data;if(!d||typeof d!=="object")return;
    if(d.type==="DW_SYNC_READY"){iframeOrigin=ev.origin;if(resolveReady){resolveReady();resolveReady=null;rejectReady=null;}return;}
    if(d.type!=="DW_SYNC_RESPONSE")return;
    const w=waiting.get(d.id);if(!w)return;
    waiting.delete(d.id);clearTimeout(w.timeout);
    if(d.error)w.reject(Error(d.error));else w.resolve(d.result);
  });
  async function call(req){
    await ready();
    if(!iframeOrigin)throw Error("동기화 연결 대기 중");
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{waiting.delete(id);reject(Error("동기화 응답 시간 초과"));},25000);
      waiting.set(id,{resolve,reject,timeout});
      iframe.contentWindow.postMessage({type:"DW_SYNC_REQUEST",id,request:req},iframeOrigin);
    });
  }
  function activeCred(){return credentials[api.active()]||null;}
  function setStatus(s){status=s;render();}
  function render(){
    const el=document.getElementById("dw-sync-root");if(!el)return;
    if(!endpoint){el.innerHTML='<div class="q-profile-pane"><strong>이름·코드로 기기 간 동기화</strong><p class="q-tiny">개인 기록 저장소는 준비됐지만 연결용 서버 주소를 설정하기 전입니다. 현재 기록은 이 기기에만 저장되며, 기존 기록 내보내기 기능은 계속 사용할 수 있습니다.</p></div>';return;}
    const account=activeCred();
    if(account){
      const count=(pending[api.active()]||[]).length;
      el.innerHTML='<div class="q-profile-pane dw-panel"><strong>기록 동기화 · '+esc(account.name)+'</strong><p class="q-tiny">'+esc(status)+'</p><p class="q-tiny">미전송 변경 '+count+'건 · 기기마다 같은 이름과 코드를 입력하면 기록을 불러올 수 있습니다.</p><button class="dw-btn" data-sync="refresh">서버에서 다시 불러오기</button><button class="dw-secondary" data-sync="retry">미전송 기록 다시 보내기</button><button class="dw-secondary" data-sync="disconnect">이 기기 연결 해제</button></div>';
      return;
    }
    el.innerHTML='<div class="q-profile-pane dw-panel"><strong>다른 기기에서도 이어 읽기</strong><p class="q-tiny">Google 로그인 없이 이름과 개인 코드만 입력하세요. 같은 이름과 코드로 접속하면 읽음·즐겨찾기·5개 트랙 진도가 동기화됩니다.</p><div class="dw-fields"><label>이름<input id="dw-sync-name" maxlength="30" autocomplete="nickname" placeholder="예: 준우"/></label><label>개인 코드<input id="dw-sync-code" maxlength="40" spellcheck="false" autocomplete="off" type="password" placeholder="16자리 이상 코드"/></label></div><button class="dw-secondary" data-sync="generate">안전한 개인 코드 자동 만들기</button><button class="dw-secondary" data-sync="toggle-code">코드 표시/숨김</button><div class="dw-actions"><button class="dw-btn" data-sync="connect">기존 기록 불러오기</button><button class="dw-btn" data-sync="create">새 동기화 기록 만들기</button></div><p class="q-tiny">'+esc(status)+' 개인 코드를 잃어버리면 복구가 어렵습니다. 비밀번호 관리자 등에 안전하게 보관하세요.</p></div>';
  }
  window.DWRenderSync=render;
  function strongCode(){
    if(!window.crypto?.getRandomValues)throw Error("보안 코드 생성에 필요한 기능을 사용할 수 없습니다.");
    const bytes=new Uint8Array(20);crypto.getRandomValues(bytes);
    return Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join("");
  }
  async function auth(op){
    const name=String(document.getElementById("dw-sync-name")?.value||"").trim();
    const code=String(document.getElementById("dw-sync-code")?.value||"").trim().toUpperCase().replace(/[\s-]/g,"");
    if(!name || !/^[A-Z2-9]{16,32}$/.test(code))return setStatus("이름과 16~32자리 개인 코드를 확인해 주세요.");
    if(op==="create"&&!confirm("이 이름과 코드로 새 동기화 기록을 만드시겠습니까? 기존 기기 기록은 자동으로 합치지 않습니다."))return;
    setStatus("서버에 연결하는 중입니다…");
    try{
      const result=await call({op,name,code});
      if(!result?.ok||!result.state)throw Error("동기화 서버 응답 오류");
      const id=api.activateCloud(result.name,result.state);
      credentials[id]={name:result.name,code};
      store(STORE,credentials);
      setStatus("서버와 연결되었습니다. "+(op==="create"?"개인 코드를 안전하게 보관하세요.":"읽기 기록을 불러왔습니다."));
      flush();
    }catch(err){setStatus("연결되지 않았습니다: "+err.message);}
  }
  async function flush(){
    const id=api.active(),cred=activeCred(),queue=pending[id];
    if(busy||!cred||!queue?.length)return;
    busy=true;
    try{
      while(queue.length){
        const response=await call({op:"apply",name:cred.name,code:cred.code,change:queue[0]});
        if(!response?.ok)throw Error("서버 저장 실패");
        queue.shift();store(QUEUE,pending);
        if(queue.length===0)api.activateCloud(cred.name,response.state);
      }
      setStatus("모든 읽기 기록이 서버에 저장됐습니다.");
    }catch(err){setStatus("이 기기에는 저장됐지만 동기화는 실패했습니다: "+err.message);}
    finally{busy=false;}
  }
  window.DWOnLocalChange=change=>{
    const id=api.active();if(!activeCred())return;
    const arr=pending[id]||(pending[id]=[]);
    if(arr.length>=200){setStatus("저장 대기 기록이 너무 많습니다. 연결을 확인해 주세요.");return;}
    arr.push(change);store(QUEUE,pending);flush();
  };
  async function refresh(){
    const id=api.active(),cred=activeCred();if(!cred)return;
    if((pending[id]||[]).length){await flush();if((pending[id]||[]).length)return;}
    setStatus("서버의 읽기 기록을 확인 중입니다…");
    try{
      const x=await call({op:"load",name:cred.name,code:cred.code});
      if(!x?.ok)throw Error("서버 오류");
      api.activateCloud(cred.name,x.state);
      setStatus("서버와 동기화되었습니다.");
    }catch(err){setStatus("읽기 기록을 가져오지 못했습니다: "+err.message);}
  }
  document.addEventListener("click",e=>{
    const b=e.target.closest("[data-sync]");if(!b)return;
    const cmd=b.dataset.sync;
    if(cmd==="generate"){try{document.getElementById("dw-sync-code").value=strongCode();document.getElementById("dw-sync-code").type="text";setStatus("안전한 코드를 만들었습니다. 다른 기기에서 똑같이 입력할 수 있도록 복사해 두세요.");}catch(err){setStatus(err.message);}}
    else if(cmd==="toggle-code"){const input=document.getElementById("dw-sync-code");if(input)input.type=input.type==="password"?"text":"password";}
    else if(cmd==="create"||cmd==="connect")auth(cmd==="create"?"create":"load");
    else if(cmd==="refresh")refresh();
    else if(cmd==="retry")flush();
    else if(cmd==="disconnect"){if(!confirm("이 기기에서만 동기화 코드를 지우시겠습니까? 서버의 읽기 기록은 유지됩니다."))return;delete credentials[api.active()];store(STORE,credentials);setStatus("이 기기의 자동 연결을 해제했습니다.");}
  });
  window.addEventListener("online",()=>{if(activeCred())flush();});
  render();
  if(endpoint&&activeCred())refresh();
})();