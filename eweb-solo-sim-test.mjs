#!/usr/bin/env node
/**
 * eWeb 1対1判定のシミュレーション。
 * 実eWebには接続せず、通<国> / 通<数> / 通(数) / 講(数) / 集団データを使う。
 *
 * 使い方: node eweb-solo-sim-test.mjs
 * ブラウザ確認まで行う場合は、先に index.html を配信して Chrome CDP を開いておく。
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

function extractBlock(startRe, endRe){
  const start = appSrc.search(startRe);
  if(start < 0) throw new Error("start not found: " + startRe);
  const after = appSrc.slice(start + 1);
  const endRel = after.search(endRe);
  if(endRel < 0) throw new Error("end not found: " + endRe);
  return appSrc.slice(start, start + 1 + endRel);
}

const helpers = extractBlock(/^function normSoloName/m, /^function loadSoloMapForDate/m)
  + extractBlock(/^function loadSoloMapForDate/m, /^function soloSlashMarkHtml/m);
const eweb = extractBlock(/^const EWEB_SUBJECT_ABBR/m, /^function guessSubjectFromName/m);

const mem = {};
const STORAGE = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem(k, v){ mem[k] = String(v); }
};
const ctx = { STORAGE, window: { STORAGE }, console };
vm.createContext(ctx);
vm.runInContext(helpers + "\n" + eweb, ctx);

const {
  parseEwebSubject, isEwebSoloSubject, ewebSoloDisplaySubject,
  soloMapFromEwebPayload, saveEwebSoloMap, soloComboKey
} = ctx;

const SEP = "\u2016";
const results = [];
function check(name, ok, detail){
  results.push({ name, ok: !!ok, detail: detail || "" });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? " — " + detail : ""}`);
}

function keysOf(map){ return Object.keys(map || {}).sort(); }

/* ---------- 科目パース ---------- */
check("parseEwebSubject(通<国>) → 国語", parseEwebSubject("通<国>").subject === "国語", parseEwebSubject("通<国>").subject);
check("parseEwebSubject(通<数>) → 数学", parseEwebSubject("通<数>").subject === "数学", parseEwebSubject("通<数>").subject);
check("parseEwebSubject(通(数)) → 数学", parseEwebSubject("通(数)").subject === "数学", parseEwebSubject("通(数)").subject);
check("parseEwebSubject(講(数)) → 数学 / course", parseEwebSubject("講(数)").subject === "数学" && parseEwebSubject("講(数)").status === "course");

check("isEwebSoloSubject(通<国>)", isEwebSoloSubject("通<国>"));
check("isEwebSoloSubject(通<数>)", isEwebSoloSubject("通<数>"));
check("isEwebSoloSubject(通(数)) は false", !isEwebSoloSubject("通(数)"));
check("isEwebSoloSubject(講(数)) は false", !isEwebSoloSubject("講(数)"));
check("isEwebSoloSubject(講<数>) は false", !isEwebSoloSubject("講<数>"));
check("表示科目 通<国> → 国語", ewebSoloDisplaySubject("通<国>") === "国語");
check("表示科目 通<数> → 数学", ewebSoloDisplaySubject("通<数>") === "数学");

/* ---------- payload シミュレーション ---------- */
const payloadKokugo = {
  date: "2026-08-18",
  komas: [{ id: 1, name: "A", start: "17:10", end: "18:40" }],
  items: [{ koma_id: 1, teacher_name: "講師A", student_name: "山田 太郎", grade: "中3", subject: "通<国>", pos: 1 }],
  groups: [{ koma_id: 1, start: "17:10", end: "18:40", name: "中3社会-2026夏期集団", teacher_name: "講師B", students: ["集団 生徒"] }]
};
const payloadSugaku = {
  date: "2026-08-19",
  items: [{ koma_id: 1, teacher_name: "講師A", student_name: "佐藤 花子", grade: "中2", subject: "通<数>", pos: 1 }]
};
const payloadOneToTwo = {
  date: "2026-08-20",
  items: [{ koma_id: 1, teacher_name: "講師A", student_name: "鈴木 一郎", grade: "中1", subject: "通(数)", pos: 1 }]
};
const payloadKoushu = {
  date: "2026-08-21",
  items: [{ koma_id: 1, teacher_name: "講師A", student_name: "高橋 次郎", grade: "高1", subject: "講(数)", pos: 1 }]
};
const payloadGroupOnly = {
  date: "2026-08-22",
  items: [],
  groups: [{ koma_id: 1, name: "中3社会-2026夏期集団", teacher_name: "講師B", students: ["集団 生徒"] }]
};
const payloadSchedules = {
  date: "2026-08-23",
  schedules: [{ koma_id: 1, teacher_name: "講師A", student_name: "伊藤 三郎", grade: "中3", subject_name: "通<国>", pos: 1 }]
};

const mapK = soloMapFromEwebPayload(payloadKokugo);
const mapS = soloMapFromEwebPayload(payloadSugaku);
const map12 = soloMapFromEwebPayload(payloadOneToTwo);
const mapKo = soloMapFromEwebPayload(payloadKoushu);
const mapG = soloMapFromEwebPayload(payloadGroupOnly);
const mapSch = soloMapFromEwebPayload(payloadSchedules);

const keyK = soloComboKey("山田 太郎", "国語");
const keyS = soloComboKey("佐藤 花子", "数学");
const badK = "山田太郎" + SEP + "通";

check("通<国> が1対1として保存される", mapK[keyK] === 1, keysOf(mapK).join(","));
check("通<国> の科目は国語であり「通」ではない", !mapK[badK] && keysOf(mapK).every(k => k.endsWith(SEP + "国語")));
check("集団データは1対1にならない", keysOf(mapK).every(k => !k.includes("集団")));
check("通<数> が1対1として保存される", mapS[keyS] === 1, keysOf(mapS).join(","));
check("通(数) は1対1にならない", keysOf(map12).length === 0, keysOf(map12).join(","));
check("講(数) は1対1にならない", keysOf(mapKo).length === 0, keysOf(mapKo).join(","));
check("集団のみ payload は1対1にならない", keysOf(mapG).length === 0);
check("schedules[].subject_name の 通<国> も1対1", mapSch[soloComboKey("伊藤 三郎", "国語")] === 1, keysOf(mapSch).join(","));

/* ---------- 保存キー・他日データ維持 ---------- */
STORAGE.setItem("seat-table-solo", JSON.stringify({ "2020-01-01": { ["旧生徒" + SEP + "国語"]: 1 } }));
saveEwebSoloMap("2026-08-18", mapK);
const stored = JSON.parse(STORAGE.getItem("seat-table-solo"));
check("保存キーは seat-table-solo", STORAGE.getItem("seat-table-solo") != null);
check("他日の既存1対1を消さない", stored["2020-01-01"]["旧生徒" + SEP + "国語"] === 1);
check("当日分はパース後科目で保存", stored["2026-08-18"][keyK] === 1);

const failed = results.filter(r => !r.ok);
console.log("\n--- node unit ---");
console.log(`${results.length - failed.length}/${results.length} passed`);
if(failed.length){
  failed.forEach(f => console.log("  FAIL", f.name, f.detail));
  process.exitCode = 1;
}

const runBrowser = process.argv.includes("--browser") || process.env.EWEB_SOLO_BROWSER === "1";
if(!runBrowser){
  console.log("\n(ブラウザ確認は node eweb-solo-sim-test.mjs --browser で実行)");
  process.exit(process.exitCode || 0);
}

const PORT = Number(process.env.CHECK_PORT || 8765);
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, timeout=15000){
  const start = Date.now();
  while(Date.now() - start < timeout){
    try { const v = await fn(); if(v) return v; } catch(e){}
    await sleep(150);
  }
  throw new Error("timeout");
}

async function connectCdp(){
  const version = await waitFor(async ()=>{
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if(!res.ok) return null;
    return res.json();
  });
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej)=>{ ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", ev=>{
    const msg = JSON.parse(ev.data);
    if(msg.id && pending.has(msg.id)){
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if(msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  function send(method, params={}, sessionId){
    const msg = { id: ++id, method, params };
    if(sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject)=> pending.set(id, { resolve, reject }));
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params={})=> send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  return { ws, s };
}

async function evalInPage(s, expression){
  const res = await s("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if(res.exceptionDetails){
    const t = res.exceptionDetails.exception && (res.exceptionDetails.exception.description || res.exceptionDetails.exception.value);
    throw new Error(t || JSON.stringify(res.exceptionDetails));
  }
  return res.result.value;
}

const browserResults = [];
function bcheck(name, ok, detail){
  browserResults.push({ name, ok: !!ok, detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

try{
  const { s, ws } = await connectCdp();
  await s("Page.navigate", { url: `${BASE}/index.html?ewebSoloSim=${Date.now()}` });
  await waitFor(async ()=>{
    const ready = await evalInPage(s, `document.readyState === "complete" && typeof saveEwebSoloMap === "function"`);
    return ready;
  });
  await s("Page.reload", { ignoreCache: true });
  await waitFor(async ()=>{
    const ready = await evalInPage(s, `document.readyState === "complete" && typeof saveEwebSoloMap === "function"`);
    return ready;
  });
  await sleep(400);

  const out = await evalInPage(s, `(async function(){
    function slashInfo(rootSel){
      const rows = Array.from(document.querySelectorAll(rootSel + " .seat-row-wrap"));
      return rows.map(row => {
        const kids = Array.from(row.children);
        const leftName = (kids[4] && kids[4].querySelector("select")) ? kids[4].querySelector("select").value : "";
        const rightName = (kids[7] && kids[7].querySelector("select")) ? kids[7].querySelector("select").value : "";
        const leftSubj = (kids[2] && kids[2].querySelector(".js-subject")) ? kids[2].querySelector(".js-subject").value : "";
        const rightSubj = (kids[5] && kids[5].querySelector(".js-subject")) ? kids[5].querySelector(".js-subject").value : "";
        const rightBlocked = !!(kids[5] && kids[5].classList.contains("solo-blocked")
          && kids[6] && kids[6].classList.contains("solo-blocked")
          && kids[7] && kids[7].classList.contains("solo-blocked"));
        const leftBlocked = !!(kids[2] && kids[2].classList.contains("solo-blocked"));
        const svg = row.querySelectorAll(".solo-slash-mark").length;
        return { leftName, rightName, leftSubj, rightSubj, rightBlocked, leftBlocked, svg };
      });
    }
    function ensurePerson(list, name, extra){
      if(!name) return;
      if(!list.some(x => x.name === name)){
        list.push(Object.assign({ id: uid(), name, birthdate:"", grade:"", subject:"" }, extra || {}));
      }
    }
    function importLikeConfirm(payload){
      (payload.items || payload.schedules || []).forEach(it=>{
        ensurePerson(state.students, it.student_name, { grade: it.grade || "" });
        if(it.teacher_name){
          if(!state.teachers.some(t => t.name === it.teacher_name)){
            state.teachers.push({ id: uid(), name: it.teacher_name, subjects:"", note:"" });
          }
        }
      });
      const dateStr = payload.date;
      const newDay = buildDayFromEwebPayload(payload);
      state.days[dateStr] = newDay;
      migrate(state);
      currentDate = dateStr;
      saveEwebSoloMap(dateStr, soloMapFromEwebPayload(payload));
      saveState();
      renderTabs();
      renderSeatView();
      if(window.__repaintSolo) window.__repaintSolo();
    }

    STORAGE.setItem("seat-table-solo", JSON.stringify({ "2020-01-01": { "旧生徒\\u2016国語": 1 } }));

    const cases = {
      kokugo: {
        date: "2026-08-18",
        komas: [{ id:1, name:"A", start:"17:10", end:"18:40" }],
        items: [{ koma_id:1, teacher_name:"講師A", student_name:"山田 太郎", grade:"中3", subject:"通<国>", pos:1 }],
        groups: [{ koma_id:1, name:"中3社会-2026夏期集団", teacher_name:"講師B", students:["集団 生徒"] }]
      },
      sugaku: {
        date: "2026-08-19",
        komas: [{ id:1, name:"A", start:"17:10", end:"18:40" }],
        items: [{ koma_id:1, teacher_name:"講師A", student_name:"佐藤 花子", grade:"中2", subject:"通<数>", pos:1 }]
      },
      oneToTwo: {
        date: "2026-08-20",
        komas: [{ id:1, name:"A", start:"17:10", end:"18:40" }],
        items: [{ koma_id:1, teacher_name:"講師A", student_name:"鈴木 一郎", grade:"中1", subject:"通(数)", pos:1 }]
      },
      koushu: {
        date: "2026-08-21",
        komas: [{ id:1, name:"A", start:"17:10", end:"18:40" }],
        items: [{ koma_id:1, teacher_name:"講師A", student_name:"高橋 次郎", grade:"高1", subject:"講(数)", pos:1 }]
      }
    };

    const out = {};
    importLikeConfirm(cases.kokugo);
    out.kokugoSeat = slashInfo("#view-seat")[0];
    out.kokugoSubjectCell = parseEwebSubject("通<国>").subject;
    out.soloAfterKokugo = JSON.parse(STORAGE.getItem("seat-table-solo") || "{}");
    renderSeatView();
    if(window.__repaintSolo) window.__repaintSolo();
    out.kokugoAfterRerender = slashInfo("#view-seat")[0];
    await new Promise(r => setTimeout(r, 1600));
    out.kokugoAfterInterval = slashInfo("#view-seat")[0];

    currentTab = "print";
    renderTabs();
    renderPrintPreviewView();
    out.kokugoPrint = slashInfo("#view-print .print-preview-page")[0];
    out.kokugoPrintSvg = document.querySelectorAll("#view-print .print-preview-page .solo-slash-mark").length;
    out.kokugoMultiHtml = printDayPageHtml("2026-08-18");
    currentTab = "seat";
    renderTabs();
    renderSeatView();

    importLikeConfirm(cases.sugaku);
    out.sugakuSeat = slashInfo("#view-seat")[0];
    out.soloAfterSugaku = JSON.parse(STORAGE.getItem("seat-table-solo") || "{}");
    currentTab = "print";
    renderTabs();
    renderPrintPreviewView();
    out.sugakuPrint = slashInfo("#view-print .print-preview-page")[0];
    currentTab = "seat";
    renderTabs();

    importLikeConfirm(cases.oneToTwo);
    out.oneToTwoSeat = slashInfo("#view-seat")[0];
    out.soloOneToTwo = JSON.parse(STORAGE.getItem("seat-table-solo") || "{}")["2026-08-20"] || {};

    importLikeConfirm(cases.koushu);
    out.koushuSeat = slashInfo("#view-seat")[0];
    out.soloKoushu = JSON.parse(STORAGE.getItem("seat-table-solo") || "{}")["2026-08-21"] || {};

    out.preservedOld = JSON.parse(STORAGE.getItem("seat-table-solo") || "{}")["2020-01-01"];
    out.storageKeys = Object.keys(localStorage).filter(k => /seat-table/.test(k)).sort();
    return out;
  })()`);

  const sep = "\u2016";
  bcheck("通<国> 座席科目が国語", out.kokugoSeat && out.kokugoSeat.leftSubj === "国語", out.kokugoSeat && out.kokugoSeat.leftSubj);
  bcheck("通<国> が1対1保存（国語キー）", !!(out.soloAfterKokugo && out.soloAfterKokugo["2026-08-18"] && out.soloAfterKokugo["2026-08-18"]["山田太郎" + sep + "国語"]));
  bcheck("通<国> 相手側空席に斜線", !!(out.kokugoSeat && out.kokugoSeat.rightBlocked && !out.kokugoSeat.leftBlocked));
  bcheck("再描画後も斜線が残る", !!(out.kokugoAfterRerender && out.kokugoAfterRerender.rightBlocked));
  bcheck("定期paint後も斜線が残る", !!(out.kokugoAfterInterval && out.kokugoAfterInterval.rightBlocked));
  bcheck("印刷プレビューでも斜線", !!(out.kokugoPrint && out.kokugoPrint.rightBlocked));
  bcheck("印刷プレビューに斜線SVG", (out.kokugoPrintSvg || 0) > 0, String(out.kokugoPrintSvg));
  bcheck("複数日印刷HTMLでも斜線", !!(out.kokugoMultiHtml && /solo-blocked/.test(out.kokugoMultiHtml) && /solo-slash-mark/.test(out.kokugoMultiHtml)));
  bcheck("通<数> 座席科目が数学", out.sugakuSeat && out.sugakuSeat.leftSubj === "数学", out.sugakuSeat && out.sugakuSeat.leftSubj);
  bcheck("通<数> が1対1保存（数学キー）", !!(out.soloAfterSugaku && out.soloAfterSugaku["2026-08-19"] && out.soloAfterSugaku["2026-08-19"]["佐藤花子" + sep + "数学"]));
  bcheck("通<数> 相手側空席に斜線", !!(out.sugakuSeat && out.sugakuSeat.rightBlocked));
  bcheck("通<数> 印刷プレビューでも斜線", !!(out.sugakuPrint && out.sugakuPrint.rightBlocked));
  bcheck("通(数) は1対1にならない", out.oneToTwoSeat && !out.oneToTwoSeat.rightBlocked && Object.keys(out.soloOneToTwo || {}).length === 0);
  bcheck("講(数) は1対1にならない", out.koushuSeat && !out.koushuSeat.rightBlocked && Object.keys(out.soloKoushu || {}).length === 0);
  bcheck("既存の他日1対1を消さない", !!(out.preservedOld && out.preservedOld["旧生徒" + sep + "国語"] === 1));
  bcheck("保存キーは seat-table-solo のまま", Array.isArray(out.storageKeys) && out.storageKeys.includes("seat-table-solo") && out.storageKeys.includes("seat-table-v1"));

  ws.close();
}catch(e){
  bcheck("ブラウザシミュレーション実行", false, String(e && e.message || e));
}

const bfailed = browserResults.filter(r => !r.ok);
console.log("\n--- browser ---");
console.log(`${browserResults.length - bfailed.length}/${browserResults.length} passed`);
if(bfailed.length){
  bfailed.forEach(f => console.log("  FAIL", f.name, f.detail));
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
