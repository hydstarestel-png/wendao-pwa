(() => {
  const VERSION = '2026-07-09-study-time-lite-v1';
  const COLORS = ['#6ad49f', '#d7b46a', '#7ab7ff', '#c38bff', '#ff9f7a', '#77d7d0', '#f06f8f'];
  let installed = false;
  function boot() {
    if (installed) return;
    try {
      if (typeof state === 'undefined' || typeof saveState !== 'function' || typeof renderAll !== 'function') return setTimeout(boot, 120);
      if (state.featureFlags?.studyTimeReports === '2026-07-09-study-time-reports-v1') return;
    } catch { return setTimeout(boot, 120); }
    installed = true;
    installStyles();
    state.schemaVersion = Math.max(Number(state.schemaVersion) || 4, 7);
    state.studyTimeSettings = { enabled: true, defaultUnitMinutes: 25, ...(state.studyTimeSettings || {}) };
    state.featureFlags = { ...(state.featureFlags || {}), studyTimeReports: VERSION };
    normalizeAll();
    patchCustomTask();
    patchChartImport();
    patchTaskList();
    patchHistory();
    renderAll();
  }

  function patchCustomTask() {
    const grid = q('#customTaskForm .custom-task-form');
    if (grid && !q('#customTaskDuration')) {
      const subject = document.createElement('label');
      const duration = document.createElement('label');
      subject.innerHTML = '科目/领域<input name="studySubject" type="text" placeholder="例如：英语 / 哲学" />';
      duration.innerHTML = '学习时长<input id="customTaskDuration" name="durationMinutes" type="number" min="0" max="1440" step="5" placeholder="分钟；也可写在任务名里" />';
      grid.append(subject, duration);
    }
    saveCustomTask = function saveCustomTask() {
      const form = q('#customTaskForm');
      const values = Object.fromEntries(new FormData(form).entries());
      const info = parseStudy(values.name, values.durationMinutes);
      if (!info.name) return toast('请先填写任务名称。');
      const type = Object.hasOwn(taskXp, values.type) ? values.type : 'standard';
      const target = clamp(Number(values.target) || 1, 1, 18);
      const subject = String(values.studySubject || '').trim() || info.subject;
      const item = { id: `custom_${Date.now()}`, name: info.name, type, target, time: values.time || '自选', xp: taskXp[type], durationMinutes: info.minutes, studySubject: subject, meta: metaText('自定义', type, target, subject, info.minutes), custom: true };
      state.customTasks[todayKey()] = [...(state.customTasks[todayKey()] || []), item];
      saveState(); form.reset(); q('#customTaskDialog').close(); renderDashboard(); renderHistory();
      toast(info.minutes ? `自定义任务已加入：${subject} · ${formatMinutes(info.minutes)}。` : '自定义任务已加入今日修炼令。');
    };
  }

  function patchChartImport() {
    parseChartText = function parseChartText(text) {
      const timePattern = /(?:[01]?\d|2[0-3])[:：][0-5]\d/g;
      const rangePattern = /((?:[01]?\d|2[0-3])[:：][0-5]\d)\s*(?:-|—|~|～|至)\s*((?:[01]?\d|2[0-3])[:：][0-5]\d)/;
      const ignored = /^(星期|周)[一二三四五六日天]$|^(时间|节次|上午|下午|晚上|课程|任务|备注|时长|科目)$/;
      const seen = new Set(), items = [];
      String(text || '').split(/\r?\n/).map(line => line.replace(/[|｜]+/g, '｜').replace(/\s+/g, ' ').trim()).forEach(line => {
        if (line.length < 2 || ignored.test(line)) return;
        const range = line.match(rangePattern), times = line.match(timePattern) || [];
        const time = times[0] ? normalizeChartTime(times[0]) : '自选';
        const rangeMinutes = range ? minutesBetween(range[1], range[2]) : 0;
        let rawName = line.replace(rangePattern, ' ').replace(timePattern, ' ');
        rawName = rawName.replace(/^(?:星期|周)[一二三四五六日天]\s*/, '').replace(/^[\d一二三四五六七八九十]+[.、)）]\s*/, '').replace(/^(上午|下午|晚上)\s*/, '').replace(/\s*(教室|地点)[:：].*$/, '').trim();
        const info = parseStudy(rawName, extractDuration(line) || rangeMinutes);
        if (info.name.length < 2 || /^\d+$/.test(info.name)) return;
        const key = `${time}|${info.name}|${info.minutes}`;
        if (seen.has(key)) return;
        seen.add(key);
        const type = inferTaskType(info.name);
        let target = type === 'light' || type === 'foundation' ? 1 : 2;
        if (info.minutes) target = clamp(Math.round(info.minutes / 30) || 1, 1, 6);
        else if (rangeMinutes) target = clamp(Math.round(rangeMinutes / 25), 1, 6);
        items.push({ id: `candidate_${items.length}`, selected: true, name: info.name, time, type, target, durationMinutes: info.minutes, studySubject: info.subject });
      });
      return items.slice(0, 24);
    };
    importScheduleTasks = function importScheduleTasks() {
      const selected = scheduleCandidates.filter(item => item.selected && item.name.trim());
      if (!selected.length) return toast('请至少选择一项有效任务。');
      const stamp = Date.now();
      const tasks = selected.map((item, index) => {
        const info = parseStudy(item.name, item.durationMinutes);
        const type = Object.hasOwn(taskXp, item.type) ? item.type : 'standard';
        const target = clamp(Number(item.target) || 1, 1, 18);
        const subject = String(item.studySubject || '').trim() || info.subject;
        return { id: `chart_${stamp}_${index}`, name: info.name, type, target, time: item.time || '自选', xp: taskXp[type], durationMinutes: info.minutes, studySubject: subject, meta: metaText('图表导入', type, target, subject, info.minutes), custom: true };
      });
      state.customTasks[todayKey()] = [...(state.customTasks[todayKey()] || []), ...tasks];
      saveState(); q('#scheduleImportDialog').close(); renderDashboard(); renderHistory();
      toast(`已导入 ${tasks.length} 项；学习时长会在完成后进入报表。`);
    };
  }

  function patchTaskList() {
    renderTasks = function renderTasks() {
      normalizeDate(todayKey());
      const tasks = allTodayTasks(), log = taskDayLog(), stats = taskDayStats();
      const heading = q('#taskHeading'), hint = q('.task-card-actions>span'), taskList = q('#taskList'), alert = q('#alertStrip');
      if (heading) heading.textContent = '自主导入令';
      if (hint) hint.textContent = '任务可写“科目｜任务-30min / 2h”；完成后自动进入天、周、月时间统计';
      if (alert && !tasks.length) { alert.className = 'alert-strip good'; alert.innerHTML = '<span>今日修炼令已清空。你可以用“自定义修炼任务”或“识别课表 / 计划表”自主导入。</span><b>自主排程</b>'; }
      if (!taskList) return;
      taskList.innerHTML = tasks.length ? tasks.map(t => {
        const count = log[t.id] || 0, done = count >= t.target, overdue = isOverdue(t.time) && !done, study = taskStudy(t, count);
        return `<div class="task-practice-item ${done ? 'done' : ''} ${overdue ? 'overdue' : ''}"><header><div><span class="task-time">${html(t.time || '自选')}</span><b>${html(t.name)}</b></div><em>${t.xp ? `+${t.xp}/单元` : '非计分'}</em></header><p>${html(t.meta || `${typeName(t.type)} · 目标 ${t.target} 单元`)}${study ? ` · <span class="study-time-chip">${study}</span>` : ''}</p><div class="task-practice-controls"><button data-task-activity="${html(t.id)}" data-delta="-1">撤回</button><span>${count}/${t.target}</span><button data-task-activity="${html(t.id)}" data-delta="1">${t.xp ? '完成一单元' : '标记完成'}</button>${t.custom ? `<button class="delete-task" data-delete-task="${html(t.id)}" aria-label="删除${html(t.name)}">删除</button>` : ''}</div></div>`;
      }).join('') : '<div class="empty-task-state"><b>今日无预设修炼令</b><span>从课表、计划表或临时任务导入；写入学习时长后，报表会自动生成时间饼图。</span></div>';
      q('#todayGeneralXp').textContent = `今日 ${stats.xp} 修为`;
      q('#taskDoneCount').textContent = `${stats.units} / 18 单元`;
      q('#applySurvival').textContent = state.survivalMode ? '退出保命模式' : '切换最低保命日';
      qa('[data-task-activity]').forEach(btn => btn.onclick = () => updateTaskActivity(btn.dataset.taskActivity, Number(btn.dataset.delta)));
      qa('[data-delete-task]').forEach(btn => btn.onclick = () => deleteCustomTask(btn.dataset.deleteTask));
    };
  }

  function patchHistory() {
    const previous = renderHistory;
    renderHistory = function renderHistory() { previous(); ensureReportDom(); renderTimeReports(); };
  }
  function ensureReportDom() {
    if (q('#studyReportGrid')) return;
    const grid = document.createElement('div');
    grid.id = 'studyReportGrid';
    grid.className = 'report-grid study-report-grid';
    grid.innerHTML = `<article class="panel report-card study-report-card"><div class="card-heading"><div><p class="eyebrow">天报</p><h3>今日时间分布</h3></div><span id="studyDayRange" class="subtle-tag"></span></div><div id="studyDayReport"></div></article><article class="panel report-card study-report-card"><div class="card-heading"><div><p class="eyebrow">周报</p><h3>本周时间分布</h3></div><span id="studyWeekRange" class="subtle-tag"></span></div><div id="studyWeekReport"></div></article><article class="panel report-card study-report-card"><div class="card-heading"><div><p class="eyebrow">月报</p><h3>本月时间分布</h3></div><span id="studyMonthRange" class="subtle-tag"></span></div><div id="studyMonthReport"></div></article>`;
    (q('#reportGrid') || q('#history .section-intro'))?.after(grid);
  }
  function renderTimeReports() { renderPeriod([todayKey()], q('#studyDayReport'), q('#studyDayRange'), 'day'); renderPeriod(weekDays(), q('#studyWeekReport'), q('#studyWeekRange'), 'week'); renderPeriod(monthDays(), q('#studyMonthReport'), q('#studyMonthRange'), 'month'); }
  function renderPeriod(days, target, rangeNode, type) {
    if (!target) return;
    const stats = periodStats(days);
    rangeNode.textContent = type === 'day' ? todayKey().slice(5) : `${days[0]?.slice(5)} — ${days.at(-1)?.slice(5)}`;
    target.innerHTML = `<div class="study-total-row"><span>已完成学习时长</span><strong>${formatMinutes(stats.total)}</strong></div>${pie(stats)}${stats.missing ? `<div class="report-line warning-line"><b>未计时任务</b><span>${stats.missing} 项已完成任务缺少学习时长</span></div>` : ''}`;
  }

  function normalizeAll() { Object.keys(state.customTasks || {}).forEach(normalizeDate); }
  function normalizeDate(key) {
    if (!state.customTasks?.[key]) return;
    state.customTasks[key] = state.customTasks[key].map(t => {
      const info = parseStudy(t.name, t.durationMinutes ?? t.studyMinutes);
      const minutes = clamp(Number(t.durationMinutes ?? t.studyMinutes ?? info.minutes) || 0, 0, 1440);
      const subject = String(t.studySubject || info.subject || inferSubject(info.name || t.name)).trim() || '其他';
      return { ...t, name: info.name || t.name || '未命名任务', durationMinutes: minutes, studySubject: subject, meta: t.meta && /学习|时长|分钟|小时|h|min/.test(t.meta) ? t.meta : metaText(t.meta?.split(' · ')[0] || '任务', t.type, t.target, subject, minutes) };
    });
  }
  function parseStudy(raw, explicit = 0) {
    let text = String(raw || '').trim(), subject = '';
    const bracket = text.match(/^[\[【（(]\s*([^\]】）)｜|:：]{1,12})\s*[\]】）)]\s*(.+)$/);
    if (bracket) { subject = bracket[1].trim(); text = bracket[2].trim(); }
    const prefix = text.match(/^([^｜|:：]{1,12})\s*[｜|:：]\s*(.+)$/);
    if (prefix && !/^\d+$/.test(prefix[1]) && !/(上午|下午|晚上|时间|任务|课程)/.test(prefix[1])) { subject = subject || prefix[1].trim(); text = prefix[2].trim(); }
    const minutes = clamp(Number(explicit) || extractDuration(text) || 0, 0, 1440);
    const name = String(text || '').replace(durationPattern(), ' ').replace(/\b预计\b|学习时长|时长|用时/gi, ' ').replace(/\s*[-—–~～]\s*$/g, ' ').replace(/^\s*[-—–~～]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return { name, minutes, subject: subject || inferSubject(name) };
  }
  function durationPattern() { return /(\d+(?:\.\d+)?)\s*(小时|小時|钟头|鐘頭|hrs?|hours?|h|分钟|分鐘|mins?|m|分)(?=\s|$|[，,。；;、)\]】）]|[-—–~～])/gi; }
  function extractDuration(text) { let total = 0, hit = false; String(text || '').replace(durationPattern(), (_, value, unit) => { hit = true; total += /h|hr|hour|小时|小時|钟头|鐘頭|时/.test(unit.toLowerCase()) ? Number(value) * 60 : Number(value); return ''; }); return hit ? Math.round(total) : 0; }
  function minutesBetween(start, end) { const [sh, sm] = normalizeChartTime(start).split(':').map(Number), [eh, em] = normalizeChartTime(end).split(':').map(Number), minutes = (eh * 60 + em) - (sh * 60 + sm); return minutes > 0 ? minutes : 0; }
  function inferSubject(name) { const text = String(name || ''); if (/英语|英文|雅思|IELTS|听力|阅读|口语|写作|背词|背单词|单词|听脉|精听|泛听|dictation/i.test(text)) return '英语'; if (/哲学|哲学家|康德|黑格尔|柏拉图|亚里士多德|尼采|海德格尔|维特根斯坦|中国哲学史|西方哲学|伦理|形而上|美学|逻辑/i.test(text)) return '哲学'; if (/历史|通史|近代史|世界史|中国史|史纲/i.test(text)) return '历史'; if (/政治|马克思|马原|毛概|思修|法基|中特|政治学/i.test(text)) return '政治'; if (/数学|高数|线代|概率|统计|微积分|代数/i.test(text)) return '数学'; if (/专业课|论文|文献|研究|课题|考试|真题/i.test(text)) return '专业课'; if (/运动|跑步|健身|散步|祷告|读经|礼拜|默想|睡眠|起床/i.test(text)) return '道基'; return '其他'; }
  function dayStats(key) { normalizeDate(key); const bySubject = {}, details = [], log = state.taskActivityLogs?.[key] || {}; let missing = 0; (state.customTasks?.[key] || []).forEach(t => { const duration = Number(t.durationMinutes) || 0, count = Number(log[t.id]) || 0; if (!duration) { if (count > 0) missing += 1; return; } const target = Math.max(1, Number(t.target) || 1), minutes = Math.round(duration * clamp(count, 0, target) / target); if (minutes <= 0) return; const subject = t.studySubject || inferSubject(t.name); bySubject[subject] = (bySubject[subject] || 0) + minutes; details.push({ key, name: t.name, minutes }); }); return { total: Object.values(bySubject).reduce((a, b) => a + b, 0), bySubject, details, missing }; }
  function periodStats(days) { const out = { total: 0, bySubject: {}, details: [], missing: 0 }; days.forEach(key => { const s = dayStats(key); out.total += s.total; out.missing += s.missing; s.details.forEach(x => out.details.push(x)); Object.entries(s.bySubject).forEach(([k, v]) => out.bySubject[k] = (out.bySubject[k] || 0) + v); }); out.details.sort((a, b) => b.minutes - a.minutes); return out; }
  function pie(stats) { if (!stats.total) return `<div class="study-time-empty"><b>暂无学习时长</b><span>导入任务时写“英语｜背单词-30min”或填写学习时长，点完成后自动统计。</span></div>`; const entries = Object.entries(stats.bySubject).sort((a, b) => b[1] - a[1]); let cursor = 0; const gradient = entries.map(([_, minutes], i) => { const start = cursor, end = cursor + minutes / stats.total * 100; cursor = end; return `${COLORS[i % COLORS.length]} ${start.toFixed(2)}% ${end.toFixed(2)}%`; }).join(', '); const legend = entries.map(([subject, minutes], i) => `<div class="study-legend-item"><i style="background:${COLORS[i % COLORS.length]}"></i><span>${html(subject)}</span><b>${formatMinutes(minutes)} · ${Math.round(minutes / stats.total * 100)}%</b></div>`).join(''); const detail = stats.details.slice(0, 5).map(x => `${x.key.slice(5)} ${x.name} ${formatMinutes(x.minutes)}`).join('；'); return `<div class="study-pie-block"><div class="study-pie" style="background:conic-gradient(${gradient})"><span><strong>${formatMinutes(stats.total)}</strong><small>总学习</small></span></div><div class="study-legend">${legend}</div><p class="study-detail">${html(detail || '暂无任务明细')}</p></div>`; }
  function taskStudy(t, count = 0) { const minutes = Number(t.durationMinutes) || 0; if (!minutes) return ''; const target = Math.max(1, Number(t.target) || 1), done = Math.round(minutes * clamp(Number(count) || 0, 0, target) / target); return `${html(t.studySubject || inferSubject(t.name))} · ${done ? `已计 ${formatMinutes(done)} / ` : ''}预计 ${html(formatMinutes(minutes))}`; }
  function metaText(source, type, target, subject, minutes) { return [source || '任务', typeName(type), `目标 ${target || 1} 单元`, subject, minutes ? `预计 ${formatMinutes(minutes)}` : ''].filter(Boolean).join(' · '); }
  function weekDays() { const now = new Date(), monday = new Date(now), day = now.getDay() || 7; monday.setDate(now.getDate() - day + 1); return Array.from({ length: 7 }, (_, i) => dateKey(addDate(monday, i))); }
  function monthDays() { const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1), last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); return Array.from({ length: last }, (_, i) => dateKey(addDate(first, i))); }
  function addDate(date, amount) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
  function dateKey(date) { return date.toLocaleDateString('sv-SE'); }
  function typeName(type) { return (typeof taskTypeNames !== 'undefined' ? taskTypeNames : { deep: '深度', standard: '标准', light: '轻度', foundation: '道基' })[type] || '标准'; }
  function formatMinutes(minutes) { const value = Math.max(0, Math.round(Number(minutes) || 0)); if (value >= 60) { const h = Math.floor(value / 60), m = value % 60; return m ? `${h}小时${m}分` : `${h}小时`; } return `${value}分钟`; }
  function html(value) { return typeof escapeHtml === 'function' ? escapeHtml(value) : String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function installStyles() { if (document.getElementById('studyTimeOverrideStyles')) return; const style = document.createElement('style'); style.id = 'studyTimeOverrideStyles'; style.textContent = `.study-time-chip{color:var(--jade-bright)}.study-report-grid{margin-top:18px}.study-total-row{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.08)}.study-total-row span{color:var(--muted);font-size:9px}.study-total-row strong{font:20px Georgia,serif;color:#e2eee7}.study-pie-block{display:grid;grid-template-columns:128px minmax(0,1fr);gap:14px;align-items:center;margin:12px 0 14px;padding:12px;border:1px solid rgba(106,212,159,.14);border-radius:16px;background:rgba(106,212,159,.035)}.study-pie{width:128px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;position:relative;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}.study-pie::after{content:"";position:absolute;inset:24px;border-radius:50%;background:var(--panel);box-shadow:0 0 0 1px rgba(255,255,255,.05)}.study-pie span{position:relative;z-index:1;display:grid;gap:2px;text-align:center}.study-pie strong{font:17px Georgia,serif;color:#eaf7f0}.study-pie small{color:var(--muted);font-size:8px}.study-legend{display:grid;gap:7px}.study-legend-item{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:center;font-size:10px;color:#cde2d7}.study-legend-item i{width:10px;height:10px;border-radius:99px}.study-legend-item b{font-weight:500;color:var(--muted)}.study-detail{grid-column:1/-1;margin:0;color:var(--muted);font-size:9px;line-height:1.6}.study-time-empty{margin:12px 0 14px;padding:16px;border:1px dashed var(--line);border-radius:14px;background:rgba(255,255,255,.025);display:grid;gap:6px;color:var(--muted)}.study-time-empty b{color:var(--jade-bright);font-size:13px}.warning-line span{color:#e0bd7a}@media(max-width:720px){.study-pie-block{grid-template-columns:1fr}.study-pie{margin:auto}}`; document.head.appendChild(style); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
