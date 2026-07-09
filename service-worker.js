const CACHE_NAME='wendao-pwa-v12';
const STUDY_TIME_VERSION='20260709-study-time-addon-v1';
const APP_SHELL=['./','./index.html','./styles.css','./app.js','./cloud-config.js','./cloud-sync.js','./feature-overrides.js','./study-time-overrides.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./vendor/tesseract.min.js','./vendor/worker.min.js'];
function featureResponseWithStudyTime(source){
  const loader=`\n;(()=>{if(document.querySelector('script[data-wendao-study-time]'))return;const script=document.createElement('script');script.src='study-time-overrides.js?v=${STUDY_TIME_VERSION}';script.dataset.wendaoStudyTime='true';document.body.appendChild(script);})();\n`;
  return new Response(`${source}\n${loader}`,{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-cache'}});
}
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const request=event.request,url=new URL(request.url);
  if(url.pathname.endsWith('/feature-overrides.js')){
    event.respondWith(fetch(request).then(response=>response.text()).then(featureResponseWithStudyTime).catch(()=>caches.match(request).then(cached=>cached||caches.match('./feature-overrides.js')).then(async cached=>cached?featureResponseWithStudyTime(await cached.text()):Response.error())));
    return;
  }
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put('./index.html',copy));return response;}).catch(()=>caches.match('./index.html')));return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok||response.type==='opaque'){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}return response;})));
});
