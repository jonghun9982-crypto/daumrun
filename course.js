'use strict';
// ---------- 코스 추천 (Leaflet + OSM + Overpass + OSRM foot + Open-Meteo elevation) ----------
const CR={dist:5,courses:[],sel:null,map:null,layers:[],loc:null,busy:false,msg:''};
const OSM_ATTR='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> 기여자';
function mkMap(el,ll,z){const m=L.map(el,{zoomControl:true,attributionControl:true}).setView(ll,z||15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:OSM_ATTR}).addTo(m);m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank">Leaflet</a>');return m}
function leafletOk(){return typeof L!=='undefined'}
function dest(p,brg,d){const R=6371e3,r=Math.PI/180,b=brg*r,la=p.lat*r,lo=p.lon*r,a=d/R;
  const la2=Math.asin(Math.sin(la)*Math.cos(a)+Math.cos(la)*Math.sin(a)*Math.cos(b));
  const lo2=lo+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(la),Math.cos(a)-Math.sin(la)*Math.sin(la2));return {lat:la2/r,lon:lo2/r}}
async function fetchJ(url,opt,ms){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms||20000);
  try{const r=await fetch(url,Object.assign({signal:c.signal},opt||{}));if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}}
const cacheGet=k=>{const v=LS.get('dr_cc_'+k,null);return v&&Date.now()-v.t<864e5*3?v.d:null}, cacheSet=(k,d)=>{try{LS.set('dr_cc_'+k,{t:Date.now(),d})}catch(e){}};
async function greenPoints(p,rad){const key='g'+p.lat.toFixed(3)+p.lon.toFixed(3)+rad,c=cacheGet(key);if(c)return c;
  const a=`(around:${rad},${p.lat.toFixed(5)},${p.lon.toFixed(5)})`;
  const q=`[out:json][timeout:25];(way["leisure"~"^(park|track|garden)$"]${a};relation["leisure"="park"]${a};way["highway"~"^(footway|path|pedestrian|cycleway)$"]["name"]${a};way["highway"~"^(footway|path|cycleway)$"]["bicycle"="designated"]${a};way["waterway"="river"]${a};way["natural"="water"]["water"="river"]${a};);out center 300;`;
  const j=await fetchJ('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'}},30000);
  const pts=j.elements.filter(e=>e.center).map(e=>{const t=e.tags||{};return {lat:e.center.lat,lon:e.center.lon,
    w:t.leisure==='park'?3:t.leisure==='track'?3:t.waterway||t.natural?2:t.leisure?2:1,name:t.name||''}});
  cacheSet(key,pts);return pts}
function snap(ideal,greens,maxD){let best=null,bs=-1;for(const g of greens){const d=hav(ideal,g);if(d>maxD)continue;const s=g.w*(1-d/maxD);if(s>bs){bs=s;best=g}}return best}
async function route(pts){const s=pts.map(p=>p.lon.toFixed(5)+','+p.lat.toFixed(5)).join(';');
  const j=await fetchJ(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${s}?overview=full&geometries=geojson&continue_straight=false`,null,20000);
  if(j.code!=='Ok'||!j.routes.length)throw new Error('route');return {dist:j.routes[0].distance,coords:j.routes[0].geometry.coordinates.map(c=>[c[1],c[0]])}}
async function elevation(coords,dist){const n=Math.min(60,coords.length),step=(coords.length-1)/(n-1),s=[];
  for(let i=0;i<n;i++)s.push(coords[Math.round(i*step)]);
  const j=await fetchJ(`https://api.open-meteo.com/v1/elevation?latitude=${s.map(c=>c[0].toFixed(5)).join(',')}&longitude=${s.map(c=>c[1].toFixed(5)).join(',')}`,null,15000);
  const e=j.elevation;let up=0;for(let i=1;i<e.length;i++)if(e[i]>e[i-1])up+=e[i]-e[i-1];return {prof:e,climb:Math.round(up)}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function makeCourses(){
  const p=CR.loc,D=CR.dist*1000;CR.courses=[];CR.sel=null;
  let greens=[];try{greens=await greenPoints(p,Math.round(D/2.5))}catch(e){CR.msg='주변 공원 정보를 불러오지 못해 일반 도로 기준으로 추천해요.'}
  const startBrg=Math.random()*360;
  for(let k=0;k<3;k++){const brg=startBrg+k*120;let r=D/4.2,best=null;
    for(let tryN=0;tryN<2;tryN++){
      const i1=dest(p,brg-30,r),i2=dest(p,brg+30,r);
      const w1=snap(i1,greens,r*0.45)||i1,w2=snap(i2,greens,r*0.45)||i2;
      try{const rt=await route([p,w1,w2,p]);rt.green=[w1,w2].filter(w=>w.w).map(w=>w.name).filter(Boolean);rt.gc=[w1,w2].filter(w=>w.w).length;
        if(!best||Math.abs(rt.dist-D)<Math.abs(best.dist-D))best=rt;
        if(Math.abs(rt.dist-D)/D<0.12)break; r*=D/rt.dist;}catch(e){}
      await sleep(400);}
    if(best)CR.courses.push(best);courseRender();}
  if(!CR.courses.length)throw new Error('none');
  CR.courses.sort((a,b)=>b.gc-a.gc||Math.abs(a.dist-D)-Math.abs(b.dist-D));
  for(const c of CR.courses){try{Object.assign(c,await elevation(c.coords,c.dist))}catch(e){c.elevErr=true}await sleep(300)}
  CR.sel=0}
const COLORS=['#ff5a36','#4a7cff','#16a34a'];
function locate(){return new Promise((res,rej)=>{if(!('geolocation' in navigator))return rej({code:9});navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy}),rej,{enableHighAccuracy:true,timeout:15000,maximumAge:60000})})}
function geoMsg(e){return e&&e.code===1?'위치 권한이 거부되었어요. iPhone 설정 → 개인정보 보호 및 보안 → 위치 서비스 → Safari 웹사이트 → "앱을 사용하는 동안"으로 바꿔 주세요.':e&&e.code===9?'이 브라우저는 위치 기능을 지원하지 않아요.':'현재 위치를 찾지 못했어요. 하늘이 트인 곳에서 다시 시도해 주세요.'}
function profSvg(e){if(!e||e.length<2)return '';const mn=Math.min(...e),mx=Math.max(...e),h=Math.max(10,mx-mn),W=300,H=60;
  const d=e.map((v,i)=>`${(i/(e.length-1)*W).toFixed(1)},${(H-(v-mn)/h*(H-6)-3).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:60px;display:block"><polygon points="0,${H} ${d} ${W},${H}" fill="#ffd9cf"/><polyline points="${d}" fill="none" stroke="#ff5a36" stroke-width="2"/></svg><div class="sub" style="display:flex;justify-content:space-between"><span>최저 ${Math.round(mn)}m</span><span>최고 ${Math.round(mx)}m</span></div>`}
function drawCourses(){if(!CR.map)return;CR.layers.forEach(l=>CR.map.removeLayer(l));CR.layers=[];
  if(CR.loc)CR.layers.push(L.circleMarker([CR.loc.lat,CR.loc.lon],{radius:8,color:'#fff',weight:3,fillColor:'#4a7cff',fillOpacity:1}).addTo(CR.map).bindTooltip('현재 위치'));
  CR.courses.forEach((c,i)=>{const on=CR.sel===i||CR.sel==null;CR.layers.push(L.polyline(c.coords,{color:COLORS[i],weight:CR.sel===i?6:4,opacity:on?.9:.3}).addTo(CR.map).on('click',()=>{CR.sel=i;courseRender()}))});
  const s=CR.courses[CR.sel];if(s)CR.map.fitBounds(L.polyline(s.coords).getBounds(),{padding:[20,20]});else if(CR.courses.length)CR.map.fitBounds(L.featureGroup(CR.layers).getBounds(),{padding:[20,20]})}
function courseView(){
  app.innerHTML=`<h1>코스 추천</h1><p class="sub">내 주변 공원·강변길·트랙을 지나는 순환 코스를 찾아드려요.</p>
  <div class="chips" id="dsel">${[3,5,10].map(d=>`<label><input type="radio" name="cd" value="${d}" ${CR.dist===d?'checked':''}>${d}km</label>`).join('')}</div>
  <div id="cmap" style="height:300px;border-radius:16px;margin:10px 0;background:#e8ecf1"></div>
  <div id="cbody"></div>`;
  document.querySelectorAll('#dsel input').forEach(x=>x.onchange=()=>{CR.dist=+x.value;CR.courses=[];CR.sel=null;CR.msg='';courseRender()});
  if(!leafletOk()){$('#cmap').innerHTML='<div class="warn" style="margin:0">지도를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.</div>';CR.map=null}
  else{CR.map=mkMap('cmap',CR.loc?[CR.loc.lat,CR.loc.lon]:[37.5665,126.978],CR.loc?15:12);setTimeout(()=>CR.map&&CR.map.invalidateSize(),50)}
  courseRender();
  if(!CR.loc&&!CR.busy){locate().then(p=>{CR.loc=p;if(CR.map)CR.map.setView([p.lat,p.lon],15);courseRender()}).catch(e=>{CR.msg=geoMsg(e);courseRender()})}}
function courseRender(){const b=$('#cbody');if(!b)return;drawCourses();
  const D=CR.dist;let h=CR.msg?`<div class="warn">${CR.msg}</div>`:'';
  if(CR.busy)h+=`<div class="card">⏳ 코스를 찾는 중이에요… (${CR.courses.length}/3)</div>`;
  else h+=`<button class="btn" id="cfind" ${CR.loc?'':'disabled style="opacity:.5"'}>${CR.courses.length?'🔄 다른 코스 찾기':`📍 ${D}km 코스 추천받기`}</button>${CR.loc?'':'<p class="sub" style="margin-top:6px">현재 위치를 확인하는 중…</p>'}`;
  CR.courses.forEach((c,i)=>{h+=`<div class="card" data-c="${i}" style="border:2px solid ${CR.sel===i?COLORS[i]:'transparent'};cursor:pointer">
   <b style="color:${COLORS[i]}">코스 ${i+1}</b> · ${km(c.dist)}km · ${c.climb!=null?`오르막 ${c.climb}m`:c.elevErr?'고도 정보 없음':'고도 계산 중…'}
   <div class="sub">${c.gc?`🌳 ${c.green.length?esc([...new Set(c.green)].join(', ')):'공원·산책로'} 경유`:'일반 보행로 위주'}</div>
   ${CR.sel===i&&c.prof?profSvg(c.prof):''}</div>`});
  if(CR.sel!=null&&!CR.busy)h+=`<button class="btn blue" id="cgo">▶ 코스 ${CR.sel+1}로 달리기 시작</button>`;
  h+=`<p class="sub" style="margin-top:10px">지도 데이터 © OpenStreetMap 기여자 · 경로: OSRM(FOSSGIS) · 고도: Open-Meteo. 추천 코스는 참고용이에요. 횡단보도·공사 구간 등 실제 상황을 꼭 확인하세요.</p>`;
  b.innerHTML=h;
  document.querySelectorAll('[data-c]').forEach(x=>x.onclick=()=>{CR.sel=+x.dataset.c;courseRender()});
  if($('#cfind'))$('#cfind').onclick=async()=>{if(!CR.loc)return;CR.busy=true;CR.msg='';courseRender();
    try{await makeCourses()}catch(e){CR.msg=navigator.onLine===false?'인터넷에 연결되어 있지 않아요.':'코스를 찾지 못했어요. 경로 서버가 바쁠 수 있으니 잠시 후 다시 시도해 주세요.'}
    CR.busy=false;courseRender()};
  if($('#cgo'))$('#cgo').onclick=()=>{const c=CR.courses[CR.sel];T.course={coords:c.coords,dist:c.dist};tab='run';startRun()}}
// live map on run screen
let RM=null,RL=null;
function runMapInit(){const el=$('#rmap');if(!el||!leafletOk())return;const c=T.course;
  RM=mkMap(el,c?c.coords[0]:[37.5665,126.978],15);if(c){const pl=L.polyline(c.coords,{color:'#ff5a36',weight:5,opacity:.5}).addTo(RM);RM.fitBounds(pl.getBounds(),{padding:[15,15]})}
  RL=L.polyline([],{color:'#4a7cff',weight:5}).addTo(RM);runMapUpd()}
function runMapUpd(){if(!RM||!RL||!document.body.contains(RM.getContainer()))return;const ll=T.pts.map(p=>[p.lat,p.lon]);RL.setLatLngs(ll);if(ll.length&&!T.course)RM.panTo(ll[ll.length-1])}
function histMap(el,r){if(!leafletOk()){el.innerHTML='<div class="sub">지도를 불러오지 못했어요.</div>';return}
  if(!r.path||r.path.length<2){el.innerHTML='<div class="sub" style="padding:10px">저장된 경로가 없어요.</div>';el.style.height='auto';return}
  const m=mkMap(el,r.path[0],15);if(r.course)L.polyline(r.course,{color:'#ff5a36',weight:4,opacity:.4,dashArray:'6 6'}).addTo(m);
  const pl=L.polyline(r.path,{color:'#4a7cff',weight:5}).addTo(m);m.fitBounds(pl.getBounds(),{padding:[15,15]})}
