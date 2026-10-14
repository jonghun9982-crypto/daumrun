'use strict';
const $=s=>document.querySelector(s), app=$('#app');
const DAYS=['일','월','화','수','목','금','토'];
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
let profile=LS.get('dr_profile',null), runs=LS.get('dr_runs',[]), chat=LS.get('dr_chat',[]);
const ymd=d=>{d=new Date(d);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fmtT=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+':':'')+String(m).padStart(h?2:1,'0')+':'+String(x).padStart(2,'0')};
const fmtP=(sec,m)=>m<20?'--:--':fmtT(sec/(m/1000));
const km=m=>(m/1000).toFixed(2);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------- plan engine (deterministic rules) ----------
function weekStart(d){d=new Date(d);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
function weekMin(ws){const e=new Date(ws);e.setDate(e.getDate()+7);return runs.filter(r=>new Date(r.start)>=ws&&new Date(r.start)<e).reduce((a,r)=>a+r.sec/60,0)}
function planFor(date){
  const d=new Date(date);d.setHours(0,0,0,0);
  if(!profile)return null;
  const today=new Date();today.setHours(0,0,0,0);
  const avail=profile.days.slice().sort((a,b)=>((a+6)%7)-((b+6)%7)); // Mon-first order
  const notes=[];
  if(profile.paused) return {type:'rest',title:'계획 일시정지',min:0,why:'위험 증상이 보고되어 계획을 멈췄습니다. 의료기관 상담 후 설정에서 다시 시작하세요.',notes};
  if(!avail.includes(d.getDay())){
    const prev=new Date(d);prev.setDate(d.getDate()-1);
    return {type:'rest',title:'오늘은 쉬는 날입니다',min:0,why:avail.includes(prev.getDay())?'어제 운동 후 회복하는 날이에요. 몸이 강해지는 건 쉬는 동안입니다.':'정해진 휴식일입니다. 산책·스트레칭은 원할 때만 가볍게.',notes};
  }
  const idx=avail.indexOf(d.getDay()), n=avail.length;
  let type= n>=3&&idx===n-1?'long': n>=2&&idx===1?'interval':'easy';
  // R4: no hard day right after hard day
  if(type==='long'&&n>=3&&idx-1===1&&((avail[idx]-avail[idx-1]+7)%7)===1) type='easy';
  // weekly volume: base minutes, +10%/week from start, recovery week every 4th
  const ws=weekStart(d), wk=Math.max(0,Math.floor((ws-weekStart(profile.created))/(7*864e5)));
  let target=profile.baseMin*Math.pow(1.1,wk-Math.floor(wk/4)); if(wk%4===3){target*=0.8;notes.push('회복 주: 이번 주는 볼륨을 20% 줄였어요(R2).')}
  // R1: cap vs last week's actual (+10%)
  const pw=new Date(ws);pw.setDate(pw.getDate()-7); const last=weekMin(pw);
  if(last>0&&target>last*1.1){target=last*1.1;notes.push(`지난주 실제 ${Math.round(last)}분 기준 +10% 상한(${Math.round(target)}분)을 적용했어요(R1).`)}
  // R8: gap >=7 days
  const lastRun=runs.length?new Date(runs[runs.length-1].start):null;
  if(runs.length&&(d-lastRun)/864e5>=7){target*=0.7;notes.push('7일 이상 쉬었으니 낮은 볼륨으로 다시 시작해요(R8).')}
  const share={easy:1,interval:1,long:1.4}, tot=avail.reduce((a,x,i)=>a+share[n>=3&&i===n-1?'long':n>=2&&i===1?'interval':'easy'],0);
  let min=Math.max(15,Math.round(target*share[type]/tot/5)*5);
  // R6: pain >=4 -> next 2 sessions eased
  const pain=runs.filter(r=>r.pain>=4).pop();
  if(pain){const after=avail.length?sessionsBetween(new Date(pain.start),d,avail):99;
    if(after<=2&&d>=today){ if(after===1){return {type:'rest',title:'오늘은 쉬는 날입니다',min:0,why:`${ymd(pain.start)} 기록에서 ${esc(pain.part||'통증')} ${pain.pain}/10을 알려주셨어요. 회복을 위해 휴식으로 바꿨습니다(R6).`,notes,eased:true}}
      type='easy';min=Math.max(15,Math.round(min*0.5));notes.push(`최근 통증 ${pain.pain}/10 때문에 강도를 낮췄어요(R6). 통증이 다시 생기면 즉시 멈추세요.`)}
    const painCount=runs.filter(r=>r.pain>=4).length; if(painCount>=3)notes.push('통증이 3회 이상 기록됐어요. 전문가(정형외과·물리치료) 상담을 권합니다.');}
  // R9: overperformance
  const lr=runs[runs.length-1]; if(lr&&lr.plannedMin&&lr.sec/60>lr.plannedMin*1.3&&(d-new Date(lr.start))/864e5<4&&d>=today)notes.push(`지난 기록이 계획보다 30% 이상 길었어요(${Math.round(lr.sec/60)}분/${lr.plannedMin}분). 오늘은 특히 천천히(R9).`);
  const T={easy:['쉬운 달리기','대화가 가능한 속도(RPE 3~4). 숨이 차면 걸어도 괜찮아요.','기초 체력을 쌓는 가장 중요한 운동이에요.'],
   interval:['걷뛰 인터벌','1분 달리기 + 2분 걷기 반복(RPE 5~6).','심폐 능력을 부담 없이 끌어올립니다.'],
   long:['롱런(천천히 길게)','가장 느린 편안한 속도. 시간만 채우면 성공!','지구력의 핵심. 속도보다 시간이 중요해요.']}[type];
  return {type,title:T[0],min,intensity:T[1],why:T[2],notes};
}
function sessionsBetween(a,b,avail){let c=0;const x=new Date(a);x.setHours(0,0,0,0);while(x<b){x.setDate(x.getDate()+1);if(avail.includes(x.getDay()))c++}return c}

// ---------- tracker ----------
const T={state:'idle',watch:null,pts:[],dist:0,elapsed:0,lastTick:0,timer:null,lock:null,err:''};
function hav(a,b){const R=6371e3,r=x=>x*Math.PI/180,dl=r(b.lat-a.lat),dn=r(b.lon-a.lon);const h=Math.sin(dl/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
async function lockOn(){try{if('wakeLock' in navigator)T.lock=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&T.state==='running')lockOn()});
function onPos(p){
  const c=p.coords, pt={lat:c.latitude,lon:c.longitude,acc:c.accuracy,t:p.timestamp};
  T.err=''; T.acc=c.accuracy;
  if(T.state!=='running')return;
  if(c.accuracy>50){upd();return}
  const prev=T.seg?null:T.pts[T.pts.length-1];T.seg=false;
  if(prev){const d=hav(prev,pt),dt=(pt.t-prev.t)/1000;
    if(d<Math.max(3,c.accuracy/3)){upd();return}      // jitter
    if(dt>0&&d/dt>12){upd();return}                   // >43km/h glitch
    T.dist+=d;}
  T.pts.push(pt); upd();
}
function onErr(e){T.err=e.code===1?'위치 권한이 거부되었습니다. iPhone 설정 → 개인정보 보호 및 보안 → 위치 서비스 → Safari 웹사이트 → "앱을 사용하는 동안"으로 바꾼 뒤 새로고침하세요.':e.code===2?'GPS 신호를 찾을 수 없어요. 하늘이 트인 곳으로 이동해 보세요.':'위치 확인이 지연되고 있어요. 잠시 기다려 주세요.';
  if(e.code===1&&T.state!=='idle'&&T.pts.length===0){stopWatch();T.state='idle';const m=T.err;render();T.err=m;upd();return} upd()}
function startWatch(){if(!('geolocation' in navigator)){T.err='이 브라우저는 위치 기능을 지원하지 않아요.';return false}
  T.watch=navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:0,timeout:20000});return true}
function stopWatch(){if(T.watch!=null)navigator.geolocation.clearWatch(T.watch);T.watch=null;clearInterval(T.timer);if(T.lock){T.lock.release().catch(()=>{});T.lock=null}}
function tick(){const n=Date.now();if(T.state==='running')T.elapsed+=(n-T.lastTick)/1000;T.lastTick=n;upd();LS.set('dr_live',{dist:T.dist,elapsed:T.elapsed,start:T.start,pts:T.pts.slice(-2000)})}
function startRun(){Object.assign(T,{state:'running',pts:[],dist:0,elapsed:0,lastTick:Date.now(),start:new Date().toISOString(),err:''});
  if(!startWatch()){T.state='idle';render();return} lockOn();T.timer=setInterval(tick,1000);render()}
function pauseRun(){if(T.state==='running'){tick();T.state='paused'}else{T.state='running';T.lastTick=Date.now();T.seg=true;lockOn()}render()}
function stopRun(){tick();stopWatch();T.state='checkin';localStorage.removeItem('dr_live');render()}
function upd(){const e=$('#live');if(!e)return;
  e.innerHTML=`<div class="stat"><div><b>${km(T.dist)}</b>km</div><div><b>${fmtT(T.elapsed)}</b>시간</div><div><b>${fmtP(T.elapsed,T.dist)}</b>/km 평균</div></div>
  <p class="sub" style="text-align:center;margin-top:8px">${T.state==='paused'?'⏸ 일시정지됨':T.acc!=null?`GPS 정확도 ±${Math.round(T.acc)}m`:'GPS 신호 찾는 중…'}</p>${T.err?`<div class="warn">${T.err}</div>`:''}`}

// ---------- views ----------
let tab='home';
function nav(){$('#tabs').innerHTML=profile?[['home','🏠','오늘'],['run','🏃','달리기'],['plan','📅','기록·플랜'],['chat','💬','AI 코치'],['set','⚙️','설정']].map(([k,i,l])=>`<a href="#" data-t="${k}" class="${tab===k?'on':''}"><b>${i}</b>${l}</a>`).join(''):'';
  document.querySelectorAll('#tabs a').forEach(a=>a.onclick=ev=>{ev.preventDefault();if(T.state==='running'||T.state==='paused'){tab='run'}else tab=a.dataset.t;render()})}
function render(){nav();app.scrollTop=0;
  if(!profile)return onboarding();
  ({home,run:runView,plan:planView,chat:chatView,set:settings})[tab]()}
function onboarding(){app.innerHTML=`<h1>다음런에 오신 걸 환영해요 👋</h1><p class="sub">몇 가지만 알려주시면 오늘 할 운동을 정해 드려요. 기록은 이 iPhone에만 저장됩니다.</p>
 <div class="card"><b>지금 수준</b><select id="lv"><option value="0">거의 안 뛰어 봤어요</option><option value="1">런데이 등 30분 달리기 가능</option><option value="2">주 3회 이상 꾸준히 뛰어요</option></select>
 <b>목표</b><select id="goal"><option>5km 완주</option><option>10km 완주</option><option>꾸준히 건강하게</option></select>
 <b>달릴 수 있는 요일 (2~5일)</b><div class="chips">${DAYS.map((d,i)=>`<label><input type="checkbox" value="${i}" ${[2,4,6].includes(i)?'checked':''}>${d}</label>`).join('')}</div></div>
 <div id="oerr"></div><button class="btn" id="go">플랜 만들기</button>`;
 $('#go').onclick=()=>{const days=[...document.querySelectorAll('.chips input:checked')].map(x=>+x.value);
  if(days.length<2||days.length>5){$('#oerr').innerHTML='<div class="warn">요일을 2~5일 골라 주세요. 주 2일 이상은 꼭 쉬어야 해요(R3).</div>';return}
  const lv=+$('#lv').value;profile={level:lv,goal:$('#goal').value,days,baseMin:[60,90,130][lv],created:new Date().toISOString(),memory:[]};LS.set('dr_profile',profile);tab='home';render()}}
function card(p,big=true){if(!p)return'';const rest=p.type==='rest';
 return `<div class="card hero ${rest?'rest':''}"><span class="tag">${rest?'휴식':p.title}</span><div class="big">${rest?p.title:p.min+'분'}</div>${rest?'':`<div>${p.intensity}</div>`}<p style="margin-top:8px;font-size:14px;opacity:.9">${p.why}</p></div>${p.notes.map(n=>`<div class="warn">${n}</div>`).join('')}`}
function home(){const p=planFor(new Date()),done=runs.filter(r=>ymd(r.start)===ymd(new Date()));
 app.innerHTML=`<p class="sub">${new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'})}</p><h1>오늘의 운동</h1>${card(p)}
 ${done.length?`<div class="card">✅ 오늘 ${km(done.reduce((a,r)=>a+r.dist,0))}km 완료! 수고했어요.</div>`:''}
 ${p.type!=='rest'?'<button class="btn" id="go">달리기 시작</button>':'<button class="btn gray" id="go">그래도 가볍게 달리기</button>'}
 <h2>이번 주</h2><div class="card">${weekList()}</div>`;
 $('#go').onclick=()=>{tab='run';render()}}
function weekList(){const ws=weekStart(new Date());let h='';for(let i=0;i<7;i++){const d=new Date(ws);d.setDate(d.getDate()+i);const p=planFor(d),r=runs.filter(x=>ymd(x.start)===ymd(d));
 h+=`<div style="display:flex;justify-content:space-between;padding:6px 0;${ymd(d)===ymd(new Date())?'font-weight:700':''}"><span>${DAYS[d.getDay()]} ${d.getDate()}일</span><span>${p.type==='rest'?'😴 휴식':p.title+' '+p.min+'분'}${r.length?' ✅':''}</span></div>`}return h}
function runView(){
 if(T.state==='checkin')return checkin();
 const p=planFor(new Date());
 app.innerHTML=`<h1>달리기</h1><p class="sub">${T.state==='idle'?(p.type==='rest'?'오늘은 휴식일이에요. 가볍게만!':`목표: ${p.title} ${p.min}분`):''}</p>
 <div class="card" id="live"></div>
 ${T.state==='idle'?'<button class="btn" id="b1">▶ 시작</button><p class="sub" style="margin-top:10px">시작하면 위치 권한을 물어봐요. "허용"을 눌러 주세요. 달리는 동안 화면을 켜 두세요(잠그면 기록이 멈출 수 있어요).</p>':
 `<button class="btn ${T.state==='running'?'gray':'blue'}" id="b1">${T.state==='running'?'⏸ 일시정지':'▶ 다시 시작'}</button><button class="btn" id="b2" style="background:#16202c">■ 종료</button>`}`;
 upd(); $('#b1').onclick=T.state==='idle'?startRun:pauseRun; if($('#b2'))$('#b2').onclick=()=>{if(confirm('달리기를 종료할까요?'))stopRun()}}
function checkin(){app.innerHTML=`<h1>수고했어요! 🎉</h1><div class="card"><div class="stat"><div><b>${km(T.dist)}</b>km</div><div><b>${fmtT(T.elapsed)}</b></div><div><b>${fmtP(T.elapsed,T.dist)}</b>/km</div></div></div>
 <div class="card"><b>힘든 정도 (RPE 1~10)</b><input type="range" id="rpe" min="1" max="10" value="4" oninput="rv.textContent=this.value"> <span id="rv">4</span>
 <b>통증 (0 = 없음 ~ 10)</b><input type="range" id="pain" min="0" max="10" value="0" oninput="pv.textContent=this.value"> <span id="pv">0</span>
 <b>통증 부위 (있다면)</b><input id="part" placeholder="예: 왼쪽 무릎"><b>한 줄 메모</b><input id="memo" placeholder="예: 날씨 좋았음">
 <label style="font-size:14px"><input type="checkbox" id="red" style="width:auto"> 가슴 통증·어지러움·호흡곤란·붓기/절뚝임이 있었어요</label></div>
 <button class="btn" id="sv">저장</button><button class="btn gray" id="dc">기록 버리기</button>`;
 $('#sv').onclick=()=>{const p=planFor(new Date());const r={id:Date.now(),start:T.start,dist:Math.round(T.dist),sec:Math.round(T.elapsed),rpe:+$('#rpe').value,pain:+$('#pain').value,part:$('#part').value.trim(),memo:$('#memo').value.trim(),plannedMin:p.type==='rest'?0:p.min,planType:p.type,path:T.pts.filter((x,i)=>i%5===0).map(x=>[+x.lat.toFixed(5),+x.lon.toFixed(5)])};
  runs.push(r);LS.set('dr_runs',runs);if($('#red').checked){profile.paused=true;LS.set('dr_profile',profile);alert('위험 증상이 있으면 즉시 운동을 멈추고 의료기관에 문의하세요. 계획을 일시정지했습니다.')}
  T.state='idle';tab='home';render()};
 $('#dc').onclick=()=>{if(confirm('이 기록을 버릴까요?')){T.state='idle';render()}}}
let calM=new Date();calM.setDate(1);
function planView(){const y=calM.getFullYear(),m=calM.getMonth(),first=new Date(y,m,1),off=(first.getDay()+6)%7,dim=new Date(y,m+1,0).getDate();
 let cells=['월','화','수','목','금','토','일'].map(d=>`<b>${d}</b>`).join('')+'<div style="background:none"></div>'.repeat(off);
 for(let i=1;i<=dim;i++){const d=new Date(y,m,i),r=runs.filter(x=>ymd(x.start)===ymd(d)),p=planFor(d);
  cells+=`<div class="${r.length?'done':''} ${ymd(d)===ymd(new Date())?'today':''}"><b>${i}</b><br>${r.length?km(r.reduce((a,x)=>a+x.dist,0))+'k':p.type==='rest'?'😴':{easy:'쉬운',interval:'걷뛰',long:'롱런'}[p.type]+'<br>'+p.min+'′'}</div>`}
 const tot=runs.reduce((a,r)=>a+r.dist,0);
 app.innerHTML=`<h1>기록·플랜</h1><div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><a href="#" id="pm">◀</a><b>${y}년 ${m+1}월</b><a href="#" id="nm">▶</a></div><div class="cal">${cells}</div><p class="sub" style="margin-top:8px">초록 = 달린 날 · 😴 = 휴식</p></div>
 <h2>전체 ${runs.length}회 · ${km(tot)}km</h2>${runs.slice().reverse().map(r=>`<div class="card"><b>${new Date(r.start).toLocaleDateString('ko-KR',{month:'short',day:'numeric',weekday:'short'})}</b> · ${km(r.dist)}km · ${fmtT(r.sec)} · ${fmtP(r.sec,r.dist)}/km<br><span class="sub">RPE ${r.rpe}${r.pain?` · 통증 ${r.pain}/10 ${esc(r.part)}`:''}${r.memo?' · '+esc(r.memo):''}</span> <a href="#" data-del="${r.id}" style="float:right;color:#a12b10;font-size:12px">삭제</a></div>`).join('')||'<div class="card">아직 기록이 없어요. 첫 달리기를 시작해 보세요!</div>'}`;
 $('#pm').onclick=e=>{e.preventDefault();calM.setMonth(m-1);planView()};$('#nm').onclick=e=>{e.preventDefault();calM.setMonth(m+1);planView()};
 document.querySelectorAll('[data-del]').forEach(a=>a.onclick=e=>{e.preventDefault();if(confirm('이 기록을 삭제할까요?')){runs=runs.filter(r=>r.id!=a.dataset.del);LS.set('dr_runs',runs);planView()}})}

// ---------- rule-based coach ----------
function reply(q){
 const s=q.replace(/\s/g,'');
 if(/가슴|어지러|호흡곤란|숨이안|기절|붓|절뚝/.test(s)){profile.paused=true;LS.set('dr_profile',profile);return '⚠️ 지금 바로 운동을 멈추세요. 가슴 통증·어지러움·호흡곤란·붓기·절뚝임은 위험 신호일 수 있어요. 증상이 계속되면 119 또는 가까운 의료기관에 연락하세요.\n계획을 일시정지했습니다(R7). 저는 진단을 할 수 없어요.'}
 if(!runs.length&&/기록|페이스|거리|얼마|지난|이번주|최장/.test(s))return '기록이 없어 판단하기 어렵습니다. 첫 달리기를 기록하면 실제 수치로 알려드릴게요.';
 const ws=weekStart(new Date()),wr=runs.filter(r=>new Date(r.start)>=ws),pw=new Date(ws);pw.setDate(pw.getDate()-7);
 const lw=runs.filter(r=>new Date(r.start)>=pw&&new Date(r.start)<ws),sum=a=>a.reduce((x,r)=>x+r.dist,0),last=runs[runs.length-1];
 if(/아파|통증|무릎|발목|정강|허리|발바닥|부상/.test(s)){const m=q.match(/(\d+)\s*(\/\s*10|점)/);
  return `통증이 있다니 걱정되네요. 저는 진단은 할 수 없고, 운동 조정만 도와드릴게요.\n• 달리는 중 통증이 생기거나 심해지면 바로 멈추세요.\n• 통증이 4/10 이상이면 달리기 후 체크인에 기록해 주세요. 다음 운동이 자동으로 휴식→가벼운 운동으로 바뀝니다(R6).${m&&+m[1]>=4?`\n• 말씀하신 ${m[1]}/10은 기준(4) 이상이에요. 오늘은 쉬는 걸 권합니다.`:''}\n• 같은 부위가 반복해서 아프면 정형외과·물리치료 상담을 받아 보세요.`}
 if(/오늘|뭐해|뭐하|운동/.test(s)){const p=planFor(new Date());return p.type==='rest'?`오늘은 휴식일이에요. ${p.why.replace(/<[^>]+>/g,'')}`:`오늘은 ${p.title} ${p.min}분입니다. ${p.intensity}\n${p.notes.join('\n')}`}
 if(/이번주|주간/.test(s))return `이번 주: ${wr.length}회, ${km(sum(wr))}km, ${Math.round(wr.reduce((a,r)=>a+r.sec,0)/60)}분.\n지난주: ${lw.length}회, ${km(sum(lw))}km.\n다음 주 볼륨은 지난주 실제 기록 대비 +10% 이내로만 늘려요(R1).`;
 if(/페이스|빨라|느려|속도/.test(s)){const v=runs.filter(r=>r.dist>=500);if(!v.length)return '500m 이상 기록이 없어 페이스를 판단하기 어렵습니다.';const b=v.reduce((a,r)=>r.sec/r.dist<a.sec/a.dist?r:a);
  return `최근 기록 페이스: ${fmtP(last.sec,last.dist)}/km (${km(last.dist)}km).\n가장 빠른 평균 페이스: ${fmtP(b.sec,b.dist)}/km (${ymd(b.start)}).\n초보 단계에서는 속도보다 '대화 가능한 속도'로 시간을 늘리는 게 더 중요해요.`}
 if(/최장|가장길|제일길/.test(s)){const b=runs.reduce((a,r)=>r.dist>a.dist?r:a);return `가장 긴 기록은 ${ymd(b.start)} ${km(b.dist)}km (${fmtT(b.sec)})입니다.`}
 if(/지난|최근|마지막|기록/.test(s))return `마지막 기록: ${ymd(last.start)} ${km(last.dist)}km, ${fmtT(last.sec)}, ${fmtP(last.sec,last.dist)}/km, RPE ${last.rpe}${last.pain?`, 통증 ${last.pain}/10`:''}.\n총 ${runs.length}회 ${km(sum(runs))}km를 달렸어요.`;
 if(/더|늘려|많이|빨리|마라톤|하프/.test(s))return `의욕 좋아요! 다만 안전을 위해 주간 운동량은 지난주보다 10% 넘게 늘리지 않아요(R1). 지난주 ${km(sum(lw))}km였으니 이번 주는 그 기준 안에서 조금씩 늘리고, 3~4주마다 회복 주를 둡니다(R2).`;
 if(/못뛰|바빠|출장|시간이없|빠질/.test(s))return '괜찮아요! 한 번 빠져도 따라잡으려고 몰아서 뛰지 마세요. 다음 예정된 운동을 그대로 하면 됩니다. 7일 이상 쉬면 볼륨을 낮춰 다시 시작해요(R8). 요일을 바꾸려면 설정에서 달릴 요일을 수정하세요.';
 if(/피곤|힘들|지쳐/.test(s))return `${last?`마지막 기록 RPE는 ${last.rpe}였어요. `:''}피곤하면 오늘을 휴식으로 바꿔도 괜찮아요. 쉬는 것도 훈련입니다.`;
 return '저는 저장된 기록을 바탕으로 답하는 규칙 기반 코치예요. 이렇게 물어보세요:\n• 오늘 뭐 해?\n• 이번 주 얼마나 뛰었어?\n• 내 페이스 어때?\n• 무릎이 아파요\n• 이번 주 못 뛰어요';
}
function chatView(){app.innerHTML=`<h1>AI 코치</h1><p class="sub">규칙 기반 · 저장된 기록만 인용 · 진단하지 않음</p><div id="msgs">${(chat.length?chat:[{w:'bot',t:reply('')}]).map(m=>`<div class="msg ${m.w}">${esc(m.t)}</div>`).join('')}</div>
 <div style="display:flex;gap:6px"><input id="q" placeholder="메시지 입력"><button class="btn" id="send" style="width:70px;margin:4px 0 10px">전송</button></div><a href="#" id="clr" class="sub">대화 지우기</a>`;
 const send=()=>{const q=$('#q').value.trim();if(!q)return;chat.push({w:'me',t:q},{w:'bot',t:reply(q)});chat=chat.slice(-60);LS.set('dr_chat',chat);chatView();app.scrollTop=1e6;$('#q').focus()};
 $('#send').onclick=send;$('#q').onkeydown=e=>{if(e.key==='Enter')send()};$('#clr').onclick=e=>{e.preventDefault();chat=[];LS.set('dr_chat',chat);chatView()}}
function settings(){app.innerHTML=`<h1>설정</h1>${profile.paused?'<div class="warn">계획이 일시정지 상태예요(위험 증상 보고). 의료 상담 후 아래 버튼으로 재개하세요.</div><button class="btn blue" id="rs">계획 재개</button>':''}
 <div class="card"><b>달릴 요일</b><div class="chips">${DAYS.map((d,i)=>`<label><input type="checkbox" value="${i}" ${profile.days.includes(i)?'checked':''}>${d}</label>`).join('')}</div><button class="btn" id="sd">요일 저장</button></div>
 <div class="card">목표: ${esc(profile.goal)}<br>저장된 기록: ${runs.length}개 (이 기기에만 저장)</div>
 <button class="btn gray" id="ex">기록 내보내기(JSON 복사)</button><button class="btn" style="background:#a12b10" id="rst">모든 데이터 초기화</button>
 <p class="sub" style="margin-top:12px">다음런 웹앱 v1 · 데이터는 Safari 저장소에만 있어요. Safari 방문 기록/웹사이트 데이터를 지우면 함께 삭제됩니다.</p>`;
 if($('#rs'))$('#rs').onclick=()=>{profile.paused=false;LS.set('dr_profile',profile);settings()};
 $('#sd').onclick=()=>{const d=[...document.querySelectorAll('.chips input:checked')].map(x=>+x.value);if(d.length<2||d.length>5)return alert('2~5일을 골라 주세요(주 2일 이상 휴식).');profile.days=d;LS.set('dr_profile',profile);alert('저장했어요.')};
 $('#ex').onclick=async()=>{const t=JSON.stringify({profile,runs});try{await navigator.clipboard.writeText(t);alert('복사했어요. 메모 앱에 붙여 넣어 보관하세요.')}catch(e){prompt('아래 내용을 복사하세요',t)}};
 $('#rst').onclick=()=>{if(confirm('모든 기록과 플랜을 삭제할까요? 되돌릴 수 없어요.')){localStorage.clear();location.reload()}}}

// recover a run interrupted by reload
const live=LS.get('dr_live',null);
if(live&&profile&&live.elapsed>30&&confirm(`중단된 달리기(${km(live.dist)}km, ${fmtT(live.elapsed)})가 있어요. 저장 화면으로 갈까요?`)){Object.assign(T,live,{state:'checkin'});tab='run'}else localStorage.removeItem('dr_live');
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
render();
