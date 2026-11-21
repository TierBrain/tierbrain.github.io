/* Twelve Lamps: Carry the Light (v2). All twelve worlds are eligible; each session draws three to five of them, balanced by what the bearer
   actually does (notice, deduce, judge a risk, stay steady, hold on, move fast). The group sees tonight's lamps up front, chooses its route,
   passes the lamp to a different bearer each time, gets one final return to a lamp that stayed dark, and ends by seeing who brought each lamp home. */
(function(){'use strict';
const $=id=>document.getElementById(id);
const W={
 redsea:['Race Pharaoh\u2019s chariots across the sea','speed'],jonah:['Dive deep, and know when to surface','risk'],
 paul:['Name the city from the clues','deduce'],joseph:['Find the silver cup','deduce'],
 galilee:['Brave the storm','risk'],scroll:['Read the scroll by torchlight','notice'],
 ark:['Watch the animals board','notice'],lamps:['Keep one lamp burning','endure'],
 nehemiah:['Keep the wall going up','steady'],jacob:['Climb the ladder before the dawn','speed'],
 sinai:['Carve the two tablets','steady'],daniel:['Bring Daniel through the night','endure']};
const SKILL={notice:'Notice',deduce:'Deduce',risk:'Judge a risk',steady:'Stay steady',endure:'Hold on',speed:'Move fast'};
const FIRST={ark:'The ramp is coming up. Watch the last few animals carefully. Once that door shuts, somebody will ask what you saw.',
 joseph:'Four brothers have stopped on the road. Somewhere among their sacks is a silver cup. How much evidence will you need before you name a name?',
 daniel:'You can hear one of them breathing. Get the next answer right and it settles. Wake three at once and it will be a very long night.'};
const BACK={ark:'Back on the ramp. Look harder this time.',joseph:'Back at the sacks. Take your time, and trust the clues.',daniel:'Back in the den. This time, let\u2019s get Daniel to dawn.'};
const RK='tb-twelve-lamps-recent';
const st=document.createElement('style');
st.textContent='#carryBox{display:grid;gap:10px;margin-top:8px}#carryBox h3{margin:0;font-size:18px}#carryBox p{margin:0;opacity:.8;font-size:14px}#carryBox .btn{width:100%;text-align:left;font-size:17px;padding:12px 20px}#carryBox small{display:block;font-weight:600;opacity:.75;font-size:13px;margin-top:2px}#carryBox .row{display:flex;flex-wrap:wrap;gap:8px}#carryBox .row .btn{width:auto;text-align:center}#carryBox .card2{display:grid;gap:6px;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(243,217,143,.3)}#carryEnd{list-style:none;margin:0 0 18px;padding:0;display:grid;gap:6px;font-size:clamp(16px,1.8vw,22px)}#carryEnd .dark{opacity:.55}#carryAgain{font-family:var(--flour);font-style:italic;margin:0 0 18px;color:#f6e6c4}';
document.head.appendChild(st);

/* ---------- The lamp shelf: twelve oil lamps on dark boards, each engraved with its world's emblem ---------- */
const EMB={
 redsea:'M3 14q3-5 6 0t6 0t6 0M3 19q3-5 6 0t6 0t6 0M4 8v4M20 8v4',jonah:'M3 12q5-7 12 0q-7 7-12 0zM15 12l6-4v8z',
 paul:'M12 4v13M12 5q6 3 6 10h-6M5 18h14l-2 3H7z',joseph:'M7 4h10l-1 6q-1 3-3 4v4h3v2H8v-2h3v-4q-2-1-3-4z',
 galilee:'M4 15h16l-3 4H7zM12 15V5l6 8h-6z',scroll:'M6 5h12v12H6zM9 9h6M9 12h6M6 5q-3 0-3 3t3 3M18 17q3 0 3-3t-3-3',
 ark:'M3 14h18l-3 5H6zM7 14v-4h10v4M6 10l6-4 6 4',lamps:'M12 3q-5 6 0 11q5-5 0-11zM8 19h8',
 nehemiah:'M3 9h18v10H3zM3 14h18M9 9v5M15 14v5',jacob:'M8 3l-2 18M16 3l2 18M7 8h10M6.5 12h11M6 16h12',
 sinai:'M5 4h6v14H5zM13 4h6v14h-6zM7 8h2M15 8h2M7 12h2M15 12h2',daniel:'M12 5a7 7 0 1 0 .1 0zM9 11h.1M15 11h.1M10 15q2 2 4 0'};
const SHC='shb';
function lampSVG(id,x,y,state,label,active){
  const lit=state==='lit',tonight=state!=='rest',s=tonight?1.25:.95,op=tonight?1:.38,brass='url(#'+SHC+')';
  let g='<g transform="translate('+x+' '+y+') scale('+s+')" opacity="'+op+'">';
  if(lit)g+='<circle cy="-40" r="130" fill="url(#'+SHC+'g)" class="sh-glow"/><g transform="translate(0 -170) scale(5.2) translate(-12 -12)" fill="none" stroke="#ffd27a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity=".28"><path d="'+EMB[id]+'"/></g>';
  if(active)g+='<circle cy="-4" r="86" fill="none" stroke="#fff6d2" stroke-width="2.5" stroke-dasharray="5 7" class="sh-ring"/>';
  g+='<ellipse cx="0" cy="8" rx="42" ry="22" fill="'+brass+'"/><path d="M36 4Q62 0 70 -14Q58 -16 40 -8Z" fill="'+brass+'"/><path d="M-40 2Q-58 -4 -56 -22Q-46 -22 -36 -12Z" fill="'+brass+'"/><ellipse cx="0" cy="-8" rx="26" ry="8" fill="#f0cf7a"/>'
    +'<g transform="translate(-10.5 -4) scale(.88)" fill="none" stroke="#5a3a10" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".8"><path d="'+EMB[id]+'"/></g>';
  g+=lit?'<g class="sh-flame"><path d="M0 -12Q-16 -34 0 -62Q6 -46 14 -36Q18 -22 0 -12Z" fill="#ff9a3c"/><path d="M0 -14Q-8 -28 0 -42Q5 -34 6 -28Q7 -20 0 -14Z" fill="#fff0b0"/></g>':'<circle cy="-12" r="3" fill="#2a1a10"/>';
  g+='</g>';
  if(label)g+='<text x="'+x+'" y="'+(y+58)+'" text-anchor="middle" font-size="22" font-weight="700" fill="'+(lit?'#ffe9b0':'#f6e6c4')+'" opacity="'+(lit?1:.85)+'">'+esc(label)+'</text>';
  return g;
}
function shelfHTML(S){
  const c=S.carry,D=window.__tl.D,T=c.targets,pos=[[150,250],[383,250],[617,250],[850,250]];
  let g='<defs><linearGradient id="'+SHC+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc8e"/><stop offset=".55" stop-color="#b8862f"/><stop offset="1" stop-color="#7a5420"/></linearGradient><radialGradient id="'+SHC+'g"><stop offset="0" stop-color="#ffb347" stop-opacity=".6"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient></defs>'
   +'<rect x="20" y="20" width="960" height="960" rx="30" fill="#0b0a22" fill-opacity=".72" stroke="#d8b25a" stroke-opacity=".5" stroke-width="3"/>';
  [0,1,2].forEach(r=>{ const by=300+r*310; g+='<rect x="50" y="'+by+'" width="900" height="26" rx="7" fill="#3a2514"/><rect x="50" y="'+by+'" width="900" height="6" rx="3" fill="#6a4426"/>'; });
  D.forEach((d,i)=>{ const r=Math.floor(i/4),k=i%4,x=pos[k][0],y=pos[k][1]+r*310,on=T.includes(i),lit=on&&S.owner[i]>=0;
    g+=lampSVG(d.id,x,y,lit?'lit':on?'tonight':'rest',on?d.name:'',S.pos===i&&S.phase&&S.phase!=='between'&&on&&!lit); });
  if(!T.length)g+='<text x="500" y="500" text-anchor="middle" font-size="30" font-weight="700" fill="#f6e6c4" opacity=".0">.</text>';
  return '<svg viewBox="0 0 1000 1000" role="img" aria-label="The twelve lamps on their shelf" style="width:100%;height:100%">'+g+'</svg>';
}
const SHCSS='#dialWrap.carry-on{position:relative}#dialWrap.carry-on #dial{opacity:0;pointer-events:none}#carryShelf{position:absolute;inset:0;display:grid;place-items:center}'
 +'.sh-flame{transform-box:fill-box;transform-origin:50% 100%;animation:lampf 1.6s ease-in-out infinite}.sh-glow{animation:shg 3.2s ease-in-out infinite}.sh-ring{animation:shr 4s linear infinite;transform-box:fill-box;transform-origin:center}'
 +'@keyframes shg{50%{opacity:.65}}@keyframes shr{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.sh-flame,.sh-glow,.sh-ring{animation:none}}';
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
/* three different primary skills for a three-lamp night; a five-lamp night still gets five different skills; worlds seen last time are avoided */
function draw(n){
  let recent=[];try{recent=JSON.parse(localStorage.getItem(RK)||'[]');}catch(e){}
  const bySkill={};Object.keys(W).forEach(id=>(bySkill[W[id][1]]=bySkill[W[id][1]]||[]).push(id));
  const picks=shuffle(Object.keys(bySkill)).slice(0,n).map(sk=>{const all=shuffle(bySkill[sk]),fresh=all.filter(i=>!recent.includes(i));return (fresh.length?fresh:all)[0];});
  try{localStorage.setItem(RK,JSON.stringify(picks));}catch(e){}
  return picks;
}

/* ---------- The lamp shelf: twelve engraved oil lamps on a dark wall. Tonight's lamps stand forward; a lit lamp throws its world up the wall. ---------- */
const GLYPH={redsea:'M2 4h6v16H2zM16 4h6v16h-6zM9 20L11 8h2l2 12z',jonah:'M2 12q7-8 14-4l6-4v16l-6-4q-7 4-14-4z',paul:'M11 2v14H4zM13 4l7 12h-7zM3 18h18l-3 4H6z',
 joseph:'M6 3h12l-1 6q-1 4-4 5v5h4v2H7v-2h4v-5q-3-1-4-5z',galilee:'M4 15h16l-3 5H7zM12 3v11l6-2z',scroll:'M5 4h14v13a3 3 0 0 0 3 3H8a3 3 0 0 1-3-3z',
 ark:'M2 14l3 6h14l3-6zM6 14V9h12v5zM12 4l8 5H4z',lamps:'M3 15q0 5 6 5h5q5 0 6-6l3-2-3-1-2 1q-1 3-6 3zM9 3q-3 4 0 8 3-4 0-8z',
 nehemiah:'M2 6h9v5H2zM13 6h9v5h-9zM2 13h5v5H2zM9 13h6v5H9zM17 13h5v5h-5z',jacob:'M7 2h2v20H7zM15 2h2v20h-2zM9 5h6v2H9zM9 10h6v2H9zM9 15h6v2H9z',
 sinai:'M3 8a4 4 0 0 1 8 0v12H3zM13 8a4 4 0 0 1 8 0v12h-8z',daniel:'M12 2l2 4 4-2-1 4 4 2-4 2 1 4-4-2-2 4-2-4-4 2 1-4-4-2 4-2-1-4 4 2z'};
const SHORT={redsea:'The Red Sea',jonah:'Jonah',paul:'Paul\u2019s journeys',joseph:'Joseph\u2019s cup',galilee:'Galilee',scroll:'The scroll cave',ark:'Noah\u2019s Ark',lamps:'The ten lamps',nehemiah:'The wall',jacob:'Jacob\u2019s ladder',sinai:'Mount Sinai',daniel:'The lions\u2019 den'};
const sst=document.createElement('style');
sst.textContent='#dialWrap.shelf-on #dial{opacity:0;pointer-events:none}#carryShelf{position:absolute;inset:0;z-index:2;pointer-events:none}#carryShelf svg{width:100%;height:100%;display:block}'
+'.sf-flame{transform-box:fill-box;transform-origin:50% 100%;animation:sff 1.1s ease-in-out infinite}@keyframes sff{50%{transform:scale(1.08,1.18) skewX(2deg)}}'
+'.sf-glow{animation:sfg 3s ease-in-out infinite}@keyframes sfg{50%{opacity:.6}}.sf-smoke{animation:sfs 4s ease-out infinite}@keyframes sfs{from{transform:translateY(0);opacity:.5}to{transform:translateY(-46px);opacity:0}}'
+'@media (prefers-reduced-motion:reduce){.sf-flame,.sf-glow,.sf-smoke{animation:none}}';
document.head.appendChild(sst);
function lampSvg(t,S,D){
  const c=S.carry,i=t,id=D[i].id,x=130+(i%4)*247,y=280+Math.floor(i/4)*290,tonight=c.targets.includes(i),drawn=c.targets.length>0;
  const lit=S.owner[i]>=0,cur=c.current===i&&!lit,tried=!lit&&!cur&&(c.tried[i]||0)>0;
  const sc=!drawn?1.05:tonight?1.4:.8,op=!drawn?.9:tonight?1:.34;
  const body=lit?'#e0b860':cur?'#b8873a':tried?'#6a5438':drawn&&!tonight?'#6a5438':'#8a6a3a',rim=lit?'#f3d98f':'#a8844a';
  let s='<g transform="translate('+x+' '+y+') scale('+sc+')" opacity="'+op+'">';
  if(lit)s+='<path d="M84 -54L-30 -190L198 -190Z" fill="url(#sf-cone)" opacity=".55"/><g transform="translate(0 -120) scale(4.5) translate(-12 -12)" fill="#ffd27a" opacity=".16">'+'<path d="'+GLYPH[id]+'"/></g>';
  if(lit||cur)s+='<circle cx="84" cy="-62" r="'+(lit?130:70)+'" fill="url(#sf-glow)" class="sf-glow"/>';
  s+='<path d="M-26 0h52l-10-14h-32z" fill="'+body+'"/><ellipse cx="0" cy="-22" rx="54" ry="24" fill="'+body+'"/><path d="M44 -30Q76 -34 88 -52Q70 -54 48 -42Z" fill="'+body+'"/><path d="M-50 -28Q-76 -34 -74 -56Q-60 -58 -46 -42Z" fill="'+body+'"/><ellipse cx="0" cy="-34" rx="32" ry="9" fill="'+rim+'"/>';
  s+='<g transform="translate(-16 -38) scale(1.35)" fill="'+(lit?'#7a5418':'#2a1a0a')+'" opacity=".85"><path d="'+GLYPH[id]+'"/></g>';
  if(lit)s+='<path class="sf-flame" d="M84 -52Q75 -72 84 -96Q90 -82 96 -74Q100 -62 84 -52Z" fill="#ffb347"/><path class="sf-flame" d="M84 -54Q79 -66 84 -80Q88 -72 90 -68Q92 -60 84 -54Z" fill="#fff0b0"/>';
  else if(cur)s+='<path class="sf-flame" d="M84 -52Q79 -62 84 -74Q88 -68 90 -64Q92 -58 84 -52Z" fill="#ff9a3c"/>';
  else if(tried)s+='<path class="sf-smoke" d="M84 -54q-8 -14 0 -26q8 -12 0 -24" fill="none" stroke="#9a9aaa" stroke-width="5" stroke-linecap="round"/>';
  if(tonight){const who=lit?'carried by '+(c.bearers[i]||'the group'):cur?c.bearer+' carries':tried?'still dark':'';
    s+='<text x="0" y="48" text-anchor="middle" font-size="26" font-weight="700" fill="#f6e6c4">'+esc(SHORT[id])+'</text>'+(who?'<text x="0" y="76" text-anchor="middle" font-size="22" fill="'+(lit?'#f3d98f':'#b8b0c8')+'">'+esc(who)+'</text>':'');}
  return s+'</g>';
}
const TL=window.TL_CARRY={
  init(D,names){ return {ids:D.map(d=>d.id),targets:[],names:names.length?names:['Player 1','Player 2','Player 3'],used:[],bearer:'',bearers:{},next:-1,tried:{},final:false,revealed:false}; },
  options(S){ const c=S.carry; const fresh=c.targets.filter(t=>!c.tried[t]); if(fresh.length)return fresh;
    if(!c.final)return c.targets.filter(t=>S.owner[t]<0); return []; },
  done(S){ return S.carry.targets.length>0&&TL.options(S).length===0; },
  others(){ const S=window.__tl&&window.__tl.S; return S&&S.carry?S.carry.names.filter(n=>n!==S.carry.bearer):[]; },
  bearerName(){ const S=window.__tl&&window.__tl.S; return S&&S.carry?S.carry.bearer:''; },
  shelf(S){ const w=$('dialWrap'); if(!w)return; w.classList.add('carry-on'); let el=$('carryShelf'); if(!el){el=document.createElement('div');el.id='carryShelf';w.appendChild(el);} el.innerHTML=shelfHTML(S); },
  off(S){ const w=$('dialWrap'); if(S&&S.carry)return; if(w)w.classList.remove('carry-on'); const el=$('carryShelf'); if(el)el.remove(); },
  chip(S){ const c=S.carry,el=$('spinCount'); if(el&&c.targets.length)el.textContent=c.targets.filter(t=>S.owner[t]>=0).length+' of tonight\u2019s '+c.targets.length+' lamps lit'; },
  dim(S){ TL.shelf(S); },
  shelf(S){ const D=window.__tl.D,wrap=$('dialWrap'); wrap.classList.add('shelf-on'); let el=$('carryShelf'); if(!el){el=document.createElement('div');el.id='carryShelf';wrap.appendChild(el);}
    let planks='';[0,1,2].forEach(r=>{const y=280+r*290;planks+='<rect x="20" y="'+y+'" width="960" height="22" rx="4" fill="#4a3320"/><rect x="20" y="'+y+'" width="960" height="5" rx="2" fill="#7a5a38"/><path d="M60 '+(y+22)+'v26M940 '+(y+22)+'v26" stroke="#2a1c10" stroke-width="8"/>';});
    let lamps='';D.forEach((d,i)=>{lamps+=lampSvg(i,S,D);});
    el.innerHTML='<svg viewBox="0 0 1000 1000" role="img" aria-label="Twelve lamps on a shelf. Tonight\u2019s lamps stand forward."><defs><linearGradient id="sf-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1a4a"/><stop offset="1" stop-color="#0a0a22"/></linearGradient>'
      +'<linearGradient id="sf-cone" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd27a" stop-opacity=".5"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></linearGradient><radialGradient id="sf-glow"><stop offset="0" stop-color="#ffb347" stop-opacity=".7"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient></defs>'
      +'<rect width="1000" height="1000" rx="40" fill="url(#sf-wall)"/><g stroke="#2a2a60" stroke-width="2" opacity=".5">'+[100,200,400,500,700,800].map(y=>'<path d="M0 '+y+'H1000"/>').join('')+'</g>'+planks+lamps+'</svg>'; },
  off(){ const w=$('dialWrap'); if(w)w.classList.remove('shelf-on'); const e=$('carryShelf'); if(e)e.remove(); const b=$('carryBox'); if(b)b.remove(); if($('spinBtn'))$('spinBtn').hidden=false; },
  turn(S){
    const c=S.carry,D=window.__tl.D,name=t=>D[t].name,inv=t=>W[D[t].id][0];
    c.current=-1; $('spinBtn').hidden=true; $('turn').innerHTML='<span>Carry the Light</span>'; TL.chip(S); const old=$('carryBox'); if(old)old.remove();
    const box=document.createElement('div'); box.id='carryBox'; $('turnBox').appendChild(box); TL.dim(S);
    const mins=n=>'about '+(n*7)+' minutes';
    const go=t=>{ c.tried[t]=(c.tried[t]||0)+1; c.bearers[t]=c.bearer; if(c.targets.every(x=>c.tried[x]))c.final=c.targets.some(x=>c.tried[x]>1)||c.final; c.next=t; c.current=t; box.remove(); $('spinBtn').hidden=false; $('spinBtn').click(); $('spinBtn').hidden=true; };
    const wasFinal=()=>c.targets.every(x=>c.tried[x]);
    const pickBearer=t=>{ const fresh=c.names.filter(n=>!c.used.includes(n)); const pool=fresh.length?fresh:(c.used=[],c.names);
      box.innerHTML='<h3>Who carries the lamp into '+esc(name(t))+'?</h3><p>Everyone can advise. The bearer gives the answers and makes the key call.</p><div class="row">'+pool.map(n=>'<button type="button" class="btn ghost" data-n="'+esc(n)+'">'+esc(n)+'</button>').join('')+'</div>';
      box.onclick=e=>{ const b=e.target.closest('button'); if(!b)return; c.bearer=b.dataset.n; c.used.push(c.bearer); if(wasFinal())c.final=true; go(t); }; };
    const route=()=>{ const opts=TL.options(S),lit=c.targets.filter(t=>S.owner[t]>=0).length,dark=opts.length&&c.targets.every(x=>c.tried[x]);
      $('turnNote').textContent=lit+' of '+c.targets.length+' lamps lit.';
      box.innerHTML='<h3>'+(dark?(opts.length===1?'One lamp is still dark. Go back for it?':opts.length+' lamps are still dark. Which one shall we go back for, and who\u2019s carrying?'):'Where does the light go next?')+'</h3>'
        +opts.map(t=>'<button type="button" class="btn ghost" data-t="'+t+'">'+esc(inv(t))+'<small>'+esc(name(t))+' \u00b7 '+SKILL[W[D[t].id][1]]+'</small></button>').join('');
      box.onclick=e=>{ const b=e.target.closest('button'); if(b)pickBearer(+b.dataset.t); }; };
    const reveal=()=>{ c.revealed=true; TL.dim(S); TL.chip(S);
      box.innerHTML='<h3>Tonight\u2019s lamps</h3><p>'+c.targets.length+' lamps \u00b7 '+mins(c.targets.length)+' \u00b7 '+(S.topic==='gk'?'General knowledge':(window.RF_TOPICS&&window.RF_TOPICS[S.topic])||S.topic)+' \u00b7 '+c.names.map(esc).join(', ')+'</p>'
        +c.targets.map(t=>'<div class="card2"><b>'+esc(inv(t))+'</b><small>'+esc(name(t))+' \u00b7 the bearer will '+SKILL[W[D[t].id][1]].toLowerCase()+'</small></div>').join('')
        +'<button type="button" class="btn" id="carryGo">Begin the journey</button>';
      box.onclick=e=>{ if(e.target.closest('#carryGo'))route(); }; };
    if(!c.targets.length){ $('turnNote').textContent='Everyone can advise. One person carries the lamp.';
      const sug=c.names.length>=5?5:3;
      box.innerHTML='<h3>How many lamps tonight?</h3><p>'+(c.names.length>=5?(c.names.length===5?'With 5 players, five lamps gives everybody a first turn.':'With '+c.names.length+' players, five lamps gives more people a turn to carry.'):'Three is the shortest complete evening.')+'</p><div class="row">'
        +[3,4,5].map(n=>'<button type="button" class="btn'+(n===sug?'':' ghost')+'" data-n="'+n+'">'+n+' lamps<small>'+mins(n)+'</small></button>').join('')+'</div>';
      box.onclick=e=>{ const b=e.target.closest('button'); if(!b)return; const n=+b.dataset.n; c.targets=draw(n).map(id=>c.ids.indexOf(id)); S.spins=n+1; reveal(); }; return; }
    if(!c.revealed)reveal(); else route();
  },
  landing(S){ const c=S.carry,D=window.__tl.D,id=D[S.pos].id,again=(c.tried[S.pos]||1)>1,arr=window.TL_ARRIVE&&window.TL_ARRIVE[id];
    const line=again?(BACK[id]||'Back in '+D[S.pos].name+'. Another go.'):(FIRST[id]||(arr?arr[1]:''));
    $('landLine').textContent=line+' '+c.bearer+' carries the lamp: everyone can advise, '+c.bearer+' gives the answers.'; TL.dim(S); TL.chip(S); },
  ending(S){ const c=S.carry,D=window.__tl.D; c.current=-1; TL.shelf(S); ['carryEnd','carryAgain'].forEach(i=>{const o=$(i);if(o)o.remove();});
    const ul=document.createElement('ul'); ul.id='carryEnd';
    ul.innerHTML=c.targets.map(t=>S.owner[t]>=0?'<li>\u2728 <b>'+esc(D[t].name)+'</b>: brought home by '+esc(c.bearers[t]||'the group')+'</li>':'<li class="dark">\u25cb <b>'+esc(D[t].name)+'</b>: still dark</li>').join('');
    const p=document.createElement('p'); p.id='carryAgain'; p.textContent='Shall we see which lamps we get next time?';
    $('endLine').insertAdjacentElement('afterend',ul); ul.insertAdjacentElement('afterend',p); }
};
})();
