(() => {
  const SESSION_KEY = 'wendao-cloud-session-v1';
  const REQUEST_TIMEOUT_MS = 15000;
  const config = window.WENDAO_CLOUD_CONFIG || {};
  let session = readSession();
  let syncing = false;
  let pushTimer = null;
  let pendingState = null;

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
    emit('wendao-cloud-status', {
      configured: configured(),
      loggedIn: !!session?.access_token,
      email: session?.user?.email || '',
      syncing,
      ...extra,
    });
    try {
      const node = document.querySelector('#cloudDialogStatus');
      if (node && extra.error) node.textContent = `同步失败：${extra.error}`;
      else if (node && extra.lastSync) node.textContent = '当前进度已同步到云端。';
    } catch {}
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
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('云端请求超时，请检查网络后重试。');
      throw error;
    } finally {
      clearTimeout(timer);
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
    if (syncing) {
      const message = '已有同步正在进行，稍等几秒后再试。';
      emitStatus({ error: message });
      throw new Error(message);
    }
    syncing = true;
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
      emitStatus({ error: error.message });
      throw error;
    } finally {
      syncing = false;
      emitStatus();
    }
  }

  function schedulePush(state) {
    if (!configured() || !session?.access_token) return;
    pendingState = JSON.parse(JSON.stringify(state));
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const next = pendingState;
      pendingState = null;
      try {
        syncing = true;
        emitStatus();
        await pushState(next);
      } catch (error) {
        emitStatus({ error: error.message });
      } finally {
        syncing = false;
        emitStatus();
      }
    }, 900);
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

  window.WendaoCloud = {
    configured,
    signIn,
    signUp,
    signOut,
    sync,
    schedulePush,
    bootstrap,
    getStatus: () => ({ configured: configured(), loggedIn: !!session?.access_token, email: session?.user?.email || '', syncing }),
  };
})();
