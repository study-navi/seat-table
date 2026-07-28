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
if(!Array.isArray(data.printSettings.images)){
data.printSettings.images = [];
if(data.printSettings.logoImage){
data.printSettings.images.push({
id: uid(), src: data.printSettings.logoImage,
xPct: data.printSettings.logoMode==="corner-tl" ? 2 : (data.printSettings.logoMode==="watermark" ? 30 : 85),
yPct: 2, widthPct: data.printSettings.logoMode==="watermark" ? 40 : 12,
opacity: (typeof data.printSettings.logoOpacity === "number") ? data.printSettings.logoOpacity : 0.18
});
}
}
delete data.printSettings.logoImage;
delete data.printSettings.logoMode;
delete data.printSettings.logoOpacity;
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
${imagesHtml()}
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
<div class="lesson-block" data-block="${block.id}" data-time="${escapeHtml(/[0-9]/.test(block.time||'') ? block.time : '')}">
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
<div class="cell group-row">
<input list="subjectList" class="subject-select js-g-subject" value="${escapeHtml(g.subject)}" placeholder="科目">
</div>
<div class="cell group-row group-count-cell">
<span class="group-count-badge">${g.students.length}名</span>
</div>
<div class="cell group-row group-name-cell">
<input type="text" class="js-g-name" value="${escapeHtml(g.name)}" placeholder="授業名／グループ名">
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
const EWEB_SUBJECT_ABBR = {"数":"数学","英":"英語","国":"国語","理":"理科","社":"社会","化":"化学","物":"物理","生":"生物","地":"地学","現":"現代文","古":"古文","漢":"漢文","公":"公民"};
function parseEwebSubject(raw){
const s = (raw||"").trim();
const m = s.match(/^(講|通)[\(<【\[]([^\)>】\]]+)[\)>】\]]$/);
if(!m) return {subject: s, status: "normal"};
const kind = m[1], code = m[2];
const subject = EWEB_SUBJECT_ABBR[code] || code;
return {subject, status: kind === "講" ? "course" : "normal"};
}
function guessSubjectFromName(name){
const s = name || "";
for(const [abbr, full] of Object.entries(EWEB_SUBJECT_ABBR)){
if(s.includes(full) || s.includes(abbr)) return full;
}
return "";
}
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
if(list[0]){
const p0 = parseEwebSubject(list[0].subject);
seat.left = {student:normalizeName(list[0].student_name||""), subject:p0.subject, grade:list[0].grade||"", status:p0.status};
}
if(list[1]){
const p1 = parseEwebSubject(list[1].subject);
seat.right = {student:normalizeName(list[1].student_name||""), subject:p1.subject, grade:list[1].grade||"", status:p1.status};
}
block.seats.push(seat);
// 3人以上が同じ講師・同じコマの場合は、3人目以降を集団行として追加
if(list.length>2){
const p2 = parseEwebSubject(list[2].subject);
block.groupRows.push({
id: uid(), seatNumber: "", name: "", teacher: teacherName,
subject: p2.subject,
students: list.slice(2).map(x=>normalizeName(x.student_name)).filter(Boolean)
});
}
});

(groupsByKoma[komaId]||[]).forEach(g=>{
block.groupRows.push({
id: uid(), seatNumber: "", name: g.name || "",
teacher: normalizeName(g.teacher_name || ""), subject: guessSubjectFromName(g.name),
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

function imagesHtml(){
return (state.printSettings.images||[]).map(img=>`
<img class="print-image" data-img-id="${img.id}" src="${img.src}" draggable="false"
style="left:${img.xPct}%; top:${img.yPct}%; width:${img.widthPct}%; opacity:${img.opacity};">
`).join("");
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

function addImageFile(file){
if(!file || file.type.indexOf("image") === -1){ showToast("画像ファイルを選択してください", true); return; }
const reader = new FileReader();
reader.onload = ()=>{
resizeImageDataUrl(reader.result, 900, (resized)=>{
const count = state.printSettings.images.length;
state.printSettings.images.push({
id: uid(), src: resized,
xPct: 8 + (count % 5) * 6, yPct: 8 + (count % 5) * 6,
widthPct: 18, opacity: 1
});
saveState();
renderPrintPreviewView();
showToast("画像を追加しました");
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
addImageFile(item.getAsFile());
e.preventDefault();
break;
}
}
});
}

function bindImageDrag(){
const page = document.getElementById("previewPage");
if(!page) return;
let dragging = null;
page.querySelectorAll(".print-image").forEach(imgEl=>{
imgEl.style.cursor = "move";
imgEl.addEventListener("pointerdown", (e)=>{
dragging = imgEl.dataset.imgId;
imgEl.setPointerCapture(e.pointerId);
});
});
page.addEventListener("pointermove", (e)=>{
if(!dragging) return;
const rect = page.getBoundingClientRect();
let xPct = ((e.clientX - rect.left) / rect.width) * 100;
let yPct = ((e.clientY - rect.top) / rect.height) * 100;
xPct = Math.max(0, Math.min(95, xPct));
yPct = Math.max(0, Math.min(95, yPct));
const imgData = state.printSettings.images.find(i=>i.id === dragging);
if(imgData){
imgData.xPct = Math.round(xPct*10)/10;
imgData.yPct = Math.round(yPct*10)/10;
const el = page.querySelector(`.print-image[data-img-id="${dragging}"]`);
if(el){ el.style.left = imgData.xPct + "%"; el.style.top = imgData.yPct + "%"; }
}
});
page.addEventListener("pointerup", ()=>{
if(dragging) saveState();
dragging = null;
});
}

function renderPrintPreviewView(){
const el = document.getElementById("view-print");
const ps = state.printSettings;
const day = getOrCreateDay(currentDate);

const imageRows = ps.images.map((img,i)=>`
<div class="image-row" data-img-index="${i}">
<img class="image-thumb" src="${img.src}">
<div class="image-row-controls">
<label>大きさ <input type="range" class="js-img-size" min="4" max="60" step="1" value="${img.widthPct}"></label>
<label>不透明度 <input type="range" class="js-img-opacity" min="5" max="100" step="5" value="${Math.round(img.opacity*100)}"></label>
</div>
<button type="button" class="btn danger js-img-remove">削除</button>
</div>
`).join("");

el.innerHTML = `
<div class="panel page-head">
<p class="eyebrow">PRINT PREVIEW</p>
<h2>印刷プレビュー</h2>
<p class="sub">実際に印刷される見た目を確認しながら、文字の大きさや画像の位置を調整できます。ここでの設定はすべての日の印刷に共通して使われます。画像はプレビュー内でドラッグして好きな場所に置けます。</p>
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

<h3 style="margin-top:18px;">画像（ロゴ・背景など）</h3>
<p class="sub" style="margin:0 0 8px;">複数枚まで追加できます。アップロード、またはこの画面の上でそのまま貼り付け（Ctrl+V / Cmd+V）してください。プレビュー内の画像は、ドラッグして好きな場所に動かせます。</p>
<div class="btn-row" style="margin-bottom:10px;">
<input type="file" id="imageFile" accept="image/*" style="max-width:220px;">
</div>
<div class="image-list">${imageRows}</div>
</div>

<div class="print-preview-wrap">
<div class="print-preview-page" id="previewPage">
${imagesHtml()}
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
bindImageDrag();

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
document.getElementById("imageFile").addEventListener("change", (e)=>{
Array.from(e.target.files || []).forEach(f=> addImageFile(f));
e.target.value = "";
});
document.querySelectorAll(".image-row").forEach(row=>{
const idx = Number(row.dataset.imgIndex);
row.querySelector(".js-img-size").addEventListener("input", (e)=>{
ps.images[idx].widthPct = Number(e.target.value);
const imgEl = document.querySelector(`.print-image[data-img-id="${ps.images[idx].id}"]`);
if(imgEl) imgEl.style.width = ps.images[idx].widthPct + "%";
saveState();
});
row.querySelector(".js-img-opacity").addEventListener("input", (e)=>{
ps.images[idx].opacity = Number(e.target.value)/100;
const imgEl = document.querySelector(`.print-image[data-img-id="${ps.images[idx].id}"]`);
if(imgEl) imgEl.style.opacity = ps.images[idx].opacity;
saveState();
});
row.querySelector(".js-img-remove").addEventListener("click", ()=>{
ps.images.splice(idx,1);
saveState(); renderPrintPreviewView();
});
});
}

/* =========================================================
SETTINGS / BACKUP
========================================================= */
const EWEB_BOOKMARKLET = `javascript:(async()=>{window.focus();const m=location.pathname.match(/schoolDay\\/(\\d+)/);const schoolId=m?m[1]:null;const dateInput=document.querySelector('input[type=date]');const date=dateInput?dateInput.value:null;if(!schoolId||!date){alert('学校IDまたは日付が取得できませんでした');return;}try{const res=await window.axios.post('/api/schedule/getSchoolSchedules/'+schoolId+'/'+date+'/'+date);const data=res.data;const komas=(data.date_komas||[]).flatMap(dk=>(dk.koma_set&&dk.koma_set.komas)||[]).map(k=>({id:k.id,name:k.name,start:k.start,end:k.end}));const items=(data.schedules||[]).map(s=>({koma_id:s.koma_id,teacher_name:s.teacher_name,student_name:s.student_name,grade:s.student_grade,subject:s.subject_name,pos:s.pos,flags:Object.keys(s).filter(function(k){return /\u632f\u66ff/.test(String(s[k]))}).map(function(k){return k+"="+String(s[k]).slice(0,40)}),raw:Object.keys(s).reduce(function(o,k){var v=s[k];if(v===null||typeof v!=="object"){if(k!=="student_name"&&k!=="teacher_name")o[k]=v;}return o;},{})}));const groups=(data.scheduleGroups||[]).map(g=>({koma_id:g.koma_id,start:g.start,end:g.end,name:g.group_class?g.group_class.name:'',teacher_name:(g.join_teachers&&g.join_teachers[0]&&g.join_teachers[0].teacher&&g.join_teachers[0].teacher.user)?g.join_teachers[0].teacher.user.name:'',students:(g.join_students||[]).map(js=>js.student?js.student.name:'').filter(Boolean)}));const payload={date,komas,items,groups};const json=JSON.stringify(payload);let copied=false;try{await navigator.clipboard.writeText(json);copied=true;}catch(e){copied=false;}if(copied){alert(date+' の予定を座席表アプリ用にコピーしました（個別'+items.length+'件／集団'+groups.length+'件）。座席表アプリの「eWebから読み込む」ボタンに貼り付けてください。');}else{window.prompt('自動コピーに失敗しました。下のテキストを全選択（Ctrl+A/Cmd+A）してコピーし、座席表アプリの「eWebから読み込む」に貼り付けてください：',json);}}catch(err){alert('取得に失敗しました: '+(err.response?err.response.status:err.message));}})();`;

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

/* ==========================================================
   印刷: 全体の大きさスライダー
   CSS変数 --print-page-scale を上下させて紙面の縮尺を変える。
   値は localStorage("seat-table-print-scale") に単独で保存する
   （本体の state を上書きしないため）。
   ========================================================== */
(function(){
  var KEY = "seat-table-print-scale";
  var MIN = 60, MAX = 180;
  function read(){
    var v = parseFloat(localStorage.getItem(KEY));
    if (!isFinite(v) || v < MIN/100 || v > MAX/100) return 1;
    return v;
  }
  function apply(v){
    document.documentElement.style.setProperty("--print-page-scale", String(v));
  }
  function text(v){ return "全体の大きさ " + Math.round(v*100) + "%"; }
  function inject(){
    var panel = document.querySelector(".print-settings-panel");
    if (!panel || panel.querySelector("#printPageScale")) return;
    var labels = Array.prototype.slice.call(panel.querySelectorAll("label"));
    var anchor = null;
    for (var i = 0; i < labels.length; i++){
      if (labels[i].textContent.indexOf("学年") === 0){ anchor = labels[i].parentElement; break; }
    }
    var row = document.createElement("div");
    if (anchor) row.className = anchor.className;
    var lab = document.createElement("label");
    var input = document.createElement("input");
    input.type = "range";
    input.id = "printPageScale";
    input.min = String(MIN); input.max = String(MAX); input.step = "5";
    var v = read();
    input.value = String(Math.round(v*100));
    lab.textContent = text(v);
    input.addEventListener("input", function(){
      var nv = parseInt(input.value, 10) / 100;
      try { localStorage.setItem(KEY, String(nv)); } catch(e){}
      apply(nv);
      lab.textContent = text(nv);
    });
    row.appendChild(lab);
    row.appendChild(input);
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(row, anchor.nextSibling);
    else panel.appendChild(row);
  }
  apply(read());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
  setInterval(inject, 1500);
})();

/* ==========================================================
   印刷: 行の高さ（縦の伸ばし）と、プレビューの画面フィット表示
   ========================================================== */
(function(){
  var ROWKEY = "seat-table-print-row-h";
  var FITKEY = "seat-table-preview-fit";
  var MAXMM = 30;
  function q(s){ return document.querySelector(s); }

  function readRow(){
    var v = parseFloat(localStorage.getItem(ROWKEY));
    if (!isFinite(v) || v < 0 || v > MAXMM) return 0;
    return v;
  }
  function applyRow(v){
    document.documentElement.style.setProperty("--print-row-h", v > 0 ? (v + "mm") : "0px");
  }
  function rowText(v){ return v > 0 ? ("行の高さ " + v + "mm") : "行の高さ 自動"; }

  function readFit(){
    /* 編集モードでは画面フィットの縮小をかけない */
    if (localStorage.getItem("seat-table-print-look") === "0") return false;
    return localStorage.getItem(FITKEY) !== "0";
  }
  function applyFit(){
    if (window.__suspendPreviewFit) return;
    var wrap = q(".print-preview-wrap");
    var page = q(".print-preview-page");
    if (!wrap || !page) return;
    page.style.transform = "none";
    if (!readFit()){
      page.style.transform = "";
      page.style.transformOrigin = "";
      wrap.style.height = "";
      wrap.style.overflow = "";
      return;
    }
    var r = page.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var availW = wrap.clientWidth;
    var availH = Math.max(360, window.innerHeight - 140);
    var f = Math.min(availW / r.width, availH / r.height, 1);
    if (!isFinite(f) || f <= 0) f = 1;
    f = Math.max(0.2, f);
    page.style.transformOrigin = "top center";
    page.style.transform = "scale(" + f + ")";
    wrap.style.height = Math.ceil(r.height * f) + "px";
    wrap.style.overflow = "hidden";
  }

  var fitTimer = null;
  function scheduleFit(){
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(applyFit, 120);
  }

  function makeRow(anchor){
    var d = document.createElement("div");
    if (anchor) d.className = anchor.className;
    return d;
  }

  function inject(){
    var panel = q(".print-settings-panel");
    if (!panel || panel.querySelector("#printRowH")) return;
    var scaleInput = panel.querySelector("#printPageScale");
    var anchor = scaleInput ? scaleInput.parentElement : null;

    var row = makeRow(anchor);
    var lab = document.createElement("label");
    var input = document.createElement("input");
    input.type = "range";
    input.id = "printRowH";
    input.min = "0"; input.max = String(MAXMM); input.step = "1";
    var v = readRow();
    input.value = String(v);
    lab.textContent = rowText(v);
    input.addEventListener("input", function(){
      var nv = parseInt(input.value, 10);
      try { localStorage.setItem(ROWKEY, String(nv)); } catch(e){}
      applyRow(nv);
      lab.textContent = rowText(nv);
      scheduleFit();
    });
    row.appendChild(lab);
    row.appendChild(input);
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(row, anchor.nextSibling);
    else panel.appendChild(row);

    var fitRow = makeRow(anchor);
    var fitLab = document.createElement("label");
    fitLab.textContent = "画面に合わせる";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "previewFit";
    cb.checked = readFit();
    cb.style.flex = "0 0 auto";
    cb.style.width = "18px";
    cb.style.height = "18px";
    cb.addEventListener("change", function(){
      try { localStorage.setItem(FITKEY, cb.checked ? "1" : "0"); } catch(e){}
      applyFit();
    });
    fitRow.appendChild(fitLab);
    fitRow.appendChild(cb);
    if (row.parentElement) row.parentElement.insertBefore(fitRow, row.nextSibling);

    var scaleEl = panel.querySelector("#printPageScale");
    if (scaleEl) scaleEl.addEventListener("input", scheduleFit);
    var obs = new MutationObserver(scheduleFit);
    var wrap = q(".print-preview-wrap");
    if (wrap) obs.observe(wrap, { childList: true, subtree: true });
  }

  applyRow(readRow());
  function boot(){ inject(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  setInterval(boot, 1500);
  window.addEventListener("resize", scheduleFit);
  document.addEventListener("click", scheduleFit, true);
  setTimeout(applyFit, 800);
})();

/* ==========================================================
   集団行: 集団名に含まれる時間を読み取り、空いている科目列に表示
   例) "HALLO土曜日-15:10~16:00" -> "15:10〜16:00"
   時間が書かれていない集団（中3社会-2026夏期集団 など）は何も出さない。
   科目が既に入っている行にも出さない。
   ========================================================== */
(function(){
  var RE = /(\d{1,2})\s*[:：]\s*(\d{2})\s*[~〜～\-–—]\s*(\d{1,2})\s*[:：]\s*(\d{2})/;
  function pad(n){ n = String(parseInt(n, 10)); return n.length < 2 ? ("0" + n) : n; }
  function timeOf(name){
    var m = RE.exec(String(name || ""));
    if (!m) return "";
    return pad(m[1]) + ":" + m[2] + "〜" + pad(m[3]) + ":" + m[4];
  }
  function nameOf(row){
    var i = row.querySelector(".group-name-cell input");
    if (i) return i.value;
    var d = row.querySelector(".group-name-cell");
    return d ? d.textContent : "";
  }
  function subjectCell(row){
    var cs = row.children;
    for (var i = 0; i < cs.length; i++){
      var cl = " " + cs[i].className + " ";
      if (cl.indexOf(" group-row ") >= 0
        && cl.indexOf("group-count") < 0
        && cl.indexOf("group-name") < 0
        && cl.indexOf("group-students") < 0
        && cl.indexOf("seat-num") < 0
        && cl.indexOf("teacher-col") < 0) return cs[i];
    }
    return null;
  }
  function clearInline(row){
    var s = row.querySelector(".group-time-inline");
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }
  function showInline(row, t){
    var nc = row.querySelector(".group-name-cell");
    if (!nc) return;
    var s = nc.querySelector(".group-time-inline");
    if (!s){
      s = document.createElement("span");
      s.className = "group-time-inline";
      nc.appendChild(s);
    }
    if (s.textContent !== t) s.textContent = t;
  }
  function clear(cell, input){
    var t = cell.querySelector(".group-time-auto");
    if (t && t.parentNode) t.parentNode.removeChild(t);
    if (input) input.style.display = "";
  }
  function decorate(){
    var rows = document.querySelectorAll(".group-row-wrap");
    for (var i = 0; i < rows.length; i++){
      var row = rows[i];
      var cell = subjectCell(row);
      if (!cell) continue;
      var input = cell.querySelector("input");
      if (cell.getAttribute("data-group-time-off") === "1"){ clear(cell, input); continue; }
      var t = "";
      if (typeof window.__seatGroupTime === "function") t = window.__seatGroupTime(row) || "";
      if (!t) t = timeOf(nameOf(row));
      var filled = input && input.value && input.value.trim() !== "";
      if (!t){ clear(cell, input); clearInline(row); continue; }
      if (filled){ clear(cell, input); showInline(row, t); continue; }
      clearInline(row);
      var tag = cell.querySelector(".group-time-auto");
      if (!tag){
        tag = document.createElement("span");
        tag.className = "group-time-auto";
        tag.title = "集団名から読み取った時間（クリックすると科目を入力できます）";
        tag.addEventListener("click", function(ev){
          var c = ev.currentTarget.parentNode;
          if (!c) return;
          c.setAttribute("data-group-time-off", "1");
          var ip = c.querySelector("input");
          if (ev.currentTarget.parentNode) ev.currentTarget.parentNode.removeChild(ev.currentTarget);
          if (ip){ ip.style.display = ""; ip.focus(); }
        });
        cell.appendChild(tag);
      }
      if (tag.textContent !== t) tag.textContent = t;
      if (input) input.style.display = "none";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", decorate);
  else decorate();
  setInterval(decorate, 1000);
})();

/* ==========================================================
   eWeb取込payloadから集団の実施時間を拾って保存する
   payload例: {"date":"2026-07-27","komas":[{"id":47,"start":"13:50","end":"15:20"}],
              "groups":[{"koma_id":47,"start":"14:50","end":"15:50"}]}
   コマのstart/endでブロックを特定し、集団のstart/endを対応付ける。
   ========================================================== */
(function(){
  var KEY = "seat-table-group-times";
  function digits(s){ return String(s || "").replace(/[^0-9]/g, ""); }
  function load(){ try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch(e){ return {}; } }
  function save(o){ try { localStorage.setItem(KEY, JSON.stringify(o)); } catch(e){} }
  function absorb(text){
    var p = null;
    try { p = JSON.parse(text); } catch(e){ return false; }
    if (!p || !p.date || !p.komas || !p.groups) return false;
    if (!p.komas.length || !p.groups.length) return false;
    var byId = {}, i;
    for (i = 0; i < p.komas.length; i++) byId[p.komas[i].id] = p.komas[i];
    var map = {}, n = 0;
    for (i = 0; i < p.groups.length; i++){
      var g = p.groups[i];
      if (!g || !g.start || !g.end) continue;
      var k = byId[g.koma_id];
      if (!k || !k.start || !k.end) continue;
      map[digits(k.start) + digits(k.end)] = g.start + "〜" + g.end;
      n++;
    }
    if (!n) return false;
    var all = load();
    all[p.date] = map;
    save(all);
    return true;
  }
  function watch(){
    var tas = document.querySelectorAll("textarea"), i;
    for (i = 0; i < tas.length; i++){
      var ta = tas[i];
      if (ta.getAttribute("data-gt-watch") === "1") continue;
      ta.setAttribute("data-gt-watch", "1");
      ta.addEventListener("input", function(ev){ absorb(ev.target.value); });
      ta.addEventListener("paste", function(ev){
        var t = ev.target;
        setTimeout(function(){ absorb(t.value); }, 60);
      });
    }
  }
  function dateOf(row){
    var v = row.closest ? row.closest(".view") : null;
    var inp = v ? v.querySelector("input[type=\"date\"]") : null;
    if (!inp) inp = document.querySelector("#view-seat input[type=\"date\"]");
    return inp ? inp.value : "";
  }
  window.__seatGroupTime = function(row){
    var blk = row.closest ? row.closest(".lesson-block") : null;
    if (!blk) return "";
    var m = load()[dateOf(row)];
    if (!m) return "";
    return m[digits(blk.getAttribute("data-time"))] || "";
  };
  watch();
  setInterval(watch, 1200);
})();

/* ==========================================================
   印刷プレビューを実際の印刷結果に合わせる
   @media print のルールを読み取り、セレクタに .print-preview-page を
   付けた複製を screen 用に注入する。印刷CSSを変えれば自動で追従する。
   ========================================================== */
(function(){
  var ID = "preview-mirror-print";
  var SKIP = /^(@|html\b|body\b|main\b|\.topbar|\.tabs\b|\.tab-btn|\.save-indicator|\.brand|#view-|\.print-preview)/;
  function collect(rules, out){
    for (var i = 0; i < rules.length; i++){
      var r = rules[i];
      if (!r || !r.selectorText || !r.style) continue;
      var parts = r.selectorText.split(",");
      var keep = [];
      for (var j = 0; j < parts.length; j++){
        var sel = parts[j].trim();
        if (!sel || SKIP.test(sel)) continue;
        /* プレビューでの操作を殺すルールは複製しない */
        if (sel.indexOf("[data-empty-sel") >= 0) continue;
        if (sel.indexOf(".btn") >= 0) continue;
        /* 画像は印刷用の position:fixed を持ち込むと、プレビューで
           画面基準に固定されて位置・サイズが操作できなくなる */
        if (sel.indexOf(".print-image") >= 0) continue;
        keep.push(".print-preview-page " + sel);
      }
      if (!keep.length) continue;
      out.push(keep.join(", ") + "{" + r.style.cssText + "}");
    }
  }
  function build(){
    var old = document.getElementById(ID);
    var sheets = document.styleSheets, out = [], i, j;
    for (i = 0; i < sheets.length; i++){
      if (sheets[i].ownerNode && sheets[i].ownerNode.id === ID) continue;
      var rules = null;
      try { rules = sheets[i].cssRules; } catch(e){ continue; }
      if (!rules) continue;
      for (j = 0; j < rules.length; j++){
        var r = rules[j];
        if (!r || r.type !== 4) continue;
        var cond = String(r.conditionText || (r.media && r.media.mediaText) || "");
        if (cond.indexOf("print") < 0) continue;
        if (r.cssRules) collect(r.cssRules, out);
      }
    }
    if (!out.length) return;
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var st = document.createElement("style");
    st.id = ID;
    st.setAttribute("media", "screen");
    st.textContent = out.join("\n");
    document.head.appendChild(st);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
  setTimeout(build, 1500);
})();

/* ==========================================================
   未選択のセレクトに data-empty-sel を立てる
   印刷・プレビューでは「生徒を選択」「—」を空白にするため。
   画面編集時はCSS側で対象外なので今までどおり表示される。
   ========================================================== */
(function(){
  function mark(){
    var sels = document.querySelectorAll(".cell select");
    for (var i = 0; i < sels.length; i++){
      var s = sels[i];
      var empty = (s.value === "" || s.value === null);
      if (empty){
        if (s.getAttribute("data-empty-sel") !== "1") s.setAttribute("data-empty-sel", "1");
      } else if (s.hasAttribute("data-empty-sel")){
        s.removeAttribute("data-empty-sel");
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mark);
  else mark();
  document.addEventListener("change", function(){ setTimeout(mark, 0); }, true);
  setInterval(mark, 800);
})();

/* ==========================================================
   印刷プレビューの表示設定パネルを折りたためるようにする
   スライダーと画像欄で縦に長くなり、プレビューが画面外へ
   押し下げられるため。初期状態は閉じる。
   ========================================================== */
(function(){
  var KEY = "seat-table-print-panel-open";
  function isOpen(){ return localStorage.getItem(KEY) === "1"; }
  function apply(panel, open){
    var kids = panel.children, i;
    for (i = 0; i < kids.length; i++){
      if (kids[i].getAttribute("data-panel-toggle") === "1") continue;
      kids[i].style.display = open ? "" : "none";
    }
  }
  function inject(){
    var panel = document.querySelector(".print-settings-panel");
    if (!panel || panel.querySelector("[data-panel-toggle]")) return;
    var bar = document.createElement("div");
    bar.setAttribute("data-panel-toggle", "1");
    bar.className = "print-panel-toggle";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    function label(){
      btn.textContent = isOpen()
        ? "表示設定を閉じる"
        : "表示設定を開く（文字サイズ・行の高さ・画像）";
    }
    btn.addEventListener("click", function(){
      var next = !isOpen();
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch(e){}
      apply(panel, next);
      label();
    });
    label();
    bar.appendChild(btn);
    panel.insertBefore(bar, panel.firstChild);
    apply(panel, isOpen());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
  setInterval(inject, 1500);
})();

/* ==========================================================
   プレビューの表示モード切り替え
   ON  : 印刷と同じ見た目（8pt・9mm列。確認向け。行が12〜20pxで編集は困難）
   OFF : 画面用の大きさ（編集向け）
   ========================================================== */
(function(){
  var KEY = "seat-table-print-look";
  function isOn(){ return localStorage.getItem(KEY) !== "0"; }
  function apply(){
    var st = document.getElementById("preview-mirror-print");
    if (st) st.disabled = !isOn();
    document.documentElement.setAttribute("data-print-look", isOn() ? "1" : "0");
  }
  function inject(){
    var bar = document.querySelector(".print-panel-toggle");
    if (!bar || bar.querySelector("#printLookToggle")) return;
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.flexWrap = "wrap";
    bar.style.gap = "12px";
    var lab = document.createElement("label");
    lab.style.fontSize = "13px";
    lab.style.display = "inline-flex";
    lab.style.alignItems = "center";
    lab.style.gap = "6px";
    lab.style.cursor = "pointer";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "printLookToggle";
    cb.checked = isOn();
    cb.addEventListener("change", function(){
      try { localStorage.setItem(KEY, cb.checked ? "1" : "0"); } catch(e){}
      apply();
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode("印刷と同じ見た目で表示（外すと編集しやすい大きさになります）"));
    bar.appendChild(lab);
    apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
  setInterval(function(){ inject(); apply(); }, 1500);
})();

/* ==========================================================
   画像の大きさ・不透明度スライダーを即時プレビューに反映する
   値は保存されるが再描画が走らないため、動かしても見た目が
   変わらない。スライダー操作中に直接インラインstyleへ当てる。
   ========================================================== */
(function(){
  function pairs(){
    var panel = document.querySelector(".print-settings-panel");
    if (!panel) return [];
    var all = panel.querySelectorAll("input[type=range]"), noId = [], i;
    for (i = 0; i < all.length; i++){ if (!all[i].id) noId.push(all[i]); }
    var out = [];
    for (i = 0; i + 1 < noId.length; i += 2) out.push([noId[i], noId[i + 1]]);
    return out;
  }
  function images(){
    return document.querySelectorAll(".print-preview-page img.print-image");
  }
  function live(){
    var ps = pairs(), im = images(), i;
    for (i = 0; i < ps.length && i < im.length; i++){
      var w = parseFloat(ps[i][0].value);
      var o = parseFloat(ps[i][1].value);
      if (isFinite(w)) im[i].style.width = w + "%";
      if (isFinite(o)) im[i].style.opacity = String(o / 100);
    }
  }
  function bind(){
    var ps = pairs(), i, j;
    for (i = 0; i < ps.length; i++){
      for (j = 0; j < 2; j++){
        var el = ps[i][j];
        if (!el || el.getAttribute("data-img-live") === "1") continue;
        el.setAttribute("data-img-live", "1");
        el.addEventListener("input", live);
        el.addEventListener("change", live);
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
  setInterval(bind, 1000);
})();

/* ==========================================================
   生徒名簿: 生年月日をまとめて貼り付け
   1行1人。「氏名 生年月日」または生年月日のみ（名簿の並び順）。
   氏名は空白（半角・全角）を無視して照合する。
   ========================================================== */
(function(){
  var ID = "birthdate-bulk";
  var KEY = "seat-table-v1";
  function norm(s){ return String(s || "").replace(/[\s\u3000,\uFF0C\u3001;\uFF1B\t]+/g, ""); }
  function pad(n){ return (n < 10 ? "0" : "") + n; }
  function toISO(y, m, d){
    y = parseInt(y, 10); m = parseInt(m, 10); d = parseInt(d, 10);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return "";
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
    return y + "-" + pad(m) + "-" + pad(d);
  }
  function parseLine(ln){
    var m = ln.match(/(\d{4})\s*[\/\-\.年]\s*(\d{1,2})\s*[\/\-\.月]\s*(\d{1,2})\s*[日]?/);
    if (!m) return { name: norm(ln), iso: "" };
    return { name: norm(ln.replace(m[0], " ")), iso: toISO(m[1], m[2], m[3]) };
  }
  function entries(text){
    var out = [], lines = String(text || "").split(/\r?\n/), i;
    for (i = 0; i < lines.length; i++){ if (norm(lines[i])) out.push(parseLine(lines[i])); }
    return out;
  }
  function build(text){
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch(e){ return null; }
    if (!s || !s.students) return null;
    var idx = {}, i;
    for (i = 0; i < s.students.length; i++) idx[norm(s.students[i].name)] = i;
    var es = entries(text), plan = [], unmatched = [], invalid = 0, order = 0;
    for (i = 0; i < es.length; i++){
      var e = es[i];
      if (!e.iso){ invalid++; continue; }
      if (e.name){
        if (idx[e.name] === undefined){ unmatched.push(e.name); continue; }
        plan.push({ i: idx[e.name], iso: e.iso });
      } else {
        if (order < s.students.length) plan.push({ i: order, iso: e.iso });
        order++;
      }
    }
    return { state: s, plan: plan, unmatched: unmatched, invalid: invalid, total: es.length };
  }
  function inject(){
    var view = document.querySelector("#view-students");
    if (!view || document.getElementById(ID)) return;
    var box = document.createElement("div");
    box.id = ID; box.className = "panel"; box.style.marginBottom = "12px";
    var h = document.createElement("h3");
    h.textContent = "生年月日をまとめて貼り付け";
    var p = document.createElement("p");
    p.style.fontSize = "13px";
    p.textContent = "1行に1人。「氏名 生年月日」の形か、生年月日だけ（名簿の並び順に対応）。氏名は空白の有無を無視して照合します。日付は 2011/5/3・2011-5-3・2011年5月3日 のいずれでも可。";
    var ta = document.createElement("textarea");
    ta.rows = 6; ta.style.width = "100%";
    ta.placeholder = "大利 幸之介\t2011/05/03\n藤井 章聡 2011-6-14";
    var row = document.createElement("div");
    row.style.display = "flex"; row.style.gap = "8px"; row.style.alignItems = "center";
    row.style.marginTop = "8px"; row.style.flexWrap = "wrap";
    var checkBtn = document.createElement("button");
    checkBtn.type = "button"; checkBtn.className = "btn"; checkBtn.textContent = "照合する";
    var applyBtn = document.createElement("button");
    applyBtn.type = "button"; applyBtn.className = "btn"; applyBtn.textContent = "反映して再読み込み";
    applyBtn.disabled = true;
    var msg = document.createElement("div");
    msg.style.fontSize = "13px"; msg.style.marginTop = "8px"; msg.style.whiteSpace = "pre-wrap";
    checkBtn.addEventListener("click", function(){
      var r = build(ta.value);
      if (!r){ msg.textContent = "名簿データを読み込めませんでした。"; applyBtn.disabled = true; return; }
      var out = [];
      out.push("照合できた: " + r.plan.length + "件 / 入力 " + r.total + "行");
      if (r.unmatched.length) out.push("名簿に見つからない氏名: " + r.unmatched.join("、"));
      if (r.invalid) out.push("日付が読めない行: " + r.invalid + "件");
      out.push("「反映して再読み込み」で保存し、ページを読み直します。");
      msg.textContent = out.join("\n");
      applyBtn.disabled = (r.plan.length === 0);
    });
    applyBtn.addEventListener("click", function(){
      var r = build(ta.value);
      if (!r || !r.plan.length) return;
      var i;
      for (i = 0; i < r.plan.length; i++) r.state.students[r.plan[i].i].birthdate = r.plan[i].iso;
      try { localStorage.setItem(KEY, JSON.stringify(r.state)); } catch(e){ msg.textContent = "保存に失敗しました。"; return; }
      location.reload();
    });
    row.appendChild(checkBtn); row.appendChild(applyBtn);
    box.appendChild(h); box.appendChild(p); box.appendChild(ta);
    box.appendChild(row); box.appendChild(msg);
    view.insertBefore(box, view.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
  setInterval(inject, 1500);
})();

/* ==========================================================
   生徒名簿: 生年月日順の並べ替えと、学年の自動計算
   学年は4月1日時点の年齢基準。学年gは
   (年度-6-g)年4月2日 〜 (年度-5-g)年4月1日 生まれ。
   例) 2026年度の中3(g=9) = 2011/4/2〜2012/4/1
   ========================================================== */
(function(){
  var KEY = "seat-table-v1";
  function state(){ try { return JSON.parse(localStorage.getItem(KEY)); } catch(e){ return null; } }
  function schoolYear(d){ return (d.getMonth() + 1 >= 4) ? d.getFullYear() : d.getFullYear() - 1; }
  function gradeOf(iso, today){
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso || ""));
    if (!m) return "";
    var b = new Date(+m[1], +m[2] - 1, +m[3]);
    var Y = schoolYear(today), g;
    for (g = 1; g <= 12; g++){
      var s = new Date(Y - 6 - g, 3, 2);
      var e = new Date(Y - 5 - g, 3, 1);
      if (b >= s && b <= e) break;
    }
    if (g > 12){
      /* 小1の範囲より後に生まれていれば未就学、それより前なら高3を終えている */
      if (b > new Date(Y - 6, 3, 1)) return "未就学";
      return "既卒";
    }
    if (g <= 6) return "小" + g;
    if (g <= 9) return "中" + (g - 6);
    return "高" + (g - 9);
  }
  window.__gradeFromBirthdate = gradeOf;
  function mkBtn(text, fn){
    var b = document.createElement("button");
    b.type = "button"; b.className = "btn"; b.textContent = text;
    b.addEventListener("click", fn);
    return b;
  }
  function fillGrades(){
    var s = state();
    if (!s || !s.students) return;
    var today = new Date(), upd = 0, noBd = 0, outOfRange = 0, same = 0, i;
    for (i = 0; i < s.students.length; i++){
      var st = s.students[i];
      if (!st.birthdate){ noBd++; continue; }
      var g = gradeOf(st.birthdate, today);
      if (!g){ outOfRange++; continue; }
      if (st.grade === g){ same++; continue; }
      st.grade = g; upd++;
    }
    var msg = "学年を更新: " + upd + "件\n変更なし: " + same + "件\n生年月日なし: " + noBd + "件\n小1〜高3の範囲外: " + outOfRange + "件\n\n保存してページを再読み込みします。";
    if (!window.confirm(msg)) return;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){ return; }
    location.reload();
  }
  function gradeRank(g){
    var m = /^(小|中|高)(\d)$/.exec(String(g || ""));
    if (!m) return 99;
    var base = (m[1] === "小") ? 0 : ((m[1] === "中") ? 6 : 9);
    return base + (+m[2]);
  }
  function valOf(st, key){
    if (key === "name") return st.name || "";
    if (key === "grade") return st.grade || "";
    return st.birthdate || "";
  }
  function cmpKey(a, b, key){
    if (key === "name") return String(a.name||"").localeCompare(String(b.name||""), "ja");
    if (key === "grade") return gradeRank(a.grade) - gradeRank(b.grade);
    var x = a.birthdate || "", y = b.birthdate || "";
    return x < y ? -1 : (x > y ? 1 : 0);
  }
  function doSort(key, dir){
    var s = state();
    if (!s || !s.students) return;
    var label = (key === "name") ? "氏名" : ((key === "grade") ? "学年" : "生年月日");
    var dirLabel = (dir === "desc") ? "降順" : "昇順";
    var filled = 0, i;
    for (i = 0; i < s.students.length; i++) if (valOf(s.students[i], key)) filled++;
    var msg = label + "の" + dirLabel + "で並べ替えます。\n値あり: " + filled + "件\n未入力: " + (s.students.length - filled) + "件（昇降どちらでも末尾）\n\n保存して表示を更新します。";
    if (!window.confirm(msg)) return;
    s.students.sort(function(a, b){
      var ae = !valOf(a, key), be = !valOf(b, key);
      if (ae && be) return 0;
      if (ae) return 1;
      if (be) return -1;
      var r = cmpKey(a, b, key);
      return (dir === "desc") ? -r : r;
    });
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){ return; }
    location.reload();
  }
  function sortByBirthdate(){
    var s = state();
    if (!s || !s.students) return;
    var withBd = 0, i;
    for (i = 0; i < s.students.length; i++) if (s.students[i].birthdate) withBd++;
    var msg = "生年月日の古い順に並べ替えます。\n生年月日あり: " + withBd + "件\n生年月日なし: " + (s.students.length - withBd) + "件（末尾へ）\n\n保存してページを再読み込みします。";
    if (!window.confirm(msg)) return;
    s.students.sort(function(a, b){
      var x = a.birthdate || "", y = b.birthdate || "";
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? -1 : (x > y ? 1 : 0);
    });
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){ return; }
    location.reload();
  }
  function inject(){
    var box = document.getElementById("birthdate-bulk");
    if (!box || box.querySelector("[data-bd-extra]")) return;
    var row = document.createElement("div");
    row.setAttribute("data-bd-extra", "1");
    row.style.display = "flex"; row.style.gap = "8px";
    row.style.flexWrap = "wrap"; row.style.marginTop = "10px";
    row.appendChild(mkBtn("生年月日から学年を入れる", fillGrades));
    var sortLab = document.createElement("span");
    sortLab.textContent = "並べ替え:";
    sortLab.style.fontSize = "13px";
    var keySel = document.createElement("select");
    [["birthdate", "生年月日"], ["name", "氏名"], ["grade", "学年"]].forEach(function(o){
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1]; keySel.appendChild(op);
    });
    var dirSel = document.createElement("select");
    [["asc", "昇順"], ["desc", "降順"]].forEach(function(o){
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1]; dirSel.appendChild(op);
    });
    row.appendChild(sortLab);
    row.appendChild(keySel);
    row.appendChild(dirSel);
    row.appendChild(mkBtn("並べ替える", function(){ doSort(keySel.value, dirSel.value); }));
    box.appendChild(row);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
  setInterval(inject, 1500);
})();

/* ==========================================================
   再読み込み後に表示中のタブを維持する
   並べ替えや学年一括入力の後に座席表へ戻ってしまうのを防ぐ。
   sessionStorage なので次回の起動時は通常どおり。
   ========================================================== */
(function(){
  var KEY = "seat-table-active-tab";
  function save(){
    /* タブ名は件数バッジを含み変動するため、位置で覚える */
    var btns = document.querySelectorAll(".tab-btn"), i;
    for (i = 0; i < btns.length; i++){
      if (/(^|\s)active(\s|$)/.test(btns[i].className)){
        try { sessionStorage.setItem(KEY, String(i)); } catch(e){}
        return;
      }
    }
  }
  function restore(){
    var want = null;
    try { want = sessionStorage.getItem(KEY); } catch(e){ return; }
    var i = parseInt(want, 10);
    if (!isFinite(i) || i < 0) return;
    var btns = document.querySelectorAll(".tab-btn");
    if (i >= btns.length) return;
    if (!/(^|\s)active(\s|$)/.test(btns[i].className)) btns[i].click();
  }
  document.addEventListener("click", function(ev){
    var t = ev.target;
    while (t && t !== document){
      if (t.classList && t.classList.contains("tab-btn")){ setTimeout(save, 60); return; }
      t = t.parentNode;
    }
  }, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function(){ setTimeout(restore, 300); });
  else setTimeout(restore, 300);
})();

/* ==========================================================
   用紙の向き（A3横 / A3縦）
   枠数が多い日は横だと2枚になるため、縦(404mm)を選べるようにする。
   @page は属性で切り替えられないので style を差し替える。
   ========================================================== */
(function(){
  var KEY = "seat-table-paper";
  var SID = "paper-orientation-style";
  function get(){ return localStorage.getItem(KEY) === "portrait" ? "portrait" : "landscape"; }
  function apply(){
    var v = get();
    document.documentElement.setAttribute("data-paper", v);
    var st = document.getElementById(SID);
    if (!st){
      st = document.createElement("style");
      st.id = SID;
      document.head.appendChild(st);
    }
    st.textContent = "@page{ size: A3 " + v + "; margin: 8mm; }";
  }
  function inject(){
    var bar = document.querySelector(".print-panel-toggle");
    if (!bar || bar.querySelector("#paperOrientation")) return;
    var lab = document.createElement("label");
    lab.style.fontSize = "13px";
    lab.style.display = "inline-flex";
    lab.style.alignItems = "center";
    lab.style.gap = "6px";
    lab.appendChild(document.createTextNode("用紙:"));
    var sel = document.createElement("select");
    sel.id = "paperOrientation";
    [["landscape", "A3 横（2列）"], ["portrait", "A3 縦（枠が多い日向け）"]].forEach(function(o){
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      sel.appendChild(op);
    });
    sel.value = get();
    sel.addEventListener("change", function(){
      try { localStorage.setItem(KEY, sel.value); } catch(e){}
      apply();
    });
    lab.appendChild(sel);
    bar.appendChild(lab);
  }
  apply();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
  setInterval(function(){ inject(); apply(); }, 1500);
})();

/* ==========================================================
   「1枚に収める」
   縦に収まらない主因は行の高さと文字サイズなので、
   行を詰める → 文字を段階的に小さくする → 最後に倍率、の順で試す。
   倍率(transform)は文字がぼやけるため最後の手段にする。
   ========================================================== */
(function(){
  var SCALE_KEY = "seat-table-print-scale";
  var ROW_KEY = "seat-table-print-row-h";
  var busy = false;
  function root(){ return document.documentElement; }
  function page(){ return document.querySelector(".print-preview-page"); }
  function content(){ var p = page(); return p ? p.querySelector(".blocks") : null; }
  function cssNum(name, def){
    var v = parseFloat(getComputedStyle(root()).getPropertyValue(name));
    return isFinite(v) ? v : def;
  }
  function setVar(n, v){ root().style.setProperty(n, v); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function fits(){
    var p = page(), c = content();
    if (!p || !c) return false;
    return c.getBoundingClientRect().height <= p.getBoundingClientRect().height + 1;
  }
  async function tryState(rowMm, subjPt, stuPt, scale){
    setVar("--print-row-h", rowMm > 0 ? (rowMm + "mm") : "0px");
    setVar("--print-subject-size", subjPt + "pt");
    setVar("--print-student-size", stuPt + "pt");
    setVar("--print-page-scale", String(scale));
    await sleep(90);
    return fits();
  }
  async function run(btn){
    if (busy) return;
    if (!page()){ window.alert("プレビューを表示してから実行してください。"); return; }
    busy = true;
    window.__suspendPreviewFit = true;
    var oldRow = cssNum("--print-row-h", 0);
    var oldSubj = cssNum("--print-subject-size", 15);
    var oldStu = cssNum("--print-student-size", 10.5);
    var oldScale = cssNum("--print-page-scale", 1);
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = "計算中…";
    /* 行の高さは mm、文字は pt。読みやすい順に候補を並べる */
    var plan = [
      [oldRow, oldSubj, oldStu, 1],
      [0, oldSubj, oldStu, 1],
      [0, 20, 15, 1], [0, 18, 14, 1], [0, 16, 13, 1],
      [0, 14, 12, 1], [0, 12, 11, 1], [0, 11, 10, 1],
      [0, 11, 10, 0.9], [0, 11, 10, 0.8], [0, 11, 10, 0.7]
    ];
    var hit = null, i;
    for (i = 0; i < plan.length; i++){
      if (await tryState(plan[i][0], plan[i][1], plan[i][2], plan[i][3])){ hit = plan[i]; break; }
    }
    btn.disabled = false; btn.textContent = label;
    busy = false;
    window.__suspendPreviewFit = false;
    window.dispatchEvent(new Event("resize"));
    if (!hit){
      setVar("--print-row-h", oldRow + "mm");
      setVar("--print-subject-size", oldSubj + "pt");
      setVar("--print-student-size", oldStu + "pt");
      setVar("--print-page-scale", String(oldScale));
      window.alert("この日は1枚に収まりませんでした。\n用紙をA3縦にするか、授業枠を分けて印刷してください。");
      return;
    }
    var msg = "行の高さ " + hit[0] + "mm、科目 " + hit[1] + "pt、生徒名 " + hit[2] + "pt";
    if (hit[3] !== 1) msg += "、全体 " + Math.round(hit[3] * 100) + "%";
    msg += " で1枚に収まります。\nこの設定を保存しますか？";
    if (!window.confirm(msg)){
      setVar("--print-row-h", oldRow + "mm");
      setVar("--print-subject-size", oldSubj + "pt");
      setVar("--print-student-size", oldStu + "pt");
      setVar("--print-page-scale", String(oldScale));
      return;
    }
    try {
      localStorage.setItem(ROW_KEY, String(hit[0]));
      localStorage.setItem(SCALE_KEY, String(hit[3]));
      var s = JSON.parse(localStorage.getItem("seat-table-v1"));
      if (s && s.printSettings){
        s.printSettings.subjectSize = hit[1];
        s.printSettings.studentSize = hit[2];
        localStorage.setItem("seat-table-v1", JSON.stringify(s));
      }
    } catch(e){}
    location.reload();
  }
  function inject(){
    var bar = document.querySelector(".print-panel-toggle");
    if (!bar || bar.querySelector("#fitOnePage")) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "btn"; b.id = "fitOnePage";
    b.textContent = "1枚に収める";
    b.addEventListener("click", function(){ run(b); });
    bar.appendChild(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
  setInterval(inject, 1500);
})();

/* ==========================================================
   eWeb取込: 振替の自動判定
   ブックマークレットが各予定の全項目を走査し、値に「振替」を含む
   項目を flags として持ってくる。ここではそれを見て status を
   substitute（振替）にする。項目名を事前に知る必要がない。
   ========================================================== */
(function(){
  var KEY = "seat-table-substitutes";
  function norm(s){ return String(s || "").replace(/[\s\u3000]+/g, ""); }
  function load(){ try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch(e){ return {}; } }
  function absorb(text){
    var p = null;
    try { p = JSON.parse(text); } catch(e){ return false; }
    if (!p || !p.date || !p.items) return false;
    var map = {}, n = 0, i;
    for (i = 0; i < p.items.length; i++){
      var it = p.items[i];
      if (!it || !it.flags || !it.flags.length) continue;
      map[norm(it.student_name)] = 1;
      n++;
    }
    var all = load();
    all[p.date] = map;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch(e){}
    return n > 0;
  }
  function watch(){
    var tas = document.querySelectorAll("textarea"), i;
    for (i = 0; i < tas.length; i++){
      var ta = tas[i];
      if (ta.getAttribute("data-sub-watch") === "1") continue;
      ta.setAttribute("data-sub-watch", "1");
      ta.addEventListener("input", function(ev){ absorb(ev.target.value); });
      ta.addEventListener("paste", function(ev){
        var t = ev.target;
        setTimeout(function(){ absorb(t.value); }, 60);
      });
    }
  }
  function dateOf(el){
    var v = el.closest ? el.closest(".view") : null;
    var inp = v ? v.querySelector("input[type=\"date\"]") : null;
    if (!inp) inp = document.querySelector("#view-seat input[type=\"date\"]");
    return inp ? inp.value : "";
  }
  function mark(){
    var cells = document.querySelectorAll(".student-cell"), i;
    for (i = 0; i < cells.length; i++){
      var cell = cells[i];
      var sel = cell.querySelector("select");
      if (!sel || !sel.value) continue;
      if (cell.getAttribute("data-sub-done") === "1") continue;
      var m = load()[dateOf(cell)];
      if (!m) continue;
      var name = norm(sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "");
      if (!m[name]) continue;
      cell.setAttribute("data-sub-done", "1");
      var btns = cell.parentElement ? cell.parentElement.querySelectorAll("button") : [];
      var j;
      for (j = 0; j < btns.length; j++){
        if (btns[j].textContent.trim() === "\u632f\u66ff"){ btns[j].click(); break; }
      }
    }
  }
  watch();
  setInterval(function(){ watch(); mark(); }, 1200);
})();

/* ==========================================================
   1対1（eWebで斜線）の反映
   eWebは科目名の括弧で区別している。
   1対1: 通<国> のように山括弧 / 1対2: 通(数) のように丸括弧。
   取込payloadから山括弧の生徒を拾い、同じ席の相手側を斜線にする。
   ========================================================== */
(function(){
  var KEY = "seat-table-solo";
  function norm(s){ return String(s || "").replace(/[\s\u3000]+/g, ""); }
  function load(){ try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch(e){ return {}; } }
  function isSolo(subj){ return /[<\uFF1C][^>\uFF1E]*[>\uFF1E]/.test(String(subj || "")); }
  function absorb(text){
    var p = null;
    try { p = JSON.parse(text); } catch(e){ return false; }
    if (!p || !p.date || !p.items) return false;
    var map = {}, n = 0, i;
    for (i = 0; i < p.items.length; i++){
      var it = p.items[i];
      if (!it) continue;
      var subj = it.subject || (it.raw && it.raw.subject_name) || "";
      if (!isSolo(subj)) continue;
      map[norm(it.student_name)] = 1;
      n++;
    }
    var all = load();
    all[p.date] = map;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch(e){}
    return n > 0;
  }
  function watch(){
    var tas = document.querySelectorAll("textarea"), i;
    for (i = 0; i < tas.length; i++){
      var ta = tas[i];
      if (ta.getAttribute("data-solo-watch") === "1") continue;
      ta.setAttribute("data-solo-watch", "1");
      ta.addEventListener("input", function(ev){ absorb(ev.target.value); });
      ta.addEventListener("paste", function(ev){
        var t = ev.target;
        setTimeout(function(){ absorb(t.value); }, 60);
      });
    }
  }
  function dateOf(el){
    var v = el.closest ? el.closest(".view") : null;
    var inp = v ? v.querySelector("input[type=\"date\"]") : null;
    if (!inp) inp = document.querySelector("#view-seat input[type=\"date\"]");
    return inp ? inp.value : "";
  }
  function nameOf(cell){
    var s = cell.querySelector("select");
    if (!s || !s.value) return "";
    var o = s.options[s.selectedIndex];
    return o ? norm(o.text) : "";
  }
  /* 斜線は img(SVG) で描く。背景画像は Chrome の
     「背景のグラフィック」がオフだと印刷されないため。 */
  var SVG = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">' +
    '<line x1="0" y1="8" x2="8" y2="0" stroke="#888" stroke-width="1.2"/>' +
    '</svg>');
  function setHatch(cell, on){
    var had = cell.classList.contains("solo-blocked");
    if (on === had && (!on || cell.querySelector(".solo-hatch"))) return;
    cell.classList.toggle("solo-blocked", !!on);
    var old = cell.querySelector(".solo-hatch");
    if (!on){ if (old && old.parentNode) old.parentNode.removeChild(old); return; }
    if (old) return;
    var im = document.createElement("img");
    im.className = "solo-hatch";
    im.alt = "";
    /* 8px角のタイルを敷き詰める見た目にするため、SVG側で繰り返す */
    im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none">' +
      '<defs><pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse">' +
      '<line x1="0" y1="8" x2="8" y2="0" stroke="#8a8a8a" stroke-width="1.2"/>' +
      '</pattern></defs><rect width="100" height="100" fill="url(#p)"/></svg>');
    cell.appendChild(im);
  }
  function paint(){
    var rows = document.querySelectorAll(".seat-row-wrap"), i, j;
    for (i = 0; i < rows.length; i++){
      var row = rows[i];
      var kids = row.children;
      if (kids.length < 8) continue;
      var map = load()[dateOf(row)] || {};
      /* 左=科目2/学年3/生徒4、右=科目5/学年6/生徒7 */
      var leftSolo = !!map[nameOf(kids[4])];
      var rightSolo = !!map[nameOf(kids[7])];
      var leftGroup = [kids[2], kids[3], kids[4]];
      var rightGroup = [kids[5], kids[6], kids[7]];
      for (j = 0; j < 3; j++){
        if (rightGroup[j]) setHatch(rightGroup[j], leftSolo && !nameOf(kids[7]));
        if (leftGroup[j]) setHatch(leftGroup[j], rightSolo && !nameOf(kids[4]));
      }
    }
  }
  watch();
  setInterval(function(){ watch(); paint(); }, 1200);
})();
