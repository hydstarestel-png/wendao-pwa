(() => {
  const FEATURE_VERSION = '2026-07-07-foundation-reports-v1';
  const FOUNDATION_PENALTY_XP = 12;
  const SEALS = [
    ['timely', '守时印', '23:00 上床 · 07:30 起床'],
    ['clear', '清心印', '专注无手机 · 信息流不超额'],
    ['body', '强体印', '运动 30—50 分钟'],
    ['spirit', '定神印', '读经祷告或默想 ≥ 20 分钟'],
  ];
  let installed = false;
  let lastPenaltyCheckDate = '';

  function boot() {
    if (installed) return;
    try {
      if (typeof state === 'undefined' || typeof saveState !== 'function' || typeof renderAll !== 'function') {
        setTimeout(boot, 120);
        return;
      }
    } catch {
      setTimeout(boot, 120);
      return;
    }

    installed = true;
    installStyles();
    installFeatureState();
    overrideDailyTasks();
    overrideTaskRendering();
    overrideFoundations();
    overrideCheckin();
    overrideHistoryReports();
    installPenaltyClock();
    const penalties = applyFoundationPenalty();
    if (penalties.length) {
      saveState();
      toast(`根基松动：累计 ${penalties.length * 3} 个未圆满道基日，修为小退 ${penalties.reduce((sum, item) => sum + item.deduct, 0)}。`);
    }
    renderAll();
  }

  function installFeatureState() {
    state.schemaVersion = Math.max(Number(state.schemaVersion) || 4, 6);
    state.foundationPenaltyLog = state.foundationPenaltyLog || {};
    state.foundationPenaltyStartDate = state.foundationPenaltyStartDate || todayKey();
    state.featureFlags = { ...(state.featureFlags || {}), autonomousDailyTasks: true, foundationReports: FEATURE_VERSION };
  }

  function overrideDailyTasks() {
    dailyTasks = function dailyTasks() {
      return [];
    };
  }

  function overrideTaskRendering() {
    renderTasks = function renderTasks() {
      const tasks = allTodayTasks();
      const log = taskDayLog();
      const stats = taskDayStats();
      const taskList = q('#taskList');
      const heading = q('#taskHeading');
      const hint = q('.task-card-actions>span');
      const alert = q('#alertStrip');
      if (heading) heading.textContent = '自主导入令';
      if (hint) hint.textContent = '每日任务由你自定义或识别课表导入；深度 +12 · 标准 +10 · 轻度 +6 · 封顶 18 单元 / 180 修为';

      if (alert && !tasks.length) {
        alert.className = 'alert-strip good';
        alert.innerHTML = '<span>今日修炼令已清空。你可以用“自定义修炼任务”或“识别课表 / 计划表”自主导入。</span><b>自主排程</b>';
      }

      if (!taskList) return;
      taskList.innerHTML = tasks.length ? tasks.map(t => {
        const count = log[t.id] || 0;
        const done = count >= t.target;
        const overdue = isOverdue(t.time) && !done;
        const isCustom = t.custom;
        return `<div class="task-practice-item ${done ? 'done' : ''} ${overdue ? 'overdue' : ''}">
          <header><div><span class="task-time">${html(t.time || '自选')}</span><b>${html(t.name)}</b></div><em>${t.xp ? `+${t.xp}/单元` : '非计分'}</em></header>
          <p>${html(t.meta || `${taskTypeName(t.type)} · 目标 ${t.target} 单元`)}</p>
          <div class="task-practice-controls"><button data-task-activity="${html(t.id)}" data-delta="-1">撤回</button><span>${count}/${t.target}</span><button data-task-activity="${html(t.id)}" data-delta="1">${t.xp ? '完成一单元' : '标记完成'}</button>${isCustom ? `<button class="delete-task" data-delete-task="${html(t.id)}" aria-label="删除${html(t.name)}">删除</button>` : ''}</div>
        </div>`;
      }).join('') : '<div class="empty-task-state"><b>今日无预设修炼令</b><span>从课表、计划表或临时任务导入，完成后仍会即时增加修为。</span></div>';

      q('#todayGeneralXp').textContent = `今日 ${stats.xp} 修为`;
      q('#taskDoneCount').textContent = `${stats.units} / 18 单元`;
      q('#applySurvival').textContent = state.survivalMode ? '退出保命模式' : '切换最低保命日';
      qa('[data-task-activity]').forEach(btn => btn.onclick = () => updateTaskActivity(btn.dataset.taskActivity, Number(btn.dataset.delta)));
      qa('[data-delete-task]').forEach(btn => btn.onclick = () => deleteCustomTask(btn.dataset.deleteTask));
    };

    countOverdue = function countOverdue() {
      const log = state.taskActivityLogs[todayKey()] || {};
      return allTodayTasks().filter(t => (log[t.id] || 0) < t.target && isOverdue(t.time)).length;
    };
  }

  function overrideFoundations() {
    renderFoundations = function renderFoundations() {
      const key = todayKey();
      state.foundations[key] = normalizeMarks(state.foundations[key] || {});
      const day = state.foundations[key];
      const doneCount = foundationScoreForDate(key);
      const list = q('#foundationList');
      if (!list) return;
      list.innerHTML = SEALS.map(([id, name, desc]) => `<button class="foundation-seal required ${day[id] ? 'done' : ''}" data-foundation="${id}">
        <b>${name}</b><span>${desc}</span><em>${day[id] ? '已稳固' : '今日必做'}</em>
      </button>`).join('');
      q('#foundationScore').textContent = `${doneCount}/4`;
      ensureFoundationDebtNode().innerHTML = foundationDebtText();
      qa('[data-foundation]').forEach(button => {
        button.onclick = () => {
          const id = button.dataset.foundation;
          const marks = normalizeMarks(state.foundations[todayKey()] || {});
          marks[id] = !marks[id];
          state.foundations[todayKey()] = marks;
          if (state.records[todayKey()]) state.records[todayKey()].foundationScore = Object.values(marks).filter(Boolean).length;
          saveState();
          renderDashboard();
          renderHistory();
          const score = foundationScoreForDate(todayKey());
          toast(score === 4 ? '今日四印圆满，根基稳固。' : `道基 ${score}/4：四印每日必做，三日未圆满会小幅倒退。`);
        };
      });
    };
  }

  function overrideCheckin() {
    previewCheckin = function previewCheckin() {
      const stats = taskDayStats();
      const existing = state.records[todayKey()];
      const dao = foundationScoreForDate(todayKey());
      q('#checkinPreview').textContent = `今日任务已即时记录 ${existing?.units ?? stats.units} 个计分单元、${existing?.xp ?? stats.xp} 修为。道基四印当前 ${dao}/4，由首页按钮即时记录，不再由复盘表单推算。`;
    };

    saveCheckin = function saveCheckin() {
      const form = q('#checkinForm');
      const v = Object.fromEntries(new FormData(form).entries());
      const stats = taskDayStats();
      const previous = state.records[todayKey()] || {};
      const marks = normalizeMarks(state.foundations[todayKey()] || {});
      const foundationScore = Object.values(marks).filter(Boolean).length;
      state.foundations[todayKey()] = marks;
      state.tasks[todayKey()] = { ...(state.tasks[todayKey()] || {}), review: true };
      state.records[todayKey()] = {
        ...previous,
        ...v,
        units: previous.units ?? stats.units,
        xp: previous.xp ?? stats.xp,
        energy: +v.energy,
        exerciseMinutes: +v.exerciseMinutes,
        prayerMinutes: +v.prayerMinutes,
        gameMinutes: +v.gameMinutes,
        socialMinutes: +v.socialMinutes,
        foundationScore,
        survivalMode: !!v.survivalMode,
        phoneAway: !!v.phoneAway,
        reviewedAt: new Date().toLocaleString('zh-CN'),
      };
      state.survivalMode = !!v.survivalMode;
      saveState();
      q('#checkinDialog').close();
      renderAll();
      toast(`今日复盘已写入修行簿，道基 ${foundationScore}/4。`);
    };
  }

  function overrideHistoryReports() {
    const originalRenderHistory = renderHistory;
    renderHistory = function renderHistory() {
      ensureReportDom();
      originalRenderHistory();
      renderReports();
    };
  }

  function installPenaltyClock() {
    lastPenaltyCheckDate = todayKey();
    setInterval(() => {
      const now = todayKey();
      if (now === lastPenaltyCheckDate) return;
      lastPenaltyCheckDate = now;
      const penalties = applyFoundationPenalty();
      if (penalties.length) {
        saveState();
        renderAll();
        toast(`根基松动：修为小退 ${penalties.reduce((sum, item) => sum + item.deduct, 0)}。`);
      }
    }, 60000);
  }

  function applyFoundationPenalty() {
    state.foundationPenaltyLog = state.foundationPenaltyLog || {};
    const start = state.foundationPenaltyStartDate || todayKey();
    const end = addDays(todayKey(), -1);
    if (start > end) return [];
    const missed = dateRange(start, end).filter(key => foundationScoreForDate(key) < 4);
    const due = Math.floor(missed.length / 3);
    const logKeys = Object.keys(state.foundationPenaltyLog).filter(key => key.startsWith('foundation_debt_'));
    const added = [];
    for (let index = logKeys.length; index < due; index++) {
      const batch = missed.slice(index * 3, index * 3 + 3);
      const deduct = Math.min(FOUNDATION_PENALTY_XP, Math.max(0, (Number(state.totalXp) || 0) - 45));
      state.totalXp = Math.max(45, (Number(state.totalXp) || 0) - deduct);
      const key = `foundation_debt_${index + 1}`;
      state.foundationPenaltyLog[key] = {
        appliedAt: new Date().toISOString(),
        triggerDate: batch.at(-1),
        missedDays: batch,
        xp: -deduct,
      };
      added.push({ key, deduct, days: batch });
    }
    return added;
  }

  function foundationDebtText() {
    const start = state.foundationPenaltyStartDate || todayKey();
    const end = addDays(todayKey(), -1);
    const missed = start <= end ? dateRange(start, end).filter(key => foundationScoreForDate(key) < 4) : [];
    const remainder = missed.length % 3;
    const next = remainder === 0 ? 3 : 3 - remainder;
    const penalties = Object.values(state.foundationPenaltyLog || {}).filter(item => item && item.xp < 0);
    const total = penalties.reduce((sum, item) => sum + Math.abs(item.xp || 0), 0);
    return `<b>根基律：</b>四印每日必做。未圆满日累计 ${remainder}/3；再 ${next} 个未圆满日触发根基松动（-${FOUNDATION_PENALTY_XP} 修为）。已小退 ${total} 修为。`;
  }

  function ensureFoundationDebtNode() {
    let node = q('#foundationDebtStatus');
    if (!node) {
      node = document.createElement('p');
      node.id = 'foundationDebtStatus';
      node.className = 'foundation-debt muted small';
      q('#foundationList')?.after(node);
    }
    return node;
  }

  function ensureReportDom() {
    if (q('#reportGrid')) return;
    const intro = q('#history .section-intro');
    const grid = document.createElement('div');
    grid.id = 'reportGrid';
    grid.className = 'report-grid';
    grid.innerHTML = `
      <article class="panel report-card"><div class="card-heading"><div><p class="eyebrow">周报</p><h3>本周修行报告</h3></div><span id="weeklyRange" class="subtle-tag"></span></div><div id="weeklyReport" class="report-body"></div></article>
      <article class="panel report-card"><div class="card-heading"><div><p class="eyebrow">月报</p><h3>本月修行报告</h3></div><span id="monthlyRange" class="subtle-tag"></span></div><div id="monthlyReport" class="report-body"></div></article>`;
    intro?.after(grid);
  }

  function renderReports() {
    renderPeriodReport('week', q('#weeklyReport'), q('#weeklyRange'));
    renderPeriodReport('month', q('#monthlyReport'), q('#monthlyRange'));
  }

  function renderPeriodReport(type, target, rangeNode) {
    if (!target) return;
    const days = type === 'week' ? currentWeekDays() : currentMonthDays();
    const stats = days.reduce((acc, key) => {
      const xp = dayXp(key), units = dayUnits(key), dao = foundationScoreForDate(key);
      acc.xp += xp; acc.units += units; acc.dao += dao; acc.fullDao += dao === 4 ? 1 : 0;
      acc.recordDays += state.records[key] ? 1 : 0;
      acc.activeDays += hasActivity(key) ? 1 : 0;
      if (xp > acc.best.xp) acc.best = { key, xp };
      return acc;
    }, { xp: 0, units: 0, dao: 0, fullDao: 0, recordDays: 0, activeDays: 0, best: { key: '', xp: -1 } });
    const penalties = Object.values(state.foundationPenaltyLog || {}).filter(item => item?.triggerDate && days.includes(item.triggerDate));
    const avgDao = days.length ? (stats.dao / days.length).toFixed(1) : '0.0';
    const bestText = stats.best.xp > 0 ? `${stats.best.key.slice(5)} · +${stats.best.xp}` : '暂无高峰日';
    const advice = reportAdvice(type, stats, avgDao, penalties);
    if (rangeNode) rangeNode.textContent = `${days[0]?.slice(5)} — ${days.at(-1)?.slice(5)}`;
    target.innerHTML = `
      <div class="report-stats">
        <div><span>修为</span><strong>${stats.xp}</strong></div>
        <div><span>单元</span><strong>${stats.units}</strong></div>
        <div><span>平均道基</span><strong>${avgDao}/4</strong></div>
        <div><span>复盘日</span><strong>${stats.recordDays}/${days.length}</strong></div>
      </div>
      <div class="report-line"><b>最佳一日</b><span>${bestText}</span></div>
      <div class="report-line"><b>四印圆满</b><span>${stats.fullDao}/${days.length} 日</span></div>
      <div class="report-line"><b>根基松动</b><span>${penalties.length ? penalties.map(p => `${p.triggerDate?.slice(5)} ${p.xp}修为`).join('；') : '本期未触发'}</span></div>
      <p class="report-advice">${advice}</p>`;
  }

  function reportAdvice(type, stats, avgDao, penalties) {
    if (penalties.length) return '本期主要问题不是强度，而是根基连续性。先把四印恢复到每日圆满，再谈加量。';
    if (Number(avgDao) < 3) return '道基偏虚：睡眠、清心、运动、灵修至少补齐三项，任务量可以少一点。';
    if (stats.units === 0) return `${type === 'week' ? '本周' : '本月'}还没有计分修炼令。继续用课表/计划表导入，别让系统替你编任务。`;
    if (stats.recordDays < Math.ceil((type === 'week' ? 7 : currentMonthDays().length) * 0.5)) return '复盘记录偏少。每天不必写长，但至少留下真实状态，后面月报才有意义。';
    return '节奏可维持。下一步不是硬堆时间，而是提高单元质量：少开新坑，多做复述、输出和错因归档。';
  }

  function dayXp(key) {
    if (state.records[key]?.xp != null) return Number(state.records[key].xp) || 0;
    if (key === todayKey()) return taskDayStats().xp;
    const log = state.taskActivityLogs[key] || {};
    const tasks = state.customTasks[key] || [];
    return tasks.reduce((sum, task) => sum + (log[task.id] || 0) * (task.xp || 0), 0);
  }

  function dayUnits(key) {
    if (state.records[key]?.units != null) return Number(state.records[key].units) || 0;
    if (key === todayKey()) return taskDayStats().units;
    const log = state.taskActivityLogs[key] || {};
    const tasks = state.customTasks[key] || [];
    return tasks.reduce((sum, task) => sum + ((task.xp || 0) > 0 ? (log[task.id] || 0) : 0), 0);
  }

  function hasActivity(key) {
    return !!state.records[key] || Object.keys(state.taskActivityLogs[key] || {}).length > 0 || Object.keys(state.foundations[key] || {}).length > 0;
  }

  function foundationScoreForDate(key) {
    const marks = state.foundations?.[key];
    if (marks && Object.keys(marks).length) return SEALS.reduce((sum, [id]) => sum + (marks[id] ? 1 : 0), 0);
    if (state.records?.[key]?.foundationScore != null) return Number(state.records[key].foundationScore) || 0;
    return 0;
  }

  function normalizeMarks(marks) {
    return SEALS.reduce((acc, [id]) => ({ ...acc, [id]: !!marks[id] }), {});
  }

  function currentWeekDays() {
    const now = new Date();
    const monday = new Date(now);
    const day = now.getDay() || 7;
    monday.setDate(now.getDate() - day + 1);
    return Array.from({ length: 7 }, (_, index) => dateKey(addDate(monday, index)));
  }

  function currentMonthDays() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Array.from({ length: last }, (_, index) => dateKey(addDate(first, index)));
  }

  function dateRange(start, end) {
    const result = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) result.push(cursor);
    return result;
  }

  function addDays(key, amount) {
    return dateKey(addDate(new Date(key + 'T00:00:00'), amount));
  }

  function addDate(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function dateKey(date) {
    return date.toLocaleDateString('sv-SE');
  }

  function taskTypeName(type) {
    const names = typeof taskTypeNames !== 'undefined' ? taskTypeNames : { deep: '深度', standard: '标准', light: '轻度', foundation: '道基' };
    return names[type] || '标准';
  }

  function html(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function installStyles() {
    if (document.getElementById('featureOverrideStyles')) return;
    const style = document.createElement('style');
    style.id = 'featureOverrideStyles';
    style.textContent = `
      .empty-task-state{grid-column:1/-1;padding:24px;border:1px dashed var(--line);border-radius:15px;background:rgba(106,212,159,.025);display:grid;gap:6px;text-align:center;color:#b9d8c8}
      .empty-task-state b{font:18px "STKaiti",serif;color:var(--jade-bright)}
      .empty-task-state span{font-size:10px;color:var(--muted)}
      .foundation-seal.required{position:relative}
      .foundation-seal em{display:inline-block;margin-top:8px;color:var(--gold);font-size:8px;font-style:normal}
      .foundation-seal.done em{color:var(--jade-bright)}
      .foundation-debt{margin-top:10px;padding:10px 11px;border:1px solid rgba(215,180,106,.16);border-radius:10px;background:rgba(215,180,106,.035);line-height:1.55}
      .foundation-debt b{color:#dbc28b}
      .report-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-bottom:18px}
      .report-card{background:radial-gradient(circle at 100% 0,rgba(106,212,159,.07),transparent 45%),var(--panel)}
      .report-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}
      .report-stats div{padding:12px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.08)}
      .report-stats span,.report-stats strong{display:block}
      .report-stats span{color:var(--muted);font-size:8px}
      .report-stats strong{margin-top:6px;font:20px Georgia,serif;color:#e2eee7}
      .report-line{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:10px}
      .report-line b{color:#cce2d7}.report-line span{color:var(--muted);text-align:right}
      .report-advice{margin:12px 0 0;padding:12px;border-left:2px solid var(--gold);border-radius:0 10px 10px 0;background:rgba(215,180,106,.04);color:#c8b895;font:12px/1.7 "STKaiti",serif}
      @media(max-width:720px){.report-grid,.report-stats{grid-template-columns:1fr}.report-line{display:grid}.report-line span{text-align:left}}
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
