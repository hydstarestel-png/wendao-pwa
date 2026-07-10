(() => {
  'use strict';

  const AUDIO_KEY = 'wendao-feedback-sound-v1';
  let audioContext = null;

  function soundEnabled() {
    return localStorage.getItem(AUDIO_KEY) !== 'off';
  }

  function audio() {
    if (!soundEnabled()) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  }

  function tone(ctx, frequency, start, duration, volume, type = 'sine') {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playTaskSound() {
    const ctx = audio();
    if (!ctx) return;
    const now = ctx.currentTime;
    tone(ctx, 523.25, now, 0.22, 0.035, 'sine');
    tone(ctx, 659.25, now + 0.08, 0.25, 0.032, 'sine');
    tone(ctx, 783.99, now + 0.16, 0.34, 0.028, 'triangle');
  }

  function playFoundationSound(complete = false) {
    const ctx = audio();
    if (!ctx) return;
    const now = ctx.currentTime;
    tone(ctx, 392, now, 0.38, 0.032, 'sine');
    tone(ctx, 523.25, now + 0.1, 0.42, 0.03, 'sine');
    if (complete) tone(ctx, 783.99, now + 0.22, 0.55, 0.025, 'triangle');
  }

  function pointFor(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return { x: innerWidth / 2, y: innerHeight / 2 };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function burst(point, label, kind = 'xp') {
    const layer = document.createElement('div');
    layer.className = `wendao-feedback-burst ${kind}`;
    layer.style.setProperty('--burst-x', `${point.x}px`);
    layer.style.setProperty('--burst-y', `${point.y}px`);
    layer.innerHTML = `<span class="wendao-feedback-label"></span>${Array.from({ length: 12 }, (_, index) => `<i style="--i:${index}"></i>`).join('')}`;
    layer.querySelector('.wendao-feedback-label').textContent = label;
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1250);
  }

  function flash(target, kind) {
    const node = typeof target === 'string' ? document.querySelector(target) : target;
    if (!node) return;
    node.classList.remove('wendao-feedback-flash', 'xp', 'foundation');
    void node.offsetWidth;
    node.classList.add('wendao-feedback-flash', kind);
    setTimeout(() => node.classList.remove('wendao-feedback-flash', kind), 900);
  }

  function safeTodayKey() {
    try { return todayKey(); } catch { return new Date().toLocaleDateString('sv-SE'); }
  }

  function taskCount(id) {
    try { return Number(state?.taskActivityLogs?.[safeTodayKey()]?.[id]) || 0; } catch { return 0; }
  }

  function foundationDone(id) {
    try { return !!state?.foundations?.[safeTodayKey()]?.[id]; } catch { return false; }
  }

  function foundationScore() {
    try { return Object.values(state?.foundations?.[safeTodayKey()] || {}).filter(Boolean).length; } catch { return 0; }
  }

  document.addEventListener('click', (event) => {
    const taskButton = event.target.closest?.('[data-task-activity][data-delta="1"]');
    if (taskButton) {
      const id = taskButton.dataset.taskActivity;
      const before = taskCount(id);
      const point = pointFor(taskButton);
      setTimeout(() => {
        const after = taskCount(id);
        if (after <= before) return;
        let task = null;
        try { task = allTodayTasks().find((item) => item.id === id); } catch {}
        const xp = Number(task?.xp) || 0;
        playTaskSound();
        burst(point, xp > 0 ? `＋${xp} 修为` : '任务完成', 'xp');
        flash('#todayGeneralXp', 'xp');
        flash('#currentXp', 'xp');
      }, 0);
      return;
    }

    const foundationButton = event.target.closest?.('[data-foundation]');
    if (foundationButton) {
      const id = foundationButton.dataset.foundation;
      const before = foundationDone(id);
      const name = foundationButton.querySelector('b')?.textContent?.trim() || '道基印';
      const point = pointFor(foundationButton);
      setTimeout(() => {
        if (before || !foundationDone(id)) return;
        const complete = foundationScore() >= 4;
        playFoundationSound(complete);
        burst(point, complete ? '四印圆满 · 根基稳固' : `${name} · 已稳固`, 'foundation');
        flash('#foundationScore', 'foundation');
      }, 0);
      return;
    }

    const englishButton = event.target.closest?.('[data-english-activity][data-delta="1"], [data-mock-xp]');
    if (englishButton) {
      let before = 0;
      try { before = Number(state?.english?.eXp) || 0; } catch {}
      const point = pointFor(englishButton);
      setTimeout(() => {
        let after = before;
        try { after = Number(state?.english?.eXp) || 0; } catch {}
        if (after <= before) return;
        playTaskSound();
        burst(point, `＋${after - before} E-XP`, 'xp');
        flash('#englishXpLabel', 'xp');
      }, 0);
    }
  }, true);

  const style = document.createElement('style');
  style.textContent = `
    .wendao-feedback-burst{--tone:#79e5ad;position:fixed;inset:0;z-index:99999;pointer-events:none;overflow:hidden}
    .wendao-feedback-burst.foundation{--tone:#e9c979}
    .wendao-feedback-label{position:absolute;left:var(--burst-x);top:var(--burst-y);transform:translate(-50%,-50%);padding:8px 14px;border:1px solid color-mix(in srgb,var(--tone) 70%,transparent);border-radius:999px;background:rgba(7,21,17,.9);box-shadow:0 0 30px color-mix(in srgb,var(--tone) 35%,transparent);color:var(--tone);font-weight:800;letter-spacing:.08em;white-space:nowrap;animation:wendao-label-rise 1.15s ease-out forwards}
    .wendao-feedback-burst i{position:absolute;left:var(--burst-x);top:var(--burst-y);width:5px;height:5px;border-radius:50%;background:var(--tone);box-shadow:0 0 9px var(--tone);transform:translate(-50%,-50%) rotate(calc(var(--i)*30deg)) translateX(12px);animation:wendao-spark 850ms cubic-bezier(.18,.72,.2,1) forwards}
    .wendao-feedback-flash{position:relative;z-index:1;animation:wendao-value-flash 820ms ease-out}
    .wendao-feedback-flash.foundation{--flash:#e9c979}.wendao-feedback-flash.xp{--flash:#79e5ad}
    @keyframes wendao-label-rise{0%{opacity:0;transform:translate(-50%,-15%) scale(.75)}18%{opacity:1;transform:translate(-50%,-75%) scale(1.05)}100%{opacity:0;transform:translate(-50%,-190%) scale(.98)}}
    @keyframes wendao-spark{0%{opacity:0;transform:translate(-50%,-50%) rotate(calc(var(--i)*30deg)) translateX(8px) scale(.4)}20%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) rotate(calc(var(--i)*30deg)) translateX(76px) scale(0)}}
    @keyframes wendao-value-flash{0%,100%{filter:none}30%{color:var(--flash);filter:drop-shadow(0 0 10px var(--flash));transform:scale(1.12)}}
    @media (prefers-reduced-motion:reduce){.wendao-feedback-burst i{display:none}.wendao-feedback-label,.wendao-feedback-flash{animation-duration:1ms!important}}
  `;
  document.head.appendChild(style);

  window.WendaoFeedback = {
    setSound(enabled) { localStorage.setItem(AUDIO_KEY, enabled ? 'on' : 'off'); },
    get soundEnabled() { return soundEnabled(); },
  };
})();
