(() => {
"use strict";
const root = document.getElementById("app");
const TRACKS = {JES:["예수님을 바라보다","예수님의 삶과 말씀"], ACT:["지금도 일하시는 주님","성령과 교회"], PSA:["시편으로 기도하다","기도와 기다림"]};
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let feed = {published:[],dailySchedule:[]}, tab = new URLSearchParams(location.search).has("session")?"reader":"today", track = "JES", loading = true, failure=false;
const requestedId = () => new URLSearchParams(location.search).get("session");
const byId = id => feed.published.find(x => x.session_id === id && x.status==="PUBLISHED");
function nyDate() { const parts = new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()); const get=k=>parts.find(p=>p.type===k)?.value;return [get("year"),get("month"),get("day")].join("-"); }
function current() {const date=nyDate();const day=feed.dailySchedule.find(x=>x.date===date && x.plan_id==="JES"&&x.publication_status==="PUBLISHED");return day?byId(day.session_id):null;}
function linkTo(id) { history.pushState({id},"","?session="+encodeURIComponent(id));tab="reader";render();window.scrollTo(0,0); }
function navTo(id){history.pushState({tab:id},"",location.pathname);tab=id;render();window.scrollTo(0,0);}
function markup(p) {
const label='<div class="publication-tags"><span class="status">시범 공개 · 실제 발행 원고</span> <span class="small-label">'+esc(p.book_passage)+'</span></div>';
const readBtn='<button class="read-btn" data-read="'+esc(p.session_id)+'">전체 본문과 묵상 읽기</button>';
return '<article class="card sample-card">'+label+'<div class="mark">✣</div><h2>'+esc(p.title)+'</h2><p class="highlight-verse">“'+esc(p.widget_excerpt)+'”</p><p class="desc">'+esc(p.key_message)+'</p>'+readBtn+'</article>';
}
function reader(p){
let verseHtml=p.verses.map(v=>'<div class="verse-row"><span class="verse-number">'+esc(v.verse)+'</span><p>'+esc(v.text)+'</p></div>').join("");
let secHtml=p.sections.map(s=>'<section class="reading-section"><h2>'+esc(s.heading)+'</h2>'+(s.paragraphs||[]).map(x=>'<p>'+esc(x)+'</p>').join('')+'</section>').join('');
return '<div class="reader-top"><button class="back-btn" data-nav="library">← 라이브러리</button><span class="status">시범 공개 · INT-001</span></div><article class="reading"><div class="eyebrow">'+esc(p.book_passage)+' · 자체 직역</div><h1>'+esc(p.title)+'</h1><p class="desc">신약 그리스어 원문을 바탕으로 자체 직역한 본문이며 공인 번역본이 아닙니다.</p><div class="reader-actions"><a href="'+esc(p.bible_url)+'" target="_blank" rel="noopener noreferrer">성경 앱에서 보기</a></div><section class="scripture"><h2>성경 본문 · 전체 '+p.verses.length+'절</h2>'+verseHtml+'</section>'+secHtml+'<p class="footer-note">이 원고는 사용자 승인으로 한 편만 공개한 시험판입니다.</p></article>';
}
function navButtons() {return [["today","오늘의 묵상"],["library","말씀 라이브러리"],["settings","안내"]].map(([id,title])=>'<button data-nav="'+id+'" class="'+(tab===id?"active":"")+'">'+title+'</button>').join("");}
function render(){
let content="",heading="오늘, 말씀 앞에";
if(tab==="reader") {
const target=byId(requestedId());
heading="전체 묵상";
content=target?reader(target):'<div class="card"><h2>아직 공개되지 않은 본문입니다</h2><p>승인된 회차만 읽을 수 있습니다.</p><button class="read-btn" data-nav="library">라이브러리로 돌아가기</button></div>';
} else if(tab==="today") {
const p=current();
content=loading?'<div class="card"><p>발행 자료를 확인하고 있습니다…</p></div>':p?markup(p):'<div class="card"><span class="status">발행된 오늘의 회차 없음</span><h2>오늘 배정된 말씀이 없습니다</h2><p>정식 날짜별 일정은 아직 시작하지 않았습니다. 라이브러리에서 공개된 시범 원고를 읽을 수 있습니다.</p><button class="read-btn" data-nav="library">시범 묵상 찾아보기</button></div>';
} else if(tab==="library") {
heading="말씀 라이브러리";
const tr=Object.entries(TRACKS).map(([id,x])=>'<button class="track '+(track===id?"active":"")+'" data-track="'+id+'"><strong>'+esc(x[0])+'</strong><small>'+esc(x[1])+'</small></button>').join("");
const items=feed.published.filter(p=>p.plan_id===track);
content='<div class="tracks">'+tr+'</div>'+(items.length?items.map(markup).join(""):'<div class="card"><h2>아직 공개된 묵상이 없습니다</h2><p>이 트랙의 원고는 검수 중입니다.</p></div>');
} else { heading="이용 안내";content='<div class="card"><h2>매일 말씀 · 시험 운영</h2><p>예수님을 바라보는 JES를 기본 진도로 운영하고 ACT·PSA는 자유롭게 읽을 수 있습니다. 현재 한 편만 시범 공개했으며 다음 회차와 자동 일정은 시작하지 않았습니다.</p><p>아이폰은 Scriptable, 갤럭시는 KWGT로 별도 위젯을 만들 수 있습니다. 새 날짜에 자동으로 변경되는 기능은 추후 게시 일정이 정해진 후 연결됩니다.</p><p><a href="https://github.com/philojc/daily-word-qt/tree/main/widgets" target="_blank" rel="noopener noreferrer">위젯 연결 안내</a></p></div>';}
const nav=navButtons();
root.innerHTML='<div class="layout"><aside class="side"><div class="brand">✣ 매일 말씀</div><div class="sub">DAILY DEVOTION</div><nav class="nav">'+nav+'</nav></aside><main class="main"><div class="eyebrow">매일 말씀 / DAILY DEVOTION</div>'+(tab==="reader"?"":'<h1 class="hero">'+heading+'</h1><p class="desc">예수님을 알아가고, 말씀으로 하나님께 기도하는 시간.</p>')+content+'<p class="foot">한 편만 시험 발행 · 나머지 원고는 비공개</p></main><nav class="bottom">'+nav+'</nav></div>';
}
root.addEventListener("click",e=>{const b=e.target.closest("[data-nav],[data-track],[data-read]");if(!b)return;if(b.dataset.track){track=b.dataset.track;render();} else if(b.dataset.read){linkTo(b.dataset.read);} else if(b.dataset.nav){navTo(b.dataset.nav);}});
window.addEventListener("popstate",()=>{tab=new URLSearchParams(location.search).has("session")?"reader":"today";render();});
fetch("./data/publications.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json()}).then(d=>{
if(d?.schemaVersion!==1||!Array.isArray(d.published)||!Array.isArray(d.dailySchedule))throw Error("Invalid feed");
feed={published:d.published.filter(p=>p?.status==="PUBLISHED"&&Array.isArray(p.verses)&&Array.isArray(p.sections)),dailySchedule:d.dailySchedule.filter(x=>x?.publication_status==="PUBLISHED")};
}).catch(()=>{failure=true;}).finally(()=>{loading=false;render();});
render();
})();