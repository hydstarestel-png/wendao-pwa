(() => {
  let lastError = '';

  function messageFrom(reason) {
    if (!reason) return '主程序未完成启动。';
    const text = reason instanceof Error ? reason.message : String(reason?.message || reason);
    return text || '主程序未完成启动。';
  }

  function show(reason) {
    const message = messageFrom(reason);
    if (message === lastError) return;
    lastError = message;
    const panel = document.querySelector('#wendaoBootError') || document.createElement('aside');
    panel.id = 'wendaoBootError';
    panel.style.cssText = 'position:fixed;z-index:999999;right:16px;bottom:16px;max-width:min(440px,calc(100vw - 32px));padding:16px;border:1px solid #dfbb6d;border-radius:14px;background:#1c1710;color:#f5e3b4;box-shadow:0 18px 60px rgba(0,0,0,.45);font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif';
    panel.innerHTML = '<b style="display:block;font-size:15px">问道台主程序未正常启动</b><span id="wendaoBootErrorText" style="display:block;margin:7px 0;color:#d8c79f"></span><button type="button" id="wendaoBootCopy" style="margin-top:8px;border:1px solid #cba65f;border-radius:8px;background:#302616;color:#ffe5a8;padding:7px 10px;cursor:pointer">复制诊断信息</button>';
    panel.querySelector('#wendaoBootErrorText').textContent = message;
    panel.querySelector('#wendaoBootCopy').onclick = async () => {
      const report = `问道台启动错误：${message}\n页面：${location.href}\n时间：${new Date().toLocaleString('zh-CN')}`;
      try { await navigator.clipboard.writeText(report); panel.querySelector('#wendaoBootCopy').textContent = '已复制，发给 Codex'; } catch { panel.querySelector('#wendaoBootCopy').textContent = report; }
    };
    if (!panel.isConnected) document.body.appendChild(panel);
  }

  window.WendaoBootFail = show;
  window.addEventListener('error', (event) => show(event.error || `${event.message || '脚本错误'} (${event.filename || '未知文件'}:${event.lineno || 0})`));
  window.addEventListener('unhandledrejection', (event) => show(event.reason));
  setTimeout(() => { if (!window.__WENDAO_BOOTED__) show('主程序启动超时：请复制此诊断信息。'); }, 5000);
})();
