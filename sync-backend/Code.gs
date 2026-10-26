/**
 * 매일 말씀 | 이름만으로 읽기 진도 동기화 (가족용)
 *
 * Google Sheets / Google Drive 접근 권한을 사용하지 않습니다.
 * Apps Script ScriptProperties에 이름별 읽기 진도를 저장합니다.
 *
 * 보안 주의: 이름은 본인 인증 수단이 아닙니다. 이름을 아는 누구나
 * 그 이름의 완료 기록과 즐겨찾기를 읽거나 바꿀 수 있습니다.
 * 민감한 개인 메모나 기도문은 저장하지 마세요.
 */
const DW_CONFIG=Object.freeze({
  PREFIX:'DW_READER_V3_',
  MAX_USERS:30,
  MAX_READINGS:5000,
  CHUNK_SIZE:6500,
  MAX_CHUNKS:15
});
const BRIDGE_HTML_="<!doctype html>\n<html>\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <title>매일 말씀 · 기록 동기화</title>\n</head>\n<body style=\"margin:0;background:transparent\">\n<script>\n(function () {\n  \"use strict\";\n  const PARENT = \"https://philojc.github.io\";\n  const TYPE_REQUEST = \"DW_SYNC_REQUEST\";\n  const TYPE_RESPONSE = \"DW_SYNC_RESPONSE\";\n  window.addEventListener(\"message\", function (event) {\n    if (event.origin !== PARENT || event.source !== window.parent) return;\n    const msg = event.data;\n    if (!msg || msg.type !== TYPE_REQUEST ||\n        !Number.isSafeInteger(msg.id) || msg.id < 1 || msg.id > 100000000) return;\n    const respond = function (result, error) {\n      window.parent.postMessage({\n        type: TYPE_RESPONSE, id: msg.id,\n        result: result || null, error: error || null\n      }, PARENT);\n    };\n    try {\n      google.script.run\n        .withSuccessHandler(function (result) { respond(result, null); })\n        .withFailureHandler(function (err) {\n          respond(null, String(err && err.message || \"Server error\").slice(0, 250));\n        })\n        .syncRpc(msg.request || {});\n    } catch (err) {\n      respond(null, String(err.message || \"Bridge error\").slice(0, 250));\n    }\n  });\n  window.parent.postMessage({type:\"DW_SYNC_READY\"}, PARENT);\n})();\n</script>\n</body>\n</html>";
const DW_TRACKS=Object.freeze(['JES','ACT','EPI','PSA','OTN']);
function doGet(){
  return HtmlService.createHtmlOutput(BRIDGE_HTML_)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle('매일 말씀 | 이름별 읽기 기록');
}
function syncRpc(request){
  const req=request||{},op=String(req.op||'');
  if(op==='ping')return{ok:true,version:3,storage:'script-properties'};
  if(!['check','create','load','apply'].includes(op))throw Error('지원하지 않는 요청입니다.');
  const name=normalizeName_(req.name),key=profileKey_(name);
  // Create, load and write serialized: do not read a half-written multi-chunk profile.
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))throw Error('동기화 서버가 사용 중입니다. 다시 시도해 주세요.');
  try{
    const props=PropertiesService.getScriptProperties();
    const existing=readProfile_(props,key);
    if(op==='check')return{ok:true,exists:!!existing,name};
    if(op==='create'){
      if(existing)throw Error('이미 사용 중인 이름입니다. 기존 기록을 이어 읽거나 다른 이름을 사용하세요.');
      const count=props.getKeys().filter(x=>x.startsWith(DW_CONFIG.PREFIX)&&x.endsWith('_meta')).length;
      if(count>=DW_CONFIG.MAX_USERS)throw Error('등록 가능한 이용자 수를 초과했습니다.');
      const state=emptyState_(),time=new Date().toISOString();
      writeProfile_(props,key,{name,state,createdAt:time,updatedAt:time});
      return publicResult_(name,state,time);
    }
    if(!existing)throw Error('등록되지 않은 이름입니다. 새 이름으로 등록하거나 이름을 확인해 주세요.');
    const state=sanitizeState_(existing.state);
    if(op==='load')return publicResult_(existing.name,state,existing.updatedAt);
    applyChange_(state,req.change);
    const time=new Date().toISOString();
    writeProfile_(props,key,{name:existing.name,state,createdAt:existing.createdAt,updatedAt:time});
    return publicResult_(existing.name,state,time);
  }finally{lock.releaseLock();}
}
function normalizeName_(v){
  const name=String(v||'').normalize('NFC').trim().replace(/\s+/g,' ');
  if(name.length<1||name.length>30||!/^[\p{L}\p{N} _.-]+$/u.test(name))
    throw Error('이름은 1~30자의 한글·영문·숫자로 입력하세요.');
  return name;
}
function profileKey_(name){
  const normalized=name.toLocaleLowerCase('en-US');
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    'dailyword-profile-v3\0'+normalized,Utilities.Charset.UTF_8);
  const hash=bytes.map(x=>('0'+(x&255).toString(16)).slice(-2)).join('');
  return DW_CONFIG.PREFIX+hash;
}
function emptyState_(){return{completed:[],favorites:[],last:'',lastByTrack:{}};}
function validId_(v){return typeof v==='string'&&/^[A-Z][A-Z0-9-]{2,40}$/.test(v);}
function sanitizeState_(v){
  const state=v&&typeof v==='object'?v:{};
  const list=x=>Array.isArray(x)?[...new Set(x.filter(validId_))].slice(0,DW_CONFIG.MAX_READINGS):[];
  const lastByTrack={};
  for(const tr of DW_TRACKS){if(validId_(state.lastByTrack?.[tr]))lastByTrack[tr]=state.lastByTrack[tr];}
  return{completed:list(state.completed),favorites:list(state.favorites),last:validId_(state.last)?state.last:'',lastByTrack};
}
function applyChange_(state,change){
  if(!change||typeof change!=='object')throw Error('변경 요청이 비어 있습니다.');
  const kind=String(change.kind||''),id=change.sessionId;
  if(!validId_(id))throw Error('올바르지 않은 묵상 ID입니다.');
  if(kind==='open'){
    const track=String(change.track||'');
    if(!DW_TRACKS.includes(track))throw Error('지원하지 않는 묵상 트랙입니다.');
    state.last=id;state.lastByTrack[track]=id;
  }else if(kind==='mark'||kind==='favorite'){
    if(typeof change.value!=='boolean')throw Error('완료 여부가 올바르지 않습니다.');
    const prop=kind==='mark'?'completed':'favorites';
    state[prop]=state[prop].filter(v=>v!==id);
    if(change.value)state[prop].push(id);
    if(state[prop].length>DW_CONFIG.MAX_READINGS)throw Error('읽기 기록 한도를 초과했습니다.');
  }else throw Error('지원하지 않는 기록 변경입니다.');
}
function readProfile_(props,key){
  const metaJson=props.getProperty(key+'_meta');
  if(!metaJson)return null;
  const meta=JSON.parse(metaJson);
  if(!Number.isInteger(meta.chunks)||meta.chunks<1||meta.chunks>DW_CONFIG.MAX_CHUNKS)
    throw Error('저장된 기록의 형식이 올바르지 않습니다.');
  let json='';
  for(let i=0;i<meta.chunks;i++){
    const part=props.getProperty(key+'_'+i);
    if(typeof part!=='string')throw Error('기록 일부를 불러오지 못했습니다.');
    json+=part;
  }
  return{name:meta.name,createdAt:meta.createdAt,updatedAt:meta.updatedAt,state:JSON.parse(json)};
}
function writeProfile_(props,key,entry){
  // JSON body contains ASCII-only IDs and keys, so characters == UTF-8 bytes.
  const body=JSON.stringify(sanitizeState_(entry.state));
  const n=Math.ceil(body.length/DW_CONFIG.CHUNK_SIZE)||1;
  if(n>DW_CONFIG.MAX_CHUNKS)throw Error('읽기 기록 저장량이 너무 많습니다.');
  const old=props.getProperty(key+'_meta');
  const oldCount=old?JSON.parse(old).chunks:0;
  for(let i=0;i<n;i++)props.setProperty(key+'_'+i,body.slice(i*DW_CONFIG.CHUNK_SIZE,(i+1)*DW_CONFIG.CHUNK_SIZE));
  props.setProperty(key+'_meta',JSON.stringify({name:entry.name,createdAt:entry.createdAt,updatedAt:entry.updatedAt,chunks:n}));
  for(let i=n;i<oldCount;i++)props.deleteProperty(key+'_'+i);
}
function publicResult_(name,state,updatedAt){return{ok:true,name,state,updatedAt};}
