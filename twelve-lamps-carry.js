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
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let recent=[];try{recent=JSON.parse(localStorage.getItem(RK)||'[]');}catch(e){}
/* three different primary skills for a three-lamp night; a five-lamp night still gets five different skills; worlds seen last time are avoided */
function draw(n){
  const bySkill={};Object.keys(W).forEach(id=>(bySkill[W[id][1]]=bySkill[W[id][1]]||[]).push(id));
  const picks=shuffle(Object.keys(bySkill)).slice(0,n).map(sk=>{const all=shuffle(bySkill[sk]),fresh=all.filter(i=>!recent.includes(i));return (fresh.length?fresh:all)[0];});
  try{localStorage.setItem(RK,JSON.stringify(picks));}catch(e){}
  return picks;
}
const TL=window.TL_CARRY={
  init(D,names){ return {ids:D.map(d=>d.id),targets:[],names:names.length?names:['Player 1','Player 2','Player 3'],used:[],bearer:'',bearers:{},next:-1,tried:{},final:false,revealed:false}; },
  options(S){ const c=S.carry; const fresh=c.targets.filter(t=>!c.tried[t]); if(fresh.length)return fresh;
    if(!c.final)return c.targets.filter(t=>S.owner[t]<0); return []; },
  done(S){ return S.carry.targets.length>0&&TL.options(S).length===0; },
  others(){ const S=window.__tl&&window.__tl.S; return S&&S.carry?S.carry.names.filter(n=>n!==S.carry.bearer):[]; },
  bearerName(){ const S=window.__tl&&window.__tl.S; return S&&S.carry?S.carry.bearer:''; },
  dim(S){ const t=S.carry.targets; document.querySelectorAll('#dial .lan').forEach(w=>{ w.style.opacity=!t.length||t.includes(+w.dataset.i)?'1':'.22'; }); },
  turn(S){
    const c=S.carry,D=window.__tl.D,name=t=>D[t].name,inv=t=>W[D[t].id][0];
    $('spinBtn').hidden=true; $('turn').innerHTML='<span>Carry the Light</span>'; const old=$('carryBox'); if(old)old.remove();
    const box=document.createElement('div'); box.id='carryBox'; $('turnBox').appendChild(box); TL.dim(S);
    const mins=n=>'about '+(n*7)+' minutes';
    const go=t=>{ c.tried[t]=(c.tried[t]||0)+1; c.bearers[t]=c.bearer; if(c.targets.every(x=>c.tried[x]))c.final=c.targets.some(x=>c.tried[x]>1)||c.final; c.next=t; box.remove(); $('spinBtn').hidden=false; $('spinBtn').click(); $('spinBtn').hidden=true; };
    const wasFinal=()=>c.targets.every(x=>c.tried[x]);
    const pickBearer=t=>{ const fresh=c.names.filter(n=>!c.used.includes(n)); const pool=fresh.length?fresh:(c.used=[],c.names);
      box.innerHTML='<h3>Who carries the lamp into '+esc(name(t))+'?</h3><p>Everyone can advise. The bearer gives the answers and makes the key call.</p><div class="row">'+pool.map(n=>'<button type="button" class="btn ghost" data-n="'+esc(n)+'">'+esc(n)+'</button>').join('')+'</div>';
      box.onclick=e=>{ const b=e.target.closest('button'); if(!b)return; c.bearer=b.dataset.n; c.used.push(c.bearer); if(wasFinal())c.final=true; go(t); }; };
    const route=()=>{ const opts=TL.options(S),lit=c.targets.filter(t=>S.owner[t]>=0).length,dark=opts.length&&c.targets.every(x=>c.tried[x]);
      $('turnNote').textContent=lit+' of '+c.targets.length+' lamps lit.';
      box.innerHTML='<h3>'+(dark?(opts.length===1?'One lamp is still dark. Go back for it?':opts.length+' lamps are still dark. Which one shall we go back for, and who\u2019s carrying?'):'Where does the light go next?')+'</h3>'
        +opts.map(t=>'<button type="button" class="btn ghost" data-t="'+t+'">'+esc(inv(t))+'<small>'+esc(name(t))+' \u00b7 '+SKILL[W[D[t].id][1]]+'</small></button>').join('');
      box.onclick=e=>{ const b=e.target.closest('button'); if(b)pickBearer(+b.dataset.t); }; };
    const reveal=()=>{ c.revealed=true; TL.dim(S);
      box.innerHTML='<h3>Tonight\u2019s lamps</h3><p>'+c.targets.length+' lamps \u00b7 '+mins(c.targets.length)+' \u00b7 '+(S.topic==='bible'?'Bible questions':'General knowledge')+' \u00b7 '+c.names.map(esc).join(', ')+'</p>'
        +c.targets.map(t=>'<div class="card2"><b>'+esc(inv(t))+'</b><small>'+esc(name(t))+' \u00b7 the bearer will '+SKILL[W[D[t].id][1]].toLowerCase()+'</small></div>').join('')
        +'<button type="button" class="btn" id="carryGo">Begin the journey</button>';
      box.onclick=e=>{ if(e.target.closest('#carryGo'))route(); }; };
    if(!c.targets.length){ $('turnNote').textContent='Everyone can advise. One person carries the lamp.';
      const sug=c.names.length>=5?5:3;
      box.innerHTML='<h3>How many lamps tonight?</h3><p>'+(c.names.length>=5?'With '+c.names.length+' players, five lamps gives everybody a first turn.':'Three is the shortest complete evening.')+'</p><div class="row">'
        +[3,4,5].map(n=>'<button type="button" class="btn'+(n===sug?'':' ghost')+'" data-n="'+n+'">'+n+' lamps<small>'+mins(n)+'</small></button>').join('')+'</div>';
      box.onclick=e=>{ const b=e.target.closest('button'); if(!b)return; const n=+b.dataset.n; c.targets=draw(n).map(id=>c.ids.indexOf(id)); S.spins=n+1; reveal(); }; return; }
    if(!c.revealed)reveal(); else route();
  },
  landing(S){ const c=S.carry,D=window.__tl.D,id=D[S.pos].id,again=(c.tried[S.pos]||1)>1,arr=window.TL_ARRIVE&&window.TL_ARRIVE[id];
    const line=again?(BACK[id]||'Back in '+D[S.pos].name+'. Another go.'):(FIRST[id]||(arr?arr[1]:''));
    $('landLine').textContent=line+' '+c.bearer+' carries the lamp: everyone can advise, '+c.bearer+' gives the answers.'; TL.dim(S); },
  ending(S){ const c=S.carry,D=window.__tl.D; ['carryEnd','carryAgain'].forEach(i=>{const o=$(i);if(o)o.remove();});
    const ul=document.createElement('ul'); ul.id='carryEnd';
    ul.innerHTML=c.targets.map(t=>S.owner[t]>=0?'<li>\u2728 <b>'+esc(D[t].name)+'</b>: brought home by '+esc(c.bearers[t]||'the group')+'</li>':'<li class="dark">\u25cb <b>'+esc(D[t].name)+'</b>: still dark</li>').join('');
    const p=document.createElement('p'); p.id='carryAgain'; p.textContent='Shall we see which lamps we get next time?';
    $('endLine').insertAdjacentElement('afterend',ul); ul.insertAdjacentElement('afterend',p); }
};
})();
