/**
 * 매일 말씀 — 이름만 사용하는 동기화 서버 (Apps Script)
 *
 * 누구나 같은 이름으로 읽기 기록을 조회/수정할 수 있습니다.
 * 이름 중복 확인은 본인 인증이나 개인 정보 보호 기능이 아닙니다.
 * 따라서 성경 읽음/즐겨찾기/트랙별 마지막 회차만 기록합니다.
 *
 * 배포: 웹 앱 / 실행 사용자: 나 / 접근: 모든 사용자
 * 서버 원본 코드가 공개되어도 연결된 Google Sheet는 공개하지 마세요.
 */
const DW_CONFIG = Object.freeze({
  SPREADSHEET_ID: '1E9j-c_wyTlv-FTPPOEKtSeTK-w9L2srQ5MvISIb_oH8',
  TAB: 'Profiles',
  MAX_USERS: 30,
  MAX_READINGS: 5000
});
const DW_TRACKS = Object.freeze(['JES','ACT','EPI','PSA','OTN']);

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle('매일 말씀 · 이름으로 진도 이어읽기');
}

function syncRpc(req) {
  req=req||{};
  const op=String(req.op||'');
  if(op==='ping') return {ok:true,version:2,storage:'ready'};
  if(!['check','create','load','apply'].includes(op))throw new Error('Unsupported action');

  const name=normalizeName_(req.name);
  const canonical=canonicalName_(name);
  const id=keyHash_(canonical);
  const write=op==='create'||op==='apply';
  const lock=write?LockService.getScriptLock():null;
  if(lock&&!lock.tryLock(20000))throw new Error('서버가 사용 중입니다. 다시 시도해 주세요.');

  try{
    const sheet=SpreadsheetApp.openById(DW_CONFIG.SPREADSHEET_ID).getSheetByName(DW_CONFIG.TAB);
    if(!sheet)throw new Error('Profiles sheet missing');
    const rows=sheet.getDataRange().getValues();
    let index=-1;
    for(let i=1;i<rows.length;i++){
      if(String(rows[i][0])===id){index=i;break;}
    }
    if(op==='check')return {ok:true,exists:index>=0,name};

    if(op==='create'){
      if(index>=0)throw new Error('이미 사용 중인 이름입니다. 기존 기록을 이어 읽으려면 ‘이 이름으로 이어 읽기’를 선택하거나 다른 이름을 입력하세요.');
      if(rows.length-1>=DW_CONFIG.MAX_USERS)throw new Error('등록 가능한 이름 수를 초과했습니다.');
      const initial=emptyState_(),now=new Date().toISOString();
      sheet.appendRow([id,name,JSON.stringify(initial),now,now]);
      return result_(name,initial,now);
    }
    if(index<0)throw new Error('등록되지 않은 이름입니다. 이름을 확인하거나 새 이름을 등록하세요.');

    const row=rows[index],state=sanitizeState_(JSON.parse(String(row[2])||'{}'));
    if(op==='load')return result_(String(row[1]),state,String(row[3]));

    applyAction_(state,req.change);
    const now=new Date().toISOString();
    sheet.getRange(index+1,3,1,2).setValues([[JSON.stringify(state),now]]);
    return result_(String(row[1]),state,now);
  }finally{if(lock)lock.releaseLock();}
}

function normalizeName_(value){
  const name=String(value||'').normalize('NFC').trim().replace(/\s+/g,' ');
  if(name.length<1||name.length>30||!/^[\p{L}\p{N} _.-]+$/u.test(name))
    throw new Error('이름은 1~30자의 한글/영문/숫자로 입력하세요.');
  return name;
}
function canonicalName_(name){
  return name.toLocaleLowerCase('en-US');
}
function keyHash_(name){
  const bytes=Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'dailyword-name-v2\0'+name,
    Utilities.Charset.UTF_8
  );
  return bytes.map(x=>('0'+(x&255).toString(16)).slice(-2)).join('');
}
function emptyState_(){return {completed:[],favorites:[],last:'',lastByTrack:{}};}
function validSession_(id){return typeof id==='string'&&/^[A-Z][A-Z0-9-]{2,40}$/.test(id);}
function sanitizeState_(v){
  const x=v&&typeof v==='object'?v:{};
  const distinct=a=>Array.isArray(a)?Array.from(new Set(a.filter(validSession_))).slice(0,DW_CONFIG.MAX_READINGS):[];
  const lastByTrack={};
  for(const t of DW_TRACKS)if(validSession_(x.lastByTrack?.[t]))lastByTrack[t]=x.lastByTrack[t];
  return {completed:distinct(x.completed),favorites:distinct(x.favorites),last:validSession_(x.last)?x.last:'',lastByTrack};
}
function applyAction_(state,change){
  if(!change||typeof change!=='object')throw new Error('Missing change');
  const kind=String(change.kind||''),id=String(change.sessionId||'');
  if(!validSession_(id))throw new Error('Invalid session');
  if(kind==='open'){
    const t=String(change.track||'');
    if(!DW_TRACKS.includes(t))throw new Error('Unknown track');
    state.last=id;state.lastByTrack[t]=id;
  }else if(kind==='mark'||kind==='favorite'){
    if(typeof change.value!=='boolean')throw new Error('Boolean required');
    const key=kind==='mark'?'completed':'favorites';
    state[key]=state[key].filter(x=>x!==id);
    if(change.value)state[key].push(id);
    if(state[key].length>DW_CONFIG.MAX_READINGS)throw new Error('Reading limit exceeded');
  }else throw new Error('Unsupported change');
}
function result_(name,state,updatedAt){return {ok:true,name,state,updatedAt};}
