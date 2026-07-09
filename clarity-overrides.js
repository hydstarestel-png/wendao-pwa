(() => {
  const VERSION = '2026-07-09-clarity-ledger-v2';
  const SEALS = ['timely', 'clear', 'body', 'spirit'];
  let installed = false;

  function boot(started = Date.now()) {
    if (installed) return;
    try {
      if (typeof state === 'undefined' || typeof saveState !== 'function' || typeof renderDashboard !== 'function' || typeof renderHistory !== 'function' || typeof phaseInfo !== 'function' || typeof taskDayStats !== 'function' || typeof q !== 'function') {
        setTimeout(() => boot(started), 120);
        return;
      }
      if (!state.featureFlags?.foundationReports && Date.now() - started < 2500) {
        setTimeout(() => boot(started), 120);
        return;
      }
    } catch {
      setTimeout(() => boot(started), 120);
      return;
    }
    installed = true;
    installState();
    installStyles();
    overrideLimits();
    patchCheckin();
    wrapDashboard();
    updateClearSeal(false);
    renderDashboard();
    renderHistory();
  }

  function installState() {
    state.schemaVersion = Math.max(Number(state.schemaVersion) || 7, 8);
    state.digitalLimits = state.digitalLimits || {};
    state.motivationLog = state.motivationLog || {};
    state.featureFlags = { ...(state.featureFlags || {}), clarityLedger: VERSION, dailyProgressVision: VERSION };
  }

  function currentLimits() {
    const phase = phaseInfo();
    return { label: phase.label, game: state.survivalMode ? 30 : phase.game, social: phase.social, study: Math.max(60, (Number(phase.hours) || 5) * 60) };
  }

  function digital(key = todayKey()) {
    state.digitalLimits = state.digitalLimits || {};
    const saved = state.digitalLimits[key] || {};
    const record = state.records?.[key] || {};
    return {
      gameMinutes: min(saved.gameMinutes ?? record.gameMinutes ?? 0),
      socialMinutes: min(saved.socialMinutes ?? record.socialMinutes ?? 0),
      phoneAway: saved.phoneAway ?? !!record.phoneAway,
      logs: Array.isArray(saved.logs) ? saved.logs : [],
      updatedAt: saved.updatedAt || record.reviewedAt || '',
    };
  }

  function min(value) { return Math.max(0, Math.round(Number(value) || 0)); }
  function percent(value, target) { return clamp(target > 0 ? Number(value || 0) / target * 100 : 0, 0, 100); }
  function fmt(minutes) { const v = min(minutes); if (v >= 60) { const h = Math.floor(v / 60), m = v % 60; return m ? `${h}小时${m}分` : `${h}小时`; } return `${v}分钟`; }
  function html(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }

  function studyStats(key = todayKey()) {
    const bySubject = {}, details = [], log = state.taskActivityLogs?.[key] || {};
    (state.customTasks?.[key] || []).forEach(task => {
      const duration = Number(task.durationMinutes ?? task.studyMinutes) || 0;
      const count = Number(log[task.id]) || 0;
      if (!duration || !count) return;
      const target = Math.max(1, Number(task.target) || 1);
      const minutes = Math.round(duration * clamp(count, 0, target) / target);
      if (minutes <= 0) return;
      const subject = String(task.studySubject || inferSubject(task.name)).trim() || '其他';
      bySubject[subject] = (bySubject[subject] || 0) + minutes;
      details.push({ subject, name: task.name || subject, minutes });
    });
    if (!Object.keys(bySubject).length && state.records?.[key]?.studyTimeBySubject) {
      Object.entries(state.records[key].studyTimeBySubject).forEach(([subject, minutes]) => {
        const value = Number(minutes) || 0;
        if (value > 0) { bySubject[subject] = value; details.push({ subject, name: `${subject}存档`, minutes: value }); }
      });
    }
    return { total: Object.values(bySubject).reduce((sum, v) => sum + v, 0), bySubject, details };
  }

  function inferSubject(name) {
    const text = String(name || '');
    if (/英语|雅思|听力|单词|魔戒|口语|写作/i.test(text)) return '英语';
    if (/哲学|中哲|西哲|原著|思想|史/i.test(text)) return '哲学';
    if (/政治|肖|马原|毛中特|史纲|思修/i.test(text)) return '政治';
    if (/运动|跑|健身|散步/i.test(text)) return '身体';
    if (/读经|祷告|默想|灵修/i.test(text)) return '灵修';
    return '其他';
  }

  function daoScore() {
    const marks = state.foundations?.[todayKey()] || {};
    return SEALS.reduce((sum, id) => sum + (marks[id] ? 1 : 0), 0);
  }

  function isClear(data = digital(), lim = currentLimits()) {
    return !!data.phoneAway && data.gameMinutes <= lim.game && data.socialMinutes <= lim.social;
  }

  function updateClearSeal(shouldSave = true) {
    const key = todayKey();
    const marks = { ...(state.foundations?.[key] || {}) };
    marks.clear = isClear();
    state.foundations[key] = marks;
    if (state.records?.[key]) state.records[key].foundationScore = Object.values(marks).filter(Boolean).length;
    if (shouldSave) saveState();
  }

  function wrapDashboard() {
    if (renderDashboard.wendaoClarityPatched) return;
    const base = renderDashboard;
    renderDashboard = function patchedRenderDashboard(...args) {
      const result = base.apply(this, args);
      renderProgressPanel();
      return result;
    };
    renderDashboard.wendaoClarityPatched = true;
  }

  function renderProgressPanel() {
    const grid = q('.dashboard-grid'), taskCard = q('.tasks-card');
    if (!grid || !taskCard) return;
    let panel = q('#dailyProgressPanel');
    if (!panel) { panel = document.createElement('article'); panel.id = 'dailyProgressPanel'; panel.className = 'panel span-2 daily-progress-panel'; grid.insertBefore(panel, taskCard); }
    const phase = phaseInfo(), tasks = taskDayStats(), study = studyStats(), lim = currentLimits(), d = digital(), dao = daoScore(), clear = isClear(d, lim);
    const used = d.gameMinutes + d.socialMinutes, budget = Math.max(1, lim.game + lim.social);
    const clearScore = clear ? Math.max(0, 100 - percent(used, budget)) : Math.max(0, 100 - percent(used, budget));
    const score = Math.round(percent(tasks.units, 12) * .22 + percent(tasks.xp, 120) * .18 + percent(study.total, lim.study) * .24 + percent(dao, 4) * .22 + (clear ? 100 : clearScore) * .14);
    const title = titleFor(score, clear, dao, tasks.units);
    state.motivationLog[todayKey()] = { score, title, updatedAt: new Date().toISOString() };
    const metrics = [
      ['修为', tasks.xp, 180, percent(tasks.xp, 180), 'jade'],
      ['单元', tasks.units, 18, percent(tasks.units, 18), 'gold'],
      ['学习', fmt(study.total), fmt(lim.study), percent(study.total, lim.study), 'blue'],
      ['道基', dao, '4印', percent(dao, 4), 'violet'],
      ['清心', clear ? '稳' : '警', '戒', clearScore, clear ? 'jade' : 'ember'],
    ];
    panel.innerHTML = `<div class="card-heading"><div><p class="eyebrow">今日进度 · 视觉总览</p><h3>${html(title)}</h3></div><span class="subtle-tag">心境 ${score}/100</span></div><div class="daily-progress-orbits">${metrics.map(([name, value, target, p, tone]) => orb(name, value, target, p, tone)).join('')}</div><div class="daily-progress-path"><div class="daily-path-head"><b>下一步</b><span>${html(nextAction({ tasks, study, lim, d, dao, clear }))}</span></div><div class="daily-path-bar"><i style="width:${clamp(score, 2, 100)}%"></i></div></div><div class="daily-reward-row">${chips({ score, clear, dao, tasks, study }).map(x => `<span class="${x.on ? 'on' : ''}">${html(x.text)}</span>`).join('')}</div>`;
  }

  function orb(name, value, target, p, tone) { return `<div class="progress-orb ${tone}" style="--p:${clamp(Number(p) || 0, 0, 100)}%"><div class="progress-orb-ring"><b>${html(value)}</b><small>/ ${html(target)}</small></div><span>${html(name)}</span></div>`; }
  function titleFor(score, clear, dao, units) { if (!clear) return '清心有漏，先止损再推进'; if (score >= 90) return '今日气脉大顺'; if (score >= 72) return '修行入流，继续推进'; if (score >= 52) return '道火已燃，稳住节奏'; if (dao >= 3 && !units) return '道基已立，开第一单元'; return '先起一念，完成最小一笔'; }
  function nextAction(ctx) { if (!ctx.clear) { if (ctx.d.gameMinutes > ctx.lim.game) return '游戏已超额：今天不再加时，后续休息改成离屏恢复。'; if (ctx.d.socialMinutes > ctx.lim.social) return '手机信息流已超额：先把手机离手，下一段只做一个小任务。'; return '勾选“手机不在手边”，清心印才算稳。'; } if (ctx.dao < 4) return `道基还差 ${4 - ctx.dao} 印，先补睡眠、运动、灵修或清心。`; if (ctx.study.total < ctx.lim.study * .5) return `学习时间还浅，先完成一个 25 分钟单元。当前 ${fmt(ctx.study.total)}。`; if (ctx.tasks.units < 6) return '今日计分单元偏少，选一项最小任务推进。'; return '保持当前节奏，收尾时写复盘，不要临睡前刷手机。'; }
  function chips(ctx) { return [{ text: '清心无漏', on: ctx.clear }, { text: '道基圆满', on: ctx.dao >= 4 }, { text: '入定三轮', on: ctx.tasks.units >= 3 }, { text: '精进六轮', on: ctx.tasks.units >= 6 }, { text: `学习${fmt(ctx.study.total)}`, on: ctx.study.total > 0 }, { text: '今日上品', on: ctx.score >= 80 }]; }

  function overrideLimits() {
    renderLimits = function renderLimits() {
      const lim = currentLimits(), d = digital(), clear = isClear(d, lim), wrap = q('#limitMeters');
      if (!wrap) return;
      const tag = q('#digitalPhase'); if (tag) tag.textContent = `${lim.label} · 清心印${clear ? '稳固' : '未稳'}`;
      wrap.innerHTML = `${meter('游戏', d.gameMinutes, lim.game)}${meter('手机 / 信息流', d.socialMinutes, lim.social)}<section class="clarity-ledger ${clear ? 'stable' : 'unstable'}"><header><div><b>清心即时登记</b><span>${statusText(d, lim)}</span></div><em>${d.logs.length} 笔</em></header><div class="clarity-input-grid"><label>本次游戏<input id="clarityGameInput" type="number" min="0" inputmode="numeric" placeholder="分钟" /></label><label>本次手机<input id="clarityPhoneInput" type="number" min="0" inputmode="numeric" placeholder="分钟" /></label><button id="clarityAddEntry" type="button" class="primary-btn">记一笔</button></div><div class="clarity-quick-row"><button type="button" data-clarity="game:15">游戏 +15</button><button type="button" data-clarity="game:30">游戏 +30</button><button type="button" data-clarity="social:10">手机 +10</button><button type="button" data-clarity="social:30">手机 +30</button></div><label class="clarity-away"><input id="clarityPhoneAway" type="checkbox" ${d.phoneAway ? 'checked' : ''}/> 专注时手机不在手边</label><div class="clarity-ledger-actions"><button id="clarityUndoEntry" type="button" class="ghost-btn" ${d.logs.length ? '' : 'disabled'}>撤回上一笔</button><button id="clarityResetDay" type="button" class="ghost-btn danger">清零今日</button></div><p class="muted clarity-note">这里记录今日累计消耗；复盘时会自动带入游戏和手机分钟。</p></section>`;
      bindControls();
    };
  }

  function meter(name, value, limit) { const p = percent(value, limit), over = value > limit; return `<div class="limit-meter clarity-meter"><div class="limit-row"><span>${name}</span><span>${value} / ${limit} 分钟</span></div><div class="meter"><i class="${p > 90 ? 'warning' : ''} ${over ? 'over' : ''}" style="width:${p}%"></i></div><small class="${over ? 'clarity-danger' : 'muted'}">${over ? `超出 ${fmt(value - limit)}` : `剩余 ${fmt(limit - value)}`}</small></div>`; }
  function statusText(d, lim) { if (!d.phoneAway) return '清心印未稳：请确认专注时手机离手。'; if (d.gameMinutes > lim.game || d.socialMinutes > lim.social) return '清心破戒：今日数字刺激已超额，后续只做止损。'; if (!d.gameMinutes && !d.socialMinutes) return '清心未染：今日尚未登记游戏或手机消耗。'; return '清心印稳固：当前仍在戒律额度内。'; }

  function bindControls() {
    q('#clarityAddEntry')?.addEventListener('click', () => addEntry(min(q('#clarityGameInput')?.value), min(q('#clarityPhoneInput')?.value)));
    qa('[data-clarity]').forEach(btn => btn.addEventListener('click', () => { const [kind, raw] = btn.dataset.clarity.split(':'); addEntry(kind === 'game' ? Number(raw) : 0, kind === 'social' ? Number(raw) : 0); }));
    q('#clarityPhoneAway')?.addEventListener('change', event => writeDigital({ ...digital(), phoneAway: !!event.target.checked }, event.target.checked ? '清心印已确认手机离手。' : '已取消手机离手。'));
    q('#clarityUndoEntry')?.addEventListener('click', undoEntry);
    q('#clarityResetDay')?.addEventListener('click', resetDay);
  }

  function addEntry(game, social) { if (!game && !social) return toast('请输入本次游戏或手机分钟数。'); const d = digital(); writeDigital({ ...d, gameMinutes: d.gameMinutes + game, socialMinutes: d.socialMinutes + social, logs: [...d.logs, { gameMinutes: game, socialMinutes: social, at: new Date().toLocaleString('zh-CN') }] }, `已记录：游戏 ${game} 分钟，手机 ${social} 分钟。`); }
  function undoEntry() { const d = digital(), last = d.logs.at(-1); if (!last) return toast('今日没有可撤回的清心记录。'); writeDigital({ ...d, gameMinutes: Math.max(0, d.gameMinutes - min(last.gameMinutes)), socialMinutes: Math.max(0, d.socialMinutes - min(last.socialMinutes)), logs: d.logs.slice(0, -1) }, '已撤回上一笔清心记录。'); }
  function resetDay() { if (!confirm('确定清零今日游戏和手机记录？')) return; writeDigital({ ...digital(), gameMinutes: 0, socialMinutes: 0, logs: [] }, '今日清心记录已清零。'); }

  function writeDigital(next, message) {
    const key = todayKey();
    const d = { gameMinutes: min(next.gameMinutes), socialMinutes: min(next.socialMinutes), phoneAway: !!next.phoneAway, logs: Array.isArray(next.logs) ? next.logs : [], updatedAt: new Date().toISOString() };
    state.digitalLimits[key] = d;
    if (state.records?.[key]) state.records[key] = { ...state.records[key], gameMinutes: d.gameMinutes, socialMinutes: d.socialMinutes, phoneAway: d.phoneAway, digitalLogs: d.logs };
    updateClearSeal(false);
    saveState();
    renderDashboard();
    renderHistory();
    syncCheckinForm(d);
    toast(message);
  }

  function syncCheckinForm(d = digital()) { const form = q('#checkinForm'); if (!form) return; if (form.elements.gameMinutes) form.elements.gameMinutes.value = d.gameMinutes; if (form.elements.socialMinutes) form.elements.socialMinutes.value = d.socialMinutes; if (form.elements.phoneAway) form.elements.phoneAway.checked = !!d.phoneAway; try { previewCheckin?.(); } catch {} }
  function patchCheckin() { if (typeof populateCheckin === 'function' && !populateCheckin.wendaoClarityPatched) { const base = populateCheckin; populateCheckin = function(...args) { const result = base.apply(this, args); syncCheckinForm(); return result; }; populateCheckin.wendaoClarityPatched = true; } if (typeof saveCheckin === 'function' && !saveCheckin.wendaoClarityPatched) { const base = saveCheckin; saveCheckin = function(...args) { const result = base.apply(this, args); const record = state.records?.[todayKey()]; if (record) { const prev = digital(); state.digitalLimits[todayKey()] = { ...prev, gameMinutes: min(record.gameMinutes), socialMinutes: min(record.socialMinutes), phoneAway: !!record.phoneAway, updatedAt: new Date().toISOString() }; updateClearSeal(false); saveState(); renderDashboard(); renderHistory(); } return result; }; saveCheckin.wendaoClarityPatched = true; } }

  function installStyles() {
    if (document.querySelector('style[data-wendao-clarity-ledger]')) return;
    const style = document.createElement('style');
    style.dataset.wendaoClarityLedger = 'true';
    style.textContent = `.clarity-meter small{display:block;margin-top:6px}.clarity-danger{color:#ff9f7a}.clarity-ledger{margin-top:16px;padding:14px;border:1px solid rgba(215,180,106,.16);border-radius:16px;background:rgba(10,24,22,.46)}.clarity-ledger.stable{border-color:rgba(106,212,159,.26);background:rgba(25,72,55,.22)}.clarity-ledger.unstable{border-color:rgba(255,159,122,.24)}.clarity-ledger header{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.clarity-ledger header b{display:block;color:#f4e4bd}.clarity-ledger header span{display:block;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.45}.clarity-ledger header em{font-style:normal;color:var(--gold);font-size:12px;white-space:nowrap}.clarity-input-grid{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.clarity-input-grid label{display:grid;gap:5px;color:var(--muted);font-size:12px}.clarity-input-grid input{min-width:0;padding:9px 10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(0,0,0,.18);color:var(--text)}.clarity-input-grid button{height:39px}.clarity-quick-row,.clarity-ledger-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.clarity-quick-row button{padding:7px 10px;border:1px solid rgba(215,180,106,.18);border-radius:999px;background:rgba(215,180,106,.08);color:#e8d6a8}.clarity-away{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--muted);font-size:13px}.clarity-away input{accent-color:#6ad49f}.clarity-ledger-actions .danger{border-color:rgba(255,159,122,.24);color:#ffb395}.clarity-note{margin:10px 0 0;font-size:12px}.daily-progress-panel{position:relative;overflow:hidden}.daily-progress-panel:before{content:"";position:absolute;inset:-70px -30px auto auto;width:210px;height:210px;border-radius:50%;background:radial-gradient(circle,rgba(106,212,159,.18),transparent 66%);pointer-events:none}.daily-progress-orbits{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:12px}.progress-orb{display:grid;place-items:center;gap:8px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(255,255,255,.035)}.progress-orb-ring{width:92px;height:92px;border-radius:50%;display:grid;place-items:center;text-align:center;background:conic-gradient(var(--orb-color,#6ad49f) var(--p),rgba(255,255,255,.09) 0);position:relative;box-shadow:0 0 22px rgba(0,0,0,.16)}.progress-orb-ring:after{content:"";position:absolute;inset:8px;border-radius:50%;background:#0d1d1b}.progress-orb-ring b,.progress-orb-ring small{position:relative;z-index:1}.progress-orb-ring b{font-size:18px;color:#f4e4bd;line-height:1}.progress-orb-ring small{font-size:10px;color:var(--muted);margin-top:24px;position:absolute}.progress-orb>span{font-size:12px;color:var(--muted)}.progress-orb.jade{--orb-color:#6ad49f}.progress-orb.gold{--orb-color:#d7b46a}.progress-orb.blue{--orb-color:#7ab7ff}.progress-orb.violet{--orb-color:#c38bff}.progress-orb.ember{--orb-color:#ff8d6a}.daily-progress-path{margin-top:14px;padding:12px;border-radius:15px;background:rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.07)}.daily-path-head{display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--muted);font-size:13px}.daily-path-head b{color:#f4e4bd}.daily-path-bar{height:8px;margin-top:9px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}.daily-path-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6ad49f,#d7b46a)}.daily-reward-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.daily-reward-row span{padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.09);color:var(--muted);font-size:12px;background:rgba(255,255,255,.035)}.daily-reward-row span.on{border-color:rgba(106,212,159,.35);color:#a8f0c8;background:rgba(106,212,159,.1)}@media(max-width:900px){.daily-progress-orbits{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:720px){.clarity-input-grid{grid-template-columns:1fr}.clarity-input-grid button{width:100%}}@media(max-width:560px){.daily-progress-orbits{grid-template-columns:repeat(2,minmax(0,1fr))}.progress-orb-ring{width:82px;height:82px}.daily-path-head{display:block}.daily-path-head span{display:block;margin-top:5px}}`;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
})();
