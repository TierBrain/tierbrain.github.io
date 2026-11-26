/* Twelve Lamps: hand-built world scenes in the same toolkit as ten-lanterns-worlds.js. Load before twelve-lamps-worlds.js. */
(function(){'use strict';
const W=1600,H=900,f=n=>(Math.round(n*10)/10).toString();
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const an=(name,d,del,ease,more)=>' style="animation:tlw-'+name+' '+d+'s '+(ease||'ease-in-out')+' '+f(del||0)+'s infinite'+(more?';'+more:'')+'"';
const grad=(id,stops,x2,y2)=>'<linearGradient id="'+id+'" x1="0" y1="0" x2="'+(x2||0)+'" y2="'+(y2===undefined?1:y2)+'">'+stops.map(([o,c,a])=>'<stop offset="'+o+'" stop-color="'+c+'"'+(a!==undefined?' stop-opacity="'+a+'"':'')+'/>').join('')+'</linearGradient>';
const radial=(id,stops)=>'<radialGradient id="'+id+'">'+stops.map(([o,c,a])=>'<stop offset="'+o+'" stop-color="'+c+'" stop-opacity="'+(a===undefined?1:a)+'"/>').join('')+'</radialGradient>';
const rect=(fill,y,h)=>'<rect x="0" y="'+(y||0)+'" width="'+W+'" height="'+(h||H)+'" fill="'+fill+'"/>';
function stars(seed,n,ymax){const r=rng(seed);let s='';for(let i=0;i<n;i++){const x=r()*W,y=r()*ymax,z=.8+r()*2,tw=r()<.6;
  s+='<circle cx="'+f(x)+'" cy="'+f(y)+'" r="'+f(z)+'" fill="#fff" opacity="'+f(.35+r()*.55)+'"'+(tw?an('tw',2+r()*4,-r()*6):'')+'/>';}return s;}
function risers(seed,n,x,y,spread,o){const r=rng(seed);let s='';for(let i=0;i<n;i++){const d=o.dur[0]+r()*(o.dur[1]-o.dur[0]);
  s+='<circle class="fx" cx="'+f(x+(r()-.5)*spread)+'" cy="'+f(y)+'" r="'+f(o.r[0]+r()*(o.r[1]-o.r[0]))+'" fill="'+(o.fill||'none')+'"'+(o.stroke?' stroke="'+o.stroke+'" stroke-width="'+(o.sw||2)+'"':'')+' style="--dx:'+f((r()-.5)*(o.wob||40))+'px;--dy:'+f(-(o.rise||300)*(.7+r()*.5))+'px;--sc:'+(o.sc||1.6)+';--o:'+(o.op||.85)+';animation:tlw-rise '+f(d)+'s ease-out '+f(-r()*d)+'s infinite"/>';}return s;}
const st=document.createElement('style');
st.textContent='@keyframes tlb-fall{to{transform:translateY(120px)}}@keyframes tlb-foam{50%{opacity:.35}}@keyframes tlb-rain{to{transform:translate(-13px,120px)}}@keyframes tlb-flash{0%,90%,100%{opacity:0}91%{opacity:.8}93%{opacity:.1}94%{opacity:.7}97%{opacity:0}}@keyframes tlb-blink{0%,92%,100%{opacity:1}96%{opacity:.05}}@keyframes tlb-up{0%{transform:translate(0,0);opacity:0}12%,88%{opacity:1}100%{transform:translate(620px,-570px);opacity:0}}@keyframes tlb-down{0%{transform:translate(620px,-570px);opacity:0}12%,88%{opacity:1}100%{transform:translate(0,0);opacity:0}}.tlw .fall{transform-box:view-box}@media (prefers-reduced-motion:reduce){.tlw *{animation:none!important}}';
document.head.appendChild(st);

const S={};
/* THE RED SEA: two walls of water, a wet path to the far shore, a pillar of fire, a crowd on the move */
S.redsea=()=>{
  const L='M0 120 Q300 96 560 200 L780 340 L772 400 L330 900 H0Z', R='M1600 120 Q1300 96 1040 200 L820 340 L828 400 L1270 900 H1600Z';
  const defs=grad('rs-sky',[[0,'#080c2c'],[.45,'#3a2a5c'],[.78,'#c8704a'],[1,'#f5b062']])
   +radial('rs-hz',[[0,'#fff0c0',.95],[.4,'#ffb347',.5],[1,'#ff8a3c',0]])
   +grad('rs-wall',[[0,'#8fe6ea'],[.18,'#2fa6bf'],[.6,'#116a8e'],[1,'#07304f']])
   +grad('rs-sand',[[0,'#e0b57c'],[1,'#8a6240']])
   +grad('rs-pil',[[0,'#ffb347',0],[.5,'#fff6d2',1],[1,'#ffb347',0]],1,0)
   +grad('rs-pilv',[[0,'#ffd27a',0],[.35,'#ffd27a',.75],[1,'#ff9a3c',.9]])
   +grad('rs-core',[[0,'#fffbe8',0],[.35,'#fffbe8',.95],[1,'#fffbe8',.9]])
   +radial('rs-warm',[[0,'#ffb060',.55],[1,'#ffb060',0]])
   +radial('rs-vig',[[0,'#000',0],[.62,'#000',0],[1,'#000',.6]])
   +'<clipPath id="rs-cl"><path d="'+L+'"/></clipPath><clipPath id="rs-cr"><path d="'+R+'"/></clipPath>';
  let b=rect('url(#rs-sky)')+stars(21,70,300);
  b+='<ellipse cx="800" cy="398" rx="520" ry="150" fill="url(#rs-hz)"'+an('glow',7,0,'ease-in-out','--g:.65')+'/>';
  // far shore: low hills and palms, lit from behind
  b+='<path d="M640 402 Q700 380 760 392 T860 388 T960 402Z" fill="#22142c"/>'+[690,722,880,918].map((x,i)=>'<g transform="translate('+x+' '+(i%2?392:390)+')"><path d="M0 0V-26" stroke="#120a1c" stroke-width="2.4"/><path d="M0 -26q-9-5-13 1M0 -26q9-5 13 1M0 -26q-6-9-12-5M0 -26q6-9 12-5" stroke="#120a1c" stroke-width="2" fill="none"/></g>').join('');
  // pillar of fire
  b+='<rect x="740" y="30" width="120" height="372" fill="url(#rs-pil)" opacity=".28"'+an('glow',3,0,'ease-in-out','--g:.5')+'/>'
   +'<rect x="776" y="40" width="48" height="362" fill="url(#rs-pilv)"/><rect x="793" y="40" width="14" height="362" fill="url(#rs-core)"/>'
   +'<ellipse cx="800" cy="70" rx="110" ry="90" fill="url(#rs-warm)"'+an('glow',2.4,0,'ease-in-out','--g:.5')+'/>'
   +risers(7,16,800,380,30,{dur:[2.6,5],r:[1.4,3.2],fill:'#ffd27a',rise:300,wob:70,op:.9});
  // the two walls: body, falling water, foam, warm light from the pillar
  [[L,'rs-cl',-1],[R,'rs-cr',1]].forEach(([d,id,sg])=>{
    const r=rng(sg>0?5:9);let streaks='';
    for(let x=(sg>0?790:-20);x<(sg>0?1620:810);x+=17){const w=1.6+r()*3.4,dash=30+r()*50;
      streaks+='<path d="M'+f(x)+' -140 L'+f(x+(800-x)*.05)+' 1040" stroke="#e6ffff" stroke-width="'+f(w)+'" stroke-dasharray="'+f(dash)+' '+f(120-dash)+'" stroke-dashoffset="'+f(-r()*120)+'" opacity="'+f(.14+r()*.22)+'"/>';}
    b+='<path d="'+d+'" fill="url(#rs-wall)" opacity=".96"/><g clip-path="url(#'+id+')"><g class="fall" style="animation:tlb-fall '+(sg>0?2.3:2.7)+'s linear infinite">'+streaks+'</g>'
     +'<ellipse cx="800" cy="520" rx="520" ry="420" fill="url(#rs-warm)"'+an('glow',3.2,0,'ease-in-out','--g:.9')+'/>'
     +'<path d="'+d+'" fill="none" stroke="#e6ffff" stroke-width="10" opacity=".55" stroke-dasharray="26 14" style="animation:tlb-foam 2.4s ease-in-out infinite"/></g>';});
  // the path
  b+='<path d="M330 900 L772 400 H828 L1270 900Z" fill="url(#rs-sand)"/>'
   +'<path d="M520 900 L788 420M1080 900 L812 420" stroke="#6b4a30" stroke-width="3" opacity=".35"/>'
   +[[600,820,70,10],[960,780,56,8],[760,640,34,5],[860,560,22,3],[700,520,16,2]].map(([x,y,rx,ry])=>'<ellipse cx="'+x+'" cy="'+y+'" rx="'+rx+'" ry="'+ry+'" fill="#7fd0e0" opacity=".45"'+an('glow',4+rx%3,-rx%4,'ease-in-out','--g:.2')+'/>').join('');
  // a long line of people on the move, small and far
  const rp=rng(33);for(let i=0;i<22;i++){const t=i/21,y=470+t*300,sc=.35+t*.95,x=800+(rp()-.5)*(60+t*330);
    b+='<g transform="translate('+f(x)+' '+f(y)+') scale('+f(sc)+')"><g'+an('bob',.9+rp()*.5,-rp(),'ease-in-out','--b:-5px')+'><path d="M-6 0L-3 -26H3L6 0Z" fill="#1a0f26"/><circle cy="-31" r="5" fill="#1a0f26"/><path d="M9 4V-34" stroke="#1a0f26" stroke-width="2"/></g></g>';}
  // mist at the foot of each wall, and spray
  b+=[[360,880],[1240,880],[560,640],[1040,640]].map(([x,y],i)=>'<ellipse cx="'+x+'" cy="'+y+'" rx="'+(i<2?260:150)+'" ry="'+(i<2?60:34)+'" fill="#d8f6fb" opacity=".28"'+an('glow',5+i,-i*1.3,'ease-in-out','--g:.1')+'/>').join('')
   +risers(11,16,420,860,260,{dur:[2.5,4.5],r:[3,8],fill:'#d8f6fb',rise:200,wob:60,op:.5,sc:2.2})
   +risers(12,16,1180,860,260,{dur:[2.5,4.5],r:[3,8],fill:'#d8f6fb',rise:200,wob:60,op:.5,sc:2.2});
  // foreground: dark rocks and a figure with a raised staff
  b+='<path d="M0 900V760Q90 720 190 760Q250 740 330 800L380 900Z" fill="#07091a"/><path d="M1600 900V800Q1500 770 1420 810L1340 900Z" fill="#07091a"/>'
   +'<g transform="translate(232 762) scale(1.5)"><g'+an('sway',5,0,'ease-in-out','--s:1deg')+'><path d="M-15 0L-8 -68H8L15 0Z" fill="#05060f"/><circle cy="-80" r="10" fill="#05060f"/><path d="M6 -62L26 -94" stroke="#05060f" stroke-width="6" stroke-linecap="round"/><path d="M30 -150V-12" stroke="#05060f" stroke-width="4" stroke-linecap="round"/></g></g>';
  b+='<rect width="1600" height="900" fill="url(#rs-vig)"/>';
  return {defs,body:b};
};
const range=(a,b,s)=>{const o=[];for(let x=a;x<=b+1e-6;x+=s)o.push(x);return o;};
const scroll=(tile,secs,y)=>'<g'+(y?' transform="translate(0 '+y+')"':'')+'><g'+an('scroll',secs,0,'linear')+'><g transform="translate(-1600 0)">'+tile+'</g>'+tile+'<g transform="translate(1600 0)">'+tile+'</g></g></g>';
const wave=(y,amp,fill,op)=>'<path d="M0 '+y+' q100 '+(-amp)+' 200 0'+' t200 0'.repeat(7)+' V900 H0Z" fill="'+fill+'"'+(op?' opacity="'+op+'"':'')+'/>';
const vig=id=>'<rect width="1600" height="900" fill="url(#'+id+')"/>';
const VIG=id=>radial(id,[[0,'#000',0],[.62,'#000',0],[1,'#000',.55]]);
const ship=(x,y,s,sail)=>'<g transform="translate('+x+' '+y+') scale('+s+')"><g class="ship"'+an('pitch',6,-x%5,'ease-in-out')+'><path d="M-90 0Q-70 42 -30 46H60Q96 40 112 -8Q40 10 -90 0Z" fill="#5a3a22"/><path d="M-84 6Q0 16 104 -2" stroke="#c9a46a" stroke-width="4" fill="none"/><path d="M0 4V-170" stroke="#3a2412" stroke-width="7"/><path d="M-4 -150Q70 -122 82 -12Q30 -2 -4 -12Z" fill="'+(sail||'#f3e6c8')+'"/><path d="M-4 -96Q40 -84 80 -90" stroke="#a8392e" stroke-width="8" fill="none" opacity=".8"/></g></g>';
const bird=(x,y,s,c,beat)=>'<g transform="translate('+f(x)+' '+f(y)+') scale('+s+')"><g'+an('flap',beat||.7,-(x%7)/10)+'><path d="M0 0C-8 -9 -18 -10 -30 -4C-22 -2 -14 2 0 6C14 2 22 -2 30 -4C18 -10 8 -9 0 0Z" fill="'+(c||'#fff')+'"/></g></g>';

/* JONAH: down in the deep */
S.jonah=()=>{
  const defs=grad('jn-w',[[0,'#2a8cb8'],[.25,'#124a78'],[.7,'#06203f'],[1,'#020a1c']])+grad('jn-sh',[[0,'#d8f6ff',.6],[1,'#d8f6ff',0]])+VIG('jn-v');
  let b=rect('url(#jn-w)');
  b+=[160,520,900,1260].map((x,i)=>'<path class="shaft" d="M'+x+' 0H'+(x+130)+'L'+(x+430)+' 900H'+(x+150)+'Z" fill="url(#jn-sh)" opacity=".45"'+an('sway',9+i*2,-i*2,'ease-in-out','--s:2.5deg')+'/>').join('');
  b+='<rect width="1600" height="110" fill="url(#jn-sh)" opacity=".55"/>'+'<g'+an('bob',5,0,'ease-in-out','--b:-8px')+'><g transform="translate(1180 70) scale(.45)"><path d="M-90 0Q-70 40 -30 44H60Q96 38 112 -8Q40 10 -90 0Z" fill="#241408"/><path d="M0 2V-150" stroke="#241408" stroke-width="7"/><path d="M-2 -140Q70 -110 82 -12Q30 -2 -2 -12Z" fill="#3a2a1c"/></g></g>';
  b+=scroll('<g opacity=".6" fill="#a6dbea">'+range(40,1560,130).map((x,i)=>'<g transform="translate('+(x+(i%3)*18)+' '+(260+(i*53)%150)+')"><path d="M0 0q14 -9 28 0q-14 9 -28 0M28 0l10 -7v14z"/></g>').join('')+'</g>',52,0);
  b+='<g'+an('bob',8,0,'ease-in-out','--b:-16px')+'><g transform="translate(600 590)">'
   +'<g class="ship"'+an('sway',5,0,'ease-in-out','--s:5deg')+'><path d="M-400 30Q-520 -40 -566 -160Q-470 -60 -440 -6Q-500 80 -566 196Q-460 112 -396 66Z" fill="#2c5878"/></g>'
   +'<path d="M-420 40Q-300 -170 0 -150Q300 -150 420 -30Q330 112 40 142Q-250 152 -420 40Z" fill="#3c6c8c"/><path d="M-380 60Q-120 110 160 100Q330 90 400 20Q330 118 40 142Q-250 152 -380 60Z" fill="#8fb4c8" opacity=".75"/>'
   +'<path d="M-200 -90Q-60 -130 120 -108" stroke="#5a8aa8" stroke-width="6" fill="none" opacity=".6"/><path d="M300 -10Q360 20 396 -4" stroke="#1d3d56" stroke-width="5" fill="none"/>'
   +'<circle cx="290" cy="-62" r="15" fill="#0a1a2a"/><circle cx="294" cy="-66" r="5" fill="#fff" opacity=".8"/>'
   +'<g class="ship"'+an('sway',4,-1,'ease-in-out','--s:7deg')+'><path d="M-40 90Q-120 150 -210 160Q-150 100 -110 70Z" fill="#2c5878"/></g></g></g>';
  b+=range(60,1560,170).map((x,i)=>'<g transform="translate('+x+' 900)"><path class="kelp" d="M0 0q-22 -60 0 -120q22 -60 0 -120q-18 -50 4 -90" stroke="#1d6a48" stroke-width="'+(12+i%3*3)+'" fill="none" stroke-linecap="round" opacity=".8"'+an('sway',4+i%3,-i,'ease-in-out','--s:5deg')+'/></g>').join('');
  b+=risers(3,26,600,500,500,{dur:[4,8],r:[3,9],stroke:'#cdf4ff',sw:2,rise:480,wob:70,op:.6,sc:1.8})+vig('jn-v');
  return {defs,body:b};
};

/* PAUL'S JOURNEYS: a ship at dusk and a harbour city */
S.paul=()=>{
  const defs=grad('pl-s',[[0,'#1d2a66'],[.45,'#a8497a'],[.8,'#f08a4a'],[1,'#ffc46a']])+radial('pl-sun',[[0,'#fff2c0',.95],[.4,'#ffc46a',.5],[1,'#ff9a4a',0]])+grad('pl-w',[[0,'#274a86'],[1,'#0a1a40']])+VIG('pl-v');
  let b=rect('url(#pl-s)')+stars(5,40,260);
  b+='<circle cx="430" cy="470" r="300" fill="url(#pl-sun)"'+an('glow',7,0,'ease-in-out','--g:.7')+'/><circle cx="430" cy="470" r="52" fill="#fff0c4"/>';
  b+='<g'+an('cross',70,0,'linear','--from:200px;--to:-300px')+' opacity=".9"><path d="M900 150q40 -24 90 -10q40 -18 80 0q-20 20 -80 18q-50 12 -90 -8Z" fill="#f5a870" opacity=".5"/></g>';
  b+='<path d="M900 500Q1040 440 1200 470Q1400 430 1600 480V560H900Z" fill="#3a2440"/><path d="M1060 478V430H1220V478ZM1048 430H1232L1140 398Z" fill="#4a2e52"/>'+[1072,1104,1136,1168,1200].map(x=>'<rect x="'+x+'" y="430" width="10" height="48" fill="#2a1830"/>').join('')+'<path d="M1300 478V440H1380V478Z" fill="#3a2244"/>'
   +[[1090,452],[1160,452],[1320,458],[1352,458],[1250,470],[980,490]].map(([x,y],i)=>'<rect x="'+x+'" y="'+y+'" width="7" height="12" fill="#ffd27a"'+an('tw',2+i*.6,-i*.5)+'/>').join('')+'<rect x="1380" y="400" width="14" height="78" fill="#3a2244"/><circle cx="1387" cy="394" r="9" fill="#ffd27a"'+an('glow',1.8,0,'ease-in-out','--g:.5')+'/>';
  b+='<rect y="520" width="1600" height="380" fill="url(#pl-w)"/><rect y="520" width="1600" height="60" fill="#ffb060" opacity=".25"/>';
  b+=scroll(wave(560,12,'#3a5ea0',.55),38)+ship(760,620,1.35)+scroll(wave(700,22,'#1c3a78',.9),24)+scroll(wave(800,30,'#0e2252'),16);
  b+=bird(300,190,1,'#2a1830',.8)+bird(360,150,.8,'#2a1830',.7)+bird(250,150,.7,'#2a1830',.9)+vig('pl-v');
  return {defs,body:b};
};

/* JOSEPH'S CUP: a night camp in Egypt, a silver cup in the lamplight */
S.joseph=()=>{
  const defs=grad('jo-s',[[0,'#0b0a2c'],[.6,'#3a2a6a'],[1,'#8a4a6a']])+radial('jo-m',[[0,'#fff6d8',.9],[1,'#fff6d8',0]])+radial('jo-f',[[0,'#ffb347',.8],[1,'#ffb347',0]])+radial('jo-c',[[0,'#f2f6ff',.8],[1,'#f2f6ff',0]])+grad('jo-d',[[0,'#6a4a5a'],[1,'#1c1220']])+VIG('jo-v');
  let b=rect('url(#jo-s)')+stars(14,110,420);
  b+='<circle cx="1220" cy="200" r="190" fill="url(#jo-m)"'+an('glow',8,0,'ease-in-out','--g:.55')+'/><circle cx="1220" cy="200" r="58" fill="#fff6d8"/>';
  b+='<path d="M120 560L330 300L540 560Z" fill="#46304e"/><path d="M330 300L540 560H420Z" fill="#2c1c38"/><path d="M420 560L560 400L700 560Z" fill="#3c2a46"/><path d="M560 400L700 560H620Z" fill="#241630"/>';
  b+='<path d="M0 540Q300 500 640 530T1200 520T1600 540V900H0Z" fill="url(#jo-d)"/>';
  b+='<g'+an('cross',60,0,'linear','--from:1700px;--to:-300px')+'>'+[0,1,2,3].map(i=>'<g transform="translate('+(i*150)+' 540)"><path d="M0 0q-6 -30 6 -44q4 -14 12 -10q4 6 -2 14q8 12 6 40l-4 28M30 0q2 -24 -2 -40" stroke="#120a1a" stroke-width="7" fill="none" stroke-linecap="round"/><ellipse cx="22" cy="-36" rx="26" ry="14" fill="#120a1a"/><path d="M42 -44l16 -22" stroke="#120a1a" stroke-width="6"/></g>').join('')+'</g>';
  b+=[[300,700,1],[1300,720,1.2]].map(([x,y,s])=>'<g transform="translate('+x+' '+y+') scale('+s+')"><path d="M-110 0L0 -110L110 0Z" fill="#2a1a2e"/><path d="M-110 0L0 -110L-20 0Z" fill="#1c1022"/><path d="M-26 0L0 -52L26 0Z" fill="#ffb347" opacity=".55"'+an('glow',2.4,0,'ease-in-out','--g:.9')+'/></g>').join('');
  b+='<ellipse cx="800" cy="780" rx="420" ry="150" fill="url(#jo-f)"'+an('glow',3,0,'ease-in-out','--g:.55')+'/>';
  b+='<path d="M600 900V790Q800 760 1000 790V900Z" fill="#1c1220"/><path d="M600 790Q800 760 1000 790" stroke="#8a6a5a" stroke-width="6" fill="none"/>';
  b+='<g transform="translate(800 740)"><ellipse cx="0" cy="40" rx="120" ry="28" fill="#ffb347" opacity=".25"/><circle cy="-50" r="130" fill="url(#jo-c)"'+an('glow',4,0,'ease-in-out','--g:.45')+'/>'
   +'<path d="M-62 -150H62L54 -108Q44 -70 14 -52V8H52V30H-52V8H-14V-52Q-44 -70 -54 -108Z" fill="#e4ebf6"/><path d="M-62 -150H62L58 -128H-58Z" fill="#ffffff"/><path d="M-30 -112Q-26 -80 -8 -62" stroke="#a8b4c8" stroke-width="5" fill="none"/>'
   +'<path d="M-6 -178V-196M6 -178V-196M0 -186H0" stroke="#fff" stroke-width="3" opacity=".7"'+an('tw',1.6)+'/></g>';
  b+=risers(9,18,300,690,60,{dur:[2.4,4.6],r:[1.5,3.4],fill:'#ffd27a',rise:260,wob:50,op:.9})+vig('jo-v');
  return {defs,body:b};
};

/* GALILEE: a storm, a small boat, one shaft of calm */
S.galilee=()=>{
  const defs=grad('ga-s',[[0,'#05080f'],[.5,'#18303a'],[1,'#3a5a62']])+grad('ga-w',[[0,'#1c3a44'],[1,'#06121a']])+radial('ga-l',[[0,'#fff6d8',.5],[1,'#fff6d8',0]])+grad('ga-sh',[[0,'#ffe9b0',.7],[1,'#ffe9b0',0]])+VIG('ga-v');
  let b=rect('url(#ga-s)');
  b+='<g'+an('cross',50,0,'linear','--from:0px;--to:-400px')+'>'+[[200,140,360],[700,100,420],[1200,170,380],[1700,120,420]].map(([x,y,w])=>'<ellipse cx="'+x+'" cy="'+y+'" rx="'+w+'" ry="90" fill="#0c1218" opacity=".85"/>').join('')+'</g>';
  b+='<path class="beam" d="M1060 0L1480 0L1560 520L960 520Z" fill="url(#ga-sh)" opacity=".28"'+an('glow',6,0,'ease-in-out','--g:.5')+'/><ellipse cx="1260" cy="560" rx="360" ry="44" fill="url(#ga-l)"'+an('glow',5,0,'ease-in-out','--g:.9')+'/>';
  b+='<path d="M0 470Q260 430 560 462T1100 450T1600 470V540H0Z" fill="#0c1a1c"/><circle cx="260" cy="468" r="5" fill="#ffd27a"'+an('tw',1.4)+'/><circle cx="330" cy="472" r="4" fill="#ffd27a"'+an('tw',2)+'/>';
  b+='<rect y="500" width="1600" height="400" fill="url(#ga-w)"/>'+scroll(wave(540,18,'#2e5a66',.6),30)+scroll(wave(640,34,'#1e4250',.85),20);
  b+='<g'+an('bob',2.6,0,'ease-in-out','--b:-18px')+'><g transform="translate(760 590) scale(1.5)"><g class="ship"'+an('pitch',3.4,0,'ease-in-out')+'><path d="M-90 0Q-70 42 -30 46H60Q96 40 112 -8Q40 10 -90 0Z" fill="#4a2e1a"/><path d="M0 4V-150" stroke="#2a180c" stroke-width="7"/><path d="M-2 -140Q56 -108 64 -16Q24 -8 -2 -16Z" fill="#cdbf9a" opacity=".85"/><circle cx="-60" cy="-12" r="9" fill="#1a1008"/><circle cx="-34" cy="-14" r="9" fill="#1a1008"/></g></g></g>';
  b+=scroll(wave(760,40,'#0e2a34'),11);
  b+='<g class="fall" style="animation:tlb-rain .9s linear infinite" opacity=".35">'+range(-100,1700,26).map((x,i)=>'<path d="M'+x+' -140L'+(x-130)+' 1040" stroke="#cfe6ea" stroke-width="'+(1+i%3*.6)+'" stroke-dasharray="'+(26+i%4*8)+' '+(94-i%4*8)+'" stroke-dashoffset="'+(-i*17%120)+'"/>').join('')+'</g>';
  b+='<rect width="1600" height="900" fill="#e8f4ff" opacity="0" style="animation:tlb-flash 7s linear infinite"/><path d="M1010 0L960 130L1000 140L940 290" stroke="#fff" stroke-width="5" fill="none" opacity="0" style="animation:tlb-flash 7s linear infinite"/>'+vig('ga-v');
  return {defs,body:b};
};

/* THE SCROLL CAVE: torchlight, jars, and an open scroll */
S.scroll=()=>{
  const defs=grad('sc-r',[[0,'#1a0f0a'],[.5,'#4a3020'],[1,'#2a1a10']])+radial('sc-t',[[0,'#ffb347',.75],[1,'#ffb347',0]])+radial('sc-s',[[0,'#ffe9b0',.8],[1,'#ffe9b0',0]])+grad('sc-n',[[0,'#0b1030'],[1,'#3a3a6a']])+VIG('sc-v');
  let b=rect('url(#sc-r)');
  b+=range(0,1500,60).map((x,i)=>'<path d="M'+x+' 0H'+(x+70)+'L'+(x+34)+' '+(110+(i*47)%130)+'Z" fill="#150c08"/>').join('');
  b+='<path d="M1130 560V380Q1130 250 1280 250Q1430 250 1430 380V560Z" fill="url(#sc-n)"/>'+stars(8,16,380).replace(/cx="(\d+(\.\d)?)"/g,(m,v)=>'cx="'+(1140+(v%280))+'"').replace(/cy="(\d+(\.\d)?)"/g,(m,v)=>'cy="'+(260+(v%260))+'"')+'<path d="M1130 560Q1280 520 1430 560V620H1130Z" fill="#6a5a4a"/><path d="M1100 600V370Q1100 220 1280 220Q1460 220 1460 370V600H1430V380Q1430 250 1280 250Q1130 250 1130 380V600Z" fill="#2a1a10"/>';
  b+='<ellipse cx="330" cy="330" rx="420" ry="380" fill="url(#sc-t)"'+an('glow',2.2,0,'ease-in-out','--g:.55')+'/>';
  b+='<path d="M290 700L316 330" stroke="#3a2412" stroke-width="16"/><path d="M296 340Q250 300 270 252Q290 210 330 248Q352 284 332 340Z" fill="#ff8a2c"'+an('sway',.9,0,'ease-in-out','--s:5deg')+' class="flame"/><path d="M304 336Q284 306 296 280Q312 262 322 290Q330 310 318 336Z" fill="#ffe08a" class="flame"'+an('sway',.7,-.3,'ease-in-out','--s:6deg')+'/>'
   +risers(4,14,308,260,24,{dur:[1.6,3.2],r:[1.2,3],fill:'#ffd27a',rise:200,wob:40,op:.9});
  b+='<path d="M0 660Q400 620 800 650T1600 640V900H0Z" fill="#241408"/><path d="M0 700H1600" stroke="#150c08" stroke-width="4" opacity=".5"/>';
  b+=[[640,560,1],[720,600,.8],[1000,570,1.1]].map(([x,y,s])=>'<g transform="translate('+x+' '+y+') scale('+s+')"><path d="M-30 0Q-48 -30 -34 -60Q-22 -78 -12 -82V-96H12V-82Q22 -78 34 -60Q48 -30 30 0Z" fill="#9a6a44"/><ellipse cy="-98" rx="18" ry="6" fill="#6a4426"/><path d="M-36 -40H36" stroke="#5a3a20" stroke-width="3"/></g>').join('');
  b+='<ellipse cx="820" cy="640" rx="340" ry="110" fill="url(#sc-s)"'+an('glow',4,0,'ease-in-out','--g:.5')+'/><g transform="translate(820 650)"><path d="M-220 -40H220V30H-220Z" fill="#5a3a22"/><path d="M-190 -64Q0 -88 190 -64V-30Q0 -52 -190 -30Z" fill="#f1e1b8"/><ellipse cx="-190" cy="-47" rx="12" ry="24" fill="#d8c394"/><ellipse cx="190" cy="-47" rx="12" ry="24" fill="#d8c394"/>'+range(-160,160,40).map((x,i)=>'<path d="M'+x+' -70V-40" stroke="#8a6a46" stroke-width="3" opacity=".6"/>').join('')+'</g>';
  b+=risers(6,22,820,600,600,{dur:[6,12],r:[1.2,2.6],fill:'#f5deae',rise:260,wob:90,op:.5,sc:1.2})+vig('sc-v');
  return {defs,body:b};
};


/* NOAH'S ARK: after the flood, a rainbow and a dove */
S.ark=()=>{
  const defs=grad('ak-s',[[0,'#6ab8e8'],[.6,'#bfe4f4'],[1,'#fff0d0']])+radial('ak-sun',[[0,'#fff6c8',.95],[1,'#ffe08a',0]])+grad('ak-w',[[0,'#5aa8c8'],[1,'#1c5a82']])+VIG('ak-v');
  let b=rect('url(#ak-s)');
  b+='<circle cx="1280" cy="250" r="260" fill="url(#ak-sun)"'+an('glow',6,0,'ease-in-out','--g:.7')+'/><circle cx="1280" cy="250" r="56" fill="#fffbe0"/>';
  b+=['#e86a5a','#f0a04a','#f3d84c','#6fcf8a','#5aa8e8','#8a6ad8'].map((c,i)=>'<path d="M100 560A700 700 0 0 1 1260 560" transform="translate('+(i*-0)+' 0)" fill="none" stroke="'+c+'" stroke-width="18" opacity=".55" transform-origin="0 0" style="transform:scale('+(1-i*.022)+') translate('+(i*30)+'px,'+(i*14)+'px)"/>').join('');
  b+='<g'+an('cross',90,0,'linear','--from:0px;--to:-500px')+'>'+[[260,170,200],[900,120,240],[1500,190,220]].map(([x,y,w])=>'<ellipse cx="'+x+'" cy="'+y+'" rx="'+w+'" ry="46" fill="#fff" opacity=".8"/><ellipse cx="'+(x+w*.4)+'" cy="'+(y-24)+'" rx="'+w*.5+'" ry="40" fill="#fff" opacity=".8"/>').join('')+'</g>';
  b+='<path d="M1050 520L1250 330L1340 400L1420 340L1600 520Z" fill="#7a8aa8"/><path d="M1250 330L1290 372L1250 360L1220 376Z" fill="#fff"/><path d="M1420 340L1450 380L1420 372L1396 386Z" fill="#fff"/>';
  b+='<rect y="520" width="1600" height="380" fill="url(#ak-w)"/>'+scroll(wave(560,10,'#8cc8e0',.5),44);
  b+='<g'+an('bob',6,0,'ease-in-out','--b:-10px')+'><g transform="translate(640 600)"><g class="ship"'+an('pitch',8,0,'ease-in-out')+'><path d="M-330 -20Q-300 90 -140 100H200Q330 90 370 -50Q60 -10 -330 -20Z" fill="#6a4426"/><path d="M-300 6Q0 40 340 -20" stroke="#a8774a" stroke-width="6" fill="none"/>'
   +'<path d="M-210 -22V-170H230V-40Z" fill="#8a5c36"/><path d="M-230 -170L10 -262L260 -170Z" fill="#5a3a20"/><path d="M-170 -22V-150M-110 -22V-150M-50 -22V-150M10 -22V-150M70 -22V-150M130 -22V-150M190 -22V-150" stroke="#6a4426" stroke-width="4" opacity=".7"/>'
   +'<rect x="-30" y="-132" width="40" height="52" rx="4" fill="#ffd27a"'+an('glow',3,0,'ease-in-out','--g:.7')+'/><rect x="60" y="-132" width="40" height="52" rx="4" fill="#ffd27a"/>'
   +'<path d="M-170 -170q8 -60 20 -96q8 -14 22 -4q-6 20 -4 40q8 30 -2 60Z" fill="#c8913a"/><circle cx="-138" cy="-268" r="11" fill="#c8913a"/><path d="M180 -170q10 -34 40 -42q40 0 52 30Z" fill="#7a8088"/></g></g></g>';
  b+=scroll(wave(700,18,'#2e7aa8',.9),26)+scroll(wave(800,26,'#1c5a82'),16);
  b+='<g'+an('cross',22,0,'linear','--from:200px;--to:-1900px')+'>'+bird(1500,260,1.4,'#fff',.55)+'<path d="M1470 266q-20 -10 -34 0q14 12 34 6" fill="#6aaa4a" transform="translate(0 0)"/></g>'+vig('ak-v');
  return {defs,body:b};
};

/* THE TEN LAMPS: midnight, a lit door, five lamps burning and five run dry */
S.lamps=()=>{
  const defs=grad('lp-s',[[0,'#05061a'],[.6,'#1a1642'],[1,'#33265a']])+radial('lp-d',[[0,'#ffd27a',.9],[1,'#ffb347',0]])+radial('lp-f',[[0,'#ffcf6a',.8],[1,'#ffb347',0]])+grad('lp-g',[[0,'#241a3a'],[1,'#0a0716']])+VIG('lp-v');
  let b=rect('url(#lp-s)')+stars(31,120,420);
  b+='<circle cx="240" cy="150" r="90" fill="#fff6d8" opacity=".15"/><circle cx="240" cy="150" r="34" fill="#fff6d8"/>';
  b+='<path d="M0 520Q400 470 800 500T1600 480V900H0Z" fill="#14102a"/>';
  b+='<path d="M560 520V330Q560 230 800 230Q1040 230 1040 330V520Z" fill="#2a2046"/><path d="M620 520V350Q620 290 800 290Q980 290 980 350V520Z" fill="url(#lp-d)"'+an('glow',3.6,0,'ease-in-out','--g:.8')+'/><path d="M680 520V380Q680 340 800 340Q920 340 920 380V520Z" fill="#fff0c0"/>'
   +'<path d="M720 520L800 340L880 520Z" fill="#ffd27a" opacity=".5"/><path d="M640 900L760 540H840L960 900Z" fill="#ffd27a" opacity=".28"'+an('glow',4,0,'ease-in-out','--g:.5')+'/>';
  b+=range(90,1510,120).map((x,i)=>'<path d="M'+x+' 520V430" stroke="#1a1432" stroke-width="10"/>').join('');
  const lampX=range(150,1450,144.4);
  lampX.forEach((x,i)=>{const on=i%2===0,y=706+(i%2?12:0)+Math.abs(i-4.5)*5;
    b+='<g transform="translate('+f(x)+' '+f(y)+')">'+(on?'<circle cy="-30" r="150" fill="url(#lp-f)"'+an('glow',2.2+i*.2,-i*.3,'ease-in-out','--g:.5')+'/>':'')
     +'<path d="M-46 0Q-52 30 -20 38H30Q60 30 56 0Q20 8 -46 0Z" fill="'+(on?'#d8b25a':'#6a5a4a')+'"/><path d="M52 6Q80 4 84 -8Q70 -10 56 -4" stroke="'+(on?'#d8b25a':'#6a5a4a')+'" stroke-width="6" fill="none"/><path d="M-46 0Q-52 -12 -34 -14Q4 -22 38 -14Q58 -12 56 0Q20 8 -46 0Z" fill="'+(on?'#f0cf7a':'#8a7a68')+'"/>'
     +(on?'<path class="flame" d="M-4 -14Q-22 -40 -4 -66Q2 -50 12 -42Q20 -28 4 -14Z" fill="#ffb347"'+an('sway',.8+i*.05,-i*.1,'ease-in-out','--s:5deg')+'/><path class="flame" d="M-3 -16Q-12 -32 -3 -48Q4 -38 6 -30Q8 -22 -1 -16Z" fill="#fff0b0"/>':'<circle cy="-22" r="3" fill="#2a1a10"/>')+'</g>';
    if(!on) b+=risers(40+i,3,x,y-20,12,{dur:[3,6],r:[3,8],fill:'#8a8a9a',rise:140,wob:30,op:.35,sc:2.4});});
  b+=risers(77,26,800,600,900,{dur:[5,10],r:[1.4,3],fill:'#ffe08a',rise:360,wob:120,op:.7})+vig('lp-v');
  return {defs,body:b};
};

/* NEHEMIAH'S WALL: dusk, a half-built wall, torches and workers */
S.nehemiah=()=>{
  const defs=grad('nh-s',[[0,'#1c2058'],[.55,'#7a3a6a'],[1,'#f0904a']])+radial('nh-f',[[0,'#ffb347',.7],[1,'#ffb347',0]])+grad('nh-g',[[0,'#4a3250'],[1,'#120a18']])+VIG('nh-v');
  let b=rect('url(#nh-s)')+stars(17,50,220);
  b+='<circle cx="1200" cy="470" r="320" fill="url(#nh-f)" opacity=".5"'+an('glow',8,0,'ease-in-out','--g:.3')+'/>';
  b+='<path d="M0 520Q200 430 440 470Q640 400 880 450T1300 430T1600 470V620H0Z" fill="#2a1a34"/>'+range(80,1500,150).map((x,i)=>'<path d="M'+x+' '+(470-(i%3)*8)+'V'+(420-(i%2)*20)+'H'+(x+60)+'V'+(470-(i%3)*8)+'Z" fill="#241430"/>').join('');
  const wall=(x0,x1,h)=>{let s='';for(let y=0;y<h;y+=34)for(let x=x0+((y/34)%2?30:0);x<x1;x+=60)s+='<rect x="'+x+'" y="'+(640-y-34)+'" width="56" height="30" rx="3" fill="'+(((x+y)%3)?'#b8946a':'#a8845a')+'"/>';return s;};
  b+='<rect x="0" y="600" width="1600" height="300" fill="url(#nh-g)"/>'+wall(0,760,204)+wall(900,1600,238)+wall(760,900,68);
  b+='<g stroke="#4a2e18" stroke-width="8"><path d="M820 640V330M900 640V330M800 420H920M800 500H920M800 580H920"/></g>';
  b+=[[160,420],[560,440],[1020,380],[1420,370]].map(([x,y],i)=>'<g transform="translate('+x+' '+y+')"><path d="M0 0V-70" stroke="#3a2412" stroke-width="8"/><circle cy="-80" r="70" fill="url(#nh-f)"'+an('glow',1.8+i*.3,-i*.4,'ease-in-out','--g:.6')+'/><path class="flame" d="M-9 -66Q-18 -90 0 -112Q6 -94 12 -86Q16 -72 6 -64Z" fill="#ffb347"'+an('sway',.8,-i*.2,'ease-in-out','--s:6deg')+'/></g>').join('');
  b+='<g'+an('cross',26,0,'linear','--from:-200px;--to:1900px')+'>'+[0,1,2,3].map(i=>'<g transform="translate('+(i*60-120)+' 700)"><g'+an('bob',.7,-i*.2,'ease-in-out','--b:-6px')+'><path d="M-9 0L-6 -44H6L9 0Z" fill="#0c0612"/><circle cy="-52" r="8" fill="#0c0612"/><rect x="-14" y="-72" width="28" height="18" fill="#0c0612"/></g></g>').join('')+'</g>';
  b+='<path d="M0 900V820Q300 790 640 830T1300 820T1600 840V900Z" fill="#0c0612"/>'+[[100,860],[300,850],[460,866]].map(([x,y])=>'<path d="M'+x+' '+y+'l12 -26l16 8l14 -22l22 40Z" fill="#8a6a46"/>').join('');
  b+=risers(23,18,1100,700,500,{dur:[4,8],r:[2,5],fill:'#d8b88a',rise:160,wob:80,op:.4,sc:2.4})+vig('nh-v');
  return {defs,body:b};
};

/* JACOB'S LADDER: stars, a stone pillow, and a stairway of light with angels */
S.jacob=()=>{
  const defs=grad('jb-s',[[0,'#05061c'],[.6,'#1c1f4a'],[1,'#4a2f62']])+grad('jb-l',[[0,'#fff6d2',0],[.2,'#ffe9a0',.5],[1,'#fff6d2',.9]])+radial('jb-m',[[0,'#fff6d8',.8],[1,'#fff6d8',0]])+radial('jb-a',[[0,'#fff8e0',.9],[1,'#fff8e0',0]])+VIG('jb-v');
  let b=rect('url(#jb-s)')+stars(41,220,620);
  b+='<g'+an('glow',9,0,'ease-in-out','--g:.35')+'><path d="M0 250Q400 150 800 230T1600 170V320Q1200 260 800 340T0 360Z" fill="#7a6ad8" opacity=".4"/></g>';
  b+='<circle cx="260" cy="170" r="150" fill="url(#jb-m)"/><circle cx="260" cy="170" r="46" fill="#fff6d8"/><path d="M1380 90L1220 160" stroke="#fff" stroke-width="3" opacity="0" style="animation:tlw-shoot 9s linear infinite"/>';
  b+='<path d="M0 640Q400 580 820 620T1600 600V900H0Z" fill="#1a1230"/><path d="M0 700Q500 660 1000 690T1600 680V900H0Z" fill="#0e0a1e"/>';
  b+='<path d="M360 700L760 40H940L520 700Z" fill="url(#jb-l)" opacity=".32"'+an('glow',5,0,'ease-in-out','--g:.5')+'/>';
  const lad='<path d="M420 720L840 -10M500 720L920 -10" stroke="#fff3c0" stroke-width="10" stroke-linecap="round"/>'+range(0,1,.0625).map(t=>'<path d="M'+f(420+420*t)+' '+f(720-730*t)+'L'+f(500+420*t)+' '+f(720-730*t)+'" stroke="#fff3c0" stroke-width="6"/>').join('');
  b+='<g'+an('glow',3,0,'ease-in-out','--g:.75')+'>'+lad+'</g>';
  const angel=(dir,dl,k)=>'<g'+(dir?'':'')+' style="animation:tlb-'+(dir?'up':'down')+' 14s linear '+dl+'s infinite"><g transform="translate('+(430+k*8)+' '+(700-k*6)+')"><circle cy="-20" r="46" fill="url(#jb-a)"/><path d="M-9 0L-6 -34H6L9 0Z" fill="#fff8e0"/><circle cy="-42" r="7" fill="#fff8e0"/><path d="M-8 -30Q-34 -52 -30 -18Z M8 -30Q34 -52 30 -18Z" fill="#fff8e0" opacity=".85"/></g></g>';
  b+=angel(1,-1,0)+angel(1,-8,1)+angel(0,-4,2)+angel(0,-11,3);
  b+='<path d="M120 860Q150 800 240 790Q330 790 360 850L380 900H80Z" fill="#05040f"/><path d="M180 800Q230 760 290 790Z" fill="#241c3a"/><ellipse cx="236" cy="782" rx="40" ry="12" fill="#2a2244"/><path d="M110 840Q160 796 250 806Q330 806 372 856" stroke="#0c0a1e" stroke-width="2" fill="none"/>';
  b+=risers(19,24,640,640,500,{dur:[5,9],r:[1.4,3.2],fill:'#fff3c0',rise:520,wob:80,op:.8})+vig('jb-v');
  return {defs,body:b};
};

/* MOUNT SINAI: storm, fire at the summit, a camp below */
S.sinai=()=>{
  const defs=grad('sn-s',[[0,'#0a0820'],[.55,'#2a1e56'],[1,'#6a3a6a']])+radial('sn-f',[[0,'#ff9a3c',.9],[1,'#ff6a2c',0]])+grad('sn-m',[[0,'#4a3a5e'],[1,'#120c20']])+VIG('sn-v');
  let b=rect('url(#sn-s)')+stars(27,60,200);
  b+='<g'+an('cross',60,0,'linear','--from:0px;--to:-500px')+'>'+[[260,170,420],[820,130,480],[1400,190,440],[1900,140,460]].map(([x,y,w])=>'<ellipse cx="'+x+'" cy="'+y+'" rx="'+w+'" ry="100" fill="#14102a" opacity=".9"/><ellipse cx="'+(x+w*.2)+'" cy="'+(y+50)+'" rx="'+w*.7+'" ry="70" fill="#241a44" opacity=".7"/>').join('')+'</g>';
  b+='<path d="M0 660L260 520L420 580L640 360L760 300L860 200L940 260L1060 330L1180 280L1380 480L1600 560V900H0Z" fill="url(#sn-m)"/><path d="M860 200L940 260L900 300L860 260L820 300Z" fill="#6a5a7e" opacity=".7"/><path d="M760 300L700 420L780 400L740 520" stroke="#1a1030" stroke-width="6" fill="none" opacity=".6"/>';
  b+='<ellipse cx="860" cy="190" rx="300" ry="190" fill="url(#sn-f)"'+an('glow',1.6,0,'ease-in-out','--g:.5')+'/><path class="flame" d="M820 220Q780 150 850 60Q860 120 900 150Q930 190 900 230Z" fill="#ff8a2c"'+an('sway',1.3,0,'ease-in-out','--s:3deg')+'/><path class="flame" d="M840 220Q820 170 860 120Q870 160 886 190Q890 214 876 226Z" fill="#ffe08a"/>'
   +risers(2,20,860,200,60,{dur:[3,6],r:[10,26],fill:'#2a2036',rise:420,wob:140,op:.55,sc:2.6})+risers(5,18,860,210,60,{dur:[1.6,3.4],r:[1.5,3.5],fill:'#ffb347',rise:300,wob:100,op:.9});
  b+='<path d="M880 0L810 150L860 160L770 330" stroke="#fff" stroke-width="6" fill="none" opacity="0" style="animation:tlb-flash 8s linear infinite"/><rect width="1600" height="900" fill="#c8b8ff" opacity="0" style="animation:tlb-flash 8s linear infinite"/>';
  b+='<path d="M0 760Q400 700 800 740T1600 720V900H0Z" fill="#0a0814"/>'+range(120,1500,110).map((x,i)=>'<g transform="translate('+(x+(i%3)*18)+' '+(780+(i%2)*26)+') scale('+(.8+(i%3)*.15)+')"><path d="M-38 0L0 -46L38 0Z" fill="#1a1226"/><path d="M-10 0L0 -22L10 0Z" fill="#ffb347" opacity=".6"'+an('glow',2+(i%4)*.4,-i*.2,'ease-in-out','--g:.9')+'/></g>').join('');
  b+=[[430,742],[930,730],[1260,740]].map(([x,y],i)=>'<circle cx="'+x+'" cy="'+y+'" r="46" fill="url(#sn-f)" opacity=".6"'+an('glow',1.4+i*.2,0,'ease-in-out','--g:.3')+'/>').join('')+vig('sn-v');
  return {defs,body:b};
};

/* THE LIONS' DEN: stone walls, a shaft of light, a man in prayer, lions at rest */
S.daniel=()=>{
  const defs=grad('dn-w',[[0,'#3a2c24'],[1,'#120c0a']])+grad('dn-l',[[0,'#ffe9b0',.85],[1,'#ffe9b0',.08]])+radial('dn-g',[[0,'#ffe9b0',.7],[1,'#ffe9b0',0]])+VIG('dn-v');
  let b=rect('url(#dn-w)');
  for(let y=0;y<700;y+=64)for(let x=((y/64)%2?-60:0);x<1600;x+=120)b+='<rect x="'+x+'" y="'+y+'" width="116" height="60" rx="5" fill="#'+(((x+y)/60|0)%3?'4a3a30':'3a2c24')+'" stroke="#1a110c" stroke-width="3" opacity=".8"/>';
  b+='<ellipse cx="800" cy="0" rx="190" ry="60" fill="#c8e0ff" opacity=".9"/><ellipse cx="800" cy="0" rx="150" ry="40" fill="#fff6d8"/>';
  b+='<path class="shaft" d="M650 0H950L1100 720H500Z" fill="url(#dn-l)" opacity=".55"'+an('glow',5,0,'ease-in-out','--g:.35')+'/>';
  b+='<path d="M0 700Q400 670 800 690T1600 680V900H0Z" fill="#2a1c12"/><path d="M0 740Q800 700 1600 740" stroke="#4a3418" stroke-width="3" fill="none" opacity=".5"/>'+range(40,1560,80).map((x,i)=>'<path d="M'+x+' '+(760+(i*37)%90)+'l30 -8M'+(x+20)+' '+(780+(i*23)%80)+'l-26 -6" stroke="#8a6a2e" stroke-width="3" opacity=".6"/>').join('');
  b+='<ellipse cx="800" cy="720" rx="340" ry="90" fill="url(#dn-g)"'+an('glow',4,0,'ease-in-out','--g:.45')+'/>';
  b+='<g transform="translate(800 700)"><g'+an('sway',6,0,'ease-in-out','--s:1deg')+'><path d="M-48 0Q-44 -56 -14 -78Q0 -84 14 -78Q44 -56 48 0Z" fill="#241608"/><circle cx="0" cy="-96" r="17" fill="#241608"/><path d="M-6 -70Q-30 -60 -20 -40M6 -70Q30 -60 20 -40" stroke="#241608" stroke-width="9" stroke-linecap="round" fill="none"/></g></g>';
  const lion=(x,y,s,flip,i)=>'<g transform="translate('+x+' '+y+') scale('+(flip?-s:s)+' '+s+')"><ellipse cx="0" cy="0" rx="150" ry="52" fill="#a87a3a"/><path d="M130 10Q190 -6 206 -52" stroke="#a87a3a" stroke-width="14" fill="none" stroke-linecap="round"/><circle cx="206" cy="-56" r="12" fill="#6a4a1e"/><circle cx="-130" cy="-20" r="62" fill="#6a4418"/><circle cx="-146" cy="-14" r="42" fill="#c8923e"/><circle cx="-160" cy="-24" r="5" fill="#ffd27a"'+an('blink',6+i*1.4,-i*2)+'/><circle cx="-138" cy="-26" r="5" fill="#ffd27a"'+an('blink',6+i*1.4,-i*2)+'/><path d="M-166 -4Q-150 6 -134 -2" stroke="#4a2c0c" stroke-width="3" fill="none"/><path d="M-60 40h-60M-20 44h-40" stroke="#8a6228" stroke-width="16" stroke-linecap="round"/></g>';
  b+=lion(320,760,1,0,0)+lion(1290,770,1.05,1,1)+lion(500,690,.62,0,2)+lion(1120,692,.6,1,3);
  b+=risers(12,30,800,420,300,{dur:[7,14],r:[1.2,2.8],fill:'#fff0c0',rise:360,wob:90,op:.6,sc:1.2})+vig('dn-v');
  return {defs,body:b};
};

window.TL_BIBLE_SCENES=S;
})();
