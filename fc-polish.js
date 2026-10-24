/* ============================================================
   Full Circuit: a light polish for the opening, the journey and the finale.
   Loaded after the game's own script on all four pages (solo and team, both editions).
   It adds to what is drawn and never changes the rules:
     - the opening: a moonlit night over the house (or, in the Bible Edition, a lamp-lit book)
     - the journey: a small map of the house in the hallway, and a corridor that passes as you walk
     - the finale: the machine wakes properly (eye, chest, arms, springs, key, steam), or fades and sags;
       in the Bible Edition the walls of Jericho fall in a cloud of dust
   ============================================================ */
(function(){
  'use strict';
  var ED = window.ED === 'bible' ? 'bible' : 'house';
  var REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function(id){ return document.getElementById(id); };

  /* ---------- styles ---------- */
  var css = [
    '.story .s-scene,.story .s-lines,.story .s-skip{z-index:1;}',
    '.story .s-sky{position:absolute;inset:0;z-index:0;pointer-events:none;transition:opacity 1.4s ease;}',
    '.story .s-sky svg{position:absolute;inset:0;width:100%;height:100%;}',
    '.story.k-arrive.walk .s-sky{opacity:.18;}',
    '.fx-twinkle{animation:fxTw 3.2s ease-in-out infinite;} @keyframes fxTw{50%{opacity:.25;}}',
    '.fx-cloud{animation:fxCloud 38s linear infinite;} @keyframes fxCloud{from{transform:translateX(-30%);}to{transform:translateX(130%);}}',
    '.fx-lit{animation:fxFlick 2.6s steps(1) infinite;} @keyframes fxFlick{0%,100%{opacity:1;}43%{opacity:.82;}46%{opacity:1;}71%{opacity:.9;}73%{opacity:1;}}',
    '.fx-attic{animation:fxHum 2.8s ease-in-out infinite;} @keyframes fxHum{50%{opacity:.35;}}',
    '.fx-spill{opacity:0;animation:fxIn 1.6s 2.2s ease forwards;} @keyframes fxIn{to{opacity:1;}}',
    '.fx-flame{transform-box:fill-box;transform-origin:50% 100%;animation:fxFlame .9s ease-in-out infinite alternate;} @keyframes fxFlame{to{transform:scaleY(1.18) scaleX(.9);}}',
    '.fx-page{transform-box:fill-box;transform-origin:0 50%;animation:fxPage 5s 1.2s ease-in-out infinite;} @keyframes fxPage{0%,55%,100%{transform:scaleX(1);}75%{transform:scaleX(-.15);opacity:.6;}}',
    '.fx-mote{animation:fxMote 6s ease-in-out infinite;} @keyframes fxMote{0%{transform:translate(0,0);opacity:0;}30%{opacity:.8;}100%{transform:translate(14px,-46px);opacity:0;}}',
    /* the corridor that passes as you walk to a door */
    '.story .s-corr{position:absolute;inset:0;pointer-events:none;}',
    '.story .s-corr .lp{position:absolute;left:50%;top:38%;width:0;height:0;opacity:0;}',
    '.story.walk .s-corr .lp{animation:fxPass 2.6s cubic-bezier(.4,0,.8,.6) var(--d) both;}',
    '.story .s-corr .lp i{position:absolute;top:0;width:10px;height:16px;margin:-8px -5px;border-radius:3px;background:#ffd08a;box-shadow:0 0 18px 8px rgba(255,180,90,.35);}',
    '.story .s-corr .lp i:first-child{left:-70px;} .story .s-corr .lp i:last-child{left:70px;}',
    '@keyframes fxPass{0%{opacity:0;transform:scale(.4);}25%{opacity:.9;}100%{opacity:0;transform:scale(3.4);}}',
    '.fx-sconce{animation:fxFlick 3.1s steps(1) infinite;}',
    /* the hallway map */
    '.fc-map{display:block;width:100%;max-width:380px;margin:2px auto 14px;}',
    '.fc-map > svg{display:block;width:100%;height:auto;overflow:visible;}',
    '.fc-map .rm{fill:#2a1d14;stroke:#7d5a22;stroke-width:1.5;transition:fill .8s;}',
    '.fc-map .rm.won{fill:#f2c46d;} .fc-map .rm.lost{fill:#4a4048;}',
    '.fc-map .gl *{stroke:#a88b5e;} .fc-map .won-g *{stroke:#5a3a10;} .fc-map .lost-g *{stroke:#8a8088;}',
    '.fc-map .just{animation:fxJust 1.6s ease-out;} @keyframes fxJust{0%{filter:drop-shadow(0 0 0 #ffd27a);}30%{filter:drop-shadow(0 0 10px #ffd27a);}100%{filter:drop-shadow(0 0 0 rgba(255,210,122,0));}}',
    '.fc-map .you{animation:fxBob 1.8s ease-in-out infinite;} @keyframes fxBob{50%{transform:translateY(-2px);}}',
    '.fc-map .lbl{font:700 9px "Special Elite","Courier New",monospace;fill:#7d5a22;}',
    /* the finale: the machine wakes */
    '.machine .fx-aura{opacity:0;transition:opacity 1.2s;} .machine.awake .fx-aura{opacity:1;animation:fxAura 2.2s ease-in-out infinite;}',
    '@keyframes fxAura{50%{opacity:.6;}}',
    '.machine.awake #p-Lens .glow{animation:fxEye 1.8s ease-out both;} @keyframes fxEye{0%{opacity:0;}20%{opacity:1;fill:#ffffff;}100%{opacity:.95;}}',
    '.machine.awake #p-Fuse .glow{animation:fxBeat 1.2s ease-in-out .4s infinite;} @keyframes fxBeat{50%{opacity:.45;}}',
    '.machine #p-Wire,.machine #p-Spring,.machine #p-Key{transform-box:view-box;}',
    '.machine.awake #p-Wire{animation:fxArms 1.6s cubic-bezier(.3,1.6,.5,1) .3s both;} @keyframes fxArms{from{transform:translateY(0);}to{transform:translateY(-7px);}}',
    '.machine.awake #p-Spring{transform-origin:150px 180px;animation:fxSpring .8s ease-in-out .5s 3;} @keyframes fxSpring{50%{transform:scaleY(.82);}}',
    '.machine.awake #p-Key{transform-origin:247px 137px;animation:fxKey 2.4s ease-in-out .2s infinite;} @keyframes fxKey{0%{transform:rotate(0);}60%,100%{transform:rotate(360deg);}}',
    '.machine .fx-puff{opacity:0;fill:#efe6d6;} .machine.awake .fx-puff{animation:fxPuff 2.2s ease-out infinite;}',
    '.machine.awake .fx-puff:nth-of-type(2){animation-delay:.7s;} .machine.awake .fx-puff:nth-of-type(3){animation-delay:1.4s;}',
    '@keyframes fxPuff{0%{opacity:0;transform:translate(0,0) scale(.6);}20%{opacity:.75;}100%{opacity:0;transform:translate(10px,-34px) scale(2.2);}}',
    '.machine .fx-zap{fill:none;stroke:#e8fbff;stroke-width:2;stroke-linecap:round;opacity:0;filter:drop-shadow(0 0 4px #9fe8ff);}',
    '.machine.awake .fx-zap{animation:fxZap 1.3s steps(1) infinite;}',
    '.machine.awake .fx-zap:nth-of-type(2n){animation-delay:.35s;} .machine.awake .fx-zap:nth-of-type(3n){animation-delay:.8s;}',
    '@keyframes fxZap{0%{opacity:0;}10%{opacity:1;}22%{opacity:0;}55%{opacity:.8;}62%{opacity:0;}}',
    '.machine .fx-puff,.machine .fx-zap{transform-box:fill-box;transform-origin:50% 50%;}',
    '.machine.asleep{translate:0 5px;filter:saturate(.55) brightness(.85);transition:translate 1.4s ease-in,filter 1.4s;}',
    '.machine.asleep .glow{animation:fxOut 1.5s ease-in forwards;} @keyframes fxOut{0%{opacity:.9;}25%{opacity:.2;}35%{opacity:.7;}55%{opacity:.1;}62%{opacity:.4;}100%{opacity:0;}}',
    '.machine .fx-dust{opacity:0;fill:#e9d2a2;transform-box:fill-box;transform-origin:50% 100%;}',
    '.machine.awake .fx-dust{animation:fxDust 2.6s ease-out .5s forwards;}',
    '.machine.awake .fx-dust:nth-of-type(2){animation-delay:.75s;} .machine.awake .fx-dust:nth-of-type(3){animation-delay:.95s;}',
    '@keyframes fxDust{0%{opacity:0;transform:scale(.3);}25%{opacity:.85;}100%{opacity:0;transform:scale(1.8) translateY(-10px);}}',
    /* the closing scene: the machine (or Jericho) itself, not just a glow */
    '.story .s-bot{position:absolute;left:50%;top:50%;width:min(52vw,230px);transform:translate(-50%,-46%);z-index:1;transition:transform 2.4s ease,filter 2.4s ease;}',
    '.story .s-bot svg{display:block;width:100%;height:auto;}',
    '.story.wake .s-bot{transform:translate(-50%,-52%);} .story.fade .s-bot{transform:translate(-50%,-42%);filter:brightness(.6) saturate(.5);}',
    '.story .s-bot .eye{fill:#9fe8ff;opacity:.15;transition:opacity 1.2s .8s;} .story.wake .s-bot .eye{opacity:1;filter:drop-shadow(0 0 10px #9fe8ff);}',
    '.story .s-bot .core{fill:#9fe8ff;opacity:.1;transition:opacity 1.2s 1.3s;} .story.wake .s-bot .core{opacity:.9;filter:drop-shadow(0 0 12px #9fe8ff);}',
    '.story.fade .s-bot .eye,.story.fade .s-bot .core{animation:fxOut 1.6s ease-in forwards;}',
    '.story .s-bot .wl{transform-box:fill-box;transform-origin:50% 100%;transition:transform 1.3s cubic-bezier(.5,0,.8,.3) .9s,opacity 1.3s .9s;}',
    '.story.wake .s-bot .wl{transform:translateY(10px) rotate(8deg) scaleY(.3);opacity:.35;} .story.wake .s-bot .wl:nth-of-type(2n){transform:translateY(12px) rotate(-10deg) scaleY(.25);}',
    '.story .s-bot .dust{opacity:0;fill:#e9d2a2;transform-box:fill-box;transform-origin:50% 100%;} .story.wake .s-bot .dust{animation:fxDust 2.4s ease-out 1.1s forwards;}',
    '.ed-bible .story .s-orb{background:radial-gradient(circle,#fff3d0,#ffd27a 40%,transparent 70%);}',
    '@media (prefers-reduced-motion: reduce){ .fx-twinkle,.fx-cloud,.fx-lit,.fx-attic,.fx-flame,.fx-page,.fx-mote,.fx-sconce,.fc-map .you,.fc-map .just,.machine.awake *,.machine .fx-aura{animation:none !important;} .story .s-corr,.story .s-bot,.machine.asleep{transition:none !important;} .fx-spill{opacity:1;animation:none;} }'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'fc-polish-css'; st.textContent = css; document.head.appendChild(st);

  /* ---------- the opening ---------- */
  function rnd(a, b){ return a + Math.random() * (b - a); }
  function skySVG(){
    var s = '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
    for(var i = 0; i < 46; i++) s += '<circle class="' + (i % 3 ? '' : 'fx-twinkle') + '" style="animation-delay:' + rnd(0, 3).toFixed(2) + 's" cx="' + rnd(0, 400).toFixed(1) + '" cy="' + rnd(0, 170).toFixed(1) + '" r="' + rnd(.4, 1.3).toFixed(2) + '" fill="#f4ecd8"/>';
    s += '<defs><filter id="fxSoft"><feGaussianBlur stdDeviation="4"/></filter></defs>'
      + '<circle cx="246" cy="50" r="17" fill="#f1ead2" opacity=".92"/><circle cx="246" cy="50" r="34" fill="#f1ead2" opacity=".07"/>'
      + '<g class="fx-cloud" opacity=".4" filter="url(#fxSoft)"><ellipse cx="60" cy="44" rx="40" ry="8" fill="#3a4060"/><ellipse cx="82" cy="39" rx="22" ry="8" fill="#3a4060"/></g>'
      + '<g class="fx-cloud" style="animation-duration:52s;animation-delay:-26s" opacity=".3" filter="url(#fxSoft)"><ellipse cx="40" cy="78" rx="50" ry="7" fill="#323856"/></g>'
      + '<path d="M0 230 Q70 205 140 222 T280 214 T400 222 V300 H0 Z" fill="#070910"/></svg>';
    return s;
  }
  var HOUSE = '<svg viewBox="0 0 300 220" aria-hidden="true">'
    // a bare tree on the left, its branches reaching for the moonlight
    + '<path d="M38 220 C40 180 36 150 44 120 M42 150 C30 140 22 128 18 112 M44 132 C56 118 58 104 66 96 M40 168 C28 164 16 160 8 150" stroke="#06080e" stroke-width="5" fill="none" stroke-linecap="round"/>'
    // the house: body, roof, chimney, porch
    + '<path d="M58 220 V112 L150 46 L242 112 V220 Z" fill="#06070c"/><path d="M48 116 L150 40 L252 116" stroke="#10131d" stroke-width="5" fill="none" stroke-linejoin="round"/>'
    + '<rect x="200" y="54" width="16" height="40" fill="#06070c"/><rect x="197" y="50" width="22" height="6" fill="#10131d"/>'
    // the attic window: something blue hums up there
    + '<circle cx="150" cy="86" r="10" fill="#0f1a2a"/><circle class="fx-attic" cx="150" cy="86" r="7" fill="#9fe8ff" opacity=".2"/><path d="M140 86 H160 M150 76 V96" stroke="#06070c" stroke-width="2"/>'
    // two dark windows and one lit, with a candle flicker
    + '<rect x="78" y="132" width="28" height="34" fill="#131a2a"/><path d="M92 132 V166 M78 149 H106" stroke="#06070c" stroke-width="2"/>'
    + '<rect x="194" y="132" width="28" height="34" fill="#131a2a"/><path d="M208 132 V166 M194 149 H222" stroke="#06070c" stroke-width="2"/>'
    + '<rect class="fx-lit" x="136" y="108" width="28" height="30" fill="#ffae3d" style="filter:drop-shadow(0 0 14px #ffae3d)"/><path d="M150 108 V138 M136 123 H164" stroke="#5a3010" stroke-width="2"/>'
    // the front door stands ajar, and light spills down the path
    + '<path class="fx-spill" d="M138 220 L162 220 L196 236 L104 236 Z" fill="rgba(255,190,110,.25)" transform="translate(0,-16)"/>'
    + '<path d="M132 220 V178 Q150 162 168 178 V220 Z" fill="#131a2a"/><path class="fx-spill" d="M161 220 V176 Q164 179 168 180 V220 Z" fill="#ffc77a" style="filter:drop-shadow(0 0 6px #ffae3d)"/>'
    + '<path d="M90 220 H210" stroke="#10131d" stroke-width="3"/></svg>';
  var BOOK = '<svg viewBox="0 0 300 220" aria-hidden="true">'
    + '<ellipse cx="150" cy="208" rx="130" ry="10" fill="rgba(0,0,0,.35)"/>'
    + '<path d="M150 70 Q100 50 30 60 V190 Q100 180 150 200 Z" fill="#efe4c8" stroke="#7d5a22" stroke-width="3"/>'
    + '<path d="M150 70 Q200 50 270 60 V190 Q200 180 150 200 Z" fill="#e3d4b0" stroke="#7d5a22" stroke-width="3"/>'
    + '<path d="M55 90 H125 M55 110 H125 M55 130 H115 M55 150 H120 M175 90 H245 M175 110 H245 M175 130 H235 M175 150 H240" stroke="#a88b5e" stroke-width="3" stroke-linecap="round"/>'
    + '<path class="fx-page" d="M150 70 Q200 52 262 62 V184 Q200 176 150 196 Z" fill="#f4ead2" stroke="#7d5a22" stroke-width="2" opacity=".95"/>'
    + '<ellipse cx="150" cy="40" rx="46" ry="30" fill="#ffae3d" opacity=".12"/>'
    + '<path class="fx-flame" d="M150 22 C142 34 144 44 150 50 C156 44 158 34 150 22 Z" fill="#ffc35a" style="filter:drop-shadow(0 0 10px #ffae3d)"/>'
    + '<path d="M132 50 Q150 60 168 50 L162 46 H138 Z" fill="#7d5a22"/>';
  for(var m = 0; m < 9; m++) BOOK += '<circle class="fx-mote" style="animation-delay:' + (m * .7).toFixed(1) + 's" cx="' + (110 + m * 10) + '" cy="' + (60 + (m % 3) * 14) + '" r="1.3" fill="#ffe3a8"/>';
  BOOK += '</svg>';
  try{ window.HOUSE_SVG = ED === 'bible' ? BOOK : HOUSE; }catch(e){}

  /* a little machine for the closing scene */
  var BOT = '<svg viewBox="0 0 200 200" aria-hidden="true"><ellipse cx="100" cy="100" rx="96" ry="96" fill="#9fe8ff" opacity=".06"/>'
    + '<rect x="58" y="84" width="84" height="70" rx="14" fill="#2a2018" stroke="#7d5a22" stroke-width="3"/><rect x="88" y="72" width="24" height="14" fill="#2a2018" stroke="#7d5a22" stroke-width="3"/>'
    + '<rect x="66" y="18" width="68" height="54" rx="16" fill="#2a2018" stroke="#7d5a22" stroke-width="3"/><circle cx="100" cy="45" r="13" fill="#120c08" stroke="#b78a3e" stroke-width="3"/><circle class="eye" cx="100" cy="45" r="8"/>'
    + '<rect x="86" y="104" width="28" height="24" rx="9" fill="#120c08" stroke="#b78a3e" stroke-width="3"/><rect class="core" x="91" y="109" width="18" height="14" rx="6"/>'
    + '<path d="M58 96 Q32 104 34 140 M142 96 Q168 104 166 140" stroke="#b78a3e" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M80 154 V186 M120 154 V186" stroke="#b78a3e" stroke-width="7" stroke-linecap="round"/></svg>';
  var WALLS = '<svg viewBox="0 0 200 200" aria-hidden="true"><ellipse cx="100" cy="150" rx="94" ry="26" fill="#c9a46a" opacity=".35"/>'
    + '<rect class="wl" x="20" y="96" width="34" height="56" fill="#d8b47a" stroke="#8a6a3e" stroke-width="3"/><rect class="wl" x="54" y="80" width="30" height="72" fill="#e2c28a" stroke="#8a6a3e" stroke-width="3"/>'
    + '<rect class="wl" x="84" y="66" width="34" height="86" fill="#d8b47a" stroke="#8a6a3e" stroke-width="3"/><rect class="wl" x="118" y="84" width="30" height="68" fill="#e2c28a" stroke="#8a6a3e" stroke-width="3"/>'
    + '<rect class="wl" x="148" y="98" width="32" height="54" fill="#d8b47a" stroke="#8a6a3e" stroke-width="3"/>'
    + '<ellipse class="dust" cx="60" cy="140" rx="40" ry="18"/><ellipse class="dust" cx="140" cy="140" rx="44" ry="20"/><ellipse class="dust" cx="100" cy="130" rx="50" ry="24"/></svg>';
  var CORR = '<div class="lp" style="--d:0s"><i></i><i></i></div><div class="lp" style="--d:.8s"><i></i><i></i></div><div class="lp" style="--d:1.6s"><i></i><i></i></div>';
  var CORR_OLD = '<svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">'
    + '<path d="M0 0 L120 70 L120 250 L0 300 Z" fill="rgba(0,0,0,.28)"/><path d="M400 0 L280 70 L280 250 L400 300 Z" fill="rgba(0,0,0,.28)"/>'
    + '<path d="M40 40 L40 280 M80 62 L80 262 M360 40 L360 280 M320 62 L320 262" stroke="rgba(255,220,170,.06)" stroke-width="3"/>'
    + '<g class="fx-sconce"><circle cx="58" cy="118" r="16" fill="rgba(255,190,110,.18)"/><rect x="55" y="112" width="6" height="12" fill="#ffd08a"/></g>'
    + '<g class="fx-sconce" style="animation-delay:1.1s"><circle cx="342" cy="118" r="16" fill="rgba(255,190,110,.18)"/><rect x="339" y="112" width="6" height="12" fill="#ffd08a"/></g>'
    + '<g class="fx-sconce" style="animation-delay:.6s"><circle cx="102" cy="132" r="10" fill="rgba(255,190,110,.16)"/><rect x="100" y="128" width="4" height="8" fill="#ffd08a"/></g>'
    + '<g class="fx-sconce" style="animation-delay:1.7s"><circle cx="298" cy="132" r="10" fill="rgba(255,190,110,.16)"/><rect x="296" y="128" width="4" height="8" fill="#ffd08a"/></g></svg>';

  /* dress each story scene as it appears */
  if(typeof window.playStory === 'function'){
    var origStory = window.playStory;
    window.playStory = function(kind, o, done){
      var before = document.querySelectorAll('.story').length;
      var r = origStory.apply(this, arguments);
      try{
        var all = document.querySelectorAll('.story'); if(all.length <= before) return r;
        var el = all[all.length - 1], scene = el.querySelector('.s-scene');
        if(kind === 'arrive'){ var sky = document.createElement('div'); sky.className = 's-sky'; if(ED !== 'bible') sky.innerHTML = skySVG(); el.insertBefore(sky, el.firstChild); }
        if(kind === 'walk' && ED !== 'bible' && scene){ var c = document.createElement('div'); c.className = 's-corr'; c.innerHTML = CORR; scene.insertBefore(c, scene.firstChild); }
        if(kind === 'end' && scene){ var b = document.createElement('div'); b.className = 's-bot'; b.innerHTML = ED === 'bible' ? WALLS : BOT; scene.appendChild(b); }
      }catch(e){}
      return r;
    };
  }

  /* ---------- the journey: a map of the house in the hallway ---------- */
  var seen = {};
  function state(){ var S = window.H || window.G; return S && S.done ? S : null; }
  function glyphFor(k){ try{ return (window.ROOMS && ROOMS[k] && ROOMS[k].glyph) || ''; }catch(e){ return ''; } }
  function mapSVG(S){
    var order = window.ORDER || ['switchboard', 'glasshouse', 'orrery', 'strongroom', 'darkroom'], items = (S.items || []).length, here = S.prev && S.prev.room;
    var slots = ED === 'bible'
      ? [{ x:40, y:92 }, { x:104, y:70 }, { x:168, y:92 }, { x:232, y:70 }, { x:296, y:92 }]
      : [{ x:84, y:122 }, { x:150, y:122 }, { x:216, y:122 }, { x:117, y:82 }, { x:183, y:82 }];
    var s = '<svg viewBox="0 0 360 160" role="img" aria-label="Map: ' + order.filter(function(k){ return S.done[k]; }).length + ' of 5 explored">';
    if(ED === 'bible'){
      s += '<path d="M20 120 C40 70 80 120 104 80 S150 130 168 104 S210 60 232 84 S280 130 296 104 S330 70 344 62" fill="none" stroke="#c9a46a" stroke-width="10" stroke-linecap="round" opacity=".55"/>'
        + '<path d="M20 120 C40 70 80 120 104 80 S150 130 168 104 S210 60 232 84 S280 130 296 104 S330 70 344 62" fill="none" stroke="#8a6a3e" stroke-width="1.5" stroke-dasharray="4 6"/>';
      var shake = items ? ' style="filter:drop-shadow(0 0 ' + (2 + items * 2) + 'px #ffae3d)"' : '';
      s += '<g' + shake + '><rect x="318" y="18" width="12" height="36" fill="#d8b47a" stroke="#8a6a3e"/><rect x="330" y="10" width="14" height="44" fill="#e2c28a" stroke="#8a6a3e"/><rect x="344" y="22" width="12" height="32" fill="#d8b47a" stroke="#8a6a3e"/></g>'
        + '<text class="lbl" x="337" y="68" text-anchor="middle">Jericho</text>';
    } else {
      s += '<path d="M40 150 V64 L150 14 L260 64 V150 Z" fill="rgba(42,29,20,.08)" stroke="#7d5a22" stroke-width="2"/>'
        + '<path d="M60 102 H240 M60 62 H240" stroke="#7d5a22" stroke-width="1.2" opacity=".5"/>'
        + '<rect class="rm' + (items === 5 ? ' won' : '') + '" x="128" y="32" width="44" height="26" rx="4"/>'
        + '<circle cx="150" cy="45" r="' + (4 + items) + '" fill="#9fe8ff" opacity="' + (.15 + items * .15).toFixed(2) + '" style="filter:drop-shadow(0 0 ' + (items * 2) + 'px #9fe8ff)"/>'
        + '<path d="M138 150 V136 Q150 128 162 136 V150" fill="#2a1d14" stroke="#7d5a22" stroke-width="1.5"/>';
    }
    order.forEach(function(k, i){ var p = slots[i], st = S.done[k] || '', just = st && seen[k] !== st;
      var w = ED === 'bible' ? 40 : 54, h = ED === 'bible' ? 40 : 32;
      s += '<g class="' + (just ? 'just' : '') + '"><rect class="rm ' + st + '" x="' + (p.x - w / 2) + '" y="' + (p.y - h / 2) + '" width="' + w + '" height="' + h + '" rx="' + (ED === 'bible' ? 20 : 4) + '"/>'
        + '<g class="gl ' + (st === 'won' ? 'won-g' : (st === 'lost' ? 'lost-g' : '')) + '" transform="translate(' + (p.x - 12) + ' ' + (p.y - 12) + ') scale(.43)">' + glyphFor(k).replace('<svg', '<svg width="56" height="56"') + '</g></g>';
      seen[k] = st; });
    var at = here ? slots[(window.ORDER || []).indexOf(here)] : (ED === 'bible' ? { x:20, y:120 } : { x:150, y:146 });
    if(at) s += '<g transform="translate(' + at.x + ' ' + (at.y + (ED === 'bible' ? -26 : -22)) + ')"><g class="you"><circle r="7" fill="#ffae3d" opacity=".35"/><circle r="3.6" fill="#ffd27a"/></g></g>';
    return s + '</svg>';
  }
  function dressHall(){
    try{ var S = state(), hall = $('hall'); if(!S || !hall) return;
      var map = hall.querySelector('.fc-map'); if(!map){ map = document.createElement('div'); map.className = 'fc-map'; if($('finale')) map.style.maxWidth = '560px'; var pack = $('pack'); hall.insertBefore(map, pack); }
      map.innerHTML = mapSVG(S); }catch(e){}
  }
  if(typeof window.paintHall === 'function'){
    var origHall = window.paintHall;
    window.paintHall = function(){ var r = origHall.apply(this, arguments); dressHall(); if(r && typeof r.then === 'function') r.then(dressHall, function(){}); return r; };
  }
  var resetSeen = function(){ seen = {}; }; ['enterBtn', 'againBtn', 'startBtn'].forEach(function(id){ var b = $(id); if(b) b.addEventListener('click', resetSeen, true); });

  /* ---------- the finale: dress the machine whenever its screen opens ---------- */
  function el(tag, a){ var e = document.createElementNS(NS, tag); for(var k in a) e.setAttribute(k, a[k]); return e; }
  function dressMachine(){
    var m = $('machine'); if(!m) return; m.classList.remove('asleep');
    if(m.querySelector('.fx-aura')) return;
    var defs = el('defs', {}), g = el('radialGradient', { id:'fxAuraG' });
    g.appendChild(el('stop', { offset:'0', 'stop-color':ED === 'bible' ? '#ffd27a' : '#bff4ff', 'stop-opacity':'.75' })); g.appendChild(el('stop', { offset:'1', 'stop-color':ED === 'bible' ? '#ffae3d' : '#9fe8ff', 'stop-opacity':'0' }));
    defs.appendChild(g); m.insertBefore(defs, m.firstChild);
    m.insertBefore(el('ellipse', { class:'fx-aura', cx:150, cy:ED === 'bible' ? 128 : 112, rx:150, ry:125, fill:'url(#fxAuraG)' }), defs.nextSibling);
    if(ED === 'bible'){ [[110, 140, 46, 20], [190, 140, 50, 22], [150, 126, 62, 28]].forEach(function(d){ m.appendChild(el('ellipse', { class:'fx-dust', cx:d[0], cy:d[1], rx:d[2], ry:d[3] })); }); return; }
    [[146, 16, 5], [154, 14, 4], [150, 18, 6]].forEach(function(d){ m.appendChild(el('circle', { class:'fx-puff', cx:d[0], cy:d[1], r:d[2] })); });
    ['M84 98 l-8 -6 6 -2 -9 -8', 'M216 98 l8 -6 -6 -2 9 -8', 'M96 178 l-8 8 5 1 -7 9', 'M204 178 l8 8 -5 1 7 9', 'M122 20 l-8 -6 5 -2 -7 -7', 'M178 20 l8 -6 -5 -2 7 -7']
      .forEach(function(d){ m.appendChild(el('path', { class:'fx-zap', d:d })); });
  }
  ['room-finale', 'finale'].forEach(function(id){ var sec = $(id); if(!sec || !window.MutationObserver) return;
    new MutationObserver(function(){ if(!sec.hidden) setTimeout(dressMachine, 0); }).observe(sec, { attributes:true, attributeFilter:['hidden'] }); });
  var m0 = $('machine'); if(m0 && window.MutationObserver) new MutationObserver(function(){ if(!m0.querySelector('.fx-aura') && ($('room-finale') || $('finale')) && !(($('room-finale') || $('finale')).hidden)) dressMachine(); }).observe(m0, { childList:true });
  ['fEnd', 'fnEnd'].forEach(function(name){ if(typeof window[name] !== 'function') return; var orig = window[name];
    window[name] = function(awake){ var r = orig.apply(this, arguments);
      var sag = function(){ try{ var m = $('machine'), S = window.G; if(!m || m.classList.contains('awake')) return; if(S && S.phase && !(S.phase === 'over' && S.awake === false)) return; m.classList.add('asleep'); }catch(e){} };
      if(awake === false){ if(r && typeof r.then === 'function') r.then(sag, function(){}); else sag(); }
      return r; }; });
})();
