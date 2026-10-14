const C='daumrun-v2',F=['./','index.html','app.js','course.js','style.css','manifest.webmanifest','icon-192.png','icon-512.png','icon-180.png'];
const LEAF=['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js','https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F).then(()=>c.addAll(LEAF).catch(()=>{}))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);
  // 지도 타일·API 응답은 캐시하지 않음(OSM 타일 정책 존중); 앱 파일과 Leaflet만 캐시
  if(u.origin!==location.origin&&!LEAF.includes(u.href.split('?')[0]))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})))});
