const STORAGE_KEY = 'wendao-cultivation-v1';
const BACKUP_KEY = 'wendao-cultivation-backup-v1';
const todayKey = () => new Date().toLocaleDateString('sv-SE');
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

const defaultEnglish = () => ({
  eXp: 45,
  realm: '元婴圆满',
  stableBand: 6.5,
  normalBand: 7.0,
  peakBand: 7.5,
  peakListening: 33,
  fatigueMinute: 15,
  listeningTrialProgress: 1,
  practiceLogs: {},
  mockLogs: {},
});
const defaultState = () => ({
  schemaVersion: 4,
  profile: { name: '道友', startDate: todayKey(), examDate: '2026-12-19', reminder: '21:40' },
  totalXp: 45,
  totalUnits: 0,
  ieltsBand: 6.5,
  english: defaultEnglish(),
  tasks: {}, customTasks: {}, taskActivityLogs: {}, foundations: {}, trials: {}, englishTrials: { listening: true }, records: {},
  milestones: [{ date: '2026-07-05', title: '听脉初证', detail: '剑桥雅思20 Test 1 · 33/40 · 获得45 E-XP' }],
  timer: { completed: 0 },
  draftUnits: { deep: 0, standard: 0, light: 0 },
  survivalMode: false,
  syncMeta: { localUpdatedAt: null, cloudUpdatedAt: null },
});
let state = loadState();
let scheduleCandidates=[],scheduleImageFile=null,scheduleImageUrl='',ocrWorker=null,deferredInstallPrompt=null,cloudUiStatus={configured:false,loggedIn:false,email:'',syncing:false};

const realms = [
  { name:'凝气', min:0, max:4800, meaning:'重建作息、学习耐力与基本秩序' },
  { name:'筑基', min:4800, max:8000, meaning:'稳定达到每日 5—6 小时，不再频繁零启动' },
  { name:'结丹', min:8000, max:11600, meaning:'各科形成系统知识框架' },
  { name:'元婴', min:11600, max:15600, meaning:'独立复述、比较并解释核心思想' },
  { name:'化神', min:15600, max:20100, meaning:'形成论述能力，完成成体系输出' },
  { name:'婴变', min:20100, max:25000, meaning:'模考、论文式回答与弱点修补' },
  { name:'问鼎', min:25000, max:25000, meaning:'达到上考场的完整状态' },
];
const englishLevels = [
  ['凝气','IELTS ≤ 5.0',5],['筑基','IELTS 5.5',5.5],['结丹','IELTS 6.0',6],['元婴','IELTS 6.5',6.5],
  ['化神','IELTS 7.0',7],['婴变','IELTS 7.5',7.5],['问鼎','IELTS 8.0',8],['阴虚','IELTS 8.5',8.5],
  ['阳实','IELTS 9.0',9],['窥涅','陌生讲座与研讨',9.5],['净涅','英文哲学论文答辩',10],['碎涅','双语学术工作',10.5]
];
const foundationDefs = [
  ['timely','守时印','23:00 上床 · 07:30 起床'],['clear','清心印','专注无手机 · 信息流不超额'],
  ['body','强体印','运动 30—50 分钟'],['spirit','定神印','读经祷告或默想 ≥ 20 分钟']
];
const englishTrialDefs = [
  ['listening','试炼一','IELTS 听力基线','严格一次播放，报告 /40 与错因'],
  ['dictation','试炼二','90 秒陌生材料听写','错误标记 V/P/L/A/M/G'],
  ['retell','试炼三','两分钟口头复述','关字幕，用英语重建论证'],
  ['writing','试炼四','250 词写作基线','完成一篇限时议论文']
];
const englishActivityDefs = [
  ['refine','听脉精炼',15,2,'25分钟主动循环：盲听、验伤、重听、复述'],
  ['endurance','神识续航',10,2,'连续听20—30分钟，漏听即断尾，结尾复述'],
  ['output','言灵输出',15,2,'25分钟口述、口语或150—250词写作并纠错'],
  ['reading','原著炼心',8,2,'专注阅读《魔戒》25分钟并简单复述']
];

function upgradeState(raw, applyProgress=true){
  const base=defaultState();
  const upgraded={...base,...raw,profile:{...base.profile,...(raw.profile||{})},english:{...base.english,...(raw.english||{})},englishTrials:{...base.englishTrials,...(raw.englishTrials||{})},syncMeta:{...base.syncMeta,...(raw.syncMeta||{})}};
  if((raw.schemaVersion||1)<2){
    upgraded.totalXp=(Number(raw.totalXp)||0)+(applyProgress?45:0);
    upgraded.english.eXp=Math.max(Number(raw.english?.eXp)||0,45);
    upgraded.englishTrials.listening=true;
    upgraded.milestones=[...(raw.milestones||[]),...base.milestones.filter(m=>!(raw.milestones||[]).some(x=>x.title===m.title))];
  }
  if((raw.schemaVersion||1)<3){upgraded.schemaVersion=3;upgraded.taskActivityLogs=raw.taskActivityLogs||{};}
  if((raw.schemaVersion||1)<4){upgraded.schemaVersion=4;upgraded.syncMeta={...base.syncMeta,...(raw.syncMeta||{})};}
  return upgraded;
}
function loadState(){
  try{
    const text=localStorage.getItem(STORAGE_KEY)||localStorage.getItem(BACKUP_KEY);
    if(!text)return defaultState();
    const upgraded=upgradeState(JSON.parse(text),true);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(upgraded));
    return upgraded;
  }catch{return defaultState();}
}
function saveState(options={}){ state.syncMeta={...(state.syncMeta||{}),localUpdatedAt:new Date().toISOString()};const previous=localStorage.getItem(STORAGE_KEY);if(previous)localStorage.setItem(BACKUP_KEY,previous);localStorage.setItem(STORAGE_KEY,JSON.stringify(state));if(options.cloud!==false)window.WendaoCloud?.schedulePush(state); }
function persistCloudState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function daysSinceStart(){ const start = new Date(state.profile.startDate + 'T00:00:00'); return Math.max(1, Math.floor((new Date().setHours(0,0,0,0)-start)/86400000)+1); }
function phaseInfo(){ const d=daysSinceStart(); if(d<=7)return{n:1,label:'第一阶段 · 前 7 天',game:90,social:60,units:10,hours:5}; if(d<=14)return{n:2,label:'第二周 · 立稳道基',game:60,social:45,units:12,hours:6}; if(d<=21)return{n:3,label:'第三周 · 增长耐力',game:60,social:45,units:14,hours:7}; return{n:4,label:'完全体 · 稳态修炼',game:60,social:30,units:16,hours:8}; }
function getRealm(xp=state.totalXp){ return realms.find(r=>xp<r.max) || realms.at(-1); }
function realmDisplay(xp=state.totalXp){ const r=getRealm(xp); if(r.name==='凝气'){ const layer=Math.min(15,Math.floor(xp/320)+1); return `凝气${toCn(layer)}层`; } return r.name; }
function toCn(n){ return ['零','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五'][n] || n; }
function currentLevelBounds(){ const r=getRealm(); if(r.name==='凝气'){const min=Math.floor(state.totalXp/320)*320;return{min,max:min+320};} return {min:r.min,max:r.max}; }
function isSunday(){ return new Date().getDay()===0; }

function dailyTasks(){
  if(isSunday()) return [
    task('weekly','10:00','一周复盘与下周规划','light',2),task('input','14:00','愉悦英语输入 /《魔戒》','light',2),
    task('worship','自选','敬拜、运动与正常生活','foundation',1,'安息日'),task('review','20:30','整理本周弱点，不开新战线','light',2)
  ];
  const p=phaseInfo().n;
  const study = p===1 ? [
    task('phil1','09:00','哲学核心：教材、原著与框架','standard',3),task('listen','11:15','英语听力炼体','deep',2),task('phil3','15:35','主动回忆与短论述','deep',2),task('english2','19:20','词汇、《魔戒》与输出','standard',2),task('review','21:40','每日复盘与明日安排','light',1)
  ] : p===2 ? [
    task('phil1','09:00','哲学核心：教材、原著与框架','standard',4),task('listen','11:15','英语听力炼体','deep',2),task('phil2','13:20','哲学史与重点人物','standard',2),task('phil3','15:35','主动回忆与短论述','deep',2),task('english2','19:20','词汇、《魔戒》与输出','standard',2)
  ] : p===3 ? [
    task('phil1','09:00','哲学核心：教材、原著与框架','standard',4),task('listen','11:15','英语听力炼体','deep',2),task('phil2','13:20','哲学史与重点人物','standard',3),task('phil3','15:35','主动回忆、论述与笔记','deep',3),task('english2','19:20','词汇、《魔戒》与输出','standard',2)
  ] : [
    task('phil1','09:00','哲学核心：教材、原著与框架','standard',4),task('listen','11:15','英语听力炼体','deep',2),task('phil2','13:20','哲学史与重点人物','standard',4),task('phil3','15:35','主动回忆、论述与笔记','deep',4),task('english2','19:20','词汇、《魔戒》与输出','standard',2)
  ];
  return [
    task('prayer','08:00','读经、祷告','foundation',1,'定神 · 30 分钟'),...study,
    task('exercise','17:35','运动炼体','foundation',1,'强体 · 30—50 分钟'),task('game','20:20','合法游戏时间','foundation',1,'戒律 · 到点即止'),task('sleep','23:00','熄灯入睡 · 手机离床','foundation',1,'守时印')
  ].sort((a,b)=>a.time.localeCompare(b.time));
}
const taskXp={deep:12,standard:10,light:6,foundation:0};
const taskTypeNames={deep:'深度',standard:'标准',light:'轻度',foundation:'道基'};
function task(id,time,name,type,target,meta=''){return{id,time,name,type,target,xp:taskXp[type],meta:meta||`${taskTypeNames[type]} · ${target} 单元`};}
function allTodayTasks(){
  const customs=(state.customTasks[todayKey()]||[]).map(item=>{
    const type=Object.hasOwn(taskXp,item.type)?item.type:'standard',target=clamp(Number(item.target)||1,1,18);
    return{...item,type,target,time:item.time||'自选',xp:taskXp[type],meta:item.meta||`${taskTypeNames[type]} · 目标 ${target} 单元`,custom:true};
  });
  return[...dailyTasks(),...customs];
}
function taskDayLog(){state.taskActivityLogs[todayKey()]=state.taskActivityLogs[todayKey()]||{};return state.taskActivityLogs[todayKey()];}
function taskDayStats(){const log=state.taskActivityLogs[todayKey()]||{},tasks=allTodayTasks();return tasks.reduce((s,t)=>{const count=log[t.id]||0;s.completions+=count;s.xp+=count*t.xp;if(t.xp>0)s.units+=count;return s;},{xp:0,units:0,completions:0});}

function renderAll(){
  renderBrowserClock();
  renderDashboard(); renderRealm(); renderEnglish(); renderHistory(); renderSettings(); renderCloudStatus();
}
function renderBrowserClock(){
  const now=new Date(),week=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][now.getDay()];
  q('#todayLabel').textContent=`${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 · ${week} · ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} · 浏览器本地时间`;
}
function renderDashboard(){
  const phase=phaseInfo(), bounds=currentLevelBounds(), value=state.totalXp-bounds.min, span=Math.max(1,bounds.max-bounds.min), pct=clamp(value/span*100,0,100);
  q('#phasePill').textContent=phase.label; q('#realmMinor').textContent=realmDisplay(); q('#realmPercent').textContent=`${Math.round(pct)}%`;
  q('#realmRing').style.setProperty('--ring',`${pct}%`); q('#currentXp').textContent=state.totalXp.toLocaleString(); q('#nextXp').textContent=bounds.max.toLocaleString(); q('#realmProgress').style.width=`${pct}%`;
  q('#xpToSummit').textContent=Math.max(0,25000-state.totalXp).toLocaleString(); q('#totalUnits').textContent=`${state.totalUnits} 单元`;
  q('#daysToExam').textContent=`${Math.max(0,Math.ceil((new Date(state.profile.examDate+'T00:00:00')-new Date())/86400000))} 天`;
  q('#nextRealmHint').textContent=state.totalXp>=25000?'问鼎之劫已至。':`再得 ${bounds.max-state.totalXp} 修为触及下一小境界。`;
  q('#dashboardEnglishXp').textContent=`英语 ${state.english.eXp} E-XP`;
  q('#phasePill').textContent=isSunday()?'安息日 · 轻量复盘':phase.label;
  const alert=q('#alertStrip'), overdue=countOverdue();
  if(q('#taskList') && Object.keys(state.records).includes(todayKey())) { alert.className='alert-strip good'; alert.innerHTML='<span>今日复盘已写入修行簿；后续完成的任务仍会即时增加修为。</span><b>复盘已入簿</b>'; }
  else if(overdue){ alert.className='alert-strip'; alert.innerHTML=`<span>有 ${overdue} 项修炼令已到时但尚未完成。先选最小的一项启动，不必追求补齐全部。</span><b>可切换最低保命日</b>`; }
  else { alert.className='alert-strip good'; alert.innerHTML=`<span>${isSunday()?'今日六日修炼、一日安息。轻量复盘即可。':'今日目标 '+phase.units+' 个专注单元，允许降级，不许虚报。'}</span><b>${phase.hours} 小时学习时段</b>`; }
  renderTasks(); renderFoundations(); renderWeekChart(); renderLimits(); renderTimerDots();
}
function renderTasks(){
  const tasks=allTodayTasks(),log=taskDayLog(),stats=taskDayStats();q('#taskHeading').textContent=isSunday()?'安息日轻量令':'主线与支线';
  q('#taskList').innerHTML=tasks.map(t=>{const count=log[t.id]||0,done=count>=t.target,overdue=isOverdue(t.time)&&!done,isCustom=t.custom;return `<div class="task-practice-item ${done?'done':''} ${overdue?'overdue':''}"><header><div><span class="task-time">${escapeHtml(t.time||'自选')}</span><b>${escapeHtml(t.name)}</b></div><em>${t.xp?`+${t.xp}/单元`:'道基任务'}</em></header><p>${escapeHtml(t.meta||`${taskTypeNames[t.type]} · 目标 ${t.target} 单元`)}</p><div class="task-practice-controls"><button data-task-activity="${escapeHtml(t.id)}" data-delta="-1">撤回</button><span>${count}/${t.target}</span><button data-task-activity="${escapeHtml(t.id)}" data-delta="1">${t.xp?'完成一单元':'标记完成'}</button>${isCustom?`<button class="delete-task" data-delete-task="${escapeHtml(t.id)}" aria-label="删除${escapeHtml(t.name)}">删除</button>`:''}</div></div>`}).join('');
  q('#todayGeneralXp').textContent=`今日 ${stats.xp} 修为`;
  q('#taskDoneCount').textContent=`${stats.units} / 18 单元`;
  q('#applySurvival').textContent=state.survivalMode?'退出保命模式':'切换最低保命日';
  qa('[data-task-activity]').forEach(btn=>btn.onclick=()=>updateTaskActivity(btn.dataset.taskActivity,Number(btn.dataset.delta)));
  qa('[data-delete-task]').forEach(btn=>btn.onclick=()=>deleteCustomTask(btn.dataset.deleteTask));
}
function countOverdue(){const log=state.taskActivityLogs[todayKey()]||{};return allTodayTasks().filter(t=>(log[t.id]||0)<t.target&&isOverdue(t.time)).length;}
function isOverdue(time){ if(!/^\d\d:\d\d$/.test(time))return false; const [h,m]=time.split(':').map(Number),n=new Date(); return n.getHours()*60+n.getMinutes()>h*60+m+20; }
function updateTaskActivity(id,delta){
  const t=allTodayTasks().find(x=>x.id===id);if(!t)return;
  const log=taskDayLog(),before=log[id]||0,after=clamp(before+delta,0,t.target);if(after===before)return;
  const stats=taskDayStats(),unitDelta=t.xp>0?after-before:0,xpDelta=(after-before)*t.xp;
  if(delta>0&&unitDelta&&stats.units>=18)return toast('今日已达到 18 个计分单元上限。');
  if(delta>0&&xpDelta&&stats.xp+xpDelta>180)return toast('今日已达到 180 修为上限；继续学习仍有价值，但不再计分。');
  log[id]=after;state.totalXp=Math.max(0,state.totalXp+xpDelta);state.totalUnits=Math.max(0,state.totalUnits+unitDelta);
  if(state.records[todayKey()]){state.records[todayKey()].xp=Math.max(0,(state.records[todayKey()].xp||0)+xpDelta);state.records[todayKey()].units=Math.max(0,(state.records[todayKey()].units||0)+unitDelta);}
  saveState();renderDashboard();renderHistory();toast(xpDelta>0?`${t.name}：＋${xpDelta} 修为。`:xpDelta<0?`${t.name}：撤回 ${Math.abs(xpDelta)} 修为。`:`${t.name}已${after?'完成':'撤回'}。`);
}
function deleteCustomTask(id){
  const task=(state.customTasks[todayKey()]||[]).find(t=>t.id===id);if(!task)return;
  const count=(state.taskActivityLogs[todayKey()]||{})[id]||0;if(count>0)return toast('请先撤回该任务已计入的单元，再删除任务。');
  state.customTasks[todayKey()]=(state.customTasks[todayKey()]||[]).filter(t=>t.id!==id);saveState();renderDashboard();toast('自定义任务已删除。');
}
function saveCustomTask(){
  const form=q('#customTaskForm'),values=Object.fromEntries(new FormData(form).entries()),name=String(values.name||'').trim();
  if(!name)return toast('请先填写任务名称。');
  const type=Object.hasOwn(taskXp,values.type)?values.type:'standard',target=clamp(Number(values.target)||1,1,18),time=values.time||'自选';
  const item={id:`custom_${Date.now()}`,name,type,target,time,xp:taskXp[type],meta:`自定义 · ${taskTypeNames[type]} · 目标 ${target} 单元`,custom:true};
  state.customTasks[todayKey()]=[...(state.customTasks[todayKey()]||[]),item];
  saveState();form.reset();q('#customTaskDialog').close();renderDashboard();toast('自定义任务已加入今日修炼令。');
}
function openScheduleImport(){
  scheduleCandidates=[];scheduleImageFile=null;if(scheduleImageUrl)URL.revokeObjectURL(scheduleImageUrl);scheduleImageUrl='';
  q('#scheduleImportForm').reset();q('#scheduleImagePreview').hidden=true;q('#scheduleImagePreview').removeAttribute('src');q('#ocrStatus').textContent='等待选择图片';q('#ocrPercent').textContent='0%';q('#ocrProgressBar').style.width='0%';q('#recognizeSchedule').disabled=true;renderScheduleCandidates();q('#scheduleImportDialog').showModal();
}
function handleScheduleImage(file){
  if(!file)return;if(!file.type.startsWith('image/'))return toast('请选择图片文件。');if(file.size>12*1024*1024)return toast('图片不能超过 12MB。');
  scheduleImageFile=file;if(scheduleImageUrl)URL.revokeObjectURL(scheduleImageUrl);scheduleImageUrl=URL.createObjectURL(file);
  q('#scheduleImagePreview').src=scheduleImageUrl;q('#scheduleImagePreview').hidden=false;q('#recognizeSchedule').disabled=false;q('#ocrStatus').textContent='图片已就绪';q('#ocrPercent').textContent='0%';q('#ocrProgressBar').style.width='0%';
}
function ocrProgress(message){
  const labels={'loading tesseract core':'加载识别核心','initializing tesseract':'初始化识别器','loading language traineddata':'下载中英文模型','initializing api':'准备文字识别','recognizing text':'正在识别文字'};
  const percent=Math.round((message.progress||0)*100);q('#ocrStatus').textContent=labels[message.status]||'正在处理图表';q('#ocrPercent').textContent=`${percent}%`;q('#ocrProgressBar').style.width=`${percent}%`;
}
async function recognizeScheduleImage(){
  if(!scheduleImageFile)return toast('请先拍照或选择一张图表。');if(!window.Tesseract)return toast('文字识别组件加载失败，请联网刷新后重试。');
  const button=q('#recognizeSchedule');button.disabled=true;button.textContent='识别中…';
  try{
    ocrWorker=await Tesseract.createWorker(['chi_sim','eng'],1,{workerPath:'vendor/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',langPath:'https://tessdata.projectnaptha.com/4.0.0_best',logger:ocrProgress});
    await ocrWorker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300'});
    const result=await ocrWorker.recognize(scheduleImageFile);q('#ocrRawText').value=(result.data.text||'').trim();q('#ocrStatus').textContent='识别完成';q('#ocrPercent').textContent='100%';q('#ocrProgressBar').style.width='100%';loadScheduleCandidatesFromText();
  }catch(error){console.error(error);q('#ocrStatus').textContent='识别失败';toast('识别失败。可以手动修正文字后点击“按文字生成任务”。');}
  finally{if(ocrWorker){await ocrWorker.terminate().catch(()=>{});ocrWorker=null;}button.disabled=false;button.textContent='重新识别';}
}
function normalizeChartTime(value){const parts=String(value||'').replace('：',':').split(':').map(Number);if(parts.length!==2||parts.some(Number.isNaN))return'自选';return`${String(clamp(parts[0],0,23)).padStart(2,'0')}:${String(clamp(parts[1],0,59)).padStart(2,'0')}`;}
function inferTaskType(name){if(/运动|跑步|健身|散步|祷告|读经|礼拜|睡眠|起床|休息/.test(name))return'foundation';if(/精读|论文|写作|模考|真题|专业课|论述|深度|考试/.test(name))return'deep';if(/背词|单词|整理|复盘|预习|计划|回顾|朗读/.test(name))return'light';return'standard';}
function parseChartText(text){
  const timePattern=/(?:[01]?\d|2[0-3])[:：][0-5]\d/g,rangePattern=/((?:[01]?\d|2[0-3])[:：][0-5]\d)\s*(?:-|—|~|～|至)\s*((?:[01]?\d|2[0-3])[:：][0-5]\d)/;
  const ignored=/^(星期|周)[…3332 tokens truncated…大心魔</b><p>${escapeHtml(r.challenge)}</p></div>`,r.worked&&`<div><b>保留做法</b><p>${escapeHtml(r.worked)}</p></div>`,r.tomorrow&&`<div><b>明日重点</b><p>${escapeHtml(r.tomorrow)}</p></div>`].filter(Boolean).join('');
    const second=typeof r.secondReview==='string'?r.secondReview:r.secondReview?.text;
    return `<div class="history-entry"><div class="history-entry-head"><div class="history-date"><strong>${k.slice(5).replace('-','月')}日</strong><span>${r.survivalMode?'最低保命日':'正常修炼日'}</span></div><strong>＋${r.xp||0} 修为</strong></div><div class="history-bars"><div class="micro-bar"><i style="width:${clamp((r.xp||0)/180*100,0,100)}%"></i></div><small class="muted">${r.units||0} 单元 · 道基 ${r.foundationScore||0}/4 · 能量 ${r.energy||0}/10</small></div>${reflections?`<div class="reflection-grid">${reflections}</div>`:'<p class="muted history-empty-reflection">本日只有旧版结算记录，尚未填写文字复盘。</p>'}${second?`<div class="second-review-note"><b>二度复盘</b><p>${escapeHtml(second)}</p>${r.secondReview?.updatedAt?`<small>${escapeHtml(r.secondReview.updatedAt)} 更新</small>`:''}</div>`:''}<button class="ghost-btn second-review-btn" data-second-review="${k}">${second?'编辑二度复盘':'追加二度复盘'}</button></div>`;
  }).join(''):'<div class="muted" style="padding:35px;text-align:center">尚无修行记录。完成今日复盘后，这里会形成第一篇修行札记。</div>';
  qa('[data-second-review]').forEach(button=>button.onclick=()=>openSecondReview(button.dataset.secondReview));
}
function openSecondReview(date){
  const record=state.records[date];if(!record)return;
  const existing=typeof record.secondReview==='string'?record.secondReview:record.secondReview?.text||'';
  q('#secondReviewDate').value=date;q('#secondReviewTitle').textContent=`重新审视 ${date}`;q('#secondReviewText').value=existing;q('#secondReviewDialog').showModal();
}
function saveSecondReview(){
  const date=q('#secondReviewDate').value,text=q('#secondReviewText').value.trim();if(!date||!state.records[date])return toast('没有找到这一天的复盘记录。');if(!text)return toast('请先写下二度复盘。');
  state.records[date].secondReview={text,updatedAt:new Date().toLocaleString('zh-CN')};saveState();q('#secondReviewDialog').close();renderHistory();toast('二度复盘已写入修行簿。');
}
function calcStreak(){ let n=0,d=new Date();while(state.records[d.toLocaleDateString('sv-SE')]){n++;d.setDate(d.getDate()-1)}return n; }
function renderSettings(){q('#settingName').value=state.profile.name;q('#settingStart').value=state.profile.startDate;q('#settingExam').value=state.profile.examDate;q('#settingReminder').value=state.profile.reminder;renderCloudStatus();}

function renderCloudStatus(){
  if(!q('#cloudStatusBtn'))return;const status=window.WendaoCloud?.getStatus?.()||cloudUiStatus;cloudUiStatus={...cloudUiStatus,...status};
  const button=q('#cloudStatusBtn'),label=q('#cloudStatusText'),settings=q('#cloudSettingsStatus'),openButton=q('#openCloudSettings'),manual=q('#manualCloudSync');button.classList.toggle('synced',!!status.loggedIn);button.classList.toggle('syncing',!!status.syncing);
  label.textContent=status.syncing?'同步中':status.loggedIn?'云端已连':'本机模式';
  settings.textContent=!status.configured?'云端功能已经就绪，等待正式发布时连接私人数据库。':status.loggedIn?`已连接 ${status.email||'云端账号'}，本地修改会自动同步。`:'云服务已就绪。登录后，手机和电脑会共用同一份进度。';
  openButton.textContent=status.loggedIn?'查看云端状态':'连接云端账号';manual.hidden=!status.loggedIn;
}
function openCloudDialog(){
  const status=window.WendaoCloud?.getStatus?.()||cloudUiStatus;q('#cloudUnavailable').hidden=!!status.configured;q('#cloudLoggedOut').hidden=!!status.loggedIn||!status.configured;q('#cloudLoggedIn').hidden=!status.loggedIn;q('#cloudAccountEmail').textContent=status.email||'—';q('#cloudDialogStatus').textContent=status.loggedIn?'本地优先：断网可用，恢复联网后自动同步。':status.configured?'登录后会先比较云端与本机档案，任何覆盖都会先征求你的选择。':'云端服务尚未完成发布配置，本机数据不受影响。';q('#cloudDialog').showModal();
}
function setCloudActionBusy(busy,message=''){qa('#cloudDialog button').forEach(button=>{if(!button.classList.contains('close-btn'))button.disabled=busy;});if(message)q('#cloudDialogStatus').textContent=message;}
async function cloudSignIn(){
  const email=q('#cloudEmail').value.trim(),password=q('#cloudPassword').value;if(!email||password.length<8)return toast('请输入有效邮箱和至少 8 位密码。');setCloudActionBusy(true,'正在登录并校验云端档案…');
  try{await WendaoCloud.signIn(email,password);await WendaoCloud.sync(state);openCloudDialogRefresh();toast('云端账号已连接。');}catch(error){q('#cloudDialogStatus').textContent=error.message;}finally{setCloudActionBusy(false);renderCloudStatus();}
}
async function cloudSignUp(){
  const email=q('#cloudEmail').value.trim(),password=q('#cloudPassword').value;if(!email||password.length<8)return toast('请输入有效邮箱和至少 8 位密码。');setCloudActionBusy(true,'正在创建私人云端档案…');
  try{const data=await WendaoCloud.signUp(email,password);if(data.access_token){await WendaoCloud.sync(state,{preferLocal:true});openCloudDialogRefresh();toast('账号创建成功，当前进度已同步。');}else q('#cloudDialogStatus').textContent='注册成功。请先完成邮箱确认，再返回登录。';}catch(error){q('#cloudDialogStatus').textContent=error.message;}finally{setCloudActionBusy(false);renderCloudStatus();}
}
function openCloudDialogRefresh(){const status=WendaoCloud.getStatus();q('#cloudLoggedOut').hidden=!!status.loggedIn;q('#cloudLoggedIn').hidden=!status.loggedIn;q('#cloudAccountEmail').textContent=status.email||'—';q('#cloudDialogStatus').textContent=status.loggedIn?'账号已连接，正在保持多端一致。':'请登录云端账号。';}
async function manualCloudSync(){
  if(!window.WendaoCloud?.getStatus().loggedIn)return openCloudDialog();setCloudActionBusy(true,'正在同步…');
  try{
    const result=await WendaoCloud.sync(state);
    if(result?.direction==='busy'){q('#cloudDialogStatus').textContent='已有同步正在进行，稍等几秒后再试。';toast('已有同步正在进行。');return;}
    if(result?.direction==='conflict'){showCloudConflict();q('#cloudDialogStatus').textContent='两端都有新进度，请选择保留本机或载入云端。';toast('发现两端进度，请在云端面板选择。');return;}
    const message=result?.direction==='pull'?'已从云端恢复最新档案。':'当前进度已同步到云端。';
    toast(message);q('#cloudDialogStatus').textContent=message;q('#cloudLastSync').textContent=`最近同步：${new Date().toLocaleString('zh-CN')}`;
  }catch(error){q('#cloudDialogStatus').textContent=`同步失败：${error.message}`;toast(`同步失败：${error.message}`);}finally{setCloudActionBusy(false);renderCloudStatus();}
}
function showCloudConflict(){const panel=q('#cloudConflict');if(panel)panel.hidden=false;if(q('#cloudDialog')&&!q('#cloudDialog').open)q('#cloudDialog').showModal();}
function hideCloudConflict(){const panel=q('#cloudConflict');if(panel)panel.hidden=true;}
async function resolveCloudConflict(choice){
  setCloudActionBusy(true,choice==='local'?'正在上传本机档案…':'正在载入云端档案…');
  try{
    const result=await WendaoCloud.resolveConflict(choice);
    hideCloudConflict();
    const message=result?.direction==='pull'?'已载入云端档案。':'本机档案已上传云端。';
    q('#cloudDialogStatus').textContent=message;q('#cloudLastSync').textContent=`最近同步：${new Date().toLocaleString('zh-CN')}`;toast(message);
  }catch(error){q('#cloudDialogStatus').textContent=`处理失败：${error.message}`;toast(`处理失败：${error.message}`);}
  finally{setCloudActionBusy(false);renderCloudStatus();}
}
function initCloudSync(){
  window.addEventListener('wendao-cloud-status',event=>{cloudUiStatus={...cloudUiStatus,...event.detail};renderCloudStatus();if(event.detail.error)toast(`云同步暂时失败：${event.detail.error}`);});
  window.addEventListener('wendao-cloud-conflict',()=>showCloudConflict());
  window.addEventListener('wendao-cloud-state',event=>{state=upgradeState(event.detail.state,false);state.syncMeta={...(state.syncMeta||{}),localUpdatedAt:event.detail.updatedAt,cloudUpdatedAt:event.detail.updatedAt};persistCloudState();renderAll();toast('已载入云端最新修行档案。');});
  window.addEventListener('wendao-cloud-meta',event=>{state.syncMeta={...(state.syncMeta||{}),localUpdatedAt:event.detail.updatedAt,cloudUpdatedAt:event.detail.updatedAt};persistCloudState();q('#cloudLastSync').textContent=`最近同步：${new Date(event.detail.updatedAt).toLocaleString('zh-CN')}`;});
  window.addEventListener('wendao-cloud-ready',()=>{renderCloudStatus();toast('云端账号已连接；为保护本机档案，请手动点击同步。');});window.WendaoCloud?.bootstrap();
}
function initPwa(){
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;q('#installAppBtn').hidden=false;});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;q('#installAppBtn').hidden=true;toast('问道台已安装到此设备。');});
  if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'))navigator.serviceWorker.register('./service-worker.js').catch(error=>console.warn('Service worker registration failed',error));
}
async function installPwa(){if(!deferredInstallPrompt)return toast('请在手机浏览器菜单中选择“添加到主屏幕”。');deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;q('#installAppBtn').hidden=true;}

function initEvents(){
  qa('.nav-item[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view)); qa('[data-jump]').forEach(b=>b.onclick=()=>switchView(b.dataset.jump));
  q('#openCheckin').onclick=()=>{populateCheckin();q('#checkinDialog').showModal();}; q('#saveCheckin').onclick=e=>{e.preventDefault();saveCheckin();}; q('#checkinForm').addEventListener('input',previewCheckin);
  q('#applySurvival').onclick=()=>{state.survivalMode=!state.survivalMode;saveState();renderAll();toast(state.survivalMode?'已切换最低保命日：今天只守住火种。':'已恢复正常修炼模式。');};
  q('#saveSettings').onclick=()=>{state.profile={name:q('#settingName').value||'道友',startDate:q('#settingStart').value,examDate:q('#settingExam').value,reminder:q('#settingReminder').value};saveState();renderAll();toast('修炼设置已保存。');};
  q('#notificationBtn').onclick=requestNotifications; q('#exportData').onclick=exportData; q('#importData').onchange=importData; q('#resetData').onclick=resetData;
  q('#addCustomTask').onclick=()=>{q('#customTaskForm').reset();q('#customTaskDialog').showModal();};
  q('#saveCustomTask').onclick=e=>{e.preventDefault();saveCustomTask();};
  q('#saveSecondReview').onclick=e=>{e.preventDefault();saveSecondReview();};
  q('#scanTaskChart').onclick=openScheduleImport;q('#scheduleImageInput').onchange=e=>handleScheduleImage(e.target.files[0]);q('#recognizeSchedule').onclick=recognizeScheduleImage;q('#parseScheduleText').onclick=loadScheduleCandidatesFromText;q('#importScheduleTasks').onclick=e=>{e.preventDefault();importScheduleTasks();};
  q('#scheduleDropZone').ondragover=e=>{e.preventDefault();q('#scheduleDropZone').classList.add('dragging');};q('#scheduleDropZone').ondragleave=()=>q('#scheduleDropZone').classList.remove('dragging');q('#scheduleDropZone').ondrop=e=>{e.preventDefault();q('#scheduleDropZone').classList.remove('dragging');handleScheduleImage(e.dataTransfer.files[0]);};
  q('#scheduleImportDialog').addEventListener('close',()=>{if(scheduleImageUrl){URL.revokeObjectURL(scheduleImageUrl);scheduleImageUrl='';}});
  q('#cloudStatusBtn').onclick=openCloudDialog;q('#openCloudSettings').onclick=openCloudDialog;q('#cloudSignIn').onclick=cloudSignIn;q('#cloudSignUp').onclick=cloudSignUp;q('#cloudSyncNow').onclick=manualCloudSync;q('#manualCloudSync').onclick=manualCloudSync;const cloudUseLocal=q('#cloudUseLocal'),cloudUseRemote=q('#cloudUseRemote');if(cloudUseLocal)cloudUseLocal.onclick=()=>resolveCloudConflict('local');if(cloudUseRemote)cloudUseRemote.onclick=()=>resolveCloudConflict('remote');q('#cloudSignOut').onclick=()=>{WendaoCloud.signOut();hideCloudConflict();openCloudDialogRefresh();renderCloudStatus();toast('已退出云端账号，本机档案仍然保留。');};q('#installAppBtn').onclick=installPwa;
  q('#timerStart').onclick=toggleTimer;q('#timerReset').onclick=resetTimer;
}
function switchView(id){qa('.view').forEach(v=>v.classList.toggle('active',v.id===id));qa('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===id));q('#pageTitle').textContent={dashboard:'今日洞府',realm:'境界天梯',english:'英语道境',history:'修行簿',settings:'系统设置'}[id];window.scrollTo(0,0);}

function populateCheckin(){
  const form=q('#checkinForm'),record=state.records[todayKey()]||{};
  const values={bedTime:record.bedTime||'23:00',wakeTime:record.wakeTime||'07:30',energy:record.energy||6,challenge:record.challenge||'',growth:record.growth||'',worked:record.worked||'',tomorrow:record.tomorrow||'',exerciseMinutes:record.exerciseMinutes||0,prayerMinutes:record.prayerMinutes||0,socialMinutes:record.socialMinutes||0,gameMinutes:record.gameMinutes||0};
  Object.entries(values).forEach(([name,value])=>{if(form.elements[name])form.elements[name].value=value;});
  form.elements.phoneAway.checked=!!record.phoneAway;form.elements.survivalMode.checked=record.survivalMode??state.survivalMode;previewCheckin();
}
function previewCheckin(){const stats=taskDayStats(),existing=state.records[todayKey()];q('#checkinPreview').textContent=`今日任务已即时记录 ${existing?.units??stats.units} 个计分单元、${existing?.xp??stats.xp} 修为。复盘只记录反思和道基，不会重复增加修为。`;}
function saveCheckin(){
  const form=q('#checkinForm'),v=Object.fromEntries(new FormData(form).entries()),phase=phaseInfo(),stats=taskDayStats(),previous=state.records[todayKey()]||{};
  const bedOk=timeWithin(v.bedTime,'23:00',30),wakeOk=timeWithin(v.wakeTime,'07:30',30),clear=!!v.phoneAway&&+v.socialMinutes<=phase.social,body=+v.exerciseMinutes>=(v.survivalMode?20:30),spirit=+v.prayerMinutes>=20,marks={timely:bedOk&&wakeOk,clear,body,spirit};
  const foundationScore=Object.values(marks).filter(Boolean).length;
  state.foundations[todayKey()]=marks;state.tasks[todayKey()]={...(state.tasks[todayKey()]||{}),review:true};
  state.records[todayKey()]={...previous,...v,units:previous.units??stats.units,xp:previous.xp??stats.xp,energy:+v.energy,exerciseMinutes:+v.exerciseMinutes,prayerMinutes:+v.prayerMinutes,gameMinutes:+v.gameMinutes,socialMinutes:+v.socialMinutes,foundationScore,survivalMode:!!v.survivalMode,phoneAway:!!v.phoneAway,reviewedAt:new Date().toLocaleString('zh-CN')};
  state.survivalMode=!!v.survivalMode;saveState();q('#checkinDialog').close();renderAll();toast(`今日复盘已写入修行簿，道基 ${foundationScore}/4。`);
}
function timeWithin(v,target,tolerance){if(!v)return false;const a=v.split(':').map(Number),b=target.split(':').map(Number);return Math.abs((a[0]*60+a[1])-(b[0]*60+b[1]))<=tolerance;}

let timerSeconds=1500,timerRunning=false,timerHandle=null,timerWork=true;
function toggleTimer(){if(timerRunning){clearInterval(timerHandle);timerRunning=false;q('#timerStart').textContent='继续入定';return;}timerRunning=true;q('#timerStart').textContent='暂停';timerHandle=setInterval(()=>{timerSeconds--;renderTimer();if(timerSeconds<=0){clearInterval(timerHandle);timerRunning=false;if(timerWork){state.timer.completed=(state.timer.completed||0)+1;saveState();toast('一轮修炼完成。起身休息五分钟，不刷手机。');}timerWork=!timerWork;timerSeconds=timerWork?1500:300;q('#timerMode').textContent=timerWork?'修炼 · 25 分钟':'调息 · 5 分钟';q('#timerStart').textContent=timerWork?'开始入定':'开始调息';renderTimerDots();renderTimer();}},1000);}
function resetTimer(){clearInterval(timerHandle);timerRunning=false;timerWork=true;timerSeconds=1500;q('#timerStart').textContent='开始入定';q('#timerMode').textContent='修炼 · 25 分钟';renderTimer();}
function renderTimer(){q('#timerDisplay').textContent=`${String(Math.floor(timerSeconds/60)).padStart(2,'0')}:${String(timerSeconds%60).padStart(2,'0')}`;}
function renderTimerDots(){q('#timerDots').innerHTML=Array.from({length:8},(_,i)=>`<i class="${i<(state.timer.completed||0)%9?'done':''}"></i>`).join('');}

async function requestNotifications(){if(!('Notification'in window))return toast('当前浏览器不支持系统通知。');const p=await Notification.requestPermission();if(p==='granted'){new Notification('问道台提醒已开启',{body:`每日 ${state.profile.reminder} 提醒你如实结算。页面需保持打开。`});q('#notificationBtn').textContent='提醒已开启';}else toast('通知权限未开启。你仍会看到站内到期提示。');}
function scheduleReminder(){if(!('Notification' in window))return;setInterval(()=>{const n=new Date(),[h,m]=state.profile.reminder.split(':').map(Number);if(n.getHours()===h&&n.getMinutes()===m&&!state.records[todayKey()]&&Notification.permission==='granted')new Notification('该收功了',{body:'花三分钟如实结算今日修为。状态差也可以写。'});},60000);}
let activeBrowserDate=todayKey(),activeBrowserMinute='';
function syncBrowserTime(){
  const now=new Date(),date=todayKey(),minute=`${now.getHours()}:${now.getMinutes()}`;
  if(date!==activeBrowserDate){
    activeBrowserDate=date;
    state.draftUnits={deep:0,standard:0,light:0};
    state.survivalMode=false;
    state.timer.completed=0;
    saveState();renderAll();toast('已根据浏览器时间进入新的一天，今日任务与限额已自动刷新。');
    return;
  }
  renderBrowserClock();
  if(minute!==activeBrowserMinute){activeBrowserMinute=minute;renderDashboard();}
}
function startTimeSync(){
  syncBrowserTime();
  setInterval(syncBrowserTime,15000);
  window.addEventListener('focus',syncBrowserTime);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncBrowserTime();});
}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`问道台修行档案-${todayKey()}.json`;a.click();URL.revokeObjectURL(a.href);}
function importData(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{state=upgradeState(JSON.parse(reader.result),true);saveState();renderAll();toast('修行档案已恢复，并已同步最新英语校准状态。');}catch{toast('档案格式无法识别。');}};reader.readAsText(file);}
function resetData(){if(!confirm('确定清空全部日常记录？建议先导出备份。英语入宗校准状态会保留。'))return;state=defaultState();saveState();renderAll();toast('日常记录已清空，已回到当前校准基线：总修为45，英语45 E-XP。');}
function toast(msg){const t=q('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
function q(s){return document.querySelector(s)}function qa(s){return [...document.querySelectorAll(s)]}

try {
  initEvents();renderAll();renderTimer();scheduleReminder();startTimeSync();initPwa();initCloudSync();
  window.__WENDAO_BOOTED__=true;
} catch (error) {
  console.error('问道台启动失败', error);
  window.WendaoBootFail?.(error);
}
