/* Twelve Lamps: bespoke games for Noah's Ark (two by two, a memory round) and Jacob's ladder (a climbing race).
   Load after twelve-lamps-worlds.js. They use the engine's own round API, so scoring, stealing and phones all work. */
(function(){'use strict';
const R=window.TL_ROUNDS; if(!R||!R.types) return; const T=R.types;
const st=document.createElement('style');
st.textContent='.ark-roles{margin:0 0 8px;text-align:center;font-weight:700;font-size:15px;color:#f6e6c4}.rs-land.ark{background:linear-gradient(#f6dca6,#e3bd80 56%,#3d2714 56%)}'
+'.jl{display:flex;gap:16px;justify-content:center;align-items:flex-end;padding:8px 0 4px}.jl-col{flex:1 1 0;max-width:120px;text-align:center}'
+'.jl-lad{position:relative;height:250px;width:64px;margin:0 auto 6px;border-left:5px solid #e8d49a;border-right:5px solid #e8d49a;border-radius:3px;background:repeating-linear-gradient(to top,#e8d49a 0 5px,transparent 5px 48px)}'
+'.jl-top{position:absolute;left:50%;top:-16px;width:30px;height:30px;margin-left:-15px;background:radial-gradient(circle,#fff6d2 0,#ffd27a 40%,transparent 72%);animation:jlg 2.4s ease-in-out infinite}'
+'.jl-pc{position:absolute;left:50%;bottom:calc(var(--f)*48px);margin-left:-20px;width:40px;height:40px;border-radius:50%;background:var(--c);display:grid;place-items:center;font-weight:800;color:#14143c;box-shadow:0 0 0 3px #fff6d2,0 0 18px var(--c)}'
+'.jl-sun{font-size:20px;line-height:1}.jl-col b{display:block;font-size:14px}@keyframes jlg{50%{opacity:.5;transform:scale(1.3)}}'
+'@media (prefers-reduced-motion:reduce){.jl-top{animation:none}}';
document.head.appendChild(st);
const st3=document.createElement('style');st3.textContent='.dn-info,.jl-note,.nw-note{flex-basis:100%;text-align:center;margin:4px 0 0;font-weight:700;font-size:15px;color:#f6e6c4}';document.head.appendChild(st3);

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
    if(!opts.includes(t.n))opts[0]=t.n; qs.push({cat:'count',q:'How many '+(d.many||d.one+'s')+' did you see?',correct:String(t.n),opts:shuffle(opts,r).map(String)});});
  if(unseen.length){const w=shuffle(unseen,r)[0];qs.push({cat:'missing',q:'Which of these did NOT board the ark?',correct:'a '+nm(w),opts:shuffle(shuffle(seen,r).slice(0,3).concat(w),r).map(k=>'a '+nm(k))});}
  const four=shuffle(seen,r).slice(0,4),first=seen.find(k=>four.includes(k));
  qs.push({cat:'order',q:'Which of these boarded first?',correct:'the '+nm(first),opts:four.map(k=>'the '+nm(k))});
  return shuffle(qs,r).slice(0,3);
}
T.ark={title:'Two by two',
 rule:c=>'The animals walk up the ramp, two by two. Look hard: then three questions about what you saw.'+(c.multi?' A miss can be stolen.':''),
 async play(c){
  const scene=makeBoarding(c.rng),qs=arkQuestions(scene,c.rng);let right=0;
  /* Carry the Light: before the animals board, the bearer decides who watches for what */
  const car=window.TL_CARRY&&window.TL_CARRY.bearerName&&window.TL_CARRY.bearerName(),roles={},JOBS=[['count','count the pairs'],['order','remember who boards first'],['missing','spot who never boards']];
  if(car&&window.TL_CARRY.others){const others=shuffle(window.TL_CARRY.others(),c.rng).slice(0,4);
    if(others.length){c.count('Who watches for what?');
      for(const j of JOBS){roles[j[0]]=others.length>1?others[await c.choose({who:-1,title:'Who watches to '+j[1]+'?',options:others})]:others[0];}}}
  const banner=Object.keys(roles).length?'<p class="ark-roles">'+JOBS.map(j=>roles[j[0]]+' will '+j[1]).join(' \u00b7 ')+'</p>':'<p class="ark-roles">Watch closely: the questions are about this boarding.</p>';
  c.count('Look closely');
  c.stage(banner+'<div class="rs-land ark"><div class="rs-strip">'+scene.map(draw).join('')+'</div></div>');
  await c.watch(12000,'I\'m ready');
  c.stage('<div class="rs-land ark gone"><p>The door is shut and the rain begins.</p></div>');
  for(let k=0;k<qs.length;k++){c.count('Question '+(k+1)+' of '+qs.length);
   const r=await c.question(qs[k],{who:c.me,pts:10,steal:true,label:roles[qs[k].cat]?roles[qs[k].cat]+' was watching for this: ask them.':undefined});
   if(r.right&&!r.stolen)right++;
   await c.next(k<qs.length-1?'Next question':'See the lamp',r.right?'right':'miss',r);}
  c.stage('<div class="rs-land ark"><div class="rs-strip still">'+scene.map(draw).join('')+'</div></div>');
  return {lit:right>=2,min:1,line:right+' of '+qs.length+' remembered',need:'two right lights it'};
 }};

/* ---------- Jacob's ladder ---------- */
const TOP=4;
function ladderStage(pos,labels){
  return '<div class="jl">'+pos.map((f,k)=>'<div class="jl-col"><div class="jl-lad"><i class="jl-top"></i><div class="jl-pc" style="--f:'+f+';--c:'+labels[k].colour+'">'+labels[k].badge+'</div></div><b>'+labels[k].name+'</b></div>').join('')+'</div>'+(labels.some(l=>l.name==='The dawn')?'<p class="jl-note">The dawn climbs a rung on every second question, after the third.</p>':'');
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

/* ---------- Shared helpers ---------- */
const plural=(n,w)=>n+' '+(n===1||w==='fish'?w:w+'s');
const pickOne=(a,r)=>a[Math.floor(r()*a.length)];
const st2=document.createElement('style');
st2.textContent='.nw{display:flex;flex-direction:column-reverse;gap:3px;max-width:360px;margin:6px auto}.nw-r{display:flex;gap:3px}.nw-r:nth-child(even){margin-left:20px}.nw-r i{flex:1;height:22px;border-radius:3px;background:#b8946a;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}.nw-r.off i{background:transparent;border:1px dashed rgba(232,212,154,.3);box-shadow:none}.nw-r.new i{animation:nwp .5s ease-out}@keyframes nwp{from{transform:translateY(-14px);opacity:0}}'
+'.gc{text-align:center}.gc svg{width:min(100%,420px);height:auto}.gc p{margin:6px 0 0;font-weight:800}'
+'@media (prefers-reduced-motion:reduce){.nw-r.new i{animation:none}}';
document.head.appendChild(st2);

/* ---------- Nehemiah's wall ---------- */
function wallStage(n,max,fresh){
  let h='<div class="nw">';for(let k=1;k<=max;k++)h+='<div class="nw-r'+(k<=n?'':' off')+(k===fresh&&k<=n?' new':'')+'">'+'<i></i>'.repeat(6)+'</div>';
  return h+'</div><p class="nw-note">Keep four courses standing to light this lamp.</p>';
}
T.nehemiah={title:'Keep building',
 rule:()=>'Six quick questions. Two courses of the wall already stand. Every right answer adds a course; every miss brings one down. Six points for each course still standing at the end.',
 async play(c){
  const me=c.multi?c.me:0;let n=2;const MAX=8;
  c.stage(wallStage(n,MAX));
  for(let k=0;k<6;k++){c.count('Wall question '+(k+1)+' of 6');
   const r=await c.question(c.drawQ(),{who:me,pts:0,steal:false,noAward:true,time:12000,label:plural(n,'course')+' standing'});
   n=r.right?Math.min(MAX,n+1):Math.max(0,n-1);c.sfx(r.right?'plate':'smash');
   c.stage(wallStage(n,MAX,r.right?n:0));await c.next(k<5?'Next question':'See the lamp',r.right?'right':'miss',r);}
  if(n)c.award(me,n*6);
  const ok=n>=4;
  if(c.multi)return {taker:ok?me:-1,line:plural(n,'course')+' still standing'};
  return {lit:ok,line:plural(n,'course')+' still standing',need:'keep four courses standing to light it'};
 }};

/* ---------- Galilee: the great catch ---------- */
function netStage(fish,note){
  let f='';for(let i=0;i<Math.min(fish,12);i++){const x=178+(i%4)*24+(Math.floor(i/4)%2)*8,y=112+Math.floor(i/4)*12;f+='<g transform="translate('+x+' '+y+')"><path d="M-8 0q6-6 12 0q-6 6-12 0M4 0l6-5v10z" fill="#9fd0e0"/></g>';}
  return '<div class="gc"><svg viewBox="0 0 320 170" aria-hidden="true"><path d="M0 120q20-8 40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0V170H0Z" fill="#1f6a82"/><path d="M30 96Q70 118 130 100H150Q132 112 100 112H60Z" fill="#6a4426"/><path d="M80 98V50" stroke="#3a2412" stroke-width="3"/><path d="M80 52Q110 62 118 96H80Z" fill="#e8dcc0"/><path d="M150 96Q196 90 262 94Q272 130 236 148Q190 156 168 136Q152 120 150 96Z" fill="#cfe6f0" fill-opacity=".18" stroke="#e8d49a" stroke-width="2"/><path d="M170 98L236 150M190 94L252 140M214 92L266 130M160 116L214 152M258 98L190 150" stroke="#e8d49a" stroke-width="1" opacity=".5"/>'+f+'</svg><p>'+note+'</p></div>';
}
T.galilee={title:'The great catch',
 rule:c=>c.multi?'Fill the net with three questions. Then a rival boat decides: share the catch, or try to take the lot with one question.':'Fill the net with three questions. Then ride out the storm to double the catch, or make for shore and keep it.',
 async play(c){
  const me=c.multi?c.me:0;let gold=0;const fishN=g=>Math.round(g*c.mult/10);
  c.stage(netStage(0,'The net is empty.'));
  for(let k=0;k<3;k++){c.count('Cast '+(k+1)+' of 3');
   const r=await c.question(c.drawQ(),{who:me,pts:0,steal:false,noAward:true,label:'10 points of fish for the net'});
   if(r.right){gold+=10;c.sfx('coins');}
   c.stage(netStage(fishN(gold),gold?plural(fishN(gold),'fish')+' in the net.':'The net is empty.'));
   await c.next(k<2?'Next question':'The storm',r.right?'right':'miss',r);}
  if(!gold){c.status('Nothing to share.');return c.multi?{taker:-1,line:'The net stayed empty'}:{lit:false,line:'The net stayed empty',need:'bring home 20 or more to light it'};}
  if(!c.multi){
   const w=await c.choose({who:-1,title:plural(fishN(gold),'fish')+' in the net. Ride out the storm to double the catch (one question), or make for shore?',options:['Ride out the storm','Make for shore']});
   if(w===0){c.count('The storm');const r=await c.question(c.drawQ(),{who:0,pts:0,steal:false,noAward:true,label:'Double or half'});
    gold=r.right?gold*2:Math.floor(gold/2);c.stage(netStage(fishN(gold),r.right?'The catch is doubled!':'Half the catch is lost overboard.'));await c.next('See the lamp',r.right?'right':'miss',r);}
   c.award(0,gold);return {lit:gold>=20,line:'Home with '+plural(fishN(gold),'fish'),need:'bring home 20 or more to light it'};}
  const others=c.order().filter(x=>x!==me),rival=others.slice().sort((a,b)=>c.pts(a)-c.pts(b))[0];
  const w=await c.choose({who:rival,title:c.name(rival)+', you are the rival boat. Share the catch of '+plural(fishN(gold),'fish')+', or try to take it all with one question?',options:['Share it','Take it all']});
  if(w===0){const half=Math.ceil(gold/2);c.award(me,half);c.award(rival,gold-half);c.status('Shared.');c.stage(netStage(fishN(gold),'Shared between '+c.name(me)+' and '+c.name(rival)+'.'));await c.next('See the lamp','right');return {min:10,line:'The catch was shared'};}
  c.count('The wager');const r=await c.question(c.drawQ(),{who:rival,pts:0,steal:false,noAward:true,label:'Everything, or nothing'});
  if(r.right){c.award(rival,gold);c.stage(netStage(fishN(gold),c.name(rival)+' took the whole catch.'));await c.next('See the lamp','right',r);return {taker:gold>=20?rival:-1,line:c.name(rival)+' took the catch'};}
  c.award(me,gold+10);c.stage(netStage(fishN(gold+10),c.name(me)+' kept the catch, with 10 more for holding firm.'));await c.next('See the lamp','miss',r);
  return {taker:gold>=20?me:-1,line:c.name(me)+' kept the catch'};
 }};

/* ---------- Joseph's cup ---------- */
const BROTHERS=['Reuben','Simeon','Levi','Judah','Dan','Issachar','Zebulun','Gad','Asher','Naphtali'];
const DIMS=[
 {pairs:[['a staff','a water jar'],['a young lamb','a basket of figs']],clue:v=>'The brother with the cup was holding '+v+'.'},
 {pairs:[['a blue cloak','a red cloak'],['a striped cloak','a plain cloak']],clue:v=>'The cup was in the sack of the one in '+v+'.'},
 {pairs:[['a white headcloth','a dark headcloth'],['a bare head','a hooded head']],clue:v=>'He was wearing '+v+'.'}
];
function makeCup(r){
  const combos=shuffle([[0,0,0],[0,1,1],[1,0,1],[1,1,0]],r),names=shuffle(BROTHERS,r).slice(0,4),dims=DIMS.map(d=>pickOne(d.pairs,r));
  const people=names.map((n,k)=>({name:n,v:combos[k],text:dims.map((p,d)=>p[combos[k][d]])}));
  const thief=Math.floor(r()*4),order=shuffle([0,1,2],r);
  return {people,thief,clues:order.map(d=>DIMS[d].clue(dims[d][people[thief].v[d]]))};
}
function brother(p){
  const t=p.text.join(' '),cloak=/blue/.test(t)?'#3a64a8':/red/.test(t)?'#a8392e':'#8a6a46',stripe=/striped/.test(t)?'<path d="M-18 4V22M-6 2V22M6 2V22M18 4V22" stroke="#e8d49a" stroke-width="3"/>':'';
  const head=/white head/.test(t)?'<path d="M-16 -14Q0 -36 16 -14L18 2H-18Z" fill="#f2ecd8"/>':/dark head/.test(t)?'<path d="M-16 -14Q0 -36 16 -14L18 2H-18Z" fill="#2a2230"/>':/hooded/.test(t)?'<path d="M-17 -10Q0 -40 17 -10L14 6H-14Z" fill="#6a5a46"/>':'<path d="M-12 -16Q0 -28 12 -16" stroke="#3a2412" stroke-width="5" fill="none"/>';
  return '<svg viewBox="-30 -42 60 64" aria-hidden="true"><path d="M-24 22 q0 -22 24 -22 q24 0 24 22z" fill="'+cloak+'"/>'+stripe+'<circle cy="-12" r="14" fill="#d8b088"/>'+head+'<circle cx="-5" cy="-11" r="1.6" fill="#222"/><circle cx="5" cy="-11" r="1.6" fill="#222"/></svg>';
}
function cupStage(m,seen,lost,out){
  return '<div class="rs-mys"><div class="rs-sus">'+m.people.map((p,k)=>'<div class="rs-card'+(out.includes(k)?' out':'')+'" data-k="'+k+'">'+brother(p)+'<b>'+p.name+'</b><small>'+p.text.join('<br>')+'</small></div>').join('')+'</div>'
   +'<ol class="rs-clues">'+[0,1,2].map(k=>'<li class="'+(k<seen.length?(lost.includes(k)?'lost':'got'):'')+'"><span>Sack '+(k+1)+'</span>'+(k<seen.length?(lost.includes(k)?'The clue was lost in the dust.':m.clues[k]):'Not yet opened')+'</li>').join('')+'</ol></div>';
}
T.joseph={title:'Whose sack holds the cup?',
 rule:()=>'A puzzle inspired by Joseph\u2019s story: the hiding place changes every game. His steward has hidden the silver cup in one brother\u2019s sack. Each right answer opens a sack and turns up a clue. Name the brother early for more points: two clues are enough to be sure.',
 async play(c){
  const m=makeCup(c.rng),seen=[],lost=[],out=[],me=c.me;const paint=()=>c.stage(cupStage(m,seen,lost,out));paint();const VALUE=[30,20,10];
  for(let k=0;k<3;k++){
   c.count('Sack '+(k+1)+' of 3');
   const r=await c.question(c.drawQ(),{who:me,pts:5,steal:true,stealPts:5});
   seen.push(k);if(!r.right)lost.push(k);paint();
   c.status(r.right?'A clue: '+m.clues[k]:'No clue from this sack.');
   const got=seen.length-lost.length,last=k===2;
   if(!last){await c.next('Open the next sack',r.right?'right':'miss',r);
    if(!got)continue;
    const w=await c.choose({who:c.multi?me:-1,title:'Name the brother now for '+VALUE[k]*c.mult+' points, or open the next sack?',options:['Name him now','Open the next sack']});
    if(w===1)continue;}
   else await c.next('Name the brother',r.right?'right':'miss',r);
   const value=VALUE[k];
   const guess=await c.choose({who:c.multi?me:-1,title:'Whose sack holds the silver cup?',options:m.people.map(p=>p.name)});
   if(guess===m.thief){c.sfx('right');c.award(c.multi?me:0,value);out.push(...[0,1,2,3].filter(x=>x!==m.thief));paint();c.status('Right: it was in '+m.people[m.thief].name+'\u2019s sack.');
    await c.next('See the lamp','right');return c.multi?{taker:me,line:c.name(me)+' found the cup'}:{lit:true,line:'You found the cup'};}
   c.sfx('wrong');out.push(guess);paint();
   if(c.multi){const others=c.order().filter(x=>x!==me);
    const who=await c.buzz({players:others,label:'Not '+m.people[guess].name+'. Does anyone else know? Tap your name.',none:'Nobody'});
    if(who>=0){const g2=await c.choose({who,title:c.name(who)+': whose sack holds the cup?',options:m.people.map(p=>p.name),disabled:out});
     if(g2===m.thief){c.sfx('steal');c.award(who,value);c.status('Right: it was in '+m.people[m.thief].name+'\u2019s sack.');out.push(...[0,1,2,3].filter(x=>x!==m.thief&&!out.includes(x)));paint();
      await c.next('See the lamp','right');return {taker:who,line:c.name(who)+' found the cup'};}
     out.push(g2);paint();}}
   c.status('The cup was in '+m.people[m.thief].name+'\u2019s sack.');await c.next('See the lamp','miss');
   return c.multi?{taker:-1,line:'The cup stayed hidden'}:{lit:false,line:'The cup stayed hidden',need:'find the cup to light it'};
  }
 }};

/* In Carry the Light, the bearer answers and makes each round's key call; everyone else advises.
   Before every world except the Ark (which has its own jobs), the bearer picks the person they will lean on. */
const ADVISER={redsea:'Who keeps time for you?',jacob:'Who keeps time for you?',jonah:'Who do you trust to judge how deep to go?',galilee:'Who do you trust to judge this storm?',
 paul:'Who is your detective?',joseph:'Who is your detective?',scroll:'Who is your spotter?',nehemiah:'Who keeps you steady?',sinai:'Who keeps you steady?',lamps:'Who keeps watch with you?',daniel:'Who keeps watch with you?'};
['redsea','jonah','paul','joseph','galilee','scroll','ark','lamps','nehemiah','jacob','sinai','daniel'].forEach(id=>{const t=T[id]; if(!t)return; const play=t.play;
  t.play=async function(c){ const who=window.TL_CARRY&&window.TL_CARRY.bearerName(); if(!who)return play.call(this,c);
    let adv='';
    if(ADVISER[id]&&window.TL_CARRY.others){const others=shuffle(window.TL_CARRY.others(),c.rng).slice(0,4);
      if(others.length>1){c.count('Who do you lean on?');adv=others[await c.choose({who:-1,title:who+' carries the lamp. '+ADVISER[id],options:others})];}
      else if(others.length===1)adv=others[0];}
    /* going back for a dark lamp is a second chance: three easier questions, and two right answers light it */
    const S0=window.__tl&&window.__tl.S, ret=!!(S0&&S0.carry&&(S0.carry.tried[S0.pos]||0)>1&&T.classic), seen=new Set();
    const c2=Object.create(c); c2.count=x=>c.count((ret?'Second chance \u00b7 ':'')+x+' \u00b7 '+who+' answers'+(adv?', '+adv+' advises':''));
    if(ret){const bank=window.RF_BANK&&window.RF_BANK[S0.topic],pool=bank?[].concat(bank[1]||[],bank[2]||[]):[];
      c2.drawQ=()=>{ if(!pool.length)return c.drawQ(); let q=null; for(let k=0;k<8;k++){q=pool[Math.floor(c.rng()*pool.length)]; if(!seen.has(q.q))break;} seen.add(q.q);
        return {q:q.q,correct:q.correct,ref:q.ref,opts:shuffle([q.correct].concat(q.wrong.slice(0,3)),c.rng)}; }; }
    if(c.choose)c2.choose=o=>c.choose(Object.assign({},o,{title:who+' carries the lamp. '+(o.title||'')}));
    return (ret?T.classic.play:play).call(this,c2); }; });
})();
