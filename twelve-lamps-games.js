/* Twelve Lamps: bespoke games for Noah's Ark (two by two, a memory round) and Jacob's ladder (a climbing race).
   Load after twelve-lamps-worlds.js. They use the engine's own round API, so scoring, stealing and phones all work. */
(function(){'use strict';
const R=window.TL_ROUNDS; if(!R||!R.types) return; const T=R.types;
const st=document.createElement('style');
st.textContent='.rs-land.ark{background:linear-gradient(#f6dca6,#e3bd80 56%,#3d2714 56%)}'
+'.jl{display:flex;gap:16px;justify-content:center;align-items:flex-end;padding:8px 0 4px}.jl-col{flex:1 1 0;max-width:120px;text-align:center}'
+'.jl-lad{position:relative;height:250px;width:64px;margin:0 auto 6px;border-left:5px solid #e8d49a;border-right:5px solid #e8d49a;border-radius:3px;background:repeating-linear-gradient(to top,#e8d49a 0 5px,transparent 5px 48px)}'
+'.jl-top{position:absolute;left:50%;top:-16px;width:30px;height:30px;margin-left:-15px;background:radial-gradient(circle,#fff6d2 0,#ffd27a 40%,transparent 72%);animation:jlg 2.4s ease-in-out infinite}'
+'.jl-pc{position:absolute;left:50%;bottom:calc(var(--f)*48px);margin-left:-20px;width:40px;height:40px;border-radius:50%;background:var(--c);display:grid;place-items:center;font-weight:800;color:#14143c;box-shadow:0 0 0 3px #fff6d2,0 0 18px var(--c)}'
+'.jl-sun{font-size:20px;line-height:1}.jl-col b{display:block;font-size:14px}@keyframes jlg{50%{opacity:.5;transform:scale(1.3)}}'
+'@media (prefers-reduced-motion:reduce){.jl-top{animation:none}}';
document.head.appendChild(st);

/* ---------- Noah's Ark ---------- */
const sv=(b)=>'<svg viewBox="0 0 80 80" aria-hidden="true">'+b+'</svg>';
const legs=(xs,c,w)=>'<path d="'+xs.map(x=>'M'+x+' 58v14').join('')+'" stroke="'+c+'" stroke-width="'+(w||5)+'"/>';
const ANI={
 elephant:{one:'elephant',pairs:1,art:sv('<ellipse cx="38" cy="46" rx="24" ry="17" fill="#8a8f9a"/><circle cx="62" cy="38" r="11" fill="#8a8f9a"/><path d="M70 42q10 10 2 24" stroke="#8a8f9a" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="54" cy="38" rx="7" ry="10" fill="#6f7480"/><circle cx="66" cy="35" r="1.8" fill="#111"/>'+legs([20,30,46,56],'#7a7f8a',7))},
 giraffe:{one:'giraffe',pairs:1,art:sv('<ellipse cx="30" cy="54" rx="18" ry="12" fill="#e0b050"/><path d="M42 48L50 12H60L56 48Z" fill="#e0b050"/><ellipse cx="60" cy="12" rx="10" ry="6" fill="#e0b050"/><path d="M54 6v-4M60 6v-4" stroke="#8a5a24" stroke-width="2"/><circle cx="24" cy="50" r="3" fill="#8a5a24"/><circle cx="36" cy="56" r="3" fill="#8a5a24"/><circle cx="52" cy="30" r="2.6" fill="#8a5a24"/>'+legs([18,26,36,42],'#c89a3c',4))},
 lion:{one:'lion',pairs:1,art:sv('<ellipse cx="32" cy="52" rx="20" ry="12" fill="#d8a040"/><circle cx="58" cy="42" r="15" fill="#8a5a24"/><circle cx="58" cy="44" r="10" fill="#e8b860"/><circle cx="55" cy="42" r="1.8" fill="#111"/><circle cx="62" cy="42" r="1.8" fill="#111"/><path d="M12 52q-8-6-4-16" stroke="#d8a040" stroke-width="4" fill="none"/><circle cx="8" cy="34" r="4" fill="#8a5a24"/>'+legs([18,28,40,46],'#c08a30',5))},
 camel:{one:'camel',pairs:1,art:sv('<ellipse cx="36" cy="50" rx="22" ry="11" fill="#c8a468"/><circle cx="28" cy="38" r="8" fill="#c8a468"/><circle cx="44" cy="38" r="8" fill="#c8a468"/><path d="M54 46q8-16 12-24" stroke="#c8a468" stroke-width="7" fill="none" stroke-linecap="round"/><ellipse cx="70" cy="20" rx="8" ry="5" fill="#c8a468"/>'+legs([20,28,44,52],'#b08a50',4))},
 sheep:{one:'sheep',many:'sheep',pairs:1,art:sv('<circle cx="22" cy="46" r="9" fill="#f4f1ea"/><circle cx="32" cy="42" r="10" fill="#f4f1ea"/><circle cx="40" cy="48" r="9" fill="#f4f1ea"/><ellipse cx="50" cy="44" rx="6" ry="7" fill="#333"/><path d="M24 56v10M38 56v10" stroke="#333" stroke-width="3"/>')},
 ox:{one:'ox',many:'oxen',pairs:1,art:sv('<ellipse cx="36" cy="48" rx="22" ry="13" fill="#6a4a32"/><circle cx="60" cy="42" r="9" fill="#6a4a32"/><path d="M55 34q-5-8 0-11M65 34q5-8 0-11" stroke="#f0e8d0" stroke-width="3" fill="none"/><circle cx="62" cy="42" r="1.8" fill="#111"/>'+legs([20,28,44,52],'#4a3220',5))},
 dove:{one:'dove',one1:true,art:sv('<ellipse cx="40" cy="46" rx="16" ry="10" fill="#fff" stroke="#c8d2e0"/><path d="M34 44q-8-18 8-22q4 10-2 22z" fill="#e8eef6" stroke="#c8d2e0"/><circle cx="56" cy="38" r="6" fill="#fff" stroke="#c8d2e0"/><path d="M61 38l5 2-5 2z" fill="#e8a03a"/><ellipse cx="68" cy="46" rx="7" ry="3" fill="#6fa04a"/>')},
 raven:{one:'raven',one1:true,art:sv('<ellipse cx="40" cy="46" rx="16" ry="10" fill="#1c1c28"/><path d="M34 44q-8-18 8-22q4 10-2 22z" fill="#2c2c3c"/><circle cx="56" cy="38" r="6" fill="#1c1c28"/><path d="M61 38l6 2-6 2z" fill="#6a6a7a"/>')},
 tortoise:{one:'tortoise',many:'tortoises',pairs:1,art:sv('<path d="M14 58q4-26 26-26q22 0 26 26z" fill="#5a8a4a"/><path d="M24 58q2-14 16-14M40 58V34M54 58q-2-14-14-14" stroke="#3f6a34" stroke-width="2" fill="none"/><circle cx="70" cy="54" r="6" fill="#7aa85a"/><path d="M22 58v6M50 58v6" stroke="#7aa85a" stroke-width="5"/>')}
};
const shuffle=(a,r)=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
function makeBoarding(r){return shuffle(Object.keys(ANI),r).slice(0,7).map(k=>({kind:k,n:ANI[k].one1?1:2*(1+Math.floor(r()*3))}));}
const draw=t=>'<span class="rs-thing">'+Array.from({length:t.n},()=>ANI[t.kind].art).join('')+'</span>';
function arkQuestions(scene,r){
  const qs=[],seen=scene.map(t=>t.kind),unseen=Object.keys(ANI).filter(k=>!seen.includes(k)),nm=k=>ANI[k].one;
  const counted=shuffle(scene.filter(t=>t.n>1),r);
  counted.slice(0,2).forEach(t=>{const d=ANI[t.kind],opts=[t.n,t.n+2,t.n+4,t.n-2].filter(x=>x>=2);while(opts.length>4)opts.pop();
    if(!opts.includes(t.n))opts[0]=t.n; qs.push({q:'How many '+(d.many||d.one+'s')+' did you see?',correct:String(t.n),opts:shuffle(opts,r).map(String)});});
  if(unseen.length){const w=shuffle(unseen,r)[0];qs.push({q:'Which of these did NOT board the ark?',correct:'a '+nm(w),opts:shuffle(shuffle(seen,r).slice(0,3).concat(w),r).map(k=>'a '+nm(k))});}
  const four=shuffle(seen,r).slice(0,4),first=seen.find(k=>four.includes(k));
  qs.push({q:'Which of these boarded first?',correct:'the '+nm(first),opts:four.map(k=>'the '+nm(k))});
  return shuffle(qs,r).slice(0,3);
}
T.ark={title:'Two by two',
 rule:c=>'The animals walk up the ramp, two by two. Look hard: then three questions about what you saw.'+(c.multi?' A miss can be stolen.':''),
 async play(c){
  const scene=makeBoarding(c.rng),qs=arkQuestions(scene,c.rng);let right=0;
  c.count('Look closely');
  c.stage('<div class="rs-land ark"><div class="rs-strip">'+scene.map(draw).join('')+'</div></div>');
  await c.watch(12000,'I\'m ready');
  c.stage('<div class="rs-land ark gone"><p>The door is shut and the rain begins.</p></div>');
  for(let k=0;k<qs.length;k++){c.count('Question '+(k+1)+' of '+qs.length);
   const r=await c.question(qs[k],{who:c.me,pts:10,steal:true});
   if(r.right&&!r.stolen)right++;
   await c.next(k<qs.length-1?'Next question':'See the lamp',r.right?'right':'miss',r);}
  c.stage('<div class="rs-land ark"><div class="rs-strip still">'+scene.map(draw).join('')+'</div></div>');
  return {lit:right>=2,min:1,line:right+' of '+qs.length+' remembered',need:'two right lights it'};
 }};

/* ---------- Jacob's ladder ---------- */
const TOP=4;
function ladderStage(pos,labels){
  return '<div class="jl">'+pos.map((f,k)=>'<div class="jl-col"><div class="jl-lad"><i class="jl-top"></i><div class="jl-pc" style="--f:'+f+';--c:'+labels[k].colour+'">'+labels[k].badge+'</div></div><b>'+labels[k].name+'</b></div>').join('')+'</div>';
}
T.jacob={title:'The ladder race',
 rule:c=>c.multi?'Every question is open: tap your name to answer. Right takes you up a rung, wrong takes you down. First to the top wins.':'Right answers take you up a rung, wrong ones down. Reach the top before the dawn, which breaks after three questions and rises every second one.',
 async play(c){
  const multi=c.multi,who=multi?c.order():[0],pos=who.map(()=>0);
  const labels=who.map(i=>({name:c.name(i),colour:c.colour(i),badge:c.symbol(i)}));
  if(!multi){pos.push(0);labels.push({name:'The dawn',colour:'#f3c97a',badge:'<span class="jl-sun">\u2600</span>'});}
  const paint=()=>c.stage(ladderStage(pos,labels));paint();
  const cap=10;let winner=-1;
  for(let k=0;k<cap&&winner<0;k++){
   c.count('Question '+(k+1));
   const r=await c.question(c.drawQ(),{open:multi,players:who,pts:0,steal:false,noAward:true,label:'Right: up a rung. Wrong: down a rung.',
    onWrong:by=>{const s=who.indexOf(by);if(s>=0&&pos[s]>0){pos[s]--;paint();c.sfx('down');}}});
   if(r.right){const s=multi?who.indexOf(r.by):0;pos[s]++;c.sfx('up');if(pos[s]>=TOP)winner=s;}
   if(!multi&&k>=3&&k%2===1&&winner<0){pos[1]++;if(pos[1]>=TOP)winner=1;}
   paint();
   c.status(winner>=0?labels[winner].name+' reached the top!':r.right?labels[multi?who.indexOf(r.by):0].name+' climbed a rung.':'Slipping down.');
   await c.next(winner>=0||k===cap-1?'See the lamp':'Next question',r.right?'right':'miss',r);
  }
  who.forEach((i,s)=>{const p=pos[s]*5+(pos[s]>=TOP?15:0);if(p)c.award(i,p);});
  if(multi){if(winner>=0)return {taker:who[winner],line:c.name(who[winner])+' reached the top'};
   return {min:10,line:Math.max(...pos)?'Nobody reached the top':'Nobody left the ground'};}
  return {lit:winner===0,line:winner===0?'Up to the top, before the dawn':winner===1?'The dawn broke first':'Stopped at rung '+pos[0],need:'reach the top before the dawn to light it'};
 }};
})();
