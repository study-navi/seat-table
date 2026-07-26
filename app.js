/* =========================================================
座席表アプリ本体
- localStorage キー "seat-table-v1" は旧サイトと同じ構造を維持
（旧サイトからエクスポートしたバックアップJSONをそのまま読み込めるようにするため）
========================================================= */

const STORAGE_KEY = "seat-table-v1";

const WEEKDAY_LABELS = ["日","月","火","水","木","金","土"];

const DEFAULT_SUBJECTS = [
"国語","算数","数学","英語","理科","社会",
"物理","化学","生物","地学",
"現代文","古文","漢文",
"日本史","世界史","地理","公民",
"情報","小論文",
"数学Ⅰ","数学A","物理基礎","化学基礎",
"その他"
];

const COMMON_TIME_PRESETS = [
"09:00〜10:30","10:40〜12:10","13:00〜14:30","14:40〜16:10",
"16:40〜18:10","18:20〜19:50","20:00〜21:30"
];

const STATUS_LABELS = { course: "講習", transfer: "振替", absent: "欠席" };

/* ---------------- state ---------------- */
let state = null;
let currentDate = todayStr();
let currentTab = "seat";
let studentSearch = "";
let teacherWarnCache = new Set(); // teacher names currently in use somewhere

function todayStr(){
const d = new Date();
return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
}
function pad(n){ return String(n).padStart(2,"0"); }
function uid(){ return Math.random().toString(36).slice(2,9); }

/* ---------------- persistence ---------------- */
function loadState(){
let raw = null;
try{ raw = localStorage.getItem(STORAGE_KEY); }catch(e){}
let data;
try{ data = raw ? JSON.parse(raw) : null; }catch(e){ data = null; }
data = migrate(data || {});
return data;
}

function migrate(data){
data.students = Array.isArray(data.students) ? data.students : [];
data.teachers = Array.isArray(data.teachers) ? data.teachers : [];
data.days = (data.days && typeof data.days === "object") ? data.days : {};
data.weekdayPresets = (data.weekdayPresets && typeof data.weekdayPresets === "object") ? data.weekdayPresets : {};
data.customSubjects = Array.isArray(data.customSubjects) ? data.customSubjects : [];
data.printSettings = (data.printSettings && typeof data.printSettings === "object") ? data.printSettings : {};
data.printSettings.subjectSize = data.printSettings.subjectSize || 15;
data.printSettings.studentSize = data.printSettings.studentSize || 10.5;
data.printSettings.gradeSize = data.printSettings.gradeSize || 7.5;
data.printSettings.logoImage = data.printSettings.logoImage || null;
data.printSettings.logoMode = data.printSettings.logoMode || "corner-tr";
data.printSettings.logoOpacity = (typeof data.printSettings.logoOpacity === "number") ? data.printSettings.logoOpacity : 0.18;
// normalize students
data.students.forEach(s=>{
if(!s.id) s.id = uid();
s.name = s.name || "";
s.birthdate = s.birthdate || "";
s.grade = s.grade || "";
s.subject = s.subject || "";
});
// normalize teachers
data.teachers.forEach(t=>{
if(!t.id) t.id = uid();
t.name = t.name || "";
t.subjects = t.subjects || "";
t.note = t.note || "";
});
// normalize days / presets blocks
const fixDay = (day)=>{
if(!day || typeof day !== "object") day = {};
day.blocks = Array.isArray(day.blocks) ? day.blocks : [];
day.blocks.forEach(b=>{
if(!b.id) b.id = uid();
b.time = b.time || "時間を入力";
b.seats = Array.isArray(b.seats) ? b.seats : [];
b.groupRows = Array.isArray(b.groupRows) ? b.groupRows : [];
b.seats.forEach((s,i)=>{
s.seatNumber = (s.seatNumber !== undefined && s.seatNumber !== null && s.seatNumber !== "") ? String(s.seatNumber) : String(i+1);
s.teacher = s.teacher || "";
s.left = s.left || {student:"",subject:"",grade:"",status:"normal"};
s.right = s.right || {student:"",subject:"",grade:"",status:"normal"};
s.left.status = s.left.status || "normal";
s.right.status = s.right.status || "normal";
});
b.groupRows.forEach(g=>{
if(!g.id) g.id = uid();
g.seatNumber = g.seatNumber || "";
g.name = g.name || "";
g.teacher = g.teacher || "";
g.subject = g.subject || "";
g.students = Array.isArray(g.students) ? g.students : [];
});
});
return day;
};
Object.keys(data.days).forEach(k=> data.days[k] = fixDay(data.days[k]));
Object.keys(data.weekdayPresets).forEach(k=> data.weekdayPresets[k] = fixDay(data.weekdayPresets[k]));
return data;
}

let saveTimer = null;
function saveState(){
setSaveIndicator("saving");
try{
localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
clearTimeout(saveTimer);
saveTimer = setTimeout(()=> setSaveIndicator("ok"), 250);
}catch(e){
setSaveIndicator("error");
showToast("保存に失敗しました（ブラウザのストレージ容量を確認してください）", true);
}
}
function setSaveIndicator(mode){
const el = document.getElementById("saveIndicator");
const text = document.getElementById("saveIndicatorText");
el.classList.remove("saving","error");
if(mode==="saving"){ el.classList.add("saving"); text.textContent = "保存中…"; }
else if(mode==="error"){ el.classList.add("error"); text.textContent = "保存に失敗しました"; }
else{ text.textContent = "この端末に自動保存"; }
}

function getOrCreateDay(dateStr){
if(!state.days[dateStr]){
state.days[dateStr] = { blocks: COMMON_TIME_PRESETS.map(()=>emptyBlock()) };
}
return state.days[dateStr];
}
function emptyBlock(seatCount=8){
return {
id: uid(), time: "時間を入力",
seats: Array.from({length:seatCount}, (_,i)=>emptySeat(i+1)),
groupRows: []
};
}
function emptySeat(n){
return {
seatNumber: String(n), teacher: "",
left: {student:"",subject:"",grade:"",status:"normal"},
right: {student:"",subject:"",grade:"",status:"normal"}
};
}

/* ---------------- subject suggestions ---------------- */
function allSubjectSuggestions(){
const used = new Set(DEFAULT_SUBJECTS);
state.customSubjects.forEach(s=> s && used.add(s));
state.students.forEach(s=> s.subject && used.add(s.subject));
return Array.from(used);
}
function registerCustomSubject(val){
if(!val) return;
if(DEFAULT_SUBJECTS.includes(val)) return;
if(!state.customSubjects.includes(val)){
state.customSubjects.push(val);
}
}
function subjectDatalist(){
return `<datalist id="subjectList">${allSubjectSuggestions().map(s=>`<option value="${escapeHtml(s)}">`).join("")}</datalist>`;
}

/* ---------------- helpers ---------------- */
function escapeHtml(str){
return String(str==null?"":str).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function showToast(msg, isError){
const t = document.getElementById("toast");
t.textContent = msg;
t.hidden = false;
t.classList.toggle("error", !!isError);
clearTimeout(t._timer);
t._timer = setTimeout(()=>{ t.hidden = true; }, 3200);
}
function jaCollator(){
return new Intl.Collator("ja");
}
function weekdayOf(dateStr){
const [y,m,d] = dateStr.split("-").map(Number);
return new Date(y, m-1, d).getDay();
}

/* Find every place a teacher name is currently referenced (for delete warnings) */
function teacherUsageCount(name){
let count = 0;
const scanDay = (day)=>{
day.blocks.forEach(b=>{
b.seats.forEach(s=>{ if(s.teacher === name) count++; });
b.groupRows.forEach(g=>{ if(g.teacher === name) count++; });
});
};
Object.values(state.days).forEach(scanDay);
Object.values(state.weekdayPresets).forEach(scanDay);
return count;
}
function studentUsageCount(name){
let count = 0;
const scanDay = (day)=>{
day.blocks.forEach(b=>{
b.seats.forEach(s=>{
if(s.left.student === name) count++;
if(s.right.student === name) count++;
});
b.groupRows.forEach(g=>{ count += g.students.filter(n=>n===name).length; });
});
};
Object.values(state.days).forEach(scanDay);
Object.values(state.weekdayPresets).forEach(scanDay);
return count;
}

/* =========================================================
Modal helper
========================================================= */
function openModal(html, onMount){
const root = document.getElementById("modalRoot");
root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
const backdrop = root.querySelector(".modal-backdrop");
backdrop.addEventListener("click", (e)=>{ if(e.target === backdrop) closeModal(); });
if(onMount) onMount(root.querySelector(".modal"));
}
function closeModal(){
document.getElementById("modalRoot").innerHTML = "";
}

/* =========================================================
TAB SWITCHING
========================================================= */
function initTabs(){
document.getElementById("tabs").addEventListener("click",(e)=>{
const btn = e.target.closest(".tab-btn");
if(!btn) return;
currentTab = btn.dataset.tab;
renderTabs();
renderCurrentView();
});
}
function renderTabs(){
document.querySelectorAll(".tab-btn").forEach(b=>{
b.classList.toggle("active", b.dataset.tab === currentTab);
});
document.getElementById("studentCount").textContent = state.students.length;
document.getElementById("teacherCount").textContent = state.teachers.length;
["seat","students","teachers","print","settings"].forEach(name=>{
document.getElementById("view-"+name).hidden = (name !== currentTab);
});
}
function renderCurrentView(){
if(currentTab === "seat") renderSeatView();
else if(currentTab === "students") renderStudentsView();
else if(currentTab === "teachers") renderTeachersView();
else if(currentTab === "print") renderPrintPreviewView();
else if(currentTab === "settings") renderSettingsView();
}

/* =========================================================
SEAT VIEW
========================================================= */
function renderSeatView(){
const el = document.getElementById("view-seat");
const day = getOrCreateDay(currentDate);
const wd = weekdayOf(currentDate);
const dateObj = new Date(currentDate+"T00:00:00");
const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth()+1}月${dateObj.getDate()}日（${WEEKDAY_LABELS[wd]}）`;

el.innerHTML = `
<div class="panel page-head">
<p class="eyebrow">LESSON SEATING</p>
<h2>${dateLabel}</h2>
${logoHtml(false)}
<div class="seat-toolbar">
<label class="date-field">日付
<input type="date" id="datePicker" value="${currentDate}">
</label>
<div class="btn-row">
<button class="btn" id="btnCopyLastWeek">先週をコピー</button>
<button class="btn" id="btnImportEweb">eWebから読み込む</button>
<button class="btn danger" id="btnDeleteGroupRows">この日の集団行を削除</button>
<button class="btn danger" id="btnDeleteAll">この日をすべて削除</button>
<button class="btn" id="btnImportImage">画像から取り込み</button>
<button class="btn" id="btnPrint">A3横で印刷</button>
<button class="btn primary" id="btnAddBlock">＋ 授業枠を追加</button>
</div>
</div>
</div>

<div class="preset-panel">
<div>
<div class="preset-title">基本曜日プリセット
<small>曜日ごとのいつもの座席表を保存・呼び出し</small>
</div>
</div>
<div class="weekday-grid" id="weekdayGrid"></div>
<div class="preset-actions">
<button class="btn" id="btnLoadPreset">この曜日を呼び出す</button>
<button class="btn primary" id="btnSavePreset">現在の表を${WEEKDAY_LABELS[wd]}曜日の基本に保存</button>
</div>
</div>

<div class="legend">
<span><span class="swatch course"></span>講習</span>
<span><span class="swatch transfer"></span>振替</span>
<span><span class="swatch absent"></span>欠席</span>
<span>生徒名の下のボタンでワンタップ切り替え</span>
</div>

<div class="blocks" id="blocksWrap"></div>
${subjectDatalist()}
`;

// weekday chips
const grid = document.getElementById("weekdayGrid");
grid.innerHTML = WEEKDAY_LABELS.map((label,i)=>{
const hasPreset = !!(state.weekdayPresets[i] && state.weekdayPresets[i].blocks && state.weekdayPresets[i].blocks.length);
return `<div class="weekday-chip ${i===wd?"selected":""} ${hasPreset?"has-preset":""}" data-wd="${i}">
<span class="wd-label">${hasPreset?"登録済":"未登録"}</span>${label}
</div>`;
}).join("");

document.getElementById("datePicker").addEventListener("change", e=>{
currentDate = e.target.value || todayStr();
renderSeatView();
});
document.getElementById("btnAddBlock").addEventListener("click", ()=>{
day.blocks.push(emptyBlock());
saveState(); renderSeatView();
});
document.getElementById("btnDeleteAll").addEventListener("click", ()=>{
confirmDialog(`${dateLabel} の座席表をすべて削除します。よろしいですか？`, ()=>{
day.blocks = [];
saveState(); renderSeatView();
});
});
document.getElementById("btnDeleteGroupRows").addEventListener("click", ()=>{
confirmDialog(`${dateLabel} の集団行だけをすべて削除します。よろしいですか？`, ()=>{
day.blocks.forEach(b=> b.groupRows = []);
saveState(); renderSeatView();
});
});
document.getElementById("btnPrint").addEventListener("click", ()=> window.print());
document.getElementById("btnImportImage").addEventListener("click", openImageImportModal);
document.getElementById("btnImportEweb").addEventListener("click", openEwebImportModal);
document.getElementById("btnCopyLastWeek").addEventListener("click", openCopyLastWeekModal);
document.getElementById("btnLoadPreset").addEventListener("click", ()=>{
const preset = state.weekdayPresets[wd];
if(!preset || !preset.blocks.length){ showToast(`${WEEKDAY_LABELS[wd]}曜日の基本形はまだ登録されていません`, true); return; }
confirmDialog(`${WEEKDAY_LABELS[wd]}曜日の基本形をこの日に読み込みます。現在のこの日の内容は上書きされます。よろしいですか？`, ()=>{
state.days[currentDate] = JSON.parse(JSON.stringify(preset));
migrate(state);
saveState(); renderSeatView();
});
});
document.getElementById("btnSavePreset").addEventListener("click", ()=>{
confirmDialog(`現在のこの日の座席表を「${WEEKDAY_LABELS[wd]}曜日の基本形」として保存します。よろしいですか？`, ()=>{
state.weekdayPresets[wd] = JSON.parse(JSON.stringify(day));
saveState(); renderSeatView();
});
});
grid.addEventListener("click", (e)=>{
const chip = e.target.closest(".weekday-chip");
if(!chip) return;
const targetWd = Number(chip.dataset.wd);
// find next date with that weekday (for quick jump), or just inform
showToast(`${WEEKDAY_LABELS[targetWd]}曜日の基本形は「この曜日を呼び出す」ボタンで、その曜日の日付を選んだ状態で読み込めます。`);
});

renderBlocks(day, dateLabel);
}

function renderBlocks(day, dateLabel){
const wrap = document.getElementById("blocksWrap");
if(!day.blocks.length){
wrap.innerHTML = `<div class="empty-note">この日にはまだ授業枠がありません。「＋ 授業枠を追加」から作成してください。</div>`;
return;
}
wrap.innerHTML = day.blocks.map((block, bi)=> blockHtml(block, bi)).join("");

day.blocks.forEach((block, bi)=> bindBlockEvents(day, block, bi));
}

function blockHtml(block, bi){
const seatRows = block.seats.map((seat,si)=> seatRowHtml(block, seat, si)).join("");
const groupRows = block.groupRows.map((g,gi)=> groupRowHtml(block, g, gi)).join("");

return `
<div class="lesson-block" data-block="${block.id}">
<div class="block-head">
<div class="block-head-left">
<span class="block-index">枠${bi+1}</span>
<div class="time-input">
<span>時間帯</span>
<input type="time" class="js-time-start" value="${(block.time.split("〜")[0]||"").trim()}">
<span>〜</span>
<input type="time" class="js-time-end" value="${(block.time.split("〜")[1]||"").trim()}">
</div>
<div class="time-choice">
<select class="js-time-preset">
<option value="">よく使う時間</option>
${COMMON_TIME_PRESETS.map(t=>`<option value="${t}" ${t===block.time?"selected":""}>${t}</option>`).join("")}
</select>
</div>
</div>
<div class="block-actions">
<button class="btn js-add-seat">＋ 席を追加</button>
<button class="btn js-remove-seat">− 席を減らす</button>
<button class="btn js-add-group">＋ 集団行</button>
<button class="btn js-copy-down">下にコピー</button>
<button class="btn danger js-del-block">この時間を削除</button>
</div>
</div>
<div class="sheet-wrap">
<div class="sheet">
<div class="sheet-header">
<div class="th">席</div>
<div class="th">担当講師</div>
<div class="th side-left">左側</div>
<div class="th side-right">右側</div>
</div>
<div class="sheet-header sub">
<div class="th sub-head blank2"></div>
<div class="th sub-head">科目</div>
<div class="th sub-head">学年</div>
<div class="th sub-head">生徒名</div>
<div class="th sub-head">科目</div>
<div class="th sub-head">学年</div>
<div class="th sub-head">生徒名</div>
</div>
<div class="sheet-body">
${seatRows}
${groupRows}
</div>
</div>
</div>
</div>`;
}

function seatRowHtml(block, seat, si){
const teacherOptions = `<option value="">—</option>` + state.teachers.map(t=>`<option value="${escapeHtml(t.name)}" ${seat.teacher===t.name?"selected":""}>${escapeHtml(t.name)}</option>`).join("");
const studOpts = (selected)=> `<option value="">生徒を選択</option>` + state.students.map(s=>`<option value="${escapeHtml(s.name)}" ${selected===s.name?"selected":""}>${escapeHtml(s.name)}</option>`).join("");

const sideHtml = (side, key)=>`
<div class="cell">
<input list="subjectList" class="subject-select js-subject" data-side="${key}" value="${escapeHtml(side.subject)}" placeholder="—">
</div>
<div class="cell">
<input type="text" class="grade-input js-grade" data-side="${key}" value="${escapeHtml(side.grade)}" placeholder="学年">
</div>
<div class="cell student-cell status-${side.status} js-student-cell" data-side="${key}">
<select class="student-select js-student" data-side="${key}">${studOpts(side.student)}</select>
<div class="status-buttons">
<button type="button" class="js-status ${side.status==='course'?'active course':''}" data-side="${key}" data-status="course">講習</button>
<button type="button" class="js-status ${side.status==='transfer'?'active transfer':''}" data-side="${key}" data-status="transfer">振替</button>
<button type="button" class="js-status ${side.status==='absent'?'active absent':''}" data-side="${key}" data-status="absent">欠席</button>
</div>
</div>`;

return `
<div class="seat-row-wrap ${si%2===1?'alt-row':''}" data-seat-index="${si}">
<div class="cell seat-num-cell">
<input type="text" class="js-seat-num" value="${escapeHtml(seat.seatNumber)}" aria-label="${si+1}行目の席番号">
<div class="seat-move">
<button type="button" class="js-move-up" title="上へ移動" ${si===0?"disabled":""}>▲</button>
<button type="button" class="js-move-down" title="下へ移動" ${si===block.seats.length-1?"disabled":""}>▼</button>
</div>
</div>
<div class="cell teacher-col">
<select class="js-teacher">${teacherOptions}</select>
</div>
${sideHtml(seat.left,"left")}
${sideHtml(seat.right,"right")}
</div>
`;
}

function groupRowHtml(block, g, gi){
const teacherOptions = `<option value="">—</option>` + state.teachers.map(t=>`<option value="${escapeHtml(t.name)}" ${g.teacher===t.name?"selected":""}>${escapeHtml(t.name)}</option>`).join("");
const remainingStudents = state.students.filter(s=> !g.students.includes(s.name));
const chips = g.students.map(name=>`<span class="chip">${escapeHtml(name)}<button type="button" class="js-remove-gstudent" data-name="${escapeHtml(name)}">×</button></span>`).join("");
return `
<div class="group-row-wrap" data-group-index="${gi}">
<div class="cell seat-num-cell group-row">
<input type="text" class="js-g-seat-num" value="${escapeHtml(g.seatNumber)}" placeholder="使用席">
</div>
<div class="cell teacher-col group-row">
<select class="js-g-teacher">${teacherOptions}</select>
</div>
<div class="cell group-row group-name-cell" style="grid-column: span 2;">
<input type="text" class="js-g-name" value="${escapeHtml(g.name)}" placeholder="授業名／グループ名">
</div>
<div class="cell group-row" style="grid-column: span 1;">
<input list="subjectList" class="subject-select js-g-subject" value="${escapeHtml(g.subject)}" placeholder="科目">
</div>
<div class="cell group-row group-students-cell" style="grid-column: span 3;">
<div class="chip-list">${chips}</div>
<div class="group-students-footer">
<select class="js-g-add-student add-student-chip">
<option value="">＋ 生徒を追加</option>
${remainingStudents.map(s=>`<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("")}
</select>
<button type="button" class="btn danger js-del-group">削除</button>
</div>
</div>
</div>
`;
}

function bindBlockEvents(day, block, bi){
const root = document.querySelector(`.lesson-block[data-block="${block.id}"]`);
if(!root) return;

const applyTime = ()=>{
const s = root.querySelector(".js-time-start").value;
const e = root.querySelector(".js-time-end").value;
if(s && e) block.time = `${s}〜${e}`;
saveState();
};
root.querySelector(".js-time-start").addEventListener("change", applyTime);
root.querySelector(".js-time-end").addEventListener("change", applyTime);
root.querySelector(".js-time-preset").addEventListener("change", (e)=>{
if(e.target.value){ block.time = e.target.value; saveState(); renderSeatView(); }
});

root.querySelector(".js-add-seat").addEventListener("click", ()=>{
block.seats.push(emptySeat(block.seats.length+1));
saveState(); renderSeatView();
});
root.querySelector(".js-remove-seat").addEventListener("click", ()=>{
if(block.seats.length<=1){ showToast("これ以上は減らせません", true); return; }
block.seats.pop();
saveState(); renderSeatView();
});
root.querySelector(".js-add-group").addEventListener("click", ()=>{
block.groupRows.push({id:uid(), seatNumber:"", name:"", teacher:"", subject:"", students:[]});
saveState(); renderSeatView();
});
root.querySelector(".js-copy-down").addEventListener("click", ()=>{
const clone = JSON.parse(JSON.stringify(block));
clone.id = uid();
clone.groupRows.forEach(g=> g.id = uid());
day.blocks.splice(bi+1, 0, clone);
saveState(); renderSeatView();
});
root.querySelector(".js-del-block").addEventListener("click", ()=>{
confirmDialog("この授業枠を削除します。よろしいですか？", ()=>{
day.blocks.splice(bi,1);
saveState(); renderSeatView();
});
});

// Use event delegation within the sheet for seat-level controls
const sheet = root.querySelector(".sheet");
sheet.addEventListener("change", (e)=>{
handleSeatFieldChange(e, block);
});
sheet.addEventListener("click", (e)=>{
handleSeatClick(e, block, day);
});
}

function seatIndexFromEl(el, block){
// seat rows are rendered in DOM order matching block.seats then groupRows;
// use data attributes set on the seat-num input to locate index via closest structural offset
return null;
}

function handleSeatFieldChange(e, block){
const t = e.target;
if(t.classList.contains("js-seat-num")){
const idx = seatRowIndex(t);
if(idx>-1){ block.seats[idx].seatNumber = t.value; saveState(); }
return;
}
if(t.classList.contains("js-teacher")){
const idx = seatRowIndex(t);
if(idx>-1){ block.seats[idx].teacher = t.value; saveState(); }
return;
}
if(t.classList.contains("js-subject")){
const idx = seatRowIndex(t);
const side = t.dataset.side;
if(idx>-1){ block.seats[idx][side].subject = t.value; registerCustomSubject(t.value); saveState(); }
return;
}
if(t.classList.contains("js-grade")){
const idx = seatRowIndex(t);
const side = t.dataset.side;
if(idx>-1){ block.seats[idx][side].grade = t.value; saveState(); }
return;
}
if(t.classList.contains("js-student")){
const idx = seatRowIndex(t);
const side = t.dataset.side;
if(idx>-1){ block.seats[idx][side].student = t.value; saveState(); }
return;
}
if(t.classList.contains("js-g-teacher")){
const idx = groupRowIndex(t);
if(idx>-1){ block.groupRows[idx].teacher = t.value; saveState(); }
return;
}
if(t.classList.contains("js-g-name")){
const idx = groupRowIndex(t);
if(idx>-1){ block.groupRows[idx].name = t.value; saveState(); }
return;
}
if(t.classList.contains("js-g-subject")){
const idx = groupRowIndex(t);
if(idx>-1){ block.groupRows[idx].subject = t.value; registerCustomSubject(t.value); saveState(); }
return;
}
if(t.classList.contains("js-g-seat-num")){
const idx = groupRowIndex(t);
if(idx>-1){ block.groupRows[idx].seatNumber = t.value; saveState(); }
return;
}
if(t.classList.contains("js-g-add-student")){
const idx = groupRowIndex(t);
if(idx>-1 && t.value){
block.groupRows[idx].students.push(t.value);
saveState(); renderSeatView();
}
return;
}
}

function handleSeatClick(e, block, day){
const up = e.target.closest(".js-move-up");
const down = e.target.closest(".js-move-down");
const status = e.target.closest(".js-status");
const delGroup = e.target.closest(".js-del-group");
const removeG = e.target.closest(".js-remove-gstudent");

if(up){
const idx = seatRowIndex(up);
if(idx>0){ [block.seats[idx-1], block.seats[idx]] = [block.seats[idx], block.seats[idx-1]]; saveState(); renderSeatView(); }
return;
}
if(down){
const idx = seatRowIndex(down);
if(idx>-1 && idx<block.seats.length-1){ [block.seats[idx+1], block.seats[idx]] = [block.seats[idx], block.seats[idx+1]]; saveState(); renderSeatView(); }
return;
}
if(status){
const idx = seatRowIndex(status);
const side = status.dataset.side;
const val = status.dataset.status;
if(idx>-1){
const cur = block.seats[idx][side].status;
block.seats[idx][side].status = (cur===val) ? "normal" : val;
saveState(); renderSeatView();
}
return;
}
if(delGroup){
const idx = groupRowIndex(delGroup);
if(idx>-1){ block.groupRows.splice(idx,1); saveState(); renderSeatView(); }
return;
}
if(removeG){
const idx = groupRowIndex(removeG);
const name = removeG.dataset.name;
if(idx>-1){
block.groupRows[idx].students = block.groupRows[idx].students.filter(n=>n!==name);
saveState(); renderSeatView();
}
return;
}
}

/* Row index lookup: each seat row / group row is wrapped in a display:contents
container carrying data-seat-index / data-group-index, so we just read it back. */
function seatRowIndex(el){
const wrap = el.closest("[data-seat-index]");
return wrap ? Number(wrap.dataset.seatIndex) : -1;
}
function groupRowIndex(el){
const wrap = el.closest("[data-group-index]");
return wrap ? Number(wrap.dataset.groupIndex) : -1;
}

/* ---------------- copy last week ---------------- */
function openCopyLastWeekModal(){
const lastWeekDate = shiftDate(currentDate, -7);
const source = state.days[lastWeekDate];
if(!source || !source.blocks.length){
showToast(`先週（${lastWeekDate}）の座席表が見つかりません`, true);
return;
}
openModal(`
<h3>先週の座席表をコピー</h3>
<p>コピー元：${lastWeekDate} → コピー先：${currentDate}</p>
<div class="option-list">
<label class="opt"><input type="radio" name="copyScope" value="all" checked> すべてコピー</label>
<label class="opt"><input type="radio" name="copyScope" value="individual"> 個別授業だけコピー</label>
<label class="opt"><input type="radio" name="copyScope" value="group"> 集団授業だけコピー</label>
</div>
<label class="opt"><input type="checkbox" id="copyReplace"> コピー先の既存内容を削除してから貼り付ける（未チェックの場合は末尾に追加し、重複防止のため既にコピー済みの枠は追加しません）</label>
<div class="modal-actions">
<button class="btn" id="modalCancel">キャンセル</button>
<button class="btn primary" id="modalConfirm">コピーする</button>
</div>
`, (modal)=>{
modal.querySelector("#modalCancel").addEventListener("click", closeModal);
modal.querySelector("#modalConfirm").addEventListener("click", ()=>{
const scope = modal.querySelector('input[name="copyScope"]:checked').value;
const replace = modal.querySelector("#copyReplace").checked;
doCopyLastWeek(source, scope, replace);
closeModal();
renderSeatView();
});
});
}
function shiftDate(dateStr, days){
const d = new Date(dateStr+"T00:00:00");
d.setDate(d.getDate()+days);
return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
}
function doCopyLastWeek(source, scope, replace){
const target = getOrCreateDay(currentDate);
if(replace) target.blocks = [];
const existingSourceIds = new Set(target.blocks.map(b=>b._copiedFrom).filter(Boolean));
source.blocks.forEach(srcBlock=>{
if(!replace && existingSourceIds.has(srcBlock.id)) return; // already copied, avoid duplicate
const clone = JSON.parse(JSON.stringify(srcBlock));
clone._copiedFrom = srcBlock.id;
clone.id = uid();
if(scope==="individual") clone.groupRows = [];
if(scope==="group") clone.seats = [];
clone.groupRows.forEach(g=> g.id = uid());
target.blocks.push(clone);
});
saveState();
showToast("先週の座席表をコピーしました");
}

/* ---------------- image import (assist, not automatic OCR) ---------------- */
function openImageImportModal(){
openModal(`
<h3>画像から取り込み</h3>
<p>授業予定表の画像を確認しながら、右側の座席表へ手入力するための補助ウィンドウです。
このアプリは外部サーバーを持たないため、画像から科目・担当講師・生徒を自動認識する処理は含まれていません
（旧サイトの自動認識機能は、精度の問題や「読み取れない担当講師を推測しない」というご要望と両立させるため、
今回はあえて手動確認方式にしています）。</p>
<input type="file" id="imgFile" accept="image/*">
<div id="imgPreviewWrap" style="margin-top:10px;"></div>
<div class="modal-actions">
<button class="btn" id="modalCancel">閉じる</button>
</div>
`, (modal)=>{
modal.querySelector("#modalCancel").addEventListener("click", closeModal);
modal.querySelector("#imgFile").addEventListener("change", (e)=>{
const file = e.target.files[0];
if(!file) return;
const url = URL.createObjectURL(file);
modal.querySelector("#imgPreviewWrap").innerHTML = `<img src="${url}" style="max-width:100%;border:1px solid #ddd;border-radius:6px;">`;
});
});
}

/* ---------------- eWeb import ---------------- */
/*
eWeb（授業予定管理システム）の座席表ページで、ブックマークレット「eWeb取込」を実行すると、
その日の予定がクリップボードにJSON形式でコピーされます。それをここに貼り付けて取り込みます。

期待するJSON形式：
{
"date": "2026-07-27",
"komas": [{"id":49,"name":"A","start":"17:10","end":"18:40"}, ...],
"items": [{"koma_id":49,"teacher_name":"堀部 晃平","student_name":"平木 愛琉","grade":"中3","subject":"講(数)","pos":1}, ...],
"groups": [{"koma_id":47,"start":"14:50","end":"15:50","name":"中3社会-2026夏期集団","teacher_name":"堀部 晃平","students":["山本 紘士朗", ...]}]
}
*/
function buildDayFromEwebPayload(payload){
const komaMap = {};
(payload.komas||[]).forEach(k=> komaMap[k.id] = k);

// individual items grouped by koma -> teacher
const byKoma = {};
(payload.items||[]).forEach(it=>{
byKoma[it.koma_id] = byKoma[it.koma_id] || [];
byKoma[it.koma_id].push(it);
});
// groups grouped by koma
const groupsByKoma = {};
(payload.groups||[]).forEach(g=>{
groupsByKoma[g.koma_id] = groupsByKoma[g.koma_id] || [];
groupsByKoma[g.koma_id].push(g);
});

const komaIds = new Set([...Object.keys(byKoma), ...Object.keys(groupsByKoma)].map(Number));
const orderedKomaIds = Array.from(komaIds).sort((a,b)=>{
const sa = (komaMap[a] && komaMap[a].start) || "99:99";
const sb = (komaMap[b] && komaMap[b].start) || "99:99";
return sa.localeCompare(sb);
});

const blocks = orderedKomaIds.map(komaId=>{
const koma = komaMap[komaId] || {};
const block = { id: uid(), time: (koma.start && koma.end) ? `${koma.start}〜${koma.end}` : "時間を入力", seats: [], groupRows: [] };

const items = byKoma[komaId] || [];
const byTeacher = {};
items.forEach(it=>{
const key = it.teacher_name || "";
byTeacher[key] = byTeacher[key] || [];
byTeacher[key].push(it);
});
Object.keys(byTeacher).forEach(teacherNameRaw=>{
const teacherName = normalizeName(teacherNameRaw);
const list = byTeacher[teacherNameRaw].slice().sort((a,b)=> (a.pos||0)-(b.pos||0));
const seat = emptySeat(block.seats.length+1);
seat.teacher = teacherName;
if(list[0]) seat.left = {student:normalizeName(list[0].student_name||""), subject:list[0].subject||"", grade:list[0].grade||"", status:"normal"};
if(list[1]) seat.right = {student:normalizeName(list[1].student_name||""), subject:list[1].subject||"", grade:list[1].grade||"", status:"normal"};
block.seats.push(seat);
// 3人以上が同じ講師・同じコマの場合は、3人目以降を集団行として追加
if(list.length>2){
block.groupRows.push({
id: uid(), seatNumber: "", name: "", teacher: teacherName,
subject: list[2].subject || "",
students: list.slice(2).map(x=>normalizeName(x.student_name)).filter(Boolean)
});
}
});

(groupsByKoma[komaId]||[]).forEach(g=>{
block.groupRows.push({
id: uid(), seatNumber: "", name: g.name || "",
teacher: normalizeName(g.teacher_name || ""), subject: "",
students: (g.students||[]).map(n=>normalizeName(n)).filter(Boolean)
});
});

if(block.seats.length===0) block.seats.push(emptySeat(1));
return block;
});

return { blocks };
}

function openEwebImportModal(){
openModal(`
<h3>eWebから読み込み</h3>
<p>eWebの座席表ページ（取り込みたい日付を表示した状態）で、ブックマークレット「eWeb取込」をクリックすると、
その日の予定がクリップボードにコピーされます。それを下の欄に貼り付けてください。日付はデータに含まれる日付が自動で使われます。</p>
<textarea id="ewebPasteArea" placeholder="ここに貼り付け"></textarea>
<p class="sub" style="margin-top:8px;">まだブックマークレットを設定していない場合は、設定・バックアップタブの案内を参照してください。</p>
<div class="modal-actions">
<button class="btn" id="modalCancel">キャンセル</button>
<button class="btn primary" id="modalConfirm">取り込む</button>
</div>
`, (modal)=>{
modal.querySelector("#pasteAreaFocus");
modal.querySelector("#ewebPasteArea").focus();
modal.querySelector("#modalCancel").addEventListener("click", closeModal);
modal.querySelector("#modalConfirm").addEventListener("click", ()=>{
const raw = modal.querySelector("#ewebPasteArea").value.trim();
if(!raw){ showToast("貼り付けられたデータがありません", true); return; }
let payload;
try{ payload = JSON.parse(raw); }
catch(e){ showToast("JSONの読み込みに失敗しました。ブックマークレットでコピーした内容をそのまま貼り付けてください。", true); return; }
if(!payload.date){ showToast("日付情報が見つかりませんでした", true); return; }
const dateStr = payload.date;
const newDay = buildDayFromEwebPayload(payload);
closeModal();
confirmDialog(`${dateStr} の座席表を、eWebのデータで上書きします（既存の内容は消えます）。よろしいですか？`, ()=>{
state.days[dateStr] = newDay;
migrate(state);
currentDate = dateStr;
saveState();
renderTabs();
renderSeatView();
showToast(`${dateStr} の座席表をeWebから取り込みました`);
});
});
});
}

/* ---------------- confirm dialog ---------------- */
function confirmDialog(message, onConfirm){
openModal(`
<h3>確認</h3>
<p>${escapeHtml(message)}</p>
<div class="modal-actions">
<button class="btn" id="modalCancel">キャンセル</button>
<button class="btn primary" id="modalConfirm">実行する</button>
</div>
`, (modal)=>{
modal.querySelector("#modalCancel").addEventListener("click", closeModal);
modal.querySelector("#modalConfirm").addEventListener("click", ()=>{ closeModal(); onConfirm(); });
});
}

/* =========================================================
STUDENT ROSTER
========================================================= */
function renderStudentsView(){
const el = document.getElementById("view-students");
el.innerHTML = `
<div class="panel">
<p class="eyebrow">STUDENT ROSTER</p>
<h2 style="margin:4px 0 4px;">生徒名簿</h2>
<p class="sub" style="margin:0 0 10px;">表計算ソフトのように直接編集できます。</p>
<p class="roster-hint">
<span class="ok">✓ チェックした生徒をまとめて削除できます</span>
<span class="ok">✓ 生年月日が未登録の生徒も、欄をクリックして後から入力できます</span>
<span class="ok">✓ 見出しの▲▼または行の矢印で並び替えできます</span>
</p>
<div class="roster-toolbar">
<input type="search" id="studentSearch" placeholder="名前・学年・科目で検索" value="${escapeHtml(studentSearch)}">
<button class="btn" id="btnSortAiueo">五十音順に並び替え</button>
<button class="btn" id="btnPasteStudents">Excelから貼り付け</button>
<button class="btn primary" id="btnAddStudent">＋ 生徒を追加</button>
<button class="btn danger" id="btnDeleteSelectedStudents">選択した生徒を削除</button>
</div>
<div class="roster-table-wrap">
<table class="roster-table" id="studentTable">
<thead><tr>
<th style="width:32px;"><input type="checkbox" id="selAllStudents"></th>
<th class="num-col">No.</th>
<th style="width:36px;"></th>
<th>氏名</th>
<th>生年月日（後から入力可）</th>
<th>学年</th>
<th>主な科目</th>
<th></th>
</tr></thead>
<tbody id="studentRows"></tbody>
</table>
</div>
</div>
${subjectDatalist()}
`;

document.getElementById("studentSearch").addEventListener("input", (e)=>{
studentSearch = e.target.value;
renderStudentRows();
});
document.getElementById("btnSortAiueo").addEventListener("click", ()=>{
const col = jaCollator();
state.students.sort((a,b)=> col.compare(a.name, b.name));
saveState(); renderStudentRows();
});
document.getElementById("btnPasteStudents").addEventListener("click", ()=> openPasteModal("students"));
document.getElementById("btnAddStudent").addEventListener("click", ()=>{
state.students.push({id:uid(), name:"", birthdate:"", grade:"", subject:""});
saveState(); renderStudentRows();
});
document.getElementById("btnDeleteSelectedStudents").addEventListener("click", ()=>{
const ids = Array.from(document.querySelectorAll(".js-student-check:checked")).map(c=>c.dataset.id);
if(!ids.length){ showToast("削除する生徒を選択してください", true); return; }
confirmDialog(`選択した${ids.length}名を削除します。よろしいですか？`, ()=>{
state.students = state.students.filter(s=> !ids.includes(s.id));
saveState(); renderStudentRows();
});
});
document.getElementById("selAllStudents").addEventListener("change", (e)=>{
document.querySelectorAll(".js-student-check").forEach(c=> c.checked = e.target.checked);
});

renderStudentRows();
}

function renderStudentRows(){
const tbody = document.getElementById("studentRows");
const filtered = state.students
.map((s,i)=>({s,i}))
.filter(({s})=>{
if(!studentSearch) return true;
const q = studentSearch.toLowerCase();
return (s.name||"").toLowerCase().includes(q) || (s.grade||"").toLowerCase().includes(q) || (s.subject||"").toLowerCase().includes(q);
});

tbody.innerHTML = filtered.map(({s,i}, displayIdx)=>`
<tr draggable="true" data-index="${i}">
<td><input type="checkbox" class="js-student-check" data-id="${s.id}"></td>
<td class="num-col">${displayIdx+1}</td>
<td>
<span class="drag-handle" title="ドラッグで並び替え">⠿</span>
<span class="row-order">
<button type="button" class="js-s-up" ${i===0?"disabled":""}>▲</button>
<button type="button" class="js-s-down" ${i===state.students.length-1?"disabled":""}>▼</button>
</span>
</td>
<td><input type="text" class="js-s-name" value="${escapeHtml(s.name)}" placeholder="氏名"></td>
<td><input type="date" class="js-s-birth" value="${escapeHtml(s.birthdate)}"></td>
<td><input type="text" class="js-s-grade" value="${escapeHtml(s.grade)}" placeholder="学年"></td>
<td><input list="subjectList" class="js-s-subject" value="${escapeHtml(s.subject)}" placeholder="主な科目"></td>
<td><button class="btn danger js-s-del">削除</button></td>
</tr>
`).join("") || `<tr><td colspan="8" class="empty-note">該当する生徒がいません</td></tr>`;

tbody.querySelectorAll("tr").forEach(row=>{
const idx = Number(row.dataset.index);
row.querySelector(".js-s-name")?.addEventListener("input", e=>{ state.students[idx].name = e.target.value; saveState(); });
row.querySelector(".js-s-birth")?.addEventListener("change", e=>{ state.students[idx].birthdate = e.target.value; saveState(); });
row.querySelector(".js-s-grade")?.addEventListener("input", e=>{ state.students[idx].grade = e.target.value; saveState(); });
row.querySelector(".js-s-subject")?.addEventListener("change", e=>{ state.students[idx].subject = e.target.value; registerCustomSubject(e.target.value); saveState(); });
row.querySelector(".js-s-del")?.addEventListener("click", ()=>{
const usage = studentUsageCount(state.students[idx].name);
const doDelete = ()=>{ state.students.splice(idx,1); saveState(); renderStudentRows(); };
if(usage>0){
confirmDialog(`この生徒は現在 ${usage} 件の授業に登録されています。名簿から削除しても、既存の授業データはそのまま残ります（表示は名前のみになります）。削除しますか？`, doDelete);
} else {
doDelete();
}
});
row.querySelector(".js-s-up")?.addEventListener("click", ()=>{
if(idx>0){ [state.students[idx-1], state.students[idx]] = [state.students[idx], state.students[idx-1]]; saveState(); renderStudentRows(); }
});
row.querySelector(".js-s-down")?.addEventListener("click", ()=>{
if(idx<state.students.length-1){ [state.students[idx+1], state.students[idx]] = [state.students[idx], state.students[idx+1]]; saveState(); renderStudentRows(); }
});
row.addEventListener("dragstart", ()=> row.classList.add("dragging"));
row.addEventListener("dragend", ()=> row.classList.remove("dragging"));
row.addEventListener("dragover", (e)=>{ e.preventDefault(); row.classList.add("drag-over"); });
row.addEventListener("dragleave", ()=> row.classList.remove("drag-over"));
row.addEventListener("drop", (e)=>{
e.preventDefault(); row.classList.remove("drag-over");
const draggingRow = tbody.querySelector(".dragging");
if(!draggingRow || draggingRow===row) return;
const from = Number(draggingRow.dataset.index);
const to = Number(row.dataset.index);
const [item] = state.students.splice(from,1);
state.students.splice(to,0,item);
saveState(); renderStudentRows();
});
});
}

/* =========================================================
TEACHER ROSTER
========================================================= */
function renderTeachersView(){
const el = document.getElementById("view-teachers");
el.innerHTML = `
<div class="panel">
<p class="eyebrow">TEACHER ROSTER</p>
<h2 style="margin:4px 0 4px;">講師名簿</h2>
<p class="sub" style="margin:0 0 10px;">講師名と担当可能科目を登録します。座席表の担当講師欄は、ここに登録された講師だけが選択できます。</p>
<div class="roster-toolbar">
<button class="btn" id="btnSortAiueoT">五十音順に並び替え</button>
<button class="btn" id="btnPasteTeachers">Excelから貼り付け</button>
<button class="btn primary" id="btnAddTeacher">＋ 講師を追加</button>
</div>
<div class="roster-table-wrap">
<table class="roster-table" id="teacherTable">
<thead><tr>
<th class="num-col">No.</th>
<th style="width:36px;"></th>
<th>講師名</th>
<th>担当可能科目</th>
<th>メモ</th>
<th></th>
</tr></thead>
<tbody id="teacherRows"></tbody>
</table>
</div>
</div>
`;
document.getElementById("btnSortAiueoT").addEventListener("click", ()=>{
const col = jaCollator();
state.teachers.sort((a,b)=> col.compare(a.name, b.name));
saveState(); renderTeacherRows();
});
document.getElementById("btnPasteTeachers").addEventListener("click", ()=> openPasteModal("teachers"));
document.getElementById("btnAddTeacher").addEventListener("click", ()=>{
state.teachers.push({id:uid(), name:"", subjects:"", note:""});
saveState(); renderTeacherRows();
});
renderTeacherRows();
}

function renderTeacherRows(){
const tbody = document.getElementById("teacherRows");
tbody.innerHTML = state.teachers.map((t,i)=>`
<tr draggable="true" data-index="${i}">
<td class="num-col">${i+1}</td>
<td>
<span class="drag-handle">⠿</span>
<span class="row-order">
<button type="button" class="js-t-up" ${i===0?"disabled":""}>▲</button>
<button type="button" class="js-t-down" ${i===state.teachers.length-1?"disabled":""}>▼</button>
</span>
</td>
<td><input type="text" class="js-t-name" value="${escapeHtml(t.name)}" placeholder="講師名"></td>
<td><input type="text" class="js-t-subjects" value="${escapeHtml(t.subjects)}" placeholder="例：数学・英語"></td>
<td><input type="text" class="js-t-note" value="${escapeHtml(t.note)}" placeholder="メモ"></td>
<td><button class="btn danger js-t-del">削除</button></td>
</tr>
`).join("") || `<tr><td colspan="6" class="empty-note">講師が登録されていません</td></tr>`;

tbody.querySelectorAll("tr").forEach(row=>{
const idx = Number(row.dataset.index);
row.querySelector(".js-t-name")?.addEventListener("input", e=>{ state.teachers[idx].name = e.target.value; saveState(); });
row.querySelector(".js-t-subjects")?.addEventListener("input", e=>{ state.teachers[idx].subjects = e.target.value; saveState(); });
row.querySelector(".js-t-note")?.addEventListener("input", e=>{ state.teachers[idx].note = e.target.value; saveState(); });
row.querySelector(".js-t-del")?.addEventListener("click", ()=>{
const usage = teacherUsageCount(state.teachers[idx].name);
const doDelete = ()=>{ state.teachers.splice(idx,1); saveState(); renderTeacherRows(); };
if(usage>0){
confirmDialog(`この講師は現在 ${usage} 件の授業枠に割り当てられています。名簿から削除すると、座席表側の担当講師欄は「未設定」として扱われます。削除しますか？`, doDelete);
} else {
doDelete();
}
});
row.querySelector(".js-t-up")?.addEventListener("click", ()=>{
if(idx>0){ [state.teachers[idx-1], state.teachers[idx]] = [state.teachers[idx], state.teachers[idx-1]]; saveState(); renderTeacherRows(); }
});
row.querySelector(".js-t-down")?.addEventListener("click", ()=>{
if(idx<state.teachers.length-1){ [state.teachers[idx+1], state.teachers[idx]] = [state.teachers[idx], state.teachers[idx+1]]; saveState(); renderTeacherRows(); }
});
row.addEventListener("dragstart", ()=> row.classList.add("dragging"));
row.addEventListener("dragend", ()=> row.classList.remove("dragging"));
row.addEventListener("dragover", (e)=>{ e.preventDefault(); row.classList.add("drag-over"); });
row.addEventListener("dragleave", ()=> row.classList.remove("drag-over"));
row.addEventListener("drop", (e)=>{
e.preventDefault(); row.classList.remove("drag-over");
const draggingRow = tbody.querySelector(".dragging");
if(!draggingRow || draggingRow===row) return;
const from = Number(draggingRow.dataset.index);
const to = Number(row.dataset.index);
const [item] = state.teachers.splice(from,1);
state.teachers.splice(to,0,item);
saveState(); renderTeacherRows();
});
});
}

/* ---------------- paste from Excel (shared) ---------------- */
function openPasteModal(kind){
const label = kind==="students" ? "生徒名簿" : "講師名簿";
const cols = kind==="students" ? "氏名 / 生年月日(YYYY-MM-DD, 省略可) / 学年 / 主な科目" : "講師名 / 担当可能科目 / メモ";
openModal(`
<h3>${label}へExcelから貼り付け</h3>
<p>Excel・スプレッドシートで複数行・複数列を選択してコピーし、下の欄に貼り付けてください。列の並びは「${cols}」です。列が足りない場合は空欄として扱われます。</p>
<textarea id="pasteArea" placeholder="ここに貼り付け"></textarea>
<div class="modal-actions">
<button class="btn" id="modalCancel">キャンセル</button>
<button class="btn primary" id="modalConfirm">取り込む</button>
</div>
`, (modal)=>{
modal.querySelector("#pasteArea").focus();
modal.querySelector("#modalCancel").addEventListener("click", closeModal);
modal.querySelector("#modalConfirm").addEventListener("click", ()=>{
const raw = modal.querySelector("#pasteArea").value;
const rows = parsePasteData(raw);
if(!rows.length){ showToast("貼り付けられたデータがありません", true); return; }
let added = 0;
rows.forEach(cols=>{
if(kind==="students"){
const name = normalizeName(cols[0]);
if(!name) return;
state.students.push({id:uid(), name, birthdate: normalizeDate(cols[1]||""), grade: (cols[2]||"").trim(), subject:(cols[3]||"").trim()});
} else {
const name = normalizeName(cols[0]);
if(!name) return;
state.teachers.push({id:uid(), name, subjects:(cols[1]||"").trim(), note:(cols[2]||"").trim()});
}
added++;
});
saveState();
closeModal();
if(kind==="students") renderStudentsView(); else renderTeachersView();
showToast(`${added}件を追加しました`);
});
});
}
function parsePasteData(raw){
return raw.split(/\r\n|\r|\n/)
.map(line=> line.trim())
.filter(line=> line.length>0)
.map(line=> line.split("\t").map(c=> normalizeName(c)));
}
function normalizeName(str){
if(str==null) return "";
// normalize full-width spaces to single half-width, collapse repeats, trim
return String(str).replace(/[\u3000\s]+/g," ").trim();
}
function normalizeDate(str){
const s = (str||"").trim();
if(!s) return "";
const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
if(m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
return s;
}

/* =========================================================
PRINT PREVIEW
========================================================= */
function applyPrintCssVars(){
const ps = state.printSettings;
document.documentElement.style.setProperty("--print-subject-size", ps.subjectSize + "pt");
document.documentElement.style.setProperty("--print-student-size", ps.studentSize + "pt");
document.documentElement.style.setProperty("--print-grade-size", ps.gradeSize + "pt");
}

function logoHtml(forPreview){
const ps = state.printSettings;
if(!ps.logoImage) return "";
if(ps.logoMode === "watermark"){
return `<img class="print-watermark" src="${ps.logoImage}" style="opacity:${ps.logoOpacity}">`;
}
return `<img class="print-logo ${ps.logoMode}" src="${ps.logoImage}" style="opacity:${ps.logoOpacity}">`;
}

function resizeImageDataUrl(dataUrl, maxDim, cb){
const img = new Image();
img.onload = ()=>{
let width = img.width, height = img.height;
if(width > maxDim || height > maxDim){
const scale = maxDim / Math.max(width, height);
width = Math.round(width*scale); height = Math.round(height*scale);
}
const canvas = document.createElement("canvas");
canvas.width = width; canvas.height = height;
canvas.getContext("2d").drawImage(img, 0, 0, width, height);
cb(canvas.toDataURL("image/jpeg", 0.85));
};
img.src = dataUrl;
}

function handleLogoFile(file){
if(!file || file.type.indexOf("image") === -1){ showToast("画像ファイルを選択してください", true); return; }
const reader = new FileReader();
reader.onload = ()=>{
resizeImageDataUrl(reader.result, 900, (resized)=>{
state.printSettings.logoImage = resized;
saveState();
renderPrintPreviewView();
showToast("画像を設定しました");
});
};
reader.readAsDataURL(file);
}

function initPastePreview(){
document.addEventListener("paste", (e)=>{
if(currentTab !== "print") return;
const items = e.clipboardData && e.clipboardData.items;
if(!items) return;
for(const item of items){
if(item.type.indexOf("image") !== -1){
const file = item.getAsFile();
handleLogoFile(file);
e.preventDefault();
break;
}
}
});
}

function renderPrintPreviewView(){
const el = document.getElementById("view-print");
const ps = state.printSettings;
const day = getOrCreateDay(currentDate);

el.innerHTML = `
<div class="panel page-head">
<p class="eyebrow">PRINT PREVIEW</p>
<h2>印刷プレビュー</h2>
<p class="sub">実際に印刷される見た目を確認しながら、文字の大きさや背景・ロゴ画像を調整できます。ここでの設定はすべての日の印刷に共通して使われます。</p>
<div class="seat-toolbar">
<label class="date-field">プレビューする日付
<input type="date" id="previewDatePicker" value="${currentDate}">
</label>
<div class="btn-row">
<button class="btn primary" id="btnPrintFromPreview">この内容で印刷する</button>
</div>
</div>
</div>

<div class="panel print-settings-panel">
<h3>文字の大きさ</h3>
<div class="slider-row">
<label>科目 <span id="valSubjectSize">${ps.subjectSize}</span>pt</label>
<input type="range" id="rangeSubjectSize" min="10" max="24" step="0.5" value="${ps.subjectSize}">
</div>
<div class="slider-row">
<label>生徒名 <span id="valStudentSize">${ps.studentSize}</span>pt</label>
<input type="range" id="rangeStudentSize" min="7" max="16" step="0.5" value="${ps.studentSize}">
</div>
<div class="slider-row">
<label>学年 <span id="valGradeSize">${ps.gradeSize}</span>pt</label>
<input type="range" id="rangeGradeSize" min="6" max="12" step="0.5" value="${ps.gradeSize}">
</div>

<h3 style="margin-top:18px;">背景・ロゴ画像</h3>
<p class="sub" style="margin:0 0 8px;">画像をアップロード、またはこの画面の上でそのまま貼り付け（Ctrl+V / Cmd+V）してください。</p>
<div class="btn-row">
<input type="file" id="logoFile" accept="image/*" style="max-width:220px;">
<button class="btn danger" id="btnRemoveLogo" ${ps.logoImage ? "" : "disabled"}>画像を削除</button>
</div>
${ps.logoImage ? `
<div class="slider-row">
<label>配置</label>
<select id="logoModeSelect">
<option value="corner-tr" ${ps.logoMode==='corner-tr'?'selected':''}>右上に小さく</option>
<option value="corner-tl" ${ps.logoMode==='corner-tl'?'selected':''}>左上に小さく</option>
<option value="watermark" ${ps.logoMode==='watermark'?'selected':''}>ページ全体に薄く</option>
</select>
</div>
<div class="slider-row">
<label>不透明度 <span id="valLogoOpacity">${Math.round(ps.logoOpacity*100)}</span>%</label>
<input type="range" id="rangeLogoOpacity" min="5" max="100" step="5" value="${Math.round(ps.logoOpacity*100)}">
</div>
` : ""}
</div>

<div class="print-preview-wrap">
<div class="print-preview-page" id="previewPage">
${logoHtml(true)}
<div class="page-head" style="margin-bottom:4mm;">
<h2 style="font-size:16pt;margin:0;">${(()=>{ const d=new Date(currentDate+"T00:00:00"); return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WEEKDAY_LABELS[weekdayOf(currentDate)]}）`; })()}</h2>
</div>
<div class="blocks preview-blocks" id="previewBlocks">
${day.blocks.map((block,bi)=> blockHtml(block, bi)).join("")}
</div>
</div>
</div>
`;

applyPrintCssVars();

document.getElementById("previewDatePicker").addEventListener("change", (e)=>{
currentDate = e.target.value || todayStr();
renderPrintPreviewView();
});
document.getElementById("btnPrintFromPreview").addEventListener("click", ()=> window.print());

document.getElementById("rangeSubjectSize").addEventListener("input", (e)=>{
ps.subjectSize = Number(e.target.value);
document.getElementById("valSubjectSize").textContent = ps.subjectSize;
applyPrintCssVars(); saveState();
});
document.getElementById("rangeStudentSize").addEventListener("input", (e)=>{
ps.studentSize = Number(e.target.value);
document.getElementById("valStudentSize").textContent = ps.studentSize;
applyPrintCssVars(); saveState();
});
document.getElementById("rangeGradeSize").addEventListener("input", (e)=>{
ps.gradeSize = Number(e.target.value);
document.getElementById("valGradeSize").textContent = ps.gradeSize;
applyPrintCssVars(); saveState();
});
document.getElementById("logoFile").addEventListener("change", (e)=>{
const file = e.target.files[0];
if(file) handleLogoFile(file);
});
document.getElementById("btnRemoveLogo").addEventListener("click", ()=>{
ps.logoImage = null;
saveState(); renderPrintPreviewView();
});
const modeSelect = document.getElementById("logoModeSelect");
if(modeSelect) modeSelect.addEventListener("change", (e)=>{
ps.logoMode = e.target.value;
saveState(); renderPrintPreviewView();
});
const opacityRange = document.getElementById("rangeLogoOpacity");
if(opacityRange) opacityRange.addEventListener("input", (e)=>{
ps.logoOpacity = Number(e.target.value)/100;
document.getElementById("valLogoOpacity").textContent = e.target.value;
saveState(); renderPrintPreviewView();
});
}

/* =========================================================
SETTINGS / BACKUP
========================================================= */
const EWEB_BOOKMARKLET = `javascript:(async()=>{window.focus();const m=location.pathname.match(/schoolDay\\/(\\d+)/);const schoolId=m?m[1]:null;const dateInput=document.querySelector('input[type=date]');const date=dateInput?dateInput.value:null;if(!schoolId||!date){alert('学校IDまたは日付が取得できませんでした');return;}try{const res=await window.axios.post('/api/schedule/getSchoolSchedules/'+schoolId+'/'+date+'/'+date);const data=res.data;const komas=(data.date_komas||[]).flatMap(dk=>(dk.koma_set&&dk.koma_set.komas)||[]).map(k=>({id:k.id,name:k.name,start:k.start,end:k.end}));const items=(data.schedules||[]).map(s=>({koma_id:s.koma_id,teacher_name:s.teacher_name,student_name:s.student_name,grade:s.student_grade,subject:s.subject_name,pos:s.pos}));const groups=(data.scheduleGroups||[]).map(g=>({koma_id:g.koma_id,start:g.start,end:g.end,name:g.group_class?g.group_class.name:'',teacher_name:(g.join_teachers&&g.join_teachers[0]&&g.join_teachers[0].teacher&&g.join_teachers[0].teacher.user)?g.join_teachers[0].teacher.user.name:'',students:(g.join_students||[]).map(js=>js.student?js.student.name:'').filter(Boolean)}));const payload={date,komas,items,groups};const json=JSON.stringify(payload);let copied=false;try{await navigator.clipboard.writeText(json);copied=true;}catch(e){copied=false;}if(copied){alert(date+' の予定を座席表アプリ用にコピーしました（個別'+items.length+'件／集団'+groups.length+'件）。座席表アプリの「eWebから読み込む」ボタンに貼り付けてください。');}else{window.prompt('自動コピーに失敗しました。下のテキストを全選択（Ctrl+A/Cmd+A）してコピーし、座席表アプリの「eWebから読み込む」に貼り付けてください：',json);}}catch(err){alert('取得に失敗しました: '+(err.response?err.response.status:err.message));}})();`;

function renderSettingsView(){
const el = document.getElementById("view-settings");
el.innerHTML = `
<div class="panel page-head">
<p class="eyebrow">SETTINGS</p>
<h2>設定・バックアップ</h2>
<p class="sub">すべてのデータ（生徒名簿・講師名簿・座席配置・週ごとの座席表・曜日プリセット）をまとめてバックアップ・復元できます。</p>
</div>
<div class="settings-grid">
<div class="panel settings-card">
<h3>バックアップを保存</h3>
<p>現在のすべてのデータを1つのJSONファイルとしてダウンロードします。定期的な保存をおすすめします。</p>
<button class="btn primary" id="btnExport">JSONをダウンロード</button>
</div>
<div class="panel settings-card">
<h3>バックアップから復元</h3>
<p>以前ダウンロードしたJSONファイルを読み込みます。現在のデータに<strong>上書き</strong>されるため、必要であれば先に上のボタンでバックアップしてください。</p>
<input type="file" id="importFile" accept="application/json,.json">
<div class="file-drop">JSONファイルを選択してください</div>
</div>
<div class="panel settings-card">
<h3>保存状況</h3>
<p>生徒：${state.students.length}名 / 講師：${state.teachers.length}名 / 登録日数：${Object.keys(state.days).length}日 / 曜日プリセット：${Object.keys(state.weekdayPresets).length}件</p>
<p>データはこの端末のブラウザ内（localStorage）に自動保存されています。ブラウザのデータを消去すると失われるため、バックアップの保存をおすすめします。</p>
</div>
<div class="panel settings-card" style="grid-column:1/-1;">
<h3>eWeb取込ブックマークレットの設定方法</h3>
<p>eWebから座席表を読み込むには、以下のリンクをブラウザの「ブックマークバー」にドラッグ＆ドロップして登録してください（クリックではなく、ドラッグで登録します）。</p>
<p style="margin:10px 0;"><a href="${escapeHtml(EWEB_BOOKMARKLET)}" onclick="alert('このリンクはブックマークバーへドラッグして登録してください。クリックではこのアプリ上では動作しません。');return false;" class="btn primary" style="text-decoration:none; display:inline-block;">📌 eWeb取込（ブックマークバーへドラッグ）</a></p>
<p>使い方：①eWebで取り込みたい日付の座席表画面を開く　②上のブックマークレットをクリック（コピー完了のメッセージが出ます）　③この座席表アプリに戻り、「eWebから読み込む」ボタンに貼り付け</p>
</div>
</div>
`;
document.getElementById("btnExport").addEventListener("click", ()=>{
const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
const stamp = todayStr();
a.href = url; a.download = `seat-table-backup-${stamp}.json`;
document.body.appendChild(a); a.click(); a.remove();
showToast("バックアップをダウンロードしました");
});
document.getElementById("importFile").addEventListener("change", (e)=>{
const file = e.target.files[0];
if(!file) return;
const reader = new FileReader();
reader.onload = ()=>{
try{
const parsed = JSON.parse(reader.result);
confirmDialog("バックアップを読み込みます。現在のデータは上書きされます。よろしいですか？", ()=>{
state = migrate(parsed);
saveState();
renderTabs();
renderCurrentView();
showToast("バックアップを読み込みました");
});
}catch(err){
showToast("ファイルの読み込みに失敗しました。正しいJSONファイルか確認してください。", true);
}
};
reader.readAsText(file);
});
}

/* =========================================================
INIT
========================================================= */
function init(){
state = loadState();
applyPrintCssVars();
initTabs();
initPastePreview();
renderTabs();
renderCurrentView();
}
document.addEventListener("DOMContentLoaded", init);
