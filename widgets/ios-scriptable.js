// 매일 말씀 | Scriptable iPhone widget
// 발행된 파일 1개만 읽습니다. 시험판을 구분하여 보여줍니다.
const DATA_URL = "https://raw.githubusercontent.com/philojc/daily-word-qt/main/data/widget.json";
const w = new ListWidget();
w.backgroundColor = new Color("#F7F7F1");
w.setPadding(17, 18, 17, 18);

const header = w.addText("✣  매일 말씀");
header.font = Font.boldSystemFont(12);
header.textColor = new Color("#4B7858");
w.addSpacer(10);

let d = null;
try {
  const req = new Request(DATA_URL + "?t=" + Math.floor(Date.now()/3600000));
  req.timeoutInterval = 10;
  d = await req.loadJSON();
  if (!d || d.session_id !== "INT-001" || d.status !== "PREVIEW" || d.is_pilot !== true) {
    throw new Error("Publication not approved");
  }
} catch (err) {
  const t = w.addText("연결을 확인해 주세요");
  t.font = Font.mediumSystemFont(15);
  t.textColor = new Color("#5C6B61");
  const foot = w.addText("발행 자료를 불러오지 못했습니다.");
  foot.font = Font.systemFont(10);
  foot.textColor = new Color("#7B877D");
}

if (d) {
  const tag = w.addText("위젯 연결 테스트 · " + (d.book_passage || "누가복음 2:1–20"));
  tag.font = Font.mediumSystemFont(10);
  tag.textColor = new Color("#758376");
  w.addSpacer(5);
  const title = w.addText(d.title);
  title.font = Font.boldSystemFont(17);
  title.textColor = new Color("#283F31");
  title.lineLimit = 2;
  title.minimumScaleFactor = 0.8;
  w.addSpacer(8);
  const verse = w.addText("“" + d.excerpt + "”");
  verse.font = Font.systemFont(12);
  verse.textColor = new Color("#4B5A4E");
  verse.lineLimit = 3;
  verse.minimumScaleFactor = 0.8;
  w.url = d.url;
  w.addSpacer();
  const foot = w.addText("눌러서 Google Docs 원고 보기");
  foot.font = Font.mediumSystemFont(10);
  foot.textColor = new Color("#7F947F");
}
w.refreshAfterDate = new Date(Date.now() + 60*60*1000);
Script.setWidget(w);
if (!config.runsInWidget) await w.presentMedium();
Script.complete();
