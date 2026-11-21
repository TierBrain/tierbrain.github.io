/* Twelve Lamps: Carry the Light (prototype). A group mode: three dark lamps (Noah's Ark, Joseph's cup, the lions' den),
   a bearer who carries the lamp into each story, a choice of where to go next, and a return to any world that stays dark. */
(function(){'use strict';
const $=id=>document.getElementById(id);
const IDS=['ark','joseph','daniel'];
const DEST={ark:['Noah\u2019s Ark','Watch the animals board'],joseph:['Joseph\u2019s cup','Work out who has the cup'],daniel:['The lions\u2019 den','Bring Daniel through the night']};
const FIRST={ark:'The ramp is coming up. Watch the last few animals carefully. Once that door shuts, somebody will ask what you saw.',
 joseph:'Four brothers have stopped on the road. Somewhere among their sacks is a silver cup. How much evidence will you need before you name a name?',
 daniel:'You can hear one of them breathing. Get the next answer right and it settles. Wake three at once and it will be a very long night.'};
const BACK={ark:'Back on the ramp. Look harder this time.',joseph:'Back at the sacks. Take your time, and trust the clues.',daniel:'Back in the den. This time, let\u2019s get Daniel to dawn.'};
const st=document.createElement('style');
st.textContent='#carryBox{display:grid;gap:10px;margin-top:8px}#carryBox h3{margin:0;font-size:18px}#carryBox .btn{width:100%;text-align:left;font-size:17px;padding:12px 20px}#carryBox small{display:block;font-weight:600;opacity:.75;font-size:13px;margin-top:2px}#carryBox .row{display:flex;flex-wrap:wrap;gap:8px}#carryBox .row .btn{width:auto}';
document.head.appendChild(st);
const TL=window.TL_CARRY={
  init(D,names){ return {targets:IDS.map(id=>D.findIndex(d=>d.id===id)),names:names.length?names:['Player 1','Player 2','Player 3'],used:[],bearer:'',next:-1,tried:{}}; },
  options(S){ const c=S.carry,dark=c.targets.filter(t=>S.owner[t]<0&&(c.tried[t]||0)<2); if(!dark.length)return [];
    const m=Math.min.apply(null,dark.map(t=>c.tried[t]||0)); return dark.filter(t=>(c.tried[t]||0)===m); },
  done(S){ return TL.options(S).length===0; },
  bearerName(){ const S=window.__tl&&window.__tl.S; return S&&S.carry?S.carry.bearer:''; },
  dim(S){ document.querySelectorAll('#dial .lan').forEach(w=>{ w.style.opacity=S.carry.targets.includes(+w.dataset.i)?'1':'.22'; }); },
  turn(S){
    const c=S.carry,D=window.__tl.D,lit=c.targets.filter(t=>S.owner[t]>=0).length,opts=TL.options(S);
    $('spinBtn').hidden=true; $('turn').innerHTML='<span>Carry the Light</span>'; const old=$('carryBox'); if(old)old.remove();
    const box=document.createElement('div'); box.id='carryBox'; $('turnBox').appendChild(box);
    $('turnNote').textContent=lit+' of 3 lamps lit.'+(c.tried[opts[0]]?' A lamp stayed dark: go back and carry it again.':''); TL.dim(S);
    const go=t=>{ c.tried[t]=(c.tried[t]||0)+1; c.next=t; box.remove(); $('spinBtn').hidden=false; $('spinBtn').click(); $('spinBtn').hidden=true; };
    const pickBearer=t=>{ const fresh=c.names.filter(n=>!c.used.includes(n)); const pool=fresh.length?fresh:(c.used=[],c.names);
      box.innerHTML='<h3>Who carries the lamp into '+DEST[D[t].id][0]+'?</h3><div class="row">'+pool.map(n=>'<button type="button" class="btn ghost" data-n="'+n.replace(/"/g,'&quot;')+'">'+n.replace(/</g,'&lt;')+'</button>').join('')+'</div>';
      box.onclick=e=>{ const b=e.target.closest('button'); if(!b)return; c.bearer=b.dataset.n; c.used.push(c.bearer); go(t); }; };
    box.innerHTML='<h3>Where does the light go next?</h3>'+opts.map(t=>'<button type="button" class="btn ghost" data-t="'+t+'">'+DEST[D[t].id][1]+'<small>'+DEST[D[t].id][0]+'</small></button>').join('');
    box.onclick=e=>{ const b=e.target.closest('button'); if(b)pickBearer(+b.dataset.t); };
  },
  landing(S){ const c=S.carry,id=window.__tl.D[S.pos].id; if(!DEST[id])return;
    $('landLine').textContent=((c.tried[S.pos]||1)>1?BACK[id]:FIRST[id])+' '+c.bearer+' carries the lamp: everyone can advise, '+c.bearer+' gives the answers.';
    TL.dim(S); }
};
})();
