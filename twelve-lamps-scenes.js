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
  s+='<circle class="fx" cx="'+f(x+(r()-.5)*spread)+'" cy="'+f(y)+'" r="'+f(o.r[0]+r()*(o.r[1]-o.r[0]))+'" fill="'+o.fill+'" style="--dx:'+f((r()-.5)*(o.wob||40))+'px;--dy:'+f(-(o.rise||300)*(.7+r()*.5))+'px;--sc:'+(o.sc||1.6)+';--o:'+(o.op||.85)+';animation:tlw-rise '+f(d)+'s ease-out '+f(-r()*d)+'s infinite"/>';}return s;}
const st=document.createElement('style');
st.textContent='@keyframes tlb-fall{to{transform:translateY(120px)}}@keyframes tlb-foam{50%{opacity:.35}}.tlw .fall{transform-box:view-box}@media (prefers-reduced-motion:reduce){.tlw *{animation:none!important}}';
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
window.TL_BIBLE_SCENES=S;
})();
