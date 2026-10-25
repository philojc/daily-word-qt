/**
 * 매일 말씀 — loginless personal reading sync backend (Apps Script V8)
 * Private Google Sheet acts as the ONLY data store.
 * Deploy as: Web app / Execute as me / Access: Anyone.
 *
 * Security model: display name + unpredictable 16+ character recovery code.
 * Code is NEVER stored in Sheet; a SHA-256 digest of name and code is stored.
 * This is a bearer secret, not the security level of a Google login.
 */
const DW_CONFIG = Object.freeze({
  SPREADSHEET_ID: '1E9j-c_wyTlv-FTPPOEKtSeTK-w9L2srQ5MvISIb_oH8',
  TAB: 'Profiles',
  ALLOWED_PARENT: 'https://philojc.github.io',
  MAX_USERS: 30,
  MAX_READINGS: 5000
});
const DW_TRACKS = Object.freeze(['JES','ACT','EPI','PSA','OTN']);

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle('매일 말씀 · 읽기 기록 동기화');
}

function syncRpc(req) {
  req = req || {};
  const op = String(req.op || '');
  if (op === 'ping') return {ok:true, version:1, storage:'ready'};
  if (op !== 'create' && op !== 'load' && op !== 'apply') throw new Error('Unsupported action');

  const name = normalizeName_(req.name);
  const code = normalizeCode_(req.code);
  const hash = keyHash_(name,code);
  const write = op !== 'load';
  const lock = write ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(20000)) throw new Error('Server busy; try again.');

  try {
    const sheet = SpreadsheetApp.openById(DW_CONFIG.SPREADSHEET_ID).getSheetByName(DW_CONFIG.TAB);
    if (!sheet) throw new Error('Profiles sheet missing');
    const rows = sheet.getDataRange().getValues();
    let index = -1;
    for(let i=1;i<rows.length;i++){
      if(String(rows[i][0]) === hash){index=i;break;}
    }

    if(op==='create'){
      if(index>=0) return result_(name, JSON.parse(String(rows[index][2])), String(rows[index][3]));
      if(rows.length-1>=DW_CONFIG.MAX_USERS) throw new Error('New profile limit reached');
      for(let i=1;i<rows.length;i++){
        if(String(rows[i][1]).toLowerCase()===name.toLowerCase())
          throw new Error('That display name is already in use. Choose another name.');
      }
      const state = emptyState_();
      const ts = new Date().toISOString();
      sheet.appendRow([hash,name,JSON.stringify(state),ts,ts]);
      return result_(name,state,ts);
    }
    if(index<0)throw new Error('Name or code not found. Check the code exactly.');
    const row=rows[index],state=sanitizeState_(JSON.parse(String(row[2]) || '{}'));
    if(op==='load')return result_(name,state,String(row[3]));
    applyAction_(state,req.change);
    const ts=new Date().toISOString();
    sheet.getRange(index+1,3,1,2).setValues([[JSON.stringify(state),ts]]);
    return result_(name,state,ts);
  } finally {if(lock)lock.releaseLock();}
}

function normalizeName_(v) {
  const s=String(v||'').trim().replace(/\\s+/g,' ');
  if(s.length<1 || s.length>30 || !/^[\\p{L}\\p{N} _.-]+$/u.test(s))
    throw new Error('Display name must be 1–30 letters or numbers.');
  return s;
}
function normalizeCode_(v){
  const s=String(v||'').toUpperCase().replace(/[\\s-]/g,'');
  if(!/^[A-Z2-9]{16,32}$/.test(s))throw new Error('Use a private code with 16–32 letters or digits.');
  return s;
}
function keyHash_(name,code){
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,'dailyword-v1\\0'+name.toLowerCase()+'\\0'+code,Utilities.Charset.UTF_8);
  return bytes.map(x=>('0'+(x&255).toString(16)).slice(-2)).join('');
}
function emptyState_(){return {completed:[],favorites:[],last:'',lastByTrack:{}};}
function sanitizeState_(x){
  const obj=x&&typeof x==='object'?x:{};
  const clean=a=>Array.isArray(a)?Array.from(new Set(a.filter(validSession_))).slice(0,DW_CONFIG.MAX_READINGS):[];
  const tracks={};for(const t of DW_TRACKS){if(validSession_(obj.lastByTrack?.[t]))tracks[t]=obj.lastByTrack[t];}
  return {completed:clean(obj.completed),favorites:clean(obj.favorites),last:validSession_(obj.last)?obj.last:'',lastByTrack:tracks};
}
function validSession_(v){
  return typeof v==='string' && /^[A-Z][A-Z0-9-]{2,40}$/.test(v);
}
function applyAction_(state,change){
  if(!change||typeof change!=='object')throw new Error('Missing change');
  const op=String(change.kind||''),id=String(change.sessionId||'');
  if(!validSession_(id))throw new Error('Invalid session');
  if(op==='open'){
    const t=String(change.track||'');
    if(!DW_TRACKS.includes(t))throw new Error('Unknown track');
    state.last=id;state.lastByTrack[t]=id;
  }else if(op==='mark'||op==='favorite'){
    if(typeof change.value!=='boolean')throw new Error('Boolean value required');
    const array=op==='mark'?'completed':'favorites';
    state[array]=state[array].filter(x=>x!==id);
    if(change.value)state[array].push(id);
    if(state[array].length>DW_CONFIG.MAX_READINGS)throw new Error('Reading limit exceeded');
  }else throw new Error('Unsupported change');
}
function result_(name,state,updatedAt){
  return {ok:true,name,state,updatedAt};
}
