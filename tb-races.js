/* TierBrain live races: Tug of War and Finish Line.
   Tug of War becomes a village-fete tug over a mud pit: real pullers lean on a real rope, a referee
   starts it, the odd puller slips, trips or sneezes, and the losers end up in the mud.
   Finish Line becomes a circuit: starting lights, a grandstand, kerbs and a chequered line, cars that
   kick up dust, smoke, spin on oil or pull into the pits, and a podium at the end.

   Load before the game: <script src="tb-races.js?v=1" data-race="tug"></script>  (tug or race)
   The game calls TBRace.* at the moments that matter; everything here is drawing and sound. */
(function(){
  'use strict';
  var S0 = document.currentScript || document.querySelector('script[src*="tb-races.js"]');
  var KIND = (S0 && S0.getAttribute('data-race')) || 'tug';
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function $(id){ return document.getElementById(id); }
  function rnd(n){ var x = Math.sin(n*127.1 + 311.7)*43758.5453; return x - Math.floor(x); }
  function clamp(x, a, b){ return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t){ return a + (b - a)*t; }
  function ease(t){ t = clamp(t, 0, 1); return t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2; }
  function hexA(h, a){ h = h.replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
  function shade(h, k){ h = h.replace('#', ''); var c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    c = c.map(function(v){ return Math.round(k < 0 ? v*(1 + k) : v + (255 - v)*k); }); return 'rgb(' + c.join(',') + ')'; }
  function rr(X, x, y, w, h, r){ X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }
  function hash(s){ var x = 7; s = String(s); for(var i = 0; i < s.length; i++) x = (x*31 + s.charCodeAt(i)) % 100003; return x; }
  function clock(){ return (window.performance && performance.now ? performance.now() : Date.now())/1000; }
  function zoom(){ var app = $('app'); return app ? (parseFloat(app.style.zoom) || 1) : 1; }
  function fit(cv){ var w = cv.clientWidth || 320, h = cv.clientHeight || 150, d = Math.min(3.5, (window.devicePixelRatio || 1)*zoom());
    var W = Math.round(w*d), H = Math.round(h*d); if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
    var X = cv.getContext('2d'); X.setTransform(d, 0, 0, d, 0, 0); return { X:X, w:w, h:h }; }
  function canvas(id, cls){ var cv = $(id); if(!cv){ cv = document.createElement('canvas'); cv.id = id; cv.className = cls || ''; cv.setAttribute('aria-hidden', 'true'); } return cv; }
  function shown(el){ return !!(el && el.offsetParent && el.clientWidth); }
  var FONT = "'Baloo 2', 'Nunito', system-ui, sans-serif";
  function banner(X, text, x, y, size, fill, k){
    X.save(); X.translate(x, y); var sc = k == null ? 1 : k; X.scale(sc, sc); X.font = '800 ' + size + 'px ' + FONT; X.textAlign = 'center'; X.textBaseline = 'middle';
    X.lineJoin = 'round'; X.lineWidth = size*.22; X.strokeStyle = 'rgba(20,16,30,.85)'; X.strokeText(text, 0, 0); X.fillStyle = fill; X.fillText(text, 0, 0); X.restore(); }

  /* ---------- sound: a few short effects, through the site's shared sound switch ---------- */
  var ac = null;
  function tone(f, d, type, g, slide){ try{ if(!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); var o = ac.createOscillator(), v = ac.createGain(), n = ac.currentTime;
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, n); if(slide) o.frequency.exponentialRampToValueAtTime(slide, n + d); o.connect(v); v.connect(ac.destination);
    v.gain.setValueAtTime(g || .1, n); v.gain.exponentialRampToValueAtTime(.0001, n + d); o.start(n); o.stop(n + d + .02); }catch(e){} }
  function noise(d, g, hi){ try{ if(!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); var n = ac.currentTime, len = Math.floor(ac.sampleRate*d), b = ac.createBuffer(1, len, ac.sampleRate), a = b.getChannelData(0);
    for(var i = 0; i < len; i++) a[i] = (Math.random()*2 - 1)*(1 - i/len); var s = ac.createBufferSource(); s.buffer = b; var f = ac.createBiquadFilter(); f.type = hi ? 'highpass' : 'lowpass'; f.frequency.value = hi || 900;
    var v = ac.createGain(); v.gain.value = g || .12; s.connect(f); f.connect(v); v.connect(ac.destination); s.start(n); }catch(e){} }
  var SFX = {
    splat: function(){ noise(.35, .16); tone(140, .25, 'sine', .12, 60); },
    whistle: function(){ tone(2300, .32, 'square', .05, 2500); setTimeout(function(){ tone(2300, .2, 'square', .05); }, 360); },
    sneeze: function(){ tone(520, .12, 'triangle', .08, 900); setTimeout(function(){ noise(.22, .14, 1800); }, 140); },
    pssst: function(){ noise(.7, .1, 2600); },
    skid: function(){ tone(900, .5, 'sawtooth', .04, 500); noise(.4, .06, 1200); },
    bang: function(){ noise(.25, .2); tone(90, .3, 'square', .07, 50); },
    rev: function(){ tone(90, .5, 'sawtooth', .05, 220); },
    swoosh: function(){ noise(.3, .08, 3000); },
    cheer: function(){ noise(1.1, .07, 700); [523, 659, 784].forEach(function(f, i){ setTimeout(function(){ tone(f, .2, 'triangle', .07); }, i*110); }); }
  };

  /* ---------- the commentary line under the scoreboard ---------- */
  var tickT = 0;
  function say(text, tone2){
    var el = $('tbrTicker'); if(!el) return; clearTimeout(tickT);
    el.className = 'tbr-ticker on ' + (tone2 || ''); el.innerHTML = '<b></b>'; el.firstChild.textContent = text;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    tickT = setTimeout(function(){ el.className = 'tbr-ticker'; }, 3600);
  }

  /* ---------- big screens: scale the whole game up so it reads from the sofa ---------- */
  function tv(){
    var app = $('app'); if(!app) return;
    function go(){ var z = 1; if(innerWidth >= 900 && innerHeight >= 640) z = clamp(Math.min(innerHeight/860, innerWidth/700), 1, 1.6);
      if(z > 1.04){ app.style.zoom = z; app.style.height = (innerHeight/z) + 'px'; app.style.maxHeight = 'none'; } else { app.style.zoom = ''; app.style.height = ''; app.style.maxHeight = ''; } }
    window.addEventListener('resize', go); go();
  }

  /* ============================================================ */
  /* =====================  TUG OF WAR  ========================== */
  /* ============================================================ */
  var SKIN = ['#f1c7a5', '#d7a17c', '#a8714d', '#7a4b2e', '#f6d3b8', '#c58c62'];
  var HAIR = ['#2b1d14', '#6b3d1f', '#d8b45a', '#141414', '#9a4a22', '#4a3526'];
  var TEAM = { 1:'#3b82f6', 2:'#e63946' };
  var SLIPS = [
    { say:' slipped in the mud!', me:'You slipped in the mud!', sfx:'splat' },
    { say:' tripped over a shoelace!', me:'You tripped over your shoelace!', sfx:'splat' },
    { say:' lost their grip!', me:'You lost your grip!', sfx:'swoosh' },
    { say:' sneezed mid-heave!', me:'Achoo! You sneezed mid-heave!', sfx:'sneeze' }
  ];
  var T = { mode:'menu', f:0, fShow:0, teams:{1:[], 2:[]}, me:'', mySide:0, heave:{1:-9, 2:-9}, ev:{}, plus:[], win:null, endAt:0, goAt:-9, count:3, parts:[], lastF:0, warn:0 };
  var tugCv = null, tugLoop = false;

  function person(X, o){
    var s = o.s, d = o.dir, lean = o.lean || 0, t = o.t || 0;
    X.save(); X.translate(o.x, o.y - (o.jump || 0)); if(o.rot) X.rotate(o.rot);
    var sit = o.sit || 0;
    var hip = { x:-d*s*.05*(1 + lean) - d*sit*s*.1, y:-s*.42 + sit*s*.3 };
    var sh = { x:hip.x - d*Math.sin(lean)*s*.34, y:hip.y - Math.cos(lean)*s*.34 };
    var hd = { x:sh.x - d*Math.sin(lean)*s*.13, y:sh.y - Math.cos(lean)*s*.13 - s*.025 };
    X.lineCap = 'round'; X.lineJoin = 'round';
    /* legs: a lunge, or stretched out when sitting */
    var trou = o.trou || '#2d3142', shoe = '#1a1a22';
    X.strokeStyle = trou; X.lineWidth = s*.12;
    var legs = sit > .5 ? [[{ x:hip.x + d*s*.2, y:hip.y + s*.02 }, { x:hip.x + d*s*.38, y:-s*.02 }], [{ x:hip.x + d*s*.16, y:hip.y - s*.06 }, { x:hip.x + d*s*.34, y:-s*.07 }]]
      : o.pose === 'cheer' ? [[{ x:d*s*.06, y:-s*.2 }, { x:d*s*.1, y:0 }], [{ x:-d*s*.04, y:-s*.2 }, { x:-d*s*.08, y:0 }]]
      : [[{ x:d*s*.13, y:-s*.22 }, { x:d*s*.22, y:0 }], [{ x:-d*s*.05, y:-s*.21 }, { x:-d*s*.16, y:0 }]];
    legs.forEach(function(L){ X.beginPath(); X.moveTo(hip.x, hip.y); X.lineTo(L[0].x, L[0].y); X.lineTo(L[1].x, L[1].y); X.stroke();
      X.fillStyle = shoe; X.beginPath(); X.ellipse(L[1].x + d*s*.03, L[1].y - s*.02, s*.07, s*.035, 0, 0, 7); X.fill(); });
    /* body */
    X.strokeStyle = o.col; X.lineWidth = s*.21; X.beginPath(); X.moveTo(hip.x, hip.y - s*.02); X.lineTo(sh.x, sh.y + s*.03); X.stroke();
    X.strokeStyle = shade(o.col, -.25); X.lineWidth = s*.05; X.beginPath(); X.moveTo(hip.x - s*.07, hip.y + s*.01); X.lineTo(hip.x + s*.07, hip.y + s*.01); X.stroke();
    /* the back arm (behind the head) and the front arm */
    var hands = [];
    if(o.arms === 'rope' && o.hand){ var hx = o.hand.x - o.x, hy = o.hand.y - o.y + (o.jump || 0); hands = [{ x:hx - d*s*.05, y:hy }, { x:hx + d*s*.03, y:hy }]; }
    else if(o.arms === 'up'){ var w1 = Math.sin(t*14)*.25; hands = [{ x:sh.x - d*s*.12 + w1*s*.2, y:sh.y - s*.3 }, { x:sh.x + d*s*.16 - w1*s*.2, y:sh.y - s*.32 }]; }
    else if(o.arms === 'flail'){ var w2 = Math.sin(t*22); hands = [{ x:sh.x - d*s*.25, y:sh.y - s*.18 + w2*s*.08 }, { x:sh.x + d*s*.22, y:sh.y - s*.24 - w2*s*.08 }]; }
    else hands = [{ x:sh.x + d*s*.12, y:sh.y + s*.22 }, { x:sh.x + d*s*.2, y:sh.y + s*.2 }];
    hands.forEach(function(H, i){ var e = { x:(sh.x + H.x)/2 + (o.arms === 'rope' ? 0 : -d*s*.03), y:(sh.y + H.y)/2 + s*.05 };
      X.strokeStyle = i ? o.col : shade(o.col, -.15); X.lineWidth = s*.08; X.beginPath(); X.moveTo(sh.x, sh.y + s*.02); X.lineTo(e.x, e.y); X.stroke();
      X.strokeStyle = o.skin; X.lineWidth = s*.065; X.beginPath(); X.moveTo(e.x, e.y); X.lineTo(H.x, H.y); X.stroke();
      X.fillStyle = o.skin; X.beginPath(); X.arc(H.x, H.y, s*.045, 0, 7); X.fill(); });
    /* head */
    var r = s*.105; X.fillStyle = o.skin; X.beginPath(); X.arc(hd.x, hd.y, r, 0, 7); X.fill();
    X.fillStyle = o.hair; X.beginPath(); X.arc(hd.x - d*r*.15, hd.y - r*.2, r*.98, Math.PI*1.02, Math.PI*2.02); X.fill();
    if(o.band){ X.strokeStyle = o.band; X.lineWidth = r*.35; X.beginPath(); X.arc(hd.x, hd.y, r*.93, Math.PI*1.12, Math.PI*1.9); X.stroke(); }
    var ex = hd.x + d*r*.45, ey = hd.y - r*.1; X.fillStyle = '#1b1420';
    if(o.face === 'shock'){ X.beginPath(); X.arc(ex, ey, r*.17, 0, 7); X.fill(); X.beginPath(); X.ellipse(hd.x + d*r*.55, hd.y + r*.45, r*.14, r*.2, 0, 0, 7); X.fill(); }
    else if(o.face === 'happy'){ X.lineWidth = r*.16; X.strokeStyle = '#1b1420'; X.beginPath(); X.arc(ex, ey + r*.08, r*.14, Math.PI*1.1, Math.PI*1.9); X.stroke(); X.beginPath(); X.arc(hd.x + d*r*.45, hd.y + r*.3, r*.25, .2, Math.PI - .2); X.stroke(); }
    else { X.beginPath(); X.arc(ex, ey, r*.13, 0, 7); X.fill(); X.strokeStyle = '#1b1420'; X.lineWidth = r*.14; X.beginPath(); X.moveTo(hd.x + d*r*.25, hd.y + r*.45); X.lineTo(hd.x + d*r*.75, hd.y + r*.4); X.stroke();
      X.strokeStyle = '#fff'; X.lineWidth = r*.08; X.beginPath(); X.moveTo(hd.x + d*r*.32, hd.y + r*.43); X.lineTo(hd.x + d*r*.68, hd.y + r*.39); X.stroke(); }
    if(o.sweat){ X.fillStyle = '#9fd8ff'; X.beginPath(); X.ellipse(hd.x - d*r*.9, hd.y - r*.3 + (t*30 % 6), r*.18, r*.28, 0, 0, 7); X.fill(); }
    /* mud splatter */
    if(o.mud){ X.globalAlpha = clamp(o.mud, 0, 1); X.fillStyle = '#5b3b1e';
      for(var k = 0; k < 9; k++){ var px = lerp(hip.x, sh.x, rnd(k + o.seed)) + (rnd(k*3 + o.seed) - .5)*s*.22, py = lerp(hip.y, hd.y, rnd(k*7 + o.seed)) + (rnd(k*5 + o.seed) - .5)*s*.1;
        X.beginPath(); X.arc(px, py, s*(.03 + rnd(k*11 + o.seed)*.04), 0, 7); X.fill(); }
      X.beginPath(); X.ellipse(0, -s*.05, s*.26, s*.08, 0, 0, 7); X.fill(); X.globalAlpha = 1; }
    X.restore();
    return { head:{ x:o.x + hd.x, y:o.y + hd.y - (o.jump || 0) } };
  }

  function referee(X, x, y, s, t, drop, alpha){
    if(alpha <= 0) return; X.save(); X.globalAlpha = alpha;
    var o = { x:x, y:y, s:s, dir:1, col:'#f2f2f2', skin:SKIN[0], hair:'#ddd', t:t, lean:0, arms:'none', face:drop > 0 ? 'happy' : 'grit', seed:3, trou:'#111' };
    X.save(); X.translate(x, y); X.lineCap = 'round';
    X.strokeStyle = '#111'; X.lineWidth = s*.12; [[.06, .1], [-.06, -.1]].forEach(function(L){ X.beginPath(); X.moveTo(0, -s*.42); X.lineTo(L[0]*s, -s*.2); X.lineTo(L[1]*s*.4, 0); X.stroke(); });
    /* striped shirt */
    X.strokeStyle = '#f5f5f5'; X.lineWidth = s*.22; X.beginPath(); X.moveTo(0, -s*.44); X.lineTo(0, -s*.74); X.stroke();
    X.strokeStyle = '#111'; X.lineWidth = s*.035; for(var i = 0; i < 4; i++){ var yy = -s*(.48 + i*.075); X.beginPath(); X.moveTo(-s*.1, yy); X.lineTo(s*.1, yy); X.stroke(); }
    /* the flag arm: up, then swept down to start */
    var a = lerp(-2.6, -.4, ease(drop*2.2)); var hx = Math.cos(a)*s*.32, hy = -s*.72 + Math.sin(a)*s*.32;
    X.strokeStyle = SKIN[0]; X.lineWidth = s*.07; X.beginPath(); X.moveTo(0, -s*.72); X.lineTo(hx, hy); X.stroke();
    X.strokeStyle = '#6b4a2b'; X.lineWidth = s*.03; X.beginPath(); X.moveTo(hx, hy); X.lineTo(hx + Math.cos(a)*s*.25, hy + Math.sin(a)*s*.25); X.stroke();
    var fx = hx + Math.cos(a)*s*.25, fy = hy + Math.sin(a)*s*.25, wv = Math.sin(t*9)*s*.03;
    X.fillStyle = '#fff'; X.strokeStyle = '#ccc'; X.lineWidth = 1; X.beginPath(); X.moveTo(fx, fy); X.lineTo(fx + s*.2, fy + wv); X.lineTo(fx + s*.02, fy + s*.12); X.closePath(); X.fill(); X.stroke();
    X.strokeStyle = SKIN[0]; X.lineWidth = s*.07; X.beginPath(); X.moveTo(0, -s*.72); X.lineTo(-s*.14, -s*.5); X.stroke();
    X.fillStyle = SKIN[0]; X.beginPath(); X.arc(0, -s*.86, s*.1, 0, 7); X.fill();
    X.fillStyle = '#111'; X.beginPath(); X.arc(0, -s*.9, s*.1, Math.PI, 0); X.fill(); X.fillRect(-s*.13, -s*.9, s*.26, s*.025);
    X.fillStyle = '#1b1420'; X.beginPath(); X.arc(s*.04, -s*.86, s*.015, 0, 7); X.fill();
    if(drop < .01){ X.fillStyle = '#c0c4cc'; X.beginPath(); X.arc(s*.1, -s*.8, s*.025, 0, 7); X.fill(); }
    X.restore(); X.restore();
  }

  function tugBackdrop(X, w, h, t, cheer){
    var hz = h*.47;
    var g = X.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, '#f6a96b'); g.addColorStop(.6, '#ffd59a'); g.addColorStop(1, '#ffe9c4'); X.fillStyle = g; X.fillRect(0, 0, w, hz + 2);
    var sg = X.createRadialGradient(w*.82, hz*.55, 0, w*.82, hz*.55, h*.45); sg.addColorStop(0, 'rgba(255,248,214,.95)'); sg.addColorStop(.25, 'rgba(255,236,170,.55)'); sg.addColorStop(1, 'rgba(255,220,150,0)');
    X.fillStyle = sg; X.fillRect(0, 0, w, hz); X.fillStyle = '#fff6d8'; X.beginPath(); X.arc(w*.82, hz*.55, h*.07, 0, 7); X.fill();
    /* hills */
    [['#a7c56a', .0, .1], ['#86b052', 1.7, .05]].forEach(function(L, j){ X.fillStyle = L[0]; X.beginPath(); X.moveTo(0, hz);
      for(var x = 0; x <= w; x += 8) X.lineTo(x, hz - h*(.08 + L[2]) - Math.sin(x/w*5 + L[1])*h*.05 - Math.sin(x/w*11 + L[1]*3)*h*.02); X.lineTo(w, hz); X.closePath(); X.fill(); });
    /* the crowd behind the fence */
    var n = Math.floor(w/11);
    for(var i = 0; i < n; i++){ var hx = i*11 + 5 + rnd(i)*3, bob = Math.abs(Math.sin(t*(cheer ? 9 : 2.2) + i*1.7))*(cheer ? h*.03 : h*.008), hy = hz - h*.035 - bob;
      X.fillStyle = ['#e76f51', '#2a9d8f', '#f4a261', '#264653', '#e9c46a', '#8e7dbe', '#d1495b', '#3d5a80'][i % 8]; X.beginPath(); X.ellipse(hx, hy + h*.04, h*.032, h*.03, 0, Math.PI, 0); X.fill();
      X.fillStyle = SKIN[i % 6]; X.beginPath(); X.arc(hx, hy, h*.022, 0, 7); X.fill();
      if(cheer && i % 3 === 0){ X.strokeStyle = SKIN[i % 6]; X.lineWidth = 2; X.beginPath(); X.moveTo(hx - h*.02, hy + h*.02); X.lineTo(hx - h*.035, hy - h*.03); X.stroke(); } }
    X.fillStyle = '#fbf7ee'; X.fillRect(0, hz - h*.01, w, h*.012); X.fillRect(0, hz + h*.02, w, h*.012);
    for(var p = 6; p < w; p += 22) X.fillRect(p, hz - h*.02, 3, h*.05);
    /* grass, with mowing stripes */
    var gg = X.createLinearGradient(0, hz, 0, h); gg.addColorStop(0, '#7cc35b'); gg.addColorStop(1, '#4f9a3c'); X.fillStyle = gg; X.fillRect(0, hz + h*.03, w, h);
    X.fillStyle = 'rgba(255,255,255,.06)'; for(var k = 0; k < 9; k++){ if(k % 2) continue; X.beginPath(); X.moveTo(w*(k/9) - w*.05, h); X.lineTo(w*((k + 1)/9) + w*.05, h); X.lineTo(w*((k + 1)/9)*.7 + w*.15, hz + h*.03); X.lineTo(w*(k/9)*.7 + w*.15, hz + h*.03); X.closePath(); X.fill(); }
    /* bunting */
    X.strokeStyle = 'rgba(80,60,40,.6)'; X.lineWidth = 1; X.beginPath(); X.moveTo(0, h*.05); X.quadraticCurveTo(w/2, h*.17, w, h*.05); X.stroke();
    for(var b = 0; b < w/16; b++){ var bx = b*16 + 8, u = bx/w, by = h*.05 + 4*u*(1 - u)*h*.12*.97, sw = Math.sin(t*2 + b)*1.5;
      X.fillStyle = ['#3b82f6', '#f6c945', '#e63946', '#ffffff'][b % 4]; X.beginPath(); X.moveTo(bx - 5, by); X.lineTo(bx + 5, by); X.lineTo(bx + sw, by + 10); X.closePath(); X.fill(); }
  }

  function tugTeam(side){
    var list = T.teams[side] || []; if(list.length) return list;
    return [{ name:'', me:false }];
  }
  /* where everything stands */
  function tugLayout(w, h){
    var s = Math.min(h*.36, w*.19), feet = h*.88, ropeY = feet - s*.5, cx = w/2, D = w*.17, G = w*.2;
    return { s:s, feet:feet, ropeY:ropeY, cx:cx, D:D, G:G };
  }

  function drawTug(cv, t){
    var F = fit(cv), X = F.X, w = F.w, h = F.h, L = tugLayout(w, h), s = L.s;
    var mode = T.mode, ended = mode === 'end' || mode === 'over', pe = ended ? (mode === 'over' ? 9 : t - T.endAt) : 0;
    var win = T.win;
    /* the rope's place: eased towards the score, sliding the losers into the mud at the end */
    var target = mode === 'menu' ? Math.sin(t*.55)*.55 + Math.sin(t*1.7)*.12 : T.f;
    if(ended && win) target = (win === 2 ? 1 : -1)*(1 + .32*ease(pe/1.1));
    T.fShow = RM ? target : lerp(T.fShow, target, mode === 'menu' ? 1 : .12);
    var off = T.fShow*L.D;
    var cheer = ended && pe > .9;
    tugBackdrop(X, w, h, t, cheer || (mode === 'menu' && false));
    /* the mud pit */
    var mx = L.cx, my = L.feet + s*.02, mrx = w*.085, mry = s*.13;
    var mg = X.createRadialGradient(mx, my, 0, mx, my, mrx); mg.addColorStop(0, '#5a3a1d'); mg.addColorStop(.75, '#6e4a26'); mg.addColorStop(1, '#8a6a3a');
    X.fillStyle = '#8a6a3a'; X.beginPath(); X.ellipse(mx, my, mrx*1.12, mry*1.25, 0, 0, 7); X.fill();
    X.fillStyle = mg; X.beginPath(); X.ellipse(mx, my, mrx, mry, 0, 0, 7); X.fill();
    X.fillStyle = 'rgba(255,255,255,.18)'; X.beginPath(); X.ellipse(mx - mrx*.35, my - mry*.35, mrx*.25, mry*.18, 0, 0, 7); X.fill();
    for(var bq = 0; bq < 3; bq++){ var ph = (t*.7 + bq*.37) % 1; X.strokeStyle = 'rgba(40,24,10,' + (.6*(1 - ph)) + ')'; X.lineWidth = 1;
      X.beginPath(); X.arc(mx + (rnd(bq + Math.floor(t*.7 + bq*.37)) - .5)*mrx*1.2, my + (rnd(bq*5)*.6 - .3)*mry, 1.5 + ph*3, 0, 7); X.stroke(); }
    /* chalk lines, with each team's cone: drag the ribbon over your own line */
    [[-1, 1], [1, 2]].forEach(function(c){ var lx = L.cx + c[0]*L.D;
      X.strokeStyle = 'rgba(255,255,255,.85)'; X.lineWidth = 3; X.beginPath(); X.moveTo(lx + c[0]*s*.03, L.feet - s*.24); X.lineTo(lx - c[0]*s*.02, L.feet + s*.1); X.stroke();
      X.fillStyle = TEAM[c[1]]; X.beginPath(); X.moveTo(lx + c[0]*s*.03 - s*.05, L.feet - s*.24); X.lineTo(lx + c[0]*s*.03 + s*.05, L.feet - s*.24); X.lineTo(lx + c[0]*s*.03, L.feet - s*.38); X.closePath(); X.fill();
      X.fillStyle = '#fff'; X.fillRect(lx + c[0]*s*.03 - s*.03, L.feet - s*.31, s*.06, s*.025); });
    /* the referee starts it and steps away */
    if(mode === 'count'){ var drop = T.goAt > 0 ? (t - T.goAt) : 0; referee(X, L.cx, L.feet - s*.18, s*.95, t, drop, 1 - clamp((drop - .45)*2, 0, 1)); }
    /* pullers */
    var hands = [], heads = [], ends = { 1:L.cx, 2:L.cx };
    [1, 2].forEach(function(side){
      var list = mode === 'menu' ? [0, 1, 2].map(function(i){ return { name:'m' + side + i }; }) : tugTeam(side);
      var dir = side === 1 ? 1 : -1, n = Math.min(list.length, 6), gap = Math.min(w*.07, (w*.5 - L.G)/Math.max(1, n - .4));
      var winning = ended && win === side, losing = ended && win && win !== side, hv = clamp(1 - (t - T.heave[side])/.4, 0, 1);
      var danger = !ended && ((side === 1 && T.fShow > .62) || (side === 2 && T.fShow < -.62));
      for(var i = n - 1; i >= 0; i--){
        var P = list[i], seed = hash(P.name || (side + ':' + i)), x = L.cx + off - dir*(L.G + i*gap);
        var o = { x:x, y:L.feet, s:s*(1 - (seed % 7)*.012), dir:dir, col:TEAM[side], skin:SKIN[seed % 6], hair:HAIR[(seed >> 3) % 6], t:t, seed:seed % 50, band:P.me ? '#f6c945' : null, arms:'rope', face:'grit' };
        var bob = Math.sin(t*3.2 + i*1.3 + side)*.04;
        o.lean = .42 + bob + hv*.16 + (mode === 'menu' ? Math.sin(t*.55)*dir*.1 : 0);
        if(mode === 'count'){ o.lean = [.08, .2, .32, .42][clamp(3 - T.count, 0, 3)] + bob*.5; }
        o.hand = { x:x + dir*o.s*.17, y:L.ropeY };
        if(danger && i === 0){ o.face = 'shock'; o.sweat = true; }
        /* a slip, a trip, a lost grip, a sneeze */
        var ev = P.name && T.ev[P.name];
        if(ev){ var p = (t - ev.at)/2.4;
          if(p >= 1) delete T.ev[P.name];
          else { var down = p < .18 ? ease(p/.18) : p < .68 ? 1 : 1 - ease((p - .68)/.32);
            if(ev.kind === 0){ o.rot = -dir*1.2*down; o.arms = down > .2 ? 'flail' : 'rope'; o.face = 'shock'; o.mud = Math.min(1, p*4)*(1 - Math.max(0, p - .85)*4); }
            else if(ev.kind === 1){ o.rot = dir*1.15*down; o.arms = down > .2 ? 'flail' : 'rope'; o.face = 'shock'; o.mud = Math.min(1, p*3)*.8*(1 - Math.max(0, p - .85)*4); }
            else if(ev.kind === 2){ o.arms = p < .6 ? 'flail' : 'rope'; o.lean = .42 + down*.5; o.x -= dir*o.s*.22*down; o.face = 'shock'; }
            else { var sn = p < .25 ? -ease(p/.25)*.15 : p < .35 ? lerp(-.15, -.7, (p - .25)/.1) : lerp(-.7, .42, ease((p - .35)/.4)); o.lean = sn; o.arms = p < .5 ? 'none' : 'rope'; o.face = p < .3 ? 'shock' : 'grit'; }
            if(!ev.splashed && p > .16 && ev.kind < 2){ ev.splashed = true; splash(x - dir*o.s*.3, L.feet, ev.kind === 0 ? 14 : 10, '#5b3b1e'); }
            if(ev.kind === 3 && p > .25 && p < .8) heads.push({ txt:'ACHOO!', side:side, i:i, o:o });
            heads.push({ tag:P.name, i:i, o:o, side:side, a:Math.min(1, (1 - p)*5) });
          } }
        /* the finish: winners heave, cheer and jump; losers stumble into the mud */
        if(winning){ if(pe > .9){ o.arms = 'up'; o.pose = 'cheer'; o.lean = 0; o.face = 'happy'; o.jump = Math.abs(Math.sin(t*7 + i))*s*.14; } else o.lean = .55 + Math.sin(t*12)*.05; }
        if(losing){ var lp = clamp((pe - .25 - i*.12)/.5, 0, 1); o.face = 'shock';
          if(i < 2){ o.rot = dir*1.3*ease(lp); o.arms = lp > .1 ? 'flail' : 'rope'; o.mud = lp*1.2; if(lp > .5 && !P['splat' + T.endAt]){ P['splat' + T.endAt] = true; splash(L.cx + (i ? -dir*s*.2 : 0), L.feet, 18, '#5b3b1e'); if(i === 0) SFX.splat(); } }
          else { o.sit = ease(lp); o.arms = lp > .3 ? 'none' : 'rope'; o.lean = lerp(.42, .1, lp); } }
        if(ended && !win){ var sp = clamp((pe - .2)/.6, 0, 1); o.sit = ease(sp); o.arms = sp > .3 ? 'none' : 'rope'; o.lean = lerp(.42, .05, sp); o.face = 'grit'; o.sweat = true; }
        X.fillStyle = 'rgba(0,0,0,.18)'; X.beginPath(); X.ellipse(o.x, L.feet + 1, s*.2, s*.035, 0, 0, 7); X.fill();
        var r = person(X, o);
        if(o.arms === 'rope') hands.push(o.hand);
        if(P.me){ heads.push({ you:true, x:r.head.x, y:r.head.y - s*.22 }); }
        if(i === n - 1) ends[side] = x - dir*s*.25;
      }
      if(list.length > 6){ X.fillStyle = 'rgba(20,16,30,.75)'; rr(X, side === 1 ? 4 : w - 34, L.feet - s*1.05, 30, 16, 8); X.fill();
        X.fillStyle = '#fff'; X.font = '800 10px ' + FONT; X.textAlign = 'center'; X.fillText('+' + (list.length - 6), side === 1 ? 19 : w - 19, L.feet - s*1.05 + 11.5); }
    });
    /* the rope, lying slack when it's over */
    var slack = ended && pe > .9 ? clamp((pe - .9)/.4, 0, 1) : 0, hv2 = Math.max(clamp(1 - (t - T.heave[1])/.4, 0, 1), clamp(1 - (t - T.heave[2])/.4, 0, 1));
    var ry = lerp(L.ropeY + Math.sin(t*30)*hv2*1.2, L.feet - 2, slack), x0 = ends[1] - s*.1, x1 = ends[2] + s*.1, mid = L.cx + off;
    X.lineCap = 'round';
    X.strokeStyle = '#7a5428'; X.lineWidth = Math.max(3, s*.075); X.beginPath(); X.moveTo(x0 - s*.2, L.feet - 1); X.quadraticCurveTo(x0, ry, x0 + s*.2, ry);
    X.quadraticCurveTo(mid, ry + s*.04 + slack*2, x1 - s*.2, ry); X.quadraticCurveTo(x1, ry, x1 + s*.2, L.feet - 1); X.stroke();
    X.strokeStyle = '#c99a55'; X.lineWidth = Math.max(1.5, s*.035); X.setLineDash([3, 4]); X.lineDashOffset = -off*1.2; X.stroke(); X.setLineDash([]);
    /* hands grip over the rope */
    hands.forEach(function(H){ X.fillStyle = 'rgba(0,0,0,0)'; });
    /* the ribbon in the middle of the rope */
    var ribY = ry + s*.03, swing = Math.sin(t*3)*.15 + (T.fShow - T.lastF)*20;
    X.save(); X.translate(mid, ribY); X.rotate(clamp(swing, -.6, .6));
    X.fillStyle = '#f6c945'; X.strokeStyle = '#8a6a1a'; X.lineWidth = 1; X.beginPath(); X.moveTo(-s*.05, 0); X.lineTo(s*.05, 0); X.lineTo(s*.07, s*.32); X.lineTo(0, s*.25); X.lineTo(-s*.07, s*.32); X.closePath(); X.fill(); X.stroke();
    X.fillStyle = '#fff3cf'; X.beginPath(); X.arc(0, 0, s*.06, 0, 7); X.fill(); X.restore();
    T.lastF = lerp(T.lastF, T.fShow, .2);
    /* labels: you, and whoever just came a cropper */
    heads.forEach(function(H){
      if(H.you){ X.fillStyle = '#f6c945'; X.beginPath(); X.moveTo(H.x - 5, H.y - 4); X.lineTo(H.x + 5, H.y - 4); X.lineTo(H.x, H.y + 3); X.closePath(); X.fill();
        X.font = '800 9px ' + FONT; X.textAlign = 'center'; X.fillStyle = 'rgba(20,16,30,.8)'; rr(X, H.x - 14, H.y - 16, 28, 12, 6); X.fill(); X.fillStyle = '#f6c945'; X.fillText('YOU', H.x, H.y - 7); }
      else if(H.txt){ var bx = H.o.x + H.o.dir*s*.42, by = L.feet - s*1.02; X.fillStyle = '#fff'; rr(X, bx - 24, by - 9, 48, 17, 8); X.fill(); X.fillStyle = '#c0392b'; X.font = '800 10px ' + FONT; X.textAlign = 'center'; X.fillText(H.txt, bx, by + 3.5); }
      else if(H.tag){ X.globalAlpha = H.a; X.font = '800 10px ' + FONT; var tw = X.measureText(H.tag).width + 12, tx = H.o.x, ty = L.feet - s*1.38 - (H.i % 2)*12;
        X.fillStyle = TEAM[H.side]; rr(X, tx - tw/2, ty - 8, tw, 15, 7); X.fill(); X.fillStyle = '#fff'; X.textAlign = 'center'; X.fillText(H.tag, tx, ty + 3.5); X.globalAlpha = 1; } });
    /* +1s and splashes */
    parts(X, t);
    T.plus = T.plus.filter(function(P){ var a = t - P.at; if(a > 1) return false; X.globalAlpha = 1 - a; X.font = '800 ' + Math.round(s*.24) + 'px ' + FONT; X.textAlign = 'center';
      X.lineWidth = 3; X.strokeStyle = 'rgba(20,16,30,.7)'; X.strokeText(P.txt, P.x, P.y - a*s*.5); X.fillStyle = P.col; X.fillText(P.txt, P.x, P.y - a*s*.5); X.globalAlpha = 1; return true; });
    /* the result, written across the sky */
    if(ended && pe > .35){ var k = mode === 'over' ? 1 : Math.min(1, ease((pe - .35)/.35)*1.1);
      banner(X, win ? (win === 1 ? 'BLUE WIN!' : 'RED WIN!') : 'STALEMATE!', w/2, h*.27, Math.round(Math.min(34, w*.09)), win ? (win === 1 ? '#7fb2ff' : '#ff8a93') : '#f6c945', k);
      if(win && pe > .9) confetti(X, w, h, t, TEAM[win]); }
    if(mode === 'count' && T.count <= 0 && t - T.goAt < .8) banner(X, 'PULL!', w/2, h*.27, Math.round(Math.min(40, w*.11)), '#f6c945', 1 + (t - T.goAt)*.4);
    /* mark the scene edge */
    X.strokeStyle = 'rgba(0,0,0,.25)'; X.lineWidth = 1; X.strokeRect(.5, .5, w - 1, h - 1);
  }

  var P = [];
  function splash(x, y, n, col){ if(RM) return; var t = clock(); for(var i = 0; i < n; i++) P.push({ x:x, y:y - 3, vx:(Math.random() - .5)*70, vy:-40 - Math.random()*70, at:t, col:col, r:1.5 + Math.random()*2.5 }); }
  function parts(X, t){ P = P.filter(function(p){ var a = t - p.at; if(a > 1.1) return false; X.globalAlpha = Math.max(0, 1 - a/1.1); X.fillStyle = p.col;
    X.beginPath(); X.arc(p.x + p.vx*a, p.y + p.vy*a + 120*a*a, p.r, 0, 7); X.fill(); X.globalAlpha = 1; return true; }); }
  function confetti(X, w, h, t, col){ if(RM) return; for(var i = 0; i < 26; i++){ var x = (rnd(i)*w + t*12*(rnd(i + 9) - .5)) % w, y = ((t*(30 + rnd(i*3)*40) + rnd(i*7)*h) % (h*.8));
    X.save(); X.translate(x, y); X.rotate(t*4 + i); X.fillStyle = [col, '#f6c945', '#ffffff', '#2dd4a7'][i % 4]; X.fillRect(-3, -1.5, 6, 3); X.restore(); } }

  function tugMount(where){
    if(!tugCv){ tugCv = canvas('tugArt', 'tbr-scene'); }
    var host = where === 'menu' ? $('menuScreen') : where === 'count' ? $('countScreen') : where === 'tug' ? document.querySelector('#tugScreen .ropeWrap') : $('resultScreen');
    if(!host) return;
    if(tugCv.parentNode !== host){ if(where === 'tug') host.appendChild(tugCv); else host.insertBefore(tugCv, host.firstChild); }
    tugCv.setAttribute('data-at', where);
    if(!tugLoop){ tugLoop = true; (function loop(){ if(shown(tugCv)) drawTug(tugCv, clock()); requestAnimationFrame(loop); })(); }
  }

  /* ============================================================ */
  /* =====================  FINISH LINE  ========================= */
  /* ============================================================ */
  var CAR = { imgs:[], col:[], idx:function(){ return 0; } };
  var MISHAPS = [
    { key:'flat', title:'Flat tyre!', say:' has a flat tyre!', sub:'The pit crew is changing the wheel…', sfx:'pssst' },
    { key:'oil', title:'Oil on the track!', say:' spun out on an oil slick!', sub:'Hold tight while you straighten up…', sfx:'skid' },
    { key:'smoke', title:'Engine trouble!', say:"'s engine is smoking!", sub:'A quick fix under the bonnet…', sfx:'bang' }
  ];
  var R = { mode:'menu', count:3, goAt:-9, lead:'', straight:false, pitAt:-9, pit:null, flagAt:-9, order:[] };
  function carImg(nm){ return CAR.imgs[CAR.idx(String(nm || ''))]; }
  function drawCar(X, img, x, y, hgt, opt){ opt = opt || {}; if(!img || !img.complete || !img.naturalWidth) return; var wid = hgt*img.naturalWidth/img.naturalHeight;
    X.save(); X.translate(x, y); if(opt.rot) X.rotate(opt.rot); X.fillStyle = 'rgba(0,0,0,.35)'; X.beginPath(); X.ellipse(0, hgt*.42, wid*.46, hgt*.12, 0, 0, 7); X.fill();
    X.drawImage(img, -wid/2, -hgt/2 + (opt.bounce || 0), wid, hgt); X.restore(); return wid; }

  function stands(X, w, h, t, top, ht, wave){
    var g = X.createLinearGradient(0, top, 0, top + ht); g.addColorStop(0, '#2b3a55'); g.addColorStop(1, '#1d2738'); X.fillStyle = g; X.fillRect(0, top, w, ht);
    X.fillStyle = '#3a4b6b'; X.fillRect(0, top, w, 3);
    var rows = Math.max(1, Math.floor((ht - 4)/11));
    for(var r2 = 0; r2 < rows; r2++){ X.fillStyle = 'rgba(0,0,0,.25)'; X.fillRect(0, top + 13 + r2*11, w, 2);
      for(var i = 0; i < w/10; i++){ var k = i*7 + r2*3, x = i*10 + (r2 % 2)*5 + 4, up = Math.abs(Math.sin(t*(wave ? 8 : 1.6) + i*.9 + r2*1.7)), y = top + 9 + r2*11 - up*(wave ? 2.5 : .8);
        var shirt = ['#e63946', '#f6c945', '#3b82f6', '#f1f1f1', '#2dd4a7', '#f08a3e', '#8e7dbe'][k % 7];
        X.fillStyle = shirt; X.beginPath(); X.ellipse(x, y + 4.5, 3.6, 2.8, 0, Math.PI, 0); X.fill();
        X.fillStyle = SKIN[k % 6]; X.beginPath(); X.arc(x, y, 2.3, 0, 7); X.fill();
        if(wave && k % 3 === 0){ X.strokeStyle = SKIN[k % 6]; X.lineWidth = 1.2; X.beginPath(); X.moveTo(x + 2.5, y + 3); X.lineTo(x + 4, y - 3 - up*2); X.stroke(); } } }
    for(var f = 0; f < 4; f++){ var fx = w*(.12 + f*.25), fy = top - 2; X.strokeStyle = '#ccd'; X.lineWidth = 1.5; X.beginPath(); X.moveTo(fx, fy); X.lineTo(fx, fy - 16); X.stroke();
      var wv = Math.sin(t*5 + f)*2; X.fillStyle = ['#e63946', '#f6c945', '#3b82f6', '#2dd4a7'][f]; X.beginPath(); X.moveTo(fx, fy - 16); X.quadraticCurveTo(fx + 6, fy - 16 + wv, fx + 12, fy - 14); X.lineTo(fx + 12, fy - 8); X.quadraticCurveTo(fx + 6, fy - 9 + wv, fx, fy - 10); X.closePath(); X.fill(); }
  }
  function sky(X, w, h){ var g = X.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5aa9e6'); g.addColorStop(1, '#bfe3ff'); X.fillStyle = g; X.fillRect(0, 0, w, h);
    X.fillStyle = 'rgba(255,255,255,.75)'; [[.15, .25], [.55, .15], [.85, .3]].forEach(function(c){ X.beginPath(); X.arc(w*c[0], h*c[1], 8, 0, 7); X.arc(w*c[0] + 9, h*c[1] - 3, 10, 0, 7); X.arc(w*c[0] + 19, h*c[1], 7, 0, 7); X.fill(); }); }
  function checker(X, x, y, wd, ht, sq){ for(var i = 0; i*sq < ht; i++) for(var j = 0; j*sq < wd; j++){ X.fillStyle = (i + j) % 2 ? '#111' : '#fff'; X.fillRect(x + j*sq, y + i*sq, Math.min(sq, wd - j*sq), Math.min(sq, ht - i*sq)); } }
  function road(X, w, top, ht){ X.fillStyle = '#3a3d44'; X.fillRect(0, top, w, ht); X.fillStyle = 'rgba(255,255,255,.04)'; for(var i = 0; i < w; i += 6) X.fillRect(i, top + ((i*7) % ht), 2, 1);
    for(var k = 0; k*10 < w; k++){ X.fillStyle = k % 2 ? '#fff' : '#e63946'; X.fillRect(k*10, top - 3, 10, 3); X.fillRect(k*10, top + ht, 10, 3); } }

  /* menu: three cars chase round the circuit */
  function raceMenu(cv, t){
    var F = fit(cv), X = F.X, w = F.w, h = F.h;
    sky(X, w, h*.45); stands(X, w, h, t, h*.22, h*.24, false);
    X.fillStyle = '#5fae4b'; X.fillRect(0, h*.46, w, h*.06);
    var top = h*.53, ht = h*.42; road(X, w, top, ht);
    X.strokeStyle = 'rgba(255,255,255,.4)'; X.setLineDash([10, 9]); X.lineWidth = 2; X.lineDashOffset = 0; X.beginPath(); X.moveTo(0, top + ht/2); X.lineTo(w, top + ht/2); X.stroke(); X.setLineDash([]);
    checker(X, w*.78, top, 12, ht, 6);
    var cars = [0, 3, 4];
    cars.forEach(function(ci, i){ var sp = 70 + i*9 + Math.sin(t*.7 + i*2)*14, x = ((t*sp + i*90) % (w + 140)) - 70, y = top + ht*(i === 1 ? .73 : .3) + (i === 2 ? ht*.0 : 0);
      if(i === 2) y = top + ht*.5; var img = CAR.imgs[ci]; if(!img) return; var wid = drawCar(X, img, x, y, ht*.3, { bounce:Math.sin(t*30 + i)*.4 });
      X.strokeStyle = 'rgba(255,255,255,.35)'; X.lineWidth = 1.5; for(var k = 0; k < 3; k++){ X.beginPath(); X.moveTo(x - (wid || 50)*.55 - k*6, y - 4 + k*4); X.lineTo(x - (wid || 50)*.55 - 16 - k*10, y - 4 + k*4); X.stroke(); } });
    X.strokeStyle = 'rgba(0,0,0,.25)'; X.strokeRect(.5, .5, w - 1, h - 1);
  }
  /* countdown: the start gantry, lights going on one by one, then all green */
  function raceCount(cv, t){
    var F = fit(cv), X = F.X, w = F.w, h = F.h;
    sky(X, w, h*.5); stands(X, w, h, t, h*.3, h*.2, R.count <= 0);
    var top = h*.52, ht = h*.48; road(X, w, top, ht);
    X.fillStyle = '#fff'; X.fillRect(w*.62, top, 3, ht);
    var me = R.me || '', names = (R.grid || []).slice(0, 3); if(!names.length) names = [me];
    names.forEach(function(nm, i){ var y = top + ht*(.22 + i*.29), shake = R.count > 0 ? Math.sin(t*60 + i)*.8 : 0, go = R.count <= 0 ? Math.max(0, t - R.goAt) : 0;
      var x = w*.62 - 52 + go*go*260; var img = carImg(nm); var wid = drawCar(X, img, x, y + shake, ht*.24) || 60;
      if(R.count > 0 || go < .6){ for(var k = 0; k < 3; k++){ var a = (t*2 + k/3) % 1; X.fillStyle = 'rgba(220,220,230,' + (.5*(1 - a)) + ')'; X.beginPath(); X.arc(x - wid*.5 - a*22, y + 4 - a*8, 3 + a*6, 0, 7); X.fill(); } }
      if(nm === me && go < .3){ X.fillStyle = '#f6c945'; X.font = '800 9px ' + FONT; X.textAlign = 'center'; X.fillText('YOU', x, y - ht*.15); } });
    /* gantry */
    var gx = w*.5 - 70, gy = h*.06; X.fillStyle = '#1b1d22'; rr(X, gx, gy, 140, 34, 6); X.fill(); X.fillStyle = '#2c2f36'; X.fillRect(gx + 4, gy + 30, 132, 3);
    X.fillStyle = '#555'; X.fillRect(gx - 6, gy + 14, 6, h*.5); X.fillRect(gx + 140, gy + 14, 6, h*.5);
    for(var i = 0; i < 3; i++){ var lit = R.count <= 0 ? 'g' : (3 - R.count) >= i ? 'r' : '', lx = gx + 30 + i*40, ly = gy + 17;
      X.fillStyle = '#0c0d10'; X.beginPath(); X.arc(lx, ly, 12, 0, 7); X.fill();
      if(lit){ var col = lit === 'g' ? '#2ee88a' : '#ff3b3b'; var gg = X.createRadialGradient(lx, ly, 0, lx, ly, 20); gg.addColorStop(0, hexA(col, .9)); gg.addColorStop(1, hexA(col, 0));
        X.fillStyle = gg; X.beginPath(); X.arc(lx, ly, 20, 0, 7); X.fill(); X.fillStyle = col; X.beginPath(); X.arc(lx, ly, 9, 0, 7); X.fill(); X.fillStyle = 'rgba(255,255,255,.6)'; X.beginPath(); X.arc(lx - 3, ly - 3, 3, 0, 7); X.fill(); }
      else { X.fillStyle = '#26282e'; X.beginPath(); X.arc(lx, ly, 9, 0, 7); X.fill(); } }
    X.strokeStyle = 'rgba(0,0,0,.25)'; X.strokeRect(.5, .5, w - 1, h - 1);
  }
  /* the grandstand strip above the track while racing */
  function raceStrip(cv, t){
    var F = fit(cv), X = F.X, w = F.w, h = F.h, wave = t - R.waveAt < 2.5;
    sky(X, w, h*.4); stands(X, w, h, t, h*.3, h*.7, wave);
    X.fillStyle = 'rgba(10,12,20,.75)'; rr(X, w/2 - 58, h*.08, 116, 18, 9); X.fill(); X.font = '800 11px ' + FONT; X.textAlign = 'center'; X.fillStyle = '#f6c945';
    X.fillText(R.lead ? 'LEADER  ' + R.lead.toUpperCase().slice(0, 12) : 'GRAND PRIX', w/2, h*.08 + 12.5);
  }
  /* the podium for the results */
  function racePodium(cv, t){
    var F = fit(cv), X = F.X, w = F.w, h = F.h, o = R.order || [];
    var g = X.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1d2a44'); g.addColorStop(1, '#121826'); X.fillStyle = g; X.fillRect(0, 0, w, h);
    for(var i = 0; i < 6; i++){ var bx = w*(.1 + i*.16), a = .07 + .05*Math.sin(t*1.5 + i); X.fillStyle = 'rgba(255,240,180,' + a + ')'; X.beginPath(); X.moveTo(bx - 6, 0); X.lineTo(bx + 6, 0); X.lineTo(w/2 + (bx - w/2)*.3 + 30, h); X.lineTo(w/2 + (bx - w/2)*.3 - 30, h); X.closePath(); X.fill(); }
    var steps = [{ p:1, x:w/2, hh:h*.32 }, { p:2, x:w/2 - w*.28, hh:h*.22 }, { p:3, x:w/2 + w*.28, hh:h*.15 }], sw = Math.min(w*.27, 120);
    steps.forEach(function(S){ var nm = o[S.p - 1]; var top = h - S.hh;
      X.fillStyle = S.p === 1 ? '#f6c945' : S.p === 2 ? '#c9d1db' : '#d58b4a'; rr(X, S.x - sw/2, top, sw, S.hh + 6, 6); X.fill();
      X.fillStyle = 'rgba(0,0,0,.25)'; X.fillRect(S.x - sw/2, top + 6, sw, 3);
      X.font = '800 ' + Math.round(S.hh*.5) + 'px ' + FONT; X.textAlign = 'center'; X.fillStyle = 'rgba(20,16,30,.55)'; X.fillText(String(S.p), S.x, top + S.hh*.68);
      if(!nm) return; var img = carImg(nm), hop = S.p === 1 ? Math.abs(Math.sin(t*3))*4 : 0;
      drawCar(X, img, S.x, top - h*.1 - hop, h*.16); X.font = '800 11px ' + FONT; X.fillStyle = '#fff'; X.fillText(nm.slice(0, 12) + (nm === R.me ? ' (you)' : ''), S.x, top - h*.22 - hop); });
    if(o.length) confetti(X, w, h, t, '#f6c945');
  }

  var raceCv = {}, raceLoop = false;
  function raceMount(){
    var menu = $('menuScreen'), count = $('countScreen'), race = $('raceScreen'), res = $('resultScreen');
    if(menu && !$('raceMenuArt')){ var a = canvas('raceMenuArt', 'tbr-scene'); menu.insertBefore(a, menu.firstChild); }
    if(count && !$('raceCountArt')){ var b = canvas('raceCountArt', 'tbr-scene'); count.insertBefore(b, count.firstChild); }
    if(race && !$('raceStrip')){ var c = canvas('raceStrip', 'tbr-strip'); var hud = race.querySelector('.hudline'); race.insertBefore(c, hud ? hud.nextSibling : race.firstChild); }
    if(res && !$('racePodium')){ var d = canvas('racePodium', 'tbr-scene'); res.insertBefore(d, res.firstChild); }
    if(!raceLoop){ raceLoop = true; (function loop(){ var t = clock();
      if(shown($('raceMenuArt'))) raceMenu($('raceMenuArt'), t);
      if(shown($('raceCountArt'))) raceCount($('raceCountArt'), t);
      if(shown($('raceStrip'))) raceStrip($('raceStrip'), t);
      if(shown($('racePodium'))) racePodium($('racePodium'), t);
      requestAnimationFrame(loop); })(); }
  }
  /* a car that moves forward kicks up dust and speed lines */
  function watchCars(){
    var track = $('track'); if(!track || track.__tbr) return; track.__tbr = true;
    new MutationObserver(function(ms){ ms.forEach(function(m){ var el = m.target; if(!el.classList || !el.classList.contains('racer')) return;
      var was = parseFloat(el.__tbrLeft || 0), now = parseFloat((el.style.left.match(/calc\(([\d.]+)%/) || [0, 0])[1]); el.__tbrLeft = now;
      if(now > was + .1){ el.classList.remove('tbr-go'); void el.offsetWidth; el.classList.add('tbr-go'); clearTimeout(el.__tbrT); el.__tbrT = setTimeout(function(){ el.classList.remove('tbr-go'); }, 900); } }); })
      .observe(track, { subtree:true, attributes:true, attributeFilter:['style'] });
  }
  function laneOf(nm){ var lanes = R.lanes || {}; return lanes[nm]; }
  function carFx(nm, kind, ms){
    var lane = laneOf(nm); if(!lane) return; var car = lane.querySelector('.racer'), tr = lane.querySelector('.laneTrack'); if(!car || !tr) return;
    car.classList.remove('tbr-flat', 'tbr-oil', 'tbr-smoke', 'tbr-boost'); void car.offsetWidth; car.classList.add('tbr-' + kind);
    var fx = document.createElement('span'); fx.className = 'tbr-fx tbr-fx-' + kind; fx.style.left = car.style.left; fx.innerHTML = kind === 'smoke' ? '<i></i><i></i><i></i>' : kind === 'flat' ? '<b>pssst</b>' : kind === 'boost' ? '' : '';
    tr.appendChild(fx);
    setTimeout(function(){ car.classList.remove('tbr-' + kind); if(fx.parentNode) fx.parentNode.removeChild(fx); }, ms || 3000);
  }
  /* the pit stop: your own car's mishap fills the question space for a few seconds */
  function pitStop(kind, ms, done){
    var scr = $('raceScreen'), q = scr && scr.querySelector('.qbox'), opts = $('opts'); var M = MISHAPS[kind] || MISHAPS[0];
    var el = $('tbrPit'); if(!el){ el = document.createElement('div'); el.id = 'tbrPit'; el.setAttribute('role', 'status'); el.innerHTML = '<canvas aria-hidden="true"></canvas><div class="tbr-pit-t"></div><div class="tbr-pit-s"></div><div class="tbr-pit-bar"><i></i></div>'; scr.appendChild(el); }
    el.querySelector('.tbr-pit-t').textContent = M.title; el.querySelector('.tbr-pit-s').textContent = M.sub;
    var top = q ? q.offsetTop : 200, bot = opts ? opts.offsetTop + opts.offsetHeight : top + 300;
    el.style.top = top + 'px'; el.style.height = Math.max(180, bot - top) + 'px'; el.classList.add('on');
    var bar = el.querySelector('.tbr-pit-bar i'); bar.style.transition = 'none'; bar.style.width = '0%'; void bar.offsetWidth; bar.style.transition = 'width ' + ms + 'ms linear'; bar.style.width = '100%';
    R.pit = { kind:kind, at:clock(), ms:ms/1000 }; SFX[M.sfx] && SFX[M.sfx]();
    var cv = el.querySelector('canvas');
    (function loop(){ if(!R.pit) return; var t = clock(), p = (t - R.pit.at)/R.pit.ms; drawPit(cv, t, p, kind); if(p < 1) requestAnimationFrame(loop); })();
    setTimeout(function(){ R.pit = null; el.classList.remove('on'); if(done) done(); }, ms);
  }
  function crew(X, x, y, s, t, act, dir){ X.save(); X.translate(x, y); X.lineCap = 'round';
    X.strokeStyle = '#1f2533'; X.lineWidth = s*.13; X.beginPath(); X.moveTo(0, -s*.42); X.lineTo(-s*.08, 0); X.moveTo(0, -s*.42); X.lineTo(s*.1, 0); X.stroke();
    X.strokeStyle = '#e63946'; X.lineWidth = s*.24; X.beginPath(); X.moveTo(0, -s*.44); X.lineTo(0, -s*.72); X.stroke();
    var a = act ? Math.sin(t*26)*.3 : 0; X.strokeStyle = '#e63946'; X.lineWidth = s*.08; X.beginPath(); X.moveTo(0, -s*.68); X.lineTo(dir*s*.26, -s*.52 + a*s*.2); X.stroke();
    X.fillStyle = '#f2f2f2'; X.beginPath(); X.arc(0, -s*.86, s*.13, 0, 7); X.fill(); X.fillStyle = '#e63946'; X.fillRect(-s*.13, -s*.88, s*.26, s*.05);
    X.fillStyle = '#1b1420'; X.fillRect(dir*s*.02, -s*.86, dir*s*.1, s*.04); X.restore(); return { x:x + dir*s*.26, y:y - s*.52 + a*s*.2 }; }
  function drawPit(cv, t, p, kind){
    var F = fit(cv), X = F.X, w = F.w, h = F.h;
    var g = X.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a2f3a'); g.addColorStop(1, '#1b1f27'); X.fillStyle = g; X.fillRect(0, 0, w, h);
    X.fillStyle = 'rgba(255,255,255,.04)'; for(var pnl = 0; pnl < w; pnl += 46) X.fillRect(pnl, 0, 2, h*.78);
    X.fillStyle = '#323846'; X.fillRect(0, h*.16, w, 5);
    for(var lp = 0; lp < 3; lp++){ var lx = w*(.2 + lp*.3); X.fillStyle = '#e8eef8'; X.fillRect(lx - 16, 4, 32, 4); var lg = X.createLinearGradient(0, 8, 0, h*.7); lg.addColorStop(0, 'rgba(230,240,255,.16)'); lg.addColorStop(1, 'rgba(230,240,255,0)');
      X.fillStyle = lg; X.beginPath(); X.moveTo(lx - 16, 8); X.lineTo(lx + 16, 8); X.lineTo(lx + 60, h*.78); X.lineTo(lx - 60, h*.78); X.closePath(); X.fill(); }
    for(var ty = 0; ty < 3; ty++){ X.fillStyle = '#15171c'; rr(X, w*.06, h*.78 - (ty + 1)*h*.075, w*.11, h*.07, 6); X.fill(); X.fillStyle = '#e63946'; X.fillRect(w*.06 + 4, h*.78 - (ty + 1)*h*.075 + h*.03, w*.11 - 8, 2); }
    X.fillStyle = '#1f232c'; rr(X, w*.8, h*.3, w*.14, h*.3, 4); X.fill(); X.strokeStyle = '#8a93a6'; X.lineWidth = 2;
    for(var tl = 0; tl < 3; tl++){ X.beginPath(); X.moveTo(w*.83 + tl*w*.035, h*.36); X.lineTo(w*.83 + tl*w*.035, h*.5); X.stroke(); }
    X.fillStyle = '#4a4f5c'; X.fillRect(0, h*.78, w, h*.22); for(var k = 0; k*14 < w; k++){ X.fillStyle = k % 2 ? '#f6c945' : '#222'; X.fillRect(k*14, h*.78, 14, 4); }
    var img = carImg(R.me), cx = w/2, cy = h*.66, ch = Math.min(h*.26, w*.16), rot = 0, lift = 0;
    if(kind === 1){ var spin = p < .45 ? (1 - ease(p/.45)) : 0; rot = spin*Math.PI*4*(1 - p); X.fillStyle = 'rgba(0,0,0,.85)'; X.beginPath(); X.ellipse(cx, cy + ch*.45, ch*2.2, ch*.35, 0, 0, 7); X.fill();
      X.fillStyle = 'rgba(120,90,200,.35)'; X.beginPath(); X.ellipse(cx - ch*.5, cy + ch*.4, ch*.8, ch*.12, 0, 0, 7); X.fill(); }
    if(kind === 0) lift = p > .1 && p < .85 ? ch*.18 : 0;
    var wid = drawCar(X, img, cx, cy - lift, ch, { rot:kind === 1 ? Math.sin(rot)*.5 : kind === 0 && p < .1 ? -.06 : 0 }) || ch*4;
    if(kind === 0){ var hand = crew(X, cx + wid*.42 + ch*.5, h*.78, ch*1.6, t, p > .15 && p < .8, -1); crew(X, cx - wid*.42 - ch*.5, h*.78, ch*1.6, t, p > .1 && p < .85, 1);
      if(p > .15 && p < .8 && !RM){ for(var s2 = 0; s2 < 4; s2++){ X.fillStyle = '#ffd36b'; X.fillRect(hand.x - 4 + Math.random()*8, hand.y - 4 + Math.random()*8, 2, 2); } }
      if(p > .35 && p < .65){ var rx = lerp(w + 20, cx + wid*.3, ease((p - .35)/.3)); X.fillStyle = '#111'; X.beginPath(); X.arc(rx, h*.74, ch*.28, 0, 7); X.fill(); X.fillStyle = '#888'; X.beginPath(); X.arc(rx, h*.74, ch*.12, 0, 7); X.fill(); } }
    if(kind === 2){ crew(X, cx + wid*.2, h*.78, ch*1.6, t, true, -1);
      for(var s3 = 0; s3 < 7; s3++){ var a = (t*.8 + s3/7) % 1, sm = (1 - p)*.8 + .1; X.fillStyle = 'rgba(200,200,210,' + (.5*(1 - a)*sm) + ')'; X.beginPath(); X.arc(cx + wid*.3 - a*20 + Math.sin(a*6 + s3)*6, cy - ch*.4 - a*h*.4, 5 + a*14, 0, 7); X.fill(); } }
    if(kind === 1 && p > .5){ crew(X, cx - wid*.6, h*.78, ch*1.6, t, true, 1); }
  }
  /* crossing the line: a chequered flag sweeps across */
  function flag(done){
    var scr = $('raceScreen'); var el = $('tbrFlag'); if(!el){ el = document.createElement('div'); el.id = 'tbrFlag'; el.innerHTML = '<canvas aria-hidden="true"></canvas><b>You crossed the line!</b>'; scr.appendChild(el); }
    el.classList.add('on'); var cv = el.querySelector('canvas'), t0 = clock(); SFX.cheer(); R.waveAt = clock();
    (function loop(){ var t = clock(), p = (t - t0)/1.7; if(p > 1){ return; } var F = fit(cv), X = F.X, w = F.w, h = F.h; X.clearRect(0, 0, w, h);
      var a = p < .12 ? p/.12 : p > .85 ? (1 - p)/.15 : 1; X.save(); X.globalAlpha = a; X.fillStyle = 'rgba(10,12,20,.55)'; X.fillRect(0, 0, w, h);
      var px = w*.18, py = h*.62, fw = Math.min(w*.62, 260), fh = fw*.62, cols = 8, rows = 5, sw = fw/cols, sh2 = fh/rows, sweep = Math.sin(t*3)*.12 - .25;
      X.translate(px, py); X.rotate(sweep); X.fillStyle = '#d9dde3'; X.fillRect(-3, -fh*1.25, 6, fh*1.6);
      for(var i = 0; i < rows; i++) for(var j = 0; j < cols; j++){ var wv = function(jj){ return Math.sin(t*9 - jj*.7)*fh*.06*(jj/cols); };
        var x0 = j*sw, y0 = -fh*1.2 + i*sh2; X.fillStyle = (i + j) % 2 ? '#111' : '#fff'; X.beginPath(); X.moveTo(x0, y0 + wv(j)); X.lineTo(x0 + sw + .5, y0 + wv(j + 1)); X.lineTo(x0 + sw + .5, y0 + sh2 + .5 + wv(j + 1)); X.lineTo(x0, y0 + sh2 + .5 + wv(j)); X.closePath(); X.fill(); }
      X.restore(); confetti(X, w, h, t, '#f6c945'); requestAnimationFrame(loop); })();
    setTimeout(function(){ el.classList.remove('on'); if(done) done(); }, RM ? 400 : 1700);
  }

  /* ---------- styles ---------- */
  var css = [
    '.tbr-scene{display:block;width:100%;height:170px;flex:none;border-radius:16px;box-shadow:0 10px 26px rgba(0,0,0,.35);}',
    '#menuScreen .tbr-scene{height:150px;}',
    '#countScreen .tbr-scene{height:190px;max-width:520px;}',
    '#resultScreen .tbr-scene{height:150px;max-width:420px;}',
    '#tugScreen .ropeWrap{position:relative;}',
    '#tugScreen .ropeWrap .tbr-scene{height:200px;}',
    'body.tbr-tug #tugScreen .ropeBar{position:absolute;opacity:0;pointer-events:none;height:1px;}',
    '.tbr-ticker{width:100%;min-height:20px;font-weight:800;font-size:13px;color:var(--mut);text-align:center;opacity:.0;transform:translateY(-3px);transition:opacity .25s,transform .25s;margin:-4px 0;}',
    '.tbr-ticker.on{opacity:1;transform:none;color:var(--ink);}',
    '.tbr-ticker b{display:inline-block;background:rgba(255,255,255,.07);border:1px solid var(--line);border-radius:999px;padding:3px 12px;}',
    '.tbr-ticker.bad b{border-color:rgba(230,57,70,.6);background:rgba(230,57,70,.14);}',
    '.tbr-ticker.good b{border-color:rgba(45,212,167,.6);background:rgba(45,212,167,.12);}',
    '.tbr-ticker.gold b{border-color:rgba(246,201,69,.6);background:rgba(246,201,69,.12);}',
    '.tbr-team{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 12px;background:rgba(255,255,255,.06);}',
    '.tbr-how{list-style:none;display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--mut);max-width:400px;text-align:left;}',
    '.tbr-how li{display:flex;gap:8px;align-items:flex-start;}',
    '.tbr-how li span{flex:none;width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);font-size:11px;color:var(--ink);}',
    /* Finish Line track */
    '.tbr-strip{display:block;width:100%;height:58px;flex:none;border-radius:12px;}',
    'body.tbr-race #track{background:#3a3d44;border-radius:12px;padding:5px 0;gap:0;position:relative;border-top:4px solid transparent;border-bottom:4px solid transparent;',
    '  border-image:repeating-linear-gradient(90deg,#e63946 0 10px,#fff 10px 20px) 4;box-shadow:0 8px 20px rgba(0,0,0,.35);}',
    'body.tbr-race .lane{background:none;border:none;border-radius:0;padding:3px 8px 4px;border-bottom:2px dashed rgba(255,255,255,.22);position:relative;}',
    'body.tbr-race .lane:last-child{border-bottom:none;}',
    'body.tbr-race .lane.me{background:linear-gradient(90deg,rgba(246,201,69,.16),rgba(246,201,69,.04));}',
    'body.tbr-race .lane.done{box-shadow:none;}',
    'body.tbr-race .lname{color:#dfe3ea;}',
    'body.tbr-race .lane.done .lname::after{content:"\\2691  finished";color:var(--right);margin-left:auto;font-size:10px;}',
    '.tbr-pos{font-family:"Baloo 2",cursive;font-size:11px;line-height:1;padding:2px 5px 1px;border-radius:5px;background:rgba(255,255,255,.12);color:#fff;min-width:24px;text-align:center;}',
    '.tbr-pos.p1{background:#f6c945;color:#241c06;}',
    'body.tbr-race .laneTrack{background:none;box-shadow:none;overflow:visible;}',
    'body.tbr-race .laneTrack::before{display:none;}',
    'body.tbr-race .finishLine{right:0;top:-3px;bottom:-4px;width:12px;border:none;opacity:1;background:repeating-conic-gradient(#fff 0 25%,#111 0 50%) 0 0/6px 6px;}',
    'body.tbr-race .laneTrack::after{content:"";position:absolute;left:96px;top:-3px;bottom:-4px;width:2px;background:rgba(255,255,255,.55);}',
    'body.tbr-race .racer{animation:tbrIdle .18s steps(2) infinite;}',
    '@keyframes tbrIdle{50%{margin-top:-.6px;}}',
    '.racer.tbr-go::before{content:"";position:absolute;right:92%;top:30%;width:40px;height:40%;background:repeating-linear-gradient(180deg,rgba(255,255,255,.55) 0 2px,transparent 2px 6px);animation:tbrLines .9s ease-out forwards;}',
    '.racer.tbr-go::after{content:"";position:absolute;right:88%;bottom:-2px;width:16px;height:12px;border-radius:50%;background:rgba(210,200,190,.55);animation:tbrDust .9s ease-out forwards;}',
    '@keyframes tbrLines{from{opacity:1;transform:translateX(0);}to{opacity:0;transform:translateX(-18px);}}',
    '@keyframes tbrDust{from{opacity:.8;transform:scale(.6);}to{opacity:0;transform:scale(2.2) translate(-10px,-4px);}}',
    '.racer.tbr-oil{animation:tbrSpin 1.1s ease-out 1;}',
    '@keyframes tbrSpin{to{transform:translateY(-50%) rotate(720deg);}}',
    '.racer.tbr-flat{transform:translateY(-40%) rotate(-5deg);animation:none;}',
    '.racer.tbr-smoke{animation:tbrShake .12s steps(2) infinite;}',
    '@keyframes tbrShake{50%{margin-left:1px;}}',
    '.racer.tbr-boost{filter:drop-shadow(0 0 6px #7ad7ff) drop-shadow(0 2px 3px rgba(0,0,0,.55));}',
    '.racer.tbr-boost::before{content:"";position:absolute;right:94%;top:25%;width:46px;height:50%;border-radius:40% 0 0 40%;background:linear-gradient(270deg,rgba(122,215,255,.9),rgba(122,215,255,0));animation:tbrLines 1.4s ease-out forwards;}',
    '.tbr-fx{position:absolute;top:50%;width:96px;height:0;pointer-events:none;z-index:4;}',
    '.tbr-fx-oil{z-index:2;}',
    '.tbr-fx-oil::before{content:"";position:absolute;left:10px;top:-2px;width:80px;height:12px;border-radius:50%;background:radial-gradient(ellipse at 40% 40%,#3b2f5a,#08070c 70%);opacity:.9;animation:tbrFade 3s ease-in forwards;}',
    '.tbr-fx-smoke i{position:absolute;left:70px;top:-10px;width:10px;height:10px;border-radius:50%;background:rgba(220,220,228,.8);animation:tbrPuff 1s ease-out infinite;}',
    '.tbr-fx-smoke i:nth-child(2){animation-delay:.33s;left:62px;} .tbr-fx-smoke i:nth-child(3){animation-delay:.66s;left:76px;}',
    '@keyframes tbrPuff{from{opacity:.9;transform:scale(.6);}to{opacity:0;transform:translate(-14px,-22px) scale(2.4);}}',
    '@keyframes tbrFade{0%,70%{opacity:.9;}to{opacity:0;}}',
    '.tbr-fx-flat b{position:absolute;left:4px;top:-26px;font-size:10px;font-weight:800;color:#111;background:#fff;border-radius:8px;padding:1px 6px;animation:tbrFade 3s forwards;}',
    'body.tbr-race #track.tbr-many .laneTrack{height:22px;} body.tbr-race #track.tbr-many .racer{height:19px;}',
    '#raceScreen{position:relative;}',
    '#tbrPit{position:absolute;left:0;right:0;z-index:15;border-radius:16px;overflow:hidden;display:none;flex-direction:column;align-items:center;justify-content:flex-end;padding:16px;gap:6px;border:2px solid rgba(246,201,69,.55);background:#1b1f27;}',
    '#tbrPit.on{display:flex;animation:tbrIn .25s ease-out;}',
    '#tbrPit canvas{position:absolute;inset:0;width:100%;height:100%;}',
    '#tbrPit .tbr-pit-t{position:relative;z-index:1;font-family:"Baloo 2",cursive;font-size:28px;color:#f6c945;line-height:1;text-shadow:0 2px 0 rgba(0,0,0,.5);order:-1;margin-bottom:auto;margin-top:6px;}',
    '#tbrPit .tbr-pit-s{position:relative;z-index:1;font-weight:800;font-size:14px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);}',
    '#tbrPit .tbr-pit-bar{position:relative;z-index:1;width:70%;height:8px;border-radius:5px;background:rgba(255,255,255,.18);overflow:hidden;}',
    '#tbrPit .tbr-pit-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#f6c945,#2dd4a7);}',
    '@keyframes tbrIn{from{opacity:0;transform:scale(.96);}to{opacity:1;transform:none;}}',
    '#tbrFlag{position:absolute;inset:0;z-index:16;display:none;pointer-events:none;align-items:center;justify-content:center;}',
    '#tbrFlag.on{display:flex;}',
    '#tbrFlag canvas{position:absolute;inset:0;width:100%;height:100%;}',
    '#tbrFlag b{position:relative;margin-top:70%;font-family:"Baloo 2",cursive;font-size:30px;color:#f6c945;background:rgba(14,16,22,.85);border-radius:16px;padding:6px 18px;animation:tbrIn .3s ease-out;}',
    /* Tug of War scoreboard */
    'body.tbr-tug .tugHud{gap:8px;}',
    'body.tbr-tug .tugHud .tBlue,body.tbr-tug .tugHud .tRed{padding:5px 12px;border-radius:999px;font-size:14px;}',
    'body.tbr-tug .tugHud .tBlue{background:rgba(59,130,246,.18);border:1px solid rgba(59,130,246,.55);}',
    'body.tbr-tug .tugHud .tRed{background:rgba(230,57,70,.18);border:1px solid rgba(230,57,70,.55);}',
    'body.tbr-tug #capClock{font-family:"Baloo 2",cursive;font-size:18px;color:var(--ink);background:rgba(255,255,255,.06);border-radius:10px;padding:1px 10px;}',
    'body.tbr-tug #capClock.low{color:#ff8a93;}',
    '#countScreen .sub{margin-top:6px;}',
    'body.tbr-tug .opt.good,body.tbr-race .opt.good{border-color:var(--right);background:rgba(45,212,167,.18);}',
    'body.tbr-tug .opt.bad,body.tbr-race .opt.bad{border-color:var(--wrong);background:rgba(230,57,70,.18);}',
    '@media (hover:hover){body.tbr-tug .opts:not(.locked) .opt:hover,body.tbr-race .opts:not(.locked) .opt:hover{border-color:rgba(255,255,255,.35);}}',
    '@media (max-height:700px){#tugScreen .ropeWrap .tbr-scene{height:160px;} .tbr-strip{height:44px;} #menuScreen .tbr-scene{height:110px;}}'
  ].join('\n');

  function boot(){
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    document.body.classList.add(KIND === 'tug' ? 'tbr-tug' : 'tbr-race');
    var scr = KIND === 'tug' ? $('tugScreen') : $('raceScreen');
    if(scr && !$('tbrTicker')){ var tk = document.createElement('div'); tk.id = 'tbrTicker'; tk.className = 'tbr-ticker'; tk.setAttribute('aria-live', 'polite');
      var hud = scr.querySelector(KIND === 'tug' ? '.tugHud' : '.hudline'); scr.insertBefore(tk, hud ? hud.nextSibling : scr.firstChild); }
    if(KIND === 'tug') tugMount('menu'); else raceMount();
    tv();
  }

  window.TBRace = {
    say:say, sfx:function(k){ if(SFX[k]) SFX[k](); },
    /* shared: the countdown beats (3, 2, 1, then 0 for go) */
    countdown:function(n, teams){
      if(KIND === 'tug'){ if(n === 3){ T.mode = 'count'; T.goAt = -9; T.win = null; T.ev = {}; T.warn = 0; T.f = 0; T.fShow = 0; if(teams) T.teams = { 1:teams.blue, 2:teams.red }; tugMount('count'); SFX.whistle(); } T.count = n; if(n <= 0){ T.goAt = clock(); } }
      else { R.count = n; if(n === 3){ R.goAt = -9; SFX.rev(); } if(n <= 0){ R.goAt = clock(); SFX.rev(); } }
    },
    /* ---- tug ---- */
    tug:function(o){ if(T.mode === 'count' || T.mode === 'menu' || T.mode === 'over'){ T.mode = 'tug'; tugMount('tug'); }
      T.f = clamp(o.f, -1.2, 1.2); T.me = o.me; T.mySide = o.mySide;
      T.teams = { 1:o.blue, 2:o.red };
      var f = T.f, z = f > .55 ? 2 : f < -.55 ? 1 : 0;
      if(z && z !== T.warn){ say((z === 2 ? 'Red' : 'Blue') + ' are hauling ' + (z === 2 ? 'Blue' : 'Red') + ' towards the mud!', z === T.mySide ? 'good' : 'bad'); }
      else if(!z && T.warn && Math.abs(f) < .3){ say((T.warn === 2 ? 'Blue' : 'Red') + ' dig in and haul it back!', 'gold'); }
      if(z || Math.abs(f) < .3) T.warn = z; },
    heave:function(side, mine){ T.heave[side] = clock(); if(mine){ var cv = tugCv; if(cv){ var L = tugLayout(cv.clientWidth, cv.clientHeight); T.plus.push({ txt:'HEAVE!', x:L.cx + T.fShow*L.D - (side === 1 ? 1 : -1)*L.G*1.3, y:L.ropeY - L.s*.6, at:clock(), col:'#f6c945' }); } } },
    slip:function(name, side, count, isMe){ var kind = hash(name + ':' + count) % SLIPS.length; T.ev[name] = { kind:kind, at:clock() }; var K = SLIPS[kind];
      say(isMe ? K.me : name + K.say, isMe || side === T.mySide ? 'bad' : 'good'); if(SFX[K.sfx]) setTimeout(SFX[K.sfx], kind < 2 ? 380 : 0); return kind; },
    tugEnd:function(winner, done){ T.mode = 'end'; T.win = winner; T.endAt = clock(); tugMount('tug'); if(winner) setTimeout(SFX.cheer, 900); setTimeout(done, RM ? 300 : 2600); },
    tugResult:function(){ T.mode = 'over'; tugMount('result'); },
    tugMenu:function(){ T.mode = 'menu'; T.win = null; T.f = 0; T.ev = {}; T.warn = 0; tugMount('menu'); },
    /* ---- race ---- */
    init:function(o){ CAR.imgs = (o.cars || []).map(function(src){ var im = new Image(); im.src = src; return im; }); CAR.col = o.colors || []; CAR.idx = o.idx || CAR.idx; },
    grid:function(names, me){ R.grid = names.slice().sort(function(a, b){ return (a === me ? -1 : 0) - (b === me ? -1 : 0); }); R.me = me; },
    track:function(lanes, players, me, finish){
      R.lanes = lanes; R.me = me; watchCars(); var track = $('track'); var names = Object.keys(players);
      if(track) track.classList.toggle('tbr-many', names.length > 5);
      var order = names.slice().sort(function(a, b){ var A = players[a], B = players[b];
        if(A.finished !== B.finished) return A.finished ? -1 : 1; if(A.finished) return String(A.finishAt || '').localeCompare(String(B.finishAt || '')); return B.progress - A.progress || (a === R.lead ? -1 : b === R.lead ? 1 : 0) || (a < b ? -1 : 1); });
      order.forEach(function(nm, i){ var lane = lanes[nm]; if(!lane) return; var ln = lane.querySelector('.lname'); var b = ln && ln.querySelector('.tbr-pos');
        if(ln && !b){ b = document.createElement('span'); b.className = 'tbr-pos'; ln.insertBefore(b, ln.firstChild); } if(b){ b.textContent = 'P' + (i + 1); b.classList.toggle('p1', i === 0); } });
      var top = order[0], tp = top ? players[top].progress : 0;
      if(top && tp >= 2 && top !== R.lead && (!R.lead || !players[R.lead] || players[R.lead].progress < tp)){ if(R.lead) say((top === me ? 'You take' : top + ' takes') + ' the lead!', top === me ? 'good' : 'gold'); R.lead = top; R.waveAt = clock(); }
      else if(!R.lead && top && tp >= 2) R.lead = top;
      if(!R.straight && tp >= finish - 3 && top){ R.straight = true; say((top === me ? 'You are' : top + ' is') + ' into the final straight!', 'gold'); }
      R.order = order; return order; },
    raceReset:function(){ R.lead = ''; R.straight = false; R.order = []; R.pit = null; var p = $('tbrPit'); if(p) p.classList.remove('on'); },
    mishap:function(name, count, isMe){ var kind = hash(name + '#' + count) % MISHAPS.length, M = MISHAPS[kind]; carFx(name, M.key, 3000);
      if(!isMe){ say(name + M.say, 'gold'); if(SFX[M.sfx]) SFX[M.sfx](); } else say(M.title.replace('!', '') + ': you lose a few seconds.', 'bad'); return kind; },
    pit:pitStop,
    boost:function(name, isMe){ carFx(name, 'boost', 1400); if(isMe) SFX.swoosh(); },
    flag:flag,
    podium:function(order, me){ R.order = order; R.me = me; }
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
