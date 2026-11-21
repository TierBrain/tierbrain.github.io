/* Ten Lamps overlay: twelve biblical worlds on the Ten Lanterns engine. Load after ten-lanterns-rounds.js.
   Swaps the dial's districts, adds scenes, and re-uses each old world's game and soundscape under a new id. */
(function(){'use strict';
const A=window.TL_ART,R=window.TL_ROUNDS,S=window.TL_SOUND,Wd=window.TL_WORLDS,D=A.DISTRICTS;
D.length=0;
[['redsea','The Red Sea','Walls of water and a path of dry sand','#f2b36a','#7a3b2a'],
 ['jonah','Jonah and the fish','Down into the deep','#1d5a86','#081b33'],
 ['paul','Paul\u2019s journeys','Sea roads and city lights','#2c5c9a','#10214a'],
 ['joseph','Joseph\u2019s cup','A silver cup and eleven worried brothers','#5a3f86','#1b1236'],
 ['galilee','The storm on Galilee','A small boat and a rising wind','#3d6670','#0e2329'],
 ['scroll','The scroll cave','Torchlight on an ancient scroll','#5a3a26','#1c120c'],
 ['ark','Noah\u2019s Ark','Two by two on the lamplit deck','#8fd0f4','#e8f6ff'],
 ['lamps','The ten lamps','Who will still have oil at midnight?','#33265a','#0d0a1c'],
 ['nehemiah','Nehemiah\u2019s wall','Stone by stone before the dusk','#2a2f66','#4a2f52'],
 ['jacob','Jacob\u2019s ladder','Stairs of light under the stars','#1c1f44','#4a2f52'],
 ['sinai','Mount Sinai','Thunder, cloud and two tablets','#4a3a7e','#17132f'],
 ['daniel','The lions\u2019 den','A night of calm in the dark','#3b2f26','#0f0b09']
].forEach(a=>D.push({id:a[0],name:a[1],line:a[2],sky:[a[3],a[4]]}));

const s=(p,id)=>'<rect x="-60" y="-60" width="120" height="120" fill="url(#'+p+'-sky-'+id+')"/>';
const rc=(x,y,w,h,c,o)=>'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+c+'"'+(o?' opacity="'+o+'"':'')+'/>';
const ci=(x,y,r,c,o)=>'<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+c+'"'+(o?' opacity="'+o+'"':'')+'/>';
const pa=(d,c,o)=>'<path d="'+d+'" fill="'+c+'"'+(o?' opacity="'+o+'"':'')+'/>';
const fl=(x,y,k)=>pa('M'+x+' '+y+'c-'+3*(k||1)+' -'+4*(k||1)+' 0 -'+7*(k||1)+' 0 -'+10*(k||1)+'c'+4*(k||1)+' 3 '+4*(k||1)+' 7 0 '+10*(k||1)+'z','#ffb347');
const stars=c=>[[-40,-44],[-14,-50],[22,-40],[44,-52],[-48,-20],[36,-18],[8,-30]].map(a=>ci(a[0],a[1],1.2,c||'#fff',.85)).join('');
const M={
 redsea:p=>s(p,'redsea')+ci(0,-36,9,'#ffe3a3',.9)+rc(-60,-60,34,120,'#1f6f9a')+rc(26,-60,34,120,'#1f6f9a')+pa('M-26 60L-8 -14H8L26 60Z','#e6c18a')+rc(-5,26,10,5,'#7c4f33')+ci(-4,34,3,'#2a1a10')+ci(4,34,3,'#2a1a10'),
 jonah:p=>s(p,'jonah')+pa('M-60 -4Q-30 -14 0 -4T60 -4V60H-60Z','#0f3354',.8)+pa('M-38 20Q-22 -2 8 6Q34 12 44 28Q26 34 8 30Q-14 40 -38 20Z','#4d6a82')+ci(26,16,2,'#fff')+pa('M-38 20L-52 10L-50 30Z','#4d6a82')+pa('M-14 -46Q0 -40 14 -46L10 -40H-10Z','#8a5a36'),
 paul:p=>s(p,'paul')+ci(30,-34,8,'#ffe3a3',.9)+pa('M-60 26Q-30 18 0 26T60 26V60H-60Z','#16406e')+rc(-2,-20,3,42,'#6b4a2e')+pa('M0 -20L26 12H0Z','#f3e6c8')+pa('M-2 -14L-20 12H-2Z','#e8d6ac')+pa('M-24 22H24L16 32H-16Z','#8a5a36'),
 joseph:p=>s(p,'joseph')+stars()+pa('M-60 40Q-20 22 20 38T60 34V60H-60Z','#3a2c4e')+pa('M-40 40L-26 14L-12 40Z','#c9a46a')+pa('M10 40L24 18L38 40Z','#b88f58')+pa('M-8 -2H8L5 8L2 14V22H8V26H-8V22H-2V14L-5 8Z','#e6e9f0')+ci(0,-4,6,'#ffd27a',.35),
 galilee:p=>s(p,'galilee')+pa('M-52 -36Q-34 -52 -16 -36Q0 -52 22 -34Q40 -50 56 -34V-20H-52Z','#1d2b30',.8)+pa('M-4 -30L-14 -14H2Z','#fff',.9)+pa('M-60 22Q-40 6 -20 22T20 22T60 22V60H-60Z','#1f4a58')+pa('M-24 14H20L12 28H-16Z','#8a5a36')+rc(-2,-14,2.6,28,'#6b4a2e')+pa('M0 -12L16 10H0Z','#f3e6c8'),
 scroll:p=>s(p,'scroll')+pa('M-60 -60H60V-30Q30 -44 0 -30T-60 -30Z','#2a170d')+rc(-24,-18,48,30,'#f1e3c2')+ci(-24,-3,7,'#d9c79c')+ci(24,-3,7,'#d9c79c')+[-8,-1,6].map(y=>rc(-16,y,32,1.6,'#8a6a46')).join('')+rc(-48,18,3,24,'#6b4a2e')+fl(-46.5,18,1.4)+pa('M-60 60V40Q-20 32 20 42T60 40V60Z','#2a170d'),
 ark:p=>s(p,'ark')+ci(0,40,50,'#e24a4a',.0)+['#e86a5a','#f3c64c','#6fcf8a','#5aa8e8'].map((c,i)=>'<path d="M'+(-48+i*3.2)+' 2A'+(48-i*3.2)+' '+(48-i*3.2)+' 0 0 1 '+(48-i*3.2)+' 2" fill="none" stroke="'+c+'" stroke-width="3" opacity=".8"/>').join('')+pa('M-60 28Q-30 20 0 28T60 28V60H-60Z','#3f93c4')+pa('M-34 20H34L24 34H-24Z','#8a5a36')+rc(-20,4,40,16,'#a8774a')+pa('M-24 4L0 -12L24 4Z','#6b4a2e')+ci(-8,12,2,'#ffd27a')+ci(8,12,2,'#ffd27a'),
 lamps:p=>s(p,'lamps')+[-40,-20,0,20,40].map((x,i)=>pa('M'+(x-7)+' 8Q'+x+' 20 '+(x+7)+' 8Z','#d8b25a')+(i%2?'':fl(x,8,1))+(i%2?'':ci(x,-2,9,'#ffd27a',.18))).join('')+'<g transform="translate(0 30)">'+[-30,-10,10,30].map((x,i)=>pa('M'+(x-6)+' 6Q'+x+' 16 '+(x+6)+' 6Z','#d8b25a')+(i==1?fl(x,6,1):'')).join('')+'</g>',
 nehemiah:p=>s(p,'nehemiah')+ci(-28,-26,9,'#ffd9a0',.85)+rc(-60,10,120,50,'#9c7a52')+[10,22,34,46].map((y,i)=>[0,1,2,3,4,5,6,7].map(k=>rc(-60+k*16+(i%2?8:0),y,14,10,'#b8946a')).join('')).join('')+[-48,-16,16,48].map(x=>rc(x-5,2,10,8,'#9c7a52')).join('')+rc(30,-40,3,44,'#5c3d22')+rc(18,-40,24,3,'#5c3d22'),
 jacob:p=>s(p,'jacob')+stars()+ci(-36,-34,8,'#f3ecd0',.9)+pa('M-60 44Q-20 32 20 44T60 40V60H-60Z','#2b2340')+pa('M-12 44L-3 -50H3L12 44Z','#ffe6a0',.18)+rc(-9,-40,1.8,80,'#f3d98f')+rc(7,-40,1.8,80,'#f3d98f')+[-30,-18,-6,6,18,30].map(y=>rc(-9,y,18,1.6,'#f3d98f')).join(''),
 sinai:p=>s(p,'sinai')+stars('#dcd6ff')+pa('M-60 60L-14 -34L12 -6L26 -22L60 60Z','#4b3f5e')+pa('M-14 -34L-6 -20L-14 -22L-20 -16Z','#e8e4f2',.8)+pa('M-30 -36Q-14 -52 4 -38Q22 -50 38 -34Q20 -26 2 -30Q-18 -22 -30 -36Z','#9a92b8',.7)+pa('M8 -30L2 -14H8L2 4L14 -16H8L13 -30Z','#ffe680')+rc(-22,26,13,20,'#e8dfc8')+rc(-6,26,13,20,'#e8dfc8'),
 daniel:p=>s(p,'daniel')+pa('M-60 -60H60V-40L-60 -40Z','#2a1f18')+pa('M-8 -60H8L26 20H-26Z','#ffe6a0',.12)+rc(-60,44,120,16,'#6b5238')+[[-38,18],[-30,18],[32,22],[40,22]].map(a=>ci(a[0],a[1],1.8,'#ffd27a')).join('')+pa('M-40 44L-30 24L-20 44Z','#8a6a46')+pa('M20 44L32 26L44 44Z','#8a6a46')+ci(0,22,5,'#e2b98a')+pa('M-8 44L-6 29H6L8 44Z','#5a7ec4')
};
const mini=A.mini, CROP={redsea:350,jonah:120,paul:500,joseph:350,galilee:300,scroll:200,ark:100,lamps:350,nehemiah:350,jacob:250,sinai:400,daniel:350}, MC={};
/* dial windows are the real scenes, frozen and cropped to a square: no animation, no moving sparks */
function still(id,p){ const B=window.TL_BIBLE_SCENES||{}; if(!B[id]) return null;
  if(!MC[id]){ const w=B[id](), body=w.body.replace(/<circle class="fx"[^>]*\/>/g,'').replace(/ style="animation:[^"]*"/g,'').replace(/<rect width="1600" height="900" fill="url\(#[a-z]+-v\)"\/>/g,'');
    MC[id]='<defs>'+w.defs+'</defs><g transform="translate(-60 -60) scale(.1333) translate('+(-(CROP[id]||350))+' 0)">'+body+'</g>'; }
  /* every use gets its own gradient and clip ids, so no two windows ever share a definition */
  const pre=(p||'tl')+'-'+id+'-'; let out=MC[id]; const ids=[...out.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  ids.forEach(i=>{ out=out.split('id="'+i+'"').join('id="'+pre+i+'"').split('#'+i+')').join('#'+pre+i+')'); });
  return out; }
A.mini=(id,p)=>still(id,p)||(M[id]?M[id](p||'tl'):mini(id,p));

const st=document.createElement('style');
st.textContent='.tlb-drift{animation:tlbd 40s ease-in-out infinite alternate}@keyframes tlbd{to{transform:scale(1.07)}}@media (prefers-reduced-motion:reduce){.tlb-drift{animation:none}}';
document.head.appendChild(st);
const scene=Wd.scene;
const B=window.TL_BIBLE_SCENES||{};
Wd.scene=id=>B[id]?(scene('rome'),(w=>'<svg class="tlw tlw-'+id+'" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>'+w.defs+'</defs>'+w.body+'</svg>')(B[id]())):M[id]?'<svg class="tlw tlb" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>'+A.defs('tlb')+'</defs><g transform="translate(800 450)"><g class="tlb-drift"><g transform="scale(15)">'+A.mini(id,'tlb')+'</g></g></g></svg>':scene(id);

const SM={redsea:'rome',jonah:'submarine',paul:'flight',joseph:'railway',galilee:'galleon',scroll:'cave',ark:'balloon',lamps:'manor',nehemiah:'bigtop',jacob:'city',sinai:'cave',daniel:'cave'};
/* each biblical world now has its own soundscape in twelve-lamps-sound.js */

const T=R.types, al=(id,from,o)=>{T[id]=Object.assign({},T[from],o||{});};
al('redsea','rome',{title:'Race through the sea',rule:c=>c.multi?'Two parties cross the sea bed, with Pharaoh\u2019s chariots behind. Each question is open to both: tap your name to answer. Three right answers reach the far shore.':'Cross the sea bed with Pharaoh\u2019s chariots behind you. Every right answer pulls you ahead; every miss lets them gain. First to three wins.'});
al('jonah','submarine',{title:'How deep dare you go?',rule:c=>'Each right answer carries you deeper and fills the hold with more points. Come up whenever you like to keep them. The first wrong answer makes the deep rumble; a second loses the lot.'});
al('paul','flight',{title:'Which city?'});
al('joseph','railway',{/*title:'Whose sack held the cup?'*/});
al('galilee','galleon',{/*title:'Calm the storm'*/});
al('scroll','cave',{title:'By torchlight',rule:c=>'The torch reveals each line of the scroll a word at a time. Answer early for more points: '+(c.multi?'tap your name as soon as you know it.':'up to 15 a question.')});
al('ark','balloon',{/*title:'Two by two'*/});
al('lamps','manor',{title:'The last lamp',rule:c=>c.multi?'Questions go round in turn. A wrong answer lets your lamp go out. The last flame burning takes the lantern.':'Three lamps. Six questions. Each wrong answer lets a lamp go out. Keep one burning to light the lantern.'});
al('nehemiah','bigtop',{/*title:'Keep building'*/});
al('jacob','city',{/*title:'The ladder race'*/});

/* Two bespoke games. Both run on one loop: right answers add progress, wrong answers add a strike. */
const css=document.createElement('style');
css.textContent='.tb,.dn{display:flex;gap:14px;justify-content:center;align-items:flex-end;margin:10px 0;font-family:Fraunces,Georgia,serif}'
+'.tb-t{flex:0 1 150px;background:#d8cdb4;color:#3a2c1c;border-radius:50% 50% 8px 8px/26% 26% 8px 8px;padding:16px 10px 8px;text-align:center}'
+'.tb-s{display:flex;align-items:center;justify-content:center;gap:7px;height:26px;border-bottom:1px solid #b8a984;font-weight:700;font-size:14px}'
+'.tb-s i{width:13px;height:13px;border-radius:50%;background:var(--c,transparent);border:1px solid #b8a984}'
+'.tb-x{flex-basis:100%;text-align:center;letter-spacing:8px;color:#e0a14a;font-size:18px}'
+'.dn-d{flex-basis:100%;display:flex;gap:4px}.dn-d i{flex:1;height:8px;border-radius:4px;background:#2a2447}.dn-d i.on{background:#ffd27a}'
+'.dn-l{width:64px;text-align:center;font-size:12px;opacity:.85}.dn-l svg{width:56px;height:56px}.dn-l.on{opacity:1}'
+'.dn{flex-wrap:wrap}';
document.head.appendChild(css);
const NUM=['I','II','III','IV','V','VI'];
function sinaiPaint(st,c,who,multi){
  const slot=k=>'<div class="tb-s">'+(k<st.owners.length?'<i style="--c:'+(multi?c.colour(who[st.owners[k]]):'#d8b25a')+'"></i>':'')+'<span>'+NUM[k]+'</span></div>';
  return '<div class="tb"><div class="tb-t">'+[0,1,2].map(slot).join('')+'</div><div class="tb-t">'+[3,4,5].map(slot).join('')+'</div>'
   +'<div class="tb-x">'+[0,1,2].map(k=>k<st.strikes?'\u2715':'\u00b7').join(' ')+'</div></div>';
}
function denPaint(st){
  const lion=on=>'<div class="dn-l'+(on?' on':'')+'"><svg viewBox="0 0 56 56"><circle cx="28" cy="30" r="22" fill="#a8742f"/><circle cx="28" cy="31" r="14" fill="#e0b060"/>'
    +(on?'<circle cx="22" cy="28" r="3.2" fill="#ffe680"/><circle cx="34" cy="28" r="3.2" fill="#ffe680"/>':'<path d="M18 29q4 3 8 0M30 29q4 3 8 0" stroke="#5a3a1a" stroke-width="2" fill="none"/>')
    +'<path d="M24 38q4 3 8 0" stroke="#5a3a1a" stroke-width="2" fill="none"/></svg>'+(on?'Awake':'Asleep')+'</div>';
  return '<div class="dn">'+[0,1,2].map(k=>lion(k<st.strikes)).join('')+'<div class="dn-d">'+[0,1,2,3,4].map(k=>'<i class="'+(k<st.owners.length?'on':'')+'"></i>').join('')+'</div></div>';
}
function survive(cfg){ return {
  title:cfg.title, rule:c=>c.multi?cfg.ruleMulti:cfg.ruleSolo,
  async play(c){
    const multi=c.multi, who=multi?c.order():[0], st={owners:[],strikes:0}; let lastWrong=false, k=0;
    const paint=()=>c.stage(cfg.paint(st,c,who,multi));
    paint();
    while(st.owners.length<cfg.goal && st.strikes<cfg.limit && k<cfg.cap){
      c.count('Question '+(++k));
      const r=await c.question(c.drawQ(),{open:multi,players:who,pts:0,steal:false,noAward:true,label:cfg.label});
      if(r.right){ st.owners.push(multi?Math.max(0,who.indexOf(r.by)):0); c.sfx('up');
        if(cfg.calm&&lastWrong&&st.strikes>0) st.strikes--; lastWrong=false; }
      else { st.strikes++; lastWrong=true; c.sfx('down'); }
      paint();
      const done=st.owners.length>=cfg.goal||st.strikes>=cfg.limit;
      c.status(r.right?cfg.rightLine:cfg.wrongLine);
      await c.next(done||k>=cfg.cap?'See the lantern':'Next question',r.right?'right':'miss',r);
    }
    const ok=st.owners.length>=cfg.goal, mine=who.map((_,s)=>st.owners.filter(o=>o===s).length);
    who.forEach((i,s)=>{ if(mine[s]) c.award(i,mine[s]*cfg.pts); });
    if(multi) return ok?{min:1,line:cfg.winLine}:{min:1e6,line:cfg.loseLine};
    return {lit:ok,line:ok?cfg.winLine:cfg.loseLine,need:cfg.need};
  }}; }
T.sinai=survive({title:'The two tablets',goal:6,limit:3,cap:9,pts:5,paint:sinaiPaint,calm:false,label:'Right: carve a line. Wrong: a crack.',
  ruleSolo:'Carve six lines into the two tablets. Each right answer carves one. Three cracks and the stone breaks.',
  ruleMulti:'Every question is open: tap your name to answer. Right carves a line in your colour, wrong cracks the shared stone. Carve all six before three cracks, and the most lines takes the lantern.',
  rightLine:'A line is carved.',wrongLine:'The stone cracks.',winLine:'The tablets are finished',loseLine:'The stone broke',need:'carve all six lines before three cracks'});
T.daniel=survive({title:'A night in the den',goal:5,limit:3,cap:10,pts:10,paint:denPaint,calm:true,label:'Right: dawn draws near. Wrong: a lion wakes.',
  ruleSolo:'Reach dawn with five right answers. A wrong answer wakes a lion, but the next right answer settles one back to sleep. Three lions awake at once and the night is lost.',
  ruleMulti:'Every question is open: tap your name to answer. Five right answers bring dawn. A wrong answer wakes a lion, and the next right one settles it. Three awake at once and the night is lost. The most right answers takes the lantern.',
  rightLine:'Dawn draws nearer.',wrongLine:'A lion stirs.',winLine:'Dawn came, and Daniel is unharmed',loseLine:'The lions woke before dawn',need:'five right answers before three lions wake'});

window.TL_ARRIVE={
 redsea:['50% 80%','The waters stand like walls, and Pharaoh’s chariots are close behind. Three right answers carry you to the far shore, and every miss lets them gain.'],
 jonah:['48% 60%','Down you go, into the dark and the quiet. Each right answer takes you deeper for more points, but the deep rumbles at the first mistake and takes everything at the second.'],
 paul:['40% 60%','Another harbour, another letter to deliver. Clues come one at a time over the sea, so name the city early for more points.'],
 joseph:['50% 70%','Four brothers have stopped on the road. Somewhere among their sacks is a silver cup. How much evidence will you need before you name a name?'],
 galilee:['40% 60%','The wind is rising and the boat is small. Fill the net with three questions, then decide: ride out the storm to double the catch, or make for shore.',1300],
 scroll:['40% 60%','Torchlight falls on words older than memory, and each line appears a word at a time. Answer early for more points.'],
 ark:['50% 70%','The ramp is coming up. Watch the last few animals carefully. Once that door shuts, somebody will ask what you saw.'],
 lamps:['50% 40%','Midnight draws near and the lamps burn low. Each wrong answer lets one go out, so keep a single flame alive.'],
 nehemiah:['50% 80%','The wall is half built and the dusk is coming. Add a course with each right answer, lose one with each miss, and keep four standing.'],
 jacob:['50% 30%','A stairway of light stands under the open stars. Climb a rung with each right answer, slip back with each miss, and reach the top before the dawn.'],
 sinai:['50% 40%','Thunder rolls down the mountain, and two tablets wait to be carved. Each right answer carves a line, and three cracks break the stone.'],
 daniel:['50% 50%','You can hear one of them breathing. Get the next answer right and it settles. Wake three at once and it will be a very long night.']
};
})();
