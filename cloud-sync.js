(() => {
  const SESSION_KEY = 'wendao-cloud-session-v1';
  const REQUEST_TIMEOUT_MS = 15000;
  const SYNC_WATCHDOG_MS = 30000;
  const config = window.WENDAO_CLOUD_CONFIG || {};
  let session = readSession();
  let syncing = false;
  let syncStartedAt = 0;
  let syncWatchdogTimer = null;
  let syncRunId = 0;
  let pushTimer = null;
  let pendingState = null;
  let lastStatus = {};
  const activeRequests = new Set();

  function configured() {
    return /^https:\/\//.test(config.supabaseUrl || '') && String(config.supabaseAnonKey || '').length > 20;
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function writeSession(value) {
    session = value;
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
    emitStatus();
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function emitStatus(extra = {}) {
    const detail = {
      configured: configured(),
      loggedIn: !!session?.access_token,
      email: session?.user?.email || '',
      syncing,
      ...extra,
    };
    lastStatus = detail;
    emit('wendao-cloud-status', detail);
    setTimeout(() => applyCloudStatusHints(detail), 0);
    try {
      const node = document.querySelector('#cloudDialogStatus');
      if (node && extra.error) node.textContent = `同步失败：${extra.error}`;
      else if (node && extra.pending) node.textContent = '有本机新进度待同步，正在自动上传云端。';
      else if (node && syncing) node.textContent = '正在同步云端档案…';
      else if (node && extra.lastSync) node.textContent = '当前进度已同步到云端。';
    } catch {}
  }

  function applyCloudStatusHints(status = lastStatus) {
    try {
      if (!status?.loggedIn) return;
      const button = document.querySelector('#cloudStatusBtn');
      const label = document.querySelector('#cloudStatusText');
      const settings = document.querySelector('#cloudSettingsStatus');
      const dialog = document.querySelector('#cloudDialog');
      const dialogStatus = document.querySelector('#cloudDialogStatus');
      if (button) button.classList.toggle('syncing', !!status.syncing || !!status.pending);
      if (label) label.textContent = status.syncing ? '同步中' : status.pending ? '待同步' : '云端已连';
      if (settings && status.pending) settings.textContent = `已连接 ${status.email || '云端账号'}，有本机新进度待同步。`;
      if (dialog?.open && dialogStatus) {
        if (status.pending) dialogStatus.textContent = '有本机新进度待同步，通常几秒内自动完成。';
        else if (status.syncing) dialogStatus.textContent = '正在同步云端档案…';
      }
    } catch {}
  }

  function setCloudButtonsBusy(busy) {
    try {
      ['#cloudSyncNow', '#manualCloudSync'].forEach((selector) => {
        const node = document.querySelector(selector);
        if (node) node.disabled = busy;
      });
    } catch {}
  }

  function abortActiveRequests() {
    activeRequests.forEach((controller) => {
      try { controller.abort(); } catch {}
    });
    activeRequests.clear();
  }

  function stopSyncWatchdog() {
    clearTimeout(syncWatchdogTimer);
    syncWatchdogTimer = null;
    syncStartedAt = 0;
  }

  function forceUnlock(reason = 'timeout') {
    if (!syncing) {
      emitStatus({ pending: !!pendingState });
      return { unlocked: false };
    }
    syncRunId += 1;
    abortActiveRequests();
    syncing = false;
    stopSyncWatchdog();
    setCloudButtonsBusy(false);
    const message = reason === 'manual'
      ? '已解除卡住的同步状态，请重新点击同步。'
      : reason === 'stale'
        ? '检测到上次同步未正常结束，已自动恢复。'
        : '云端同步超时，已自动解锁；请重新点击同步。';
    emitStatus({ error: message, pending: !!pendingState });
    try { window.toast?.(message); } catch {}
    return { unlocked: true };
  }

  function startSyncWatchdog(runId) {
    clearTimeout(syncWatchdogTimer);
    syncStartedAt = Date.now();
    syncWatchdogTimer = setTimeout(() => {
      if (syncing && runId === syncRunId) forceUnlock('timeout');
    }, SYNC_WATCHDOG_MS);
  }

  function isSyncStale() {
    return syncing && syncStartedAt && Date.now() - syncStartedAt > SYNC_WATCHDOG_MS;
  }

  function enhanceManualSyncButtons() {
    const handler = async (event) => {
      const status = window.WendaoCloud?.getStatus?.();
      if (!status?.pending || !window.WendaoCloud?.flushPendingPush) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const statusNode = document.querySelector('#cloudDialogStatus');
      if (statusNode) statusNode.textContent = '正在同步待同步任务进度…';
      setCloudButtonsBusy(true);
      try {
        const result = await window.WendaoCloud.flushPendingPush();
        const message = result?.direction === 'busy'
          ? '已有同步正在进行，稍等几秒后再试。'
          : result?.direction === 'error'
            ? `同步失败：${result.error?.message || '请稍后重试'}`
            : '待同步任务进度已同步到云端。';
        if (statusNode) statusNode.textContent = message;
        window.toast?.(message);
      } finally {
        setCloudButtonsBusy(false);
        setTimeout(() => applyCloudStatusHints(window.WendaoCloud?.getStatus?.()), 0);
      }
    };
    ['#cloudSyncNow', '#manualCloudSync'].forEach((selector) => {
      const node = document.querySelector(selector);
      if (node && !node.dataset.wendaoPendingSyncHooked) {
        node.dataset.wendaoPendingSyncHooked = 'true';
        node.addEventListener('click', handler, true);
      }
    });
  }

  function headers(token = session?.access_token) {
    return {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${token || config.supabaseAnonKey}`,
      'Content-Type': 'application/json',
    };
  }

  function currentRedirectUrl() {
    const url = new URL(window.location.href);
    url.hash = '';
    url.search = '';
    if (url.pathname.endsWith('/index.html')) url.pathname = url.pathname.slice(0, -10);
    if (!url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/?$/, '/');
    return url.toString();
  }

  function authUrl(path, query = {}) {
    const url = new URL(`${config.supabaseUrl}/auth/v1/${path}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    return url.toString();
  }

  function cleanAuthUrl() {
    if (!history?.replaceState) return;
    const url = new URL(window.location.href);
    url.hash = '';
    [
      'access_token',
      'refresh_token',
      'expires_in',
      'token_type',
      'type',
      'error',
      'error_code',
      'error_description',
    ].forEach((key) => url.searchParams.delete(key));
    history.replaceState(null, document.title, url.toString());
  }

  async function parseResponse(response) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `云端请求失败（${response.status}）`);
    }
    return data;
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    activeRequests.add(controller);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('云端请求超时，请检查网络后重试。');
      throw error;
    } finally {
      clearTimeout(timer);
      activeRequests.delete(controller);
    }
  }

  async function authRequest(path, body, query) {
    const response = await request(authUrl(path, query), {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseResponse(response);
  }

  async function fetchUser(token) {
    return parseResponse(await request(authUrl('user'), { headers: headers(token) }));
  }

  async function restoreSessionFromUrl() {
    if (!configured()) return false;
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search || '');
    const params = hashParams.get('access_token') || hashParams.get('error') ? hashParams : queryParams;

    if (params.get('error')) {
      const message = params.get('error_description') || params.get('error');
      cleanAuthUrl();
      emitStatus({ error: message });
      return false;
    }

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return false;

    const expiresIn = Number(params.get('expires_in') || 3600);
    const nextSession = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: params.get('token_type') || 'bearer',
      expires_in: expiresIn,
      expires_at: Date.now() + expiresIn * 1000,
      user: null,
    };

    nextSession.user = await fetchUser(accessToken);
    writeSession(nextSession);
    cleanAuthUrl();
    return true;
  }

  async function refreshSession() {
    if (!session?.refresh_token) return null;
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    writeSession({ ...data, expires_at: Date.now() + (data.expires_in || 3600) * 1000 });
    return session;
  }

  async function ensureSession() {
    if (!session?.access_token) return null;
    if ((session.expires_at || 0) < Date.now() + 60000) await refreshSession();
    if (session?.access_token && !session?.user?.id) {
      writeSession({ ...session, user: await fetchUser(session.access_token) });
    }
    if (session?.access_token && !session?.user?.id) throw new Error('无法读取云端账号身份，请退出后重新登录。');
    return session;
  }

  async function signIn(email, password) {
    if (!configured()) throw new Error('云端服务尚未完成配置。');
    const data = await authRequest('token?grant_type=password', { email, password });
    writeSession({ ...data, expires_at: Date.now() + (data.expires_in || 3600) * 1000 });
    return data;
  }

  async function signUp(email, password) {
    if (!configured()) throw new Error('云端服务尚未完成配置。');
    const data = await authRequest('signup', { email, password }, { redirect_to: currentRedirectUrl() });
    if (data.access_token) writeSession({ ...data, expires_at: Date.now() + (data.expires_in || 3600) * 1000 });
    return data;
  }

  function signOut() {
    clearTimeout(pushTimer);
    pendingState = null;
    if (syncing) forceUnlock('manual');
    writeSession(null);
  }

  async function fetchRemoteState() {
    await ensureSession();
    if (!session?.user?.id) throw new Error('无法读取云端账号身份，请退出后重新登录。');
    const url = `${config.supabaseUrl}/rest/v1/user_states?user_id=eq.${encodeURIComponent(session.user.id)}&select=state,updated_at&limit=1`;
    const data = await parseResponse(await request(url, { headers: headers() }));
    return data?.[0] || null;
  }

  async function pushState(state) {
    await ensureSession();
    if (!session?.user?.id) throw new Error('无法读取云端账号身份，请退出后重新登录。');
    const updatedAt = new Date().toISOString();
    const payloadState = JSON.parse(JSON.stringify(state));
    payloadState.syncMeta = {
      ...(payloadState.syncMeta || {}),
      localUpdatedAt: updatedAt,
      cloudUpdatedAt: updatedAt,
    };
    const url = `${config.supabaseUrl}/rest/v1/user_states?on_conflict=user_id`;
    const response = await request(url, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{ user_id: session.user.id, state: payloadState, updated_at: updatedAt }]),
    });
    await parseResponse(response);
    emit('wendao-cloud-meta', { updatedAt });
    emitStatus({ lastSync: updatedAt });
    return updatedAt;
  }

  function hasMeaningfulProgress(state) {
    return (state?.totalXp || 0) > 45 || Object.keys(state?.records || {}).length > 0 || Object.keys(state?.customTasks || {}).length > 0;
  }

  function comparableState(value) {
    const copy = JSON.parse(JSON.stringify(value || {}));
    delete copy.syncMeta;
    return copy;
  }

  function statesDiffer(a, b) {
    return JSON.stringify(comparableState(a)) !== JSON.stringify(comparableState(b));
  }

  function applyRemoteState(remote) {
    const remoteTime = remote.updated_at || new Date().toISOString();
    const incoming = {
      ...remote.state,
      syncMeta: { ...(remote.state?.syncMeta || {}), localUpdatedAt: remoteTime, cloudUpdatedAt: remoteTime },
    };
    emit('wendao-cloud-state', { state: incoming, updatedAt: remoteTime });
    emitStatus({ lastSync: remoteTime });
    return { direction: 'pull' };
  }

  async function sync(localState, { preferLocal = false } = {}) {
    if (!configured()) throw new Error('云端服务尚未完成配置。');
    if (!session?.access_token) throw new Error('请先登录云端账号。');
    if (isSyncStale()) forceUnlock('stale');
    if (syncing) {
      const message = '已有同步正在进行，稍等几秒后再试。';
      emitStatus({ error: message });
      throw new Error(message);
    }
    const runId = ++syncRunId;
    syncing = true;
    startSyncWatchdog(runId);
    setCloudButtonsBusy(true);
    emitStatus();
    try {
      const remote = await fetchRemoteState();
      if (!remote) {
        await pushState(localState);
        return { direction: 'push' };
      }

      const localKnown = localState?.syncMeta?.cloudUpdatedAt || '';
      const localChanged = localState?.syncMeta?.localUpdatedAt || '';
      const remoteTime = remote.updated_at || '';
      const remoteChanged = !!remoteTime && remoteTime !== localKnown && remoteTime > localKnown;
      const localChangedAfterCloud = !!localChanged && (!localKnown || localChanged > localKnown);
      const different = statesDiffer(remote.state, localState);

      if (!different && remoteTime) {
        emitStatus({ lastSync: remoteTime });
        return { direction: 'noop' };
      }

      if (remoteChanged && !preferLocal) {
        if (localChangedAfterCloud && hasMeaningfulProgress(localState)) {
          const useRemote = confirm('云端和本机都有新进度。\n\n确定：使用云端档案覆盖本机。\n取消：使用本机档案覆盖云端。');
          if (!useRemote) {
            await pushState(localState);
            return { direction: 'push' };
          }
        }
        return applyRemoteState(remote);
      }

      if (remoteChanged && preferLocal && localChangedAfterCloud && hasMeaningfulProgress(localState)) {
        const useRemote = confirm('云端已有另一台设备的新进度。\n\n确定：先载入云端档案。\n取消：用本机档案覆盖云端。');
        if (useRemote) return applyRemoteState(remote);
      }

      await pushState(localState);
      return { direction: 'push' };
    } catch (error) {
      if (runId !== syncRunId) throw new Error('云端同步已自动解锁，请重新点击同步。');
      emitStatus({ error: error.message });
      throw error;
    } finally {
      if (runId === syncRunId) {
        syncing = false;
        stopSyncWatchdog();
        setCloudButtonsBusy(false);
        emitStatus({ pending: !!pendingState });
      }
    }
  }

  function schedulePush(state) {
    if (!configured() || !session?.access_token) return;
    pendingState = JSON.parse(JSON.stringify(state));
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPendingPush, 900);
    emitStatus({ pending: true });
  }

  async function flushPendingPush() {
    if (!configured() || !session?.access_token || !pendingState) return { direction: 'noop' };
    if (syncing) {
      if (isSyncStale()) forceUnlock('stale');
    }
    if (syncing) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(flushPendingPush, 1200);
      emitStatus({ pending: true });
      return { direction: 'busy' };
    }
    clearTimeout(pushTimer);
    const next = pendingState;
    pendingState = null;
    try {
      const result = await sync(next, { preferLocal: true });
      emitStatus({ pending: !!pendingState });
      return result;
    } catch (error) {
      pendingState = pendingState || next;
      emitStatus({ error: error.message, pending: true });
      return { direction: 'error', error };
    }
  }

  async function bootstrap() {
    emitStatus();
    if (!configured()) return;
    try {
      await restoreSessionFromUrl();
      if (!session?.access_token) return;
      await ensureSession();
      emitStatus();
      emit('wendao-cloud-ready', {});
    } catch (error) {
      writeSession(null);
      emitStatus({ error: error.message });
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingPush();
  });
  window.addEventListener('pagehide', flushPendingPush);
  window.addEventListener('online', flushPendingPush);
  window.addEventListener('focus', () => {
    if (isSyncStale()) forceUnlock('stale');
    if (pendingState) flushPendingPush();
  });
  window.addEventListener('pageshow', () => {
    if (isSyncStale()) forceUnlock('stale');
  });
  window.addEventListener('wendao-cloud-status', (event) => setTimeout(() => applyCloudStatusHints(event.detail), 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceManualSyncButtons, { once: true });
  else enhanceManualSyncButtons();

  window.WendaoCloud = {
    configured,
    signIn,
    signUp,
    signOut,
    sync,
    schedulePush,
    flushPendingPush,
    forceUnlock: () => forceUnlock('manual'),
    bootstrap,
    getStatus: () => ({ configured: configured(), loggedIn: !!session?.access_token, email: session?.user?.email || '', syncing, pending: !!pendingState, syncStartedAt }),
  };
})();

(() => {
  function loadFeatureOverrides() {
    if (document.querySelector('script[data-wendao-feature-overrides]')) return;
    const script = document.createElement('script');
    script.src = 'feature-overrides.js?v=20260707-foundation-reports-v1';
    script.dataset.wendaoFeatureOverrides = 'true';
    document.body.appendChild(script);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadFeatureOverrides, { once: true });
  else loadFeatureOverrides();
})();
