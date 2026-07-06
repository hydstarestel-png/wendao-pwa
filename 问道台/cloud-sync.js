(() => {
  const SESSION_KEY = 'wendao-cloud-session-v1';
  const config = window.WENDAO_CLOUD_CONFIG || {};
  let session = readSession();
  let syncing = false;
  let pushTimer = null;
  let pendingState = null;

  function configured(){ return /^https:\/\//.test(config.supabaseUrl || '') && String(config.supabaseAnonKey || '').length > 20; }
  function readSession(){ try{return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');}catch{return null;} }
  function writeSession(value){ session=value; if(value)localStorage.setItem(SESSION_KEY,JSON.stringify(value));else localStorage.removeItem(SESSION_KEY); emitStatus(); }
  function emit(name,detail){ window.dispatchEvent(new CustomEvent(name,{detail})); }
  function emitStatus(extra={}){ emit('wendao-cloud-status',{configured:configured(),loggedIn:!!session?.access_token,email:session?.user?.email||'',syncing,...extra}); }
  function headers(token=session?.access_token){ return {'apikey':config.supabaseAnonKey,'Authorization':`Bearer ${token || config.supabaseAnonKey}`,'Content-Type':'application/json'}; }
  async function parseResponse(response){ const text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||`云端请求失败（${response.status}）`);return data; }
  async function authRequest(path,body){ const response=await fetch(`${config.supabaseUrl}/auth/v1/${path}`,{method:'POST',headers:{'apikey':config.supabaseAnonKey,'Content-Type':'application/json'},body:JSON.stringify(body)});return parseResponse(response); }
  async function refreshSession(){
    if(!session?.refresh_token)return null;
    const data=await authRequest('token?grant_type=refresh_token',{refresh_token:session.refresh_token});
    writeSession({...data,expires_at:Date.now()+(data.expires_in||3600)*1000});return session;
  }
  async function ensureSession(){ if(!session?.access_token)return null;if((session.expires_at||0)<Date.now()+60000)await refreshSession();return session; }
  async function signIn(email,password){
    if(!configured())throw new Error('云端服务尚未完成配置。');
    const data=await authRequest('token?grant_type=password',{email,password});writeSession({...data,expires_at:Date.now()+(data.expires_in||3600)*1000});return data;
  }
  async function signUp(email,password){
    if(!configured())throw new Error('云端服务尚未完成配置。');
    const data=await authRequest('signup',{email,password});
    if(data.access_token)writeSession({...data,expires_at:Date.now()+(data.expires_in||3600)*1000});return data;
  }
  function signOut(){ clearTimeout(pushTimer);pendingState=null;writeSession(null); }
  async function fetchRemoteState(){
    await ensureSession();if(!session?.user?.id)return null;
    const url=`${config.supabaseUrl}/rest/v1/user_states?user_id=eq.${encodeURIComponent(session.user.id)}&select=state,updated_at&limit=1`;
    const data=await parseResponse(await fetch(url,{headers:headers()}));return data?.[0]||null;
  }
  async function pushState(state){
    await ensureSession();if(!session?.user?.id)return null;
    const updatedAt=new Date().toISOString(),payloadState=JSON.parse(JSON.stringify(state));
    payloadState.syncMeta={...(payloadState.syncMeta||{}),localUpdatedAt:updatedAt,cloudUpdatedAt:updatedAt};
    const url=`${config.supabaseUrl}/rest/v1/user_states?on_conflict=user_id`;
    const response=await fetch(url,{method:'POST',headers:{...headers(),'Prefer':'resolution=merge-duplicates,return=representation'},body:JSON.stringify([{user_id:session.user.id,state:payloadState,updated_at:updatedAt}])});
    await parseResponse(response);emit('wendao-cloud-meta',{updatedAt});emitStatus({lastSync:updatedAt});return updatedAt;
  }
  function hasMeaningfulProgress(state){ return (state?.totalXp||0)>45 || Object.keys(state?.records||{}).length>0 || Object.keys(state?.customTasks||{}).length>0; }
  async function sync(localState,{preferLocal=false}={}){
    if(!configured()||!session?.access_token||syncing)return null;
    syncing=true;emitStatus();
    try{
      const remote=await fetchRemoteState();
      if(!remote){await pushState(localState);return{direction:'push'};}
      const localKnown=localState?.syncMeta?.cloudUpdatedAt,localChanged=localState?.syncMeta?.localUpdatedAt||'',remoteTime=remote.updated_at||'';
      let useRemote=!preferLocal&&remoteTime>localChanged;
      if(!localKnown&&hasMeaningfulProgress(localState)&&JSON.stringify(remote.state)!==JSON.stringify(localState)){
        useRemote=confirm('云端与本机都有修行档案。\n\n确定：使用云端档案覆盖本机。\n取消：使用本机档案覆盖云端。');
      }
      if(useRemote){const incoming={...remote.state,syncMeta:{...(remote.state?.syncMeta||{}),localUpdatedAt:remoteTime,cloudUpdatedAt:remoteTime}};emit('wendao-cloud-state',{state:incoming,updatedAt:remoteTime});emitStatus({lastSync:remoteTime});return{direction:'pull'};}
      await pushState(localState);return{direction:'push'};
    }finally{syncing=false;emitStatus();}
  }
  function schedulePush(state){
    if(!configured()||!session?.access_token)return;
    pendingState=JSON.parse(JSON.stringify(state));clearTimeout(pushTimer);
    pushTimer=setTimeout(async()=>{const next=pendingState;pendingState=null;try{syncing=true;emitStatus();await pushState(next);}catch(error){emitStatus({error:error.message});}finally{syncing=false;emitStatus();}},900);
  }
  async function bootstrap(){
    emitStatus();if(!configured()||!session?.access_token)return;
    try{await ensureSession();emitStatus();emit('wendao-cloud-ready',{});}catch(error){writeSession(null);emitStatus({error:error.message});}
  }
  window.WendaoCloud={configured,signIn,signUp,signOut,sync,schedulePush,bootstrap,getStatus:()=>({configured:configured(),loggedIn:!!session?.access_token,email:session?.user?.email||'',syncing})};
})();
