/* TierBrain hosts. One file, three characters.
   Use on a page with <div class="host"><canvas id="hostCv"></canvas><div id="hostBubble"></div></div>
     a script tag for tb-hosts.js with data-host="quiz", "verse" or "throne" (and defer)
   It provides window.HOST.set(pose) and window.HOST.reel(), the same commands the shows already use.
   Poses: idle, welcome, present, point, ask, celebrate, wince, calm.
   The host also talks whenever the speech bubble (#hostBubble) is showing. */
(function(){
  'use strict';
  var me = document.currentScript;
  var CANVAS_ID = (me && me.getAttribute('data-canvas')) || 'hostCv';
  var BUBBLE_ID = (me && me.getAttribute('data-bubble')) || 'hostBubble';
  var WHO = (me && me.getAttribute('data-host')) || 'quiz';
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- shared drawing helpers ---------- */
  function rgb(c, a){ return a == null ? 'rgb(' + (c[0]|0) + ',' + (c[1]|0) + ',' + (c[2]|0) + ')' : 'rgba(' + (c[0]|0) + ',' + (c[1]|0) + ',' + (c[2]|0) + ',' + a + ')'; }
  function shade(c, f){ return [c[0]*f, c[1]*f, c[2]*f]; }
  function mix(a, b, t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
  function rnd(seed){ var x = Math.sin(seed*127.1)*43758.5453; return x - Math.floor(x); }

  /* ---------- poses: arm angles (shoulder a, elbow b), body and face ---------- */
  /* a: 0 = arm hanging, PI/2 = straight out to the side, PI = straight up.  b: bend at the elbow, negative folds the hand inwards. */
  /* hand targets in body units (shoulders sit at x = +/-33, y = -78; the chin at y = -90) */
  var POSES = {
    idle:      { lx:-7, ly:-40, rx:7,  ry:-40, lean:0,    tilt:0,    look:0,   brow:.15, worry:0,  smile:.45, open:0,  squint:0,  hop:0, prop:0, finger:0 },
    welcome:   { lx:-72,ly:-128,rx:72, ry:-128,lean:0,    tilt:-.04, look:0,   brow:.6,  worry:0,  smile:1,   open:.45,squint:.35,hop:.3,prop:0, finger:0 },
    present:   { lx:-7, ly:-40, rx:80, ry:-82, lean:.05,  tilt:.06,  look:.55, brow:.4,  worry:0,  smile:.8,  open:0,  squint:0,  hop:0, prop:0, finger:0 },
    point:     { lx:-7, ly:-42, rx:70, ry:-122,lean:.07,  tilt:.04,  look:.35, brow:.7,  worry:0,  smile:.85, open:.35,squint:0,  hop:0, prop:0, finger:1 },
    ask:       { lx:-5, ly:-90, rx:9,  ry:-46, lean:-.03, tilt:.1,   look:.25, brow:.55, worry:.15,smile:.35, open:0,  squint:0,  hop:0, prop:0, finger:0 },
    celebrate: { lx:-42,ly:-138,rx:42, ry:-138,lean:0,    tilt:0,    look:0,   brow:.75, worry:0,  smile:1,   open:.75,squint:.9, hop:1, prop:1, finger:0 },
    wince:     { lx:-21,ly:-103,rx:12, ry:-62,lean:-.08, tilt:-.07, look:0,   brow:-.1, worry:.9, smile:-.55,open:.15,squint:.2, hop:0, prop:0, finger:0 },
    shush:     { lx:-3, ly:-101,rx:9,  ry:-46,lean:0,    tilt:.06,  look:0,   brow:.35, worry:0,  smile:.35, open:0,  squint:.55,hop:0, prop:0, finger:-1 },
    calm:      { lx:-7, ly:-42, rx:7,  ry:-42, lean:0,    tilt:.03,  look:0,   brow:.2,  worry:0,  smile:.6,  open:0,  squint:.25,hop:0, prop:0, finger:0 }
  };
  var FIELDS = Object.keys(POSES.idle);
  var TALKS = { welcome:1, ask:1, celebrate:1, present:1, point:1 };
  var REEL = [ {p:'idle',d:2600}, {p:'welcome',d:3000,say:1}, {p:'present',d:2800}, {p:'point',d:2400,say:1}, {p:'calm',d:2200}, {p:'celebrate',d:2400} ];

  /* ---------- each show keeps its own outfit, prop and set ---------- */
  var SHOWS = {
    quiz:   { name:'The Big Quiz', coat:[226,176,72], coatDark:[176,128,40], lapel:[46,26,30], shirt:[248,240,226], tie:[217,105,79],
              sleeve:[226,176,72], cuff:[248,240,226], prop:'mic', bg:'stage', energy:1.15, hat:null, tabard:false, brooch:false, wrap:[122,46,40] },
    verse:  { name:'Chapter & Verse', coat:[110,150,118], coatDark:[78,112,86], lapel:[96,136,104], shirt:[251,241,226], tie:null,
              sleeve:[110,150,118], cuff:[96,136,104], prop:'book', bg:'study', energy:.85, hat:null, tabard:false, brooch:true, wrap:[96,136,104] },
    throne: { name:'Hold The Throne', coat:[196,72,54], coatDark:[140,46,36], lapel:[230,182,85], shirt:[251,241,226], tie:null,
              sleeve:[70,40,36], cuff:[230,182,85], prop:'trumpet', bg:'hall', energy:1.05, hat:'cap', tabard:true, brooch:false, wrap:[122,42,31] }
    ,
    spines: { name:'Spines', coat:[96,112,72], coatDark:[66,80,48], lapel:[74,88,54], shirt:[244,236,218], tie:[122,42,31],
              sleeve:[222,208,182], cuff:[196,180,150], prop:'glass', bg:'library', energy:.95, hat:null, tabard:false, brooch:false, wrap:[47,90,63] },
    harbour:{ name:'Standing Room', coat:[50,82,94], coatDark:[30,52,60], lapel:[34,56,64], shirt:[232,220,196], tie:null,
              sleeve:[50,82,94], cuff:[216,162,60], prop:'lantern', bg:'water', energy:1.0, hat:'captain', tabard:false, brooch:false, wrap:[38,62,72], buttons:true },
    guide:  { name:'Creak & Coil', coat:[184,72,50], coatDark:[128,46,32], lapel:[150,56,38], shirt:[232,220,196], tie:null,
              sleeve:[184,72,50], cuff:[60,44,36], prop:'axe', bg:'mountain', energy:1.1, hat:'beanie', tabard:false, brooch:false, wrap:[184,72,50], rope:true, zip:true }
  };
  /* ---------- the people who can host any show ---------- */
  var PEOPLE = {
    marcus: { skin:[122,76,50],  hair:[30,22,20],    iris:[58,38,26],  lip:[108,56,52],  hairStyle:'short',    facial:'goatee' },
    ruth:   { skin:[236,196,170],hair:[214,210,206], iris:[70,96,120], lip:[178,92,96],  hairStyle:'bun',      glasses:true, earrings:true, lashes:true, older:true },
    priya:  { skin:[170,112,78], hair:[34,24,26],    iris:[52,34,26],  lip:[150,70,70],  hairStyle:'ponytail', earrings:true, lashes:true },
    grace:  { skin:[98,62,44],   hair:[26,18,16],    iris:[52,32,22],  lip:[120,58,62],  hairStyle:'afro',     earrings:true, lashes:true },
    samuel: { skin:[90,58,42],   hair:[200,196,190], iris:[48,30,22],  lip:[96,50,48],   hairStyle:'bald',     facial:'fullgrey', glasses:true, older:true },
    amira:  { skin:[196,146,108],hair:[30,22,20],    iris:[60,40,28],  lip:[160,80,82],  hairStyle:'hijab',    lashes:true },
    jun:    { skin:[232,196,160],hair:[22,20,22],    iris:[46,32,24],  lip:[176,104,100],hairStyle:'sidepart', glasses:true },
    callum: { skin:[244,210,188],hair:[184,92,48],   iris:[74,110,96], lip:[184,100,100],hairStyle:'curly',    freckles:true },
    harjit: { skin:[176,122,86], hair:[28,22,22],    iris:[52,34,26],  lip:[130,66,62],  hairStyle:'turban',   facial:'full', turban:[30,58,96] },
    sofia:  { skin:[220,170,130],hair:[70,40,26],    iris:[70,48,30],  lip:[170,84,88],  hairStyle:'long',     earrings:true, lashes:true }
  };
  var ORDER = ['marcus','ruth','priya','grace','samuel','amira','jun','callum','harjit','sofia'];
  var DEFAULT = { quiz:'marcus', verse:'ruth', throne:'priya', spines:'grace', harbour:'samuel', guide:'callum' };
  function compose(who, person){
    var show = SHOWS[who] || SHOWS.quiz, p = PEOPLE[person] || PEOPLE[DEFAULT[who] || 'marcus'], c = {}, k;
    for(k in show) c[k] = show[k];
    for(k in p) c[k] = p[k];
    if(p.hairStyle === 'hijab' || p.hairStyle === 'turban') c.hat = null;
    return c;
  }
  function savedPerson(who){ try{ var v = localStorage.getItem('tb-host-' + who); if(v && PEOPLE[v]) return v; }catch(e){} return DEFAULT[who] || 'marcus'; }
  function savePerson(who, id){ try{ localStorage.setItem('tb-host-' + who, id); }catch(e){} }

  function Host(canvas, bubble, who, person, opts){
    opts = opts || {};
    who = SHOWS[who] ? who : 'quiz';
    var personId = person && PEOPLE[person] ? person : savedPerson(who);
    var C = compose(who, personId), X = canvas.getContext('2d');
    var W = 0, H = 0, DPR = 1, started = false;
    var cur = {}, vel = {}, target = POSES.idle, mode = 'reel', hold = 'idle', ri = 0, stepAt = 0, poseAt = 0;
    var talkUntil = 0, mouth = 0, mouthTarget = 0, nextSyl = 0, blinkAt = 1200, lastT = 0, saccade = 0, nextSacc = 0;
    var confetti = [], sweat = -1;
    FIELDS.forEach(function(f){ cur[f] = POSES.idle[f]; vel[f] = 0; });

    function size(){
      var r = canvas.getBoundingClientRect(); if(!r.width || !r.height) return;
      W = r.width; H = r.height; DPR = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
      X.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    window.addEventListener('resize', function(){ size(); if(RM && started) render(now()); });
    /* with reduced motion the host is drawn as a still picture, so redraw it whenever its box changes size */
    var isPortrait = false;
    if(window.ResizeObserver) new ResizeObserver(function(){
      var r = canvas.getBoundingClientRect(); if(Math.abs(r.width - W) < .5 && Math.abs(r.height - H) < .5) return;
      size(); if(isPortrait) portrait(); else if(RM && started) render(now());
    }).observe(canvas);

    function setPose(name){
      var p = POSES[name] || POSES.idle; target = p; poseAt = now();
      if(name === 'celebrate') burst();
      if(name === 'wince') sweat = now();
      if(TALKS[name]) talkUntil = Math.max(talkUntil, now() + 1500);
      if(RM){ FIELDS.forEach(function(f){ cur[f] = p[f]; }); render(now()); }
    }
    function now(){ return (window.performance && performance.now()) || Date.now(); }
    function burst(){
      if(RM) return; var cols = [[242,210,122],[217,105,79],[134,191,157],[224,164,88],[251,241,226]];
      for(var i = 0; i < 46; i++){ var a = -Math.PI/2 + (Math.random()-.5)*2.4, sp = 3 + Math.random()*5;
        confetti.push({ x:0, y:-150, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, r:Math.random()*6, vr:(Math.random()-.5)*.4, c:cols[i%cols.length], life:1, w:3+Math.random()*3 }); }
    }

    /* watch the speech bubble so the host talks while it is showing */
    if(bubble && window.MutationObserver){
      new MutationObserver(function(){
        var hidden = bubble.classList.contains('hide') || bubble.hidden || !bubble.textContent.trim();
        if(!hidden){ var words = bubble.textContent.trim().split(/\s+/).length; talkUntil = now() + Math.min(2600, 260 + words*230); }
      }).observe(bubble, { attributes:true, childList:true, characterData:true, subtree:true });
    }

    /* ---------- backgrounds ---------- */
    function backdrop(T){
      var g;
      if(C.bg === 'stage'){
        g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d1013'); g.addColorStop(1, '#120a0c'); X.fillStyle = g; X.fillRect(0, 0, W, H);
        /* marquee arch of bulbs */
        var cx = W/2, ar = Math.min(W*.42, H*.95), cy = H*1.02;
        X.strokeStyle = 'rgba(230,182,85,.16)'; X.lineWidth = Math.max(6, ar*.05); X.beginPath(); X.arc(cx, cy, ar, Math.PI*1.04, Math.PI*1.96); X.stroke();
        var n = 22;
        for(var i = 0; i <= n; i++){ var a = Math.PI*1.04 + (Math.PI*.92)*(i/n), on = RM ? 1 : (Math.floor(T/220) + i) % 3 !== 0;
          var bx = cx + Math.cos(a)*ar, by = cy + Math.sin(a)*ar, br = Math.max(2.2, ar*.022);
          X.fillStyle = on ? 'rgba(255,226,150,.95)' : 'rgba(150,110,60,.5)'; X.beginPath(); X.arc(bx, by, br, 0, 7); X.fill();
          if(on){ X.fillStyle = 'rgba(255,214,140,.16)'; X.beginPath(); X.arc(bx, by, br*3.2, 0, 7); X.fill(); } }
        /* sweeping spotlights */
        for(var k = 0; k < 2; k++){ var sw = RM ? 0 : Math.sin(T*.00045 + k*2.4)*.35, ox = k ? W*.95 : W*.05;
          X.save(); X.translate(ox, -10); X.rotate((k ? .5 : -.5) + sw);
          g = X.createLinearGradient(0, 0, 0, H*1.3); g.addColorStop(0, 'rgba(255,230,170,.20)'); g.addColorStop(1, 'rgba(255,230,170,0)');
          X.fillStyle = g; X.beginPath(); X.moveTo(-6, 0); X.lineTo(6, 0); X.lineTo(H*.32, H*1.3); X.lineTo(-H*.32, H*1.3); X.closePath(); X.fill(); X.restore(); }
      } else if(C.bg === 'study'){
        g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#24151a'); g.addColorStop(1, '#150b0e'); X.fillStyle = g; X.fillRect(0, 0, W, H);
        /* arched window of warm light */
        var wx = W/2, ww = Math.min(W*.34, H*.62), wt = H*.08, wb = H*.86;
        g = X.createLinearGradient(0, wt, 0, wb); g.addColorStop(0, 'rgba(242,210,122,.30)'); g.addColorStop(1, 'rgba(242,210,122,.05)');
        X.fillStyle = g; X.beginPath(); X.moveTo(wx-ww/2, wb); X.lineTo(wx-ww/2, wt+ww/2); X.arc(wx, wt+ww/2, ww/2, Math.PI, 0); X.lineTo(wx+ww/2, wb); X.closePath(); X.fill();
        X.strokeStyle = 'rgba(155,116,85,.55)'; X.lineWidth = Math.max(2, ww*.03);
        X.beginPath(); X.moveTo(wx, wt); X.lineTo(wx, wb); X.moveTo(wx-ww/2, wt+ww*.95); X.lineTo(wx+ww/2, wt+ww*.95); X.stroke();
        /* bookshelves either side */
        for(var sdx = -1; sdx <= 1; sdx += 2){ var sx0 = sdx < 0 ? 0 : W - W*.27, sw2 = W*.27;
          X.fillStyle = 'rgba(80,50,36,.55)'; X.fillRect(sx0, H*.12, sw2, H);
          for(var row = 0; row < 4; row++){ var ry = H*.14 + row*H*.2; X.fillStyle = 'rgba(40,24,18,.9)'; X.fillRect(sx0, ry + H*.17, sw2, Math.max(3, H*.018));
            var bxp = sx0 + 4, seed = row*13 + (sdx > 0 ? 50 : 0);
            while(bxp < sx0 + sw2 - 6){ var bw = 6 + rnd(seed)*10, bh = H*.12 + rnd(seed+1)*H*.05, cs = [[134,72,60],[96,120,90],[150,112,60],[86,70,100],[170,140,96]][Math.floor(rnd(seed+2)*5)];
              X.fillStyle = rgb(shade(cs, .7)); X.fillRect(bxp, ry + H*.17 - bh, bw - 1.5, bh); bxp += bw; seed += 3; } } }
        g = X.createRadialGradient(W/2, H*.42, 0, W/2, H*.42, H*.9); g.addColorStop(0, 'rgba(255,214,140,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)'); X.fillStyle = g; X.fillRect(0, 0, W, H);
      } else if(C.bg === 'mountain'){
        g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a1a24'); g.addColorStop(.5, '#5a2e2a'); g.addColorStop(1, '#1c1013'); X.fillStyle = g; X.fillRect(0, 0, W, H);
        X.fillStyle = 'rgba(255,214,140,.5)'; X.beginPath(); X.arc(W*.2, H*.42, Math.min(W, H)*.08, 0, 7); X.fill();
        X.fillStyle = '#3a2228'; X.beginPath(); X.moveTo(0, H*.7); X.lineTo(W*.22, H*.3); X.lineTo(W*.4, H*.55); X.lineTo(W*.62, H*.18); X.lineTo(W*.86, H*.5); X.lineTo(W, H*.36); X.lineTo(W, H); X.lineTo(0, H); X.closePath(); X.fill();
        X.fillStyle = 'rgba(251,241,226,.85)'; X.beginPath(); X.moveTo(W*.62, H*.18); X.lineTo(W*.68, H*.27); X.lineTo(W*.64, H*.25); X.lineTo(W*.6, H*.29); X.lineTo(W*.56, H*.26); X.closePath(); X.fill();
        X.beginPath(); X.moveTo(W*.22, H*.3); X.lineTo(W*.26, H*.37); X.lineTo(W*.22, H*.35); X.lineTo(W*.18, H*.37); X.closePath(); X.fill();
        X.fillStyle = '#26151a'; X.beginPath(); X.moveTo(0, H*.82); X.lineTo(W*.3, H*.62); X.lineTo(W*.55, H*.78); X.lineTo(W*.8, H*.6); X.lineTo(W, H*.74); X.lineTo(W, H); X.lineTo(0, H); X.closePath(); X.fill();
      } else if(C.bg === 'water'){
        g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1c2c34'); g.addColorStop(.55, '#16232b'); g.addColorStop(1, '#0c151a'); X.fillStyle = g; X.fillRect(0, 0, W, H);
        X.fillStyle = 'rgba(232,220,196,.85)'; X.beginPath(); X.arc(W*.78, H*.16, Math.min(W, H)*.06, 0, 7); X.fill();
        var mg = X.createRadialGradient(W*.78, H*.16, 0, W*.78, H*.16, H*.4); mg.addColorStop(0, 'rgba(232,220,196,.18)'); mg.addColorStop(1, 'rgba(232,220,196,0)'); X.fillStyle = mg; X.fillRect(0, 0, W, H);
        var wl = H*.52; X.fillStyle = '#101b22'; X.fillRect(0, wl, W, H - wl);
        for(var k = 0; k < 14; k++){ var wy = wl + 6 + k*k*1.6, ph = RM ? 0 : T*.0012 + k;
          X.strokeStyle = 'rgba(232,220,196,' + (.12 - k*.006) + ')'; X.lineWidth = 1.2; X.beginPath(); X.moveTo(W*.78 - 30 - k*4 + Math.sin(ph)*6, wy); X.lineTo(W*.78 + 30 + k*4 + Math.sin(ph)*6, wy); X.stroke(); }
        for(var pp = 0; pp < 5; pp++){ var px = W*(.08 + pp*.21); X.fillStyle = '#3a2c20'; X.fillRect(px - 5, wl - H*.12, 10, H*.5); X.fillStyle = '#5a4430'; X.fillRect(px - 6, wl - H*.13, 12, 5); }
        X.fillStyle = '#6b5540'; X.fillRect(0, wl - H*.14, W, H*.03);
      } else if(C.bg === 'library'){
        g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d3128'); g.addColorStop(1, '#0f1a15'); X.fillStyle = g; X.fillRect(0, 0, W, H);
        /* tall shelves behind, books in green, oxblood and ochre */
        var cols = Math.max(3, Math.round(W/90)), cw = W/cols;
        for(var c2 = 0; c2 < cols; c2++){ var x0 = c2*cw;
          X.fillStyle = 'rgba(40,26,16,.75)'; X.fillRect(x0 + 2, 0, cw - 4, H);
          for(var r2 = 0; r2 < 5; r2++){ var ry2 = H*.06 + r2*H*.19; X.fillStyle = 'rgba(20,12,8,.95)'; X.fillRect(x0, ry2 + H*.16, cw, Math.max(3, H*.016));
            var bx2 = x0 + 5, sd = c2*31 + r2*7;
            while(bx2 < x0 + cw - 7){ var bw2 = 5 + rnd(sd)*9, bh2 = H*.1 + rnd(sd + 1)*H*.05, cc = [[60,96,70],[110,40,34],[150,112,50],[46,70,90],[120,98,70]][Math.floor(rnd(sd + 2)*5)];
              X.fillStyle = rgb(shade(cc, .62)); X.fillRect(bx2, ry2 + H*.16 - bh2, bw2 - 1.2, bh2); bx2 += bw2; sd += 3; } } }
        /* green-shaded banker's lamp glow from above */
        g = X.createRadialGradient(W*.5, -H*.05, 0, W*.5, -H*.05, H*1.0); g.addColorStop(0, 'rgba(255,215,154,.30)'); g.addColorStop(.5, 'rgba(255,215,154,.08)'); g.addColorStop(1, 'rgba(0,0,0,0)'); X.fillStyle = g; X.fillRect(0, 0, W, H);
        var vg2 = X.createRadialGradient(W/2, H*.55, H*.2, W/2, H*.55, H*.9); vg2.addColorStop(0, 'rgba(0,0,0,0)'); vg2.addColorStop(1, 'rgba(0,0,0,.45)'); X.fillStyle = vg2; X.fillRect(0, 0, W, H);
      } else {
        g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#22121a'); g.addColorStop(1, '#130a0d'); X.fillStyle = g; X.fillRect(0, 0, W, H);
        /* throne silhouette */
        var tw = Math.min(W*.3, H*.55), tx = W/2, tb = H*.95;
        X.fillStyle = 'rgba(90,40,40,.55)'; X.beginPath(); X.moveTo(tx-tw/2, tb); X.lineTo(tx-tw/2, H*.3);
        X.quadraticCurveTo(tx-tw*.5, H*.12, tx-tw*.2, H*.15); X.lineTo(tx, H*.06); X.lineTo(tx+tw*.2, H*.15); X.quadraticCurveTo(tx+tw*.5, H*.12, tx+tw/2, H*.3); X.lineTo(tx+tw/2, tb); X.closePath(); X.fill();
        X.fillStyle = 'rgba(230,182,85,.35)'; crown(tx, H*.2, tw*.16);
        /* banners */
        for(var b2 = -1; b2 <= 1; b2 += 2){ var bxx = W/2 + b2*W*.36, bwd = Math.min(W*.12, H*.22), sway = RM ? 0 : Math.sin(T*.0012 + b2)*bwd*.04;
          X.fillStyle = '#7a2a1f'; X.beginPath(); X.moveTo(bxx-bwd/2, H*.02); X.lineTo(bxx+bwd/2, H*.02); X.lineTo(bxx+bwd/2+sway, H*.6); X.lineTo(bxx+sway, H*.52); X.lineTo(bxx-bwd/2+sway, H*.6); X.closePath(); X.fill();
          X.fillStyle = 'rgba(230,182,85,.85)'; crown(bxx + sway*.5, H*.24, bwd*.28);
          /* torch glow */
          var fl = RM ? 1 : .85 + Math.sin(T*.013 + b2*3)*.08 + Math.sin(T*.031 + b2)*.06, gx = W/2 + b2*W*.47;
          g = X.createRadialGradient(gx, H*.5, 0, gx, H*.5, H*.5*fl); g.addColorStop(0, 'rgba(255,170,90,.28)'); g.addColorStop(1, 'rgba(255,170,90,0)'); X.fillStyle = g; X.fillRect(0, 0, W, H); }
      }
      /* floor glow and shadow under the host */
      g = X.createRadialGradient(W/2, H, 0, W/2, H, H*.7); g.addColorStop(0, 'rgba(230,182,85,.16)'); g.addColorStop(1, 'rgba(230,182,85,0)'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    }
    function crown(x, y, s){ X.beginPath(); X.moveTo(x-s, y+s*.6); X.lineTo(x-s, y-s*.2); X.lineTo(x-s*.5, y+s*.15); X.lineTo(x, y-s*.55); X.lineTo(x+s*.5, y+s*.15); X.lineTo(x+s, y-s*.2); X.lineTo(x+s, y+s*.6); X.closePath(); X.fill(); }

    /* ---------- the character, drawn in "units": 1 unit = H/200, origin bottom centre ---------- */
    function circle(x, y, r){ X.beginPath(); X.arc(x, y, r, 0, 7); X.fill(); }
    function arm(side, P, T){
      var sx = side*33, sy = -78, L1 = 30, L2 = 28;
      var tx = side < 0 ? P.lx : P.rx, ty = side < 0 ? P.ly : P.ry;
      if(!RM){ tx += Math.sin(T*.0017 + side)*1.2; ty += Math.cos(T*.0021 + side)*1.2; }
      var dx = tx - sx, dy = ty - sy, d = Math.sqrt(dx*dx + dy*dy), maxd = L1 + L2 - .5;
      if(d > maxd){ dx *= maxd/d; dy *= maxd/d; d = maxd; }
      if(d < 6){ d = 6; }
      var base = Math.atan2(dy, dx), k = Math.acos(Math.max(-1, Math.min(1, (L1*L1 + d*d - L2*L2)/(2*L1*d))));
      var e1x = sx + Math.cos(base + k)*L1, e1y = sy + Math.sin(base + k)*L1, e2x = sx + Math.cos(base - k)*L1, e2y = sy + Math.sin(base - k)*L1;
      /* elbow goes outwards, away from the body */
      var ex = e1x*side > e2x*side ? e1x : e2x, ey = e1x*side > e2x*side ? e1y : e2y;
      var hx = sx + dx, hy = sy + dy;
      X.lineCap = 'round'; X.lineJoin = 'round';
      X.strokeStyle = rgb(shade(C.sleeve, .8)); X.lineWidth = 15;
      X.beginPath(); X.moveTo(sx, sy); X.lineTo(ex, ey); X.lineTo(hx, hy); X.stroke();
      X.strokeStyle = rgb(C.sleeve); X.lineWidth = 12.5;
      X.beginPath(); X.moveTo(sx, sy); X.lineTo(ex, ey); X.lineTo(hx, hy); X.stroke();
      var cxp = ex + (hx-ex)*.8, cyp = ey + (hy-ey)*.8;
      X.fillStyle = rgb(C.cuff); circle(cxp, cyp, 7);
      if(side > 0) drawProp(P, T, hx, hy);
      X.save(); X.translate(hx, hy); X.rotate(Math.atan2(hy-ey, hx-ex) - Math.PI/2);
      X.fillStyle = rgb(C.skin); X.beginPath(); X.ellipse(0, 3, 6.2, 7.4, 0, 0, 7); X.fill();
      X.fillStyle = rgb(shade(C.skin, .85)); X.beginPath(); X.ellipse(side*-4.6, 1, 2.2, 4, side*.6, 0, 7); X.fill();
      if((side > 0 && P.finger > .5) || (side < 0 && P.finger < -.5)){ X.fillStyle = rgb(C.skin); X.beginPath(); X.ellipse(0, 11, 2.1, 6.5, 0, 0, 7); X.fill(); }
      X.restore();
    }
    function drawProp(P, T, hx, hy){
      if(P.finger > .5) return;
      X.save(); X.translate(hx, hy);
      if(C.prop === 'mic'){
        X.rotate(.18 - P.prop*.3);
        X.fillStyle = '#2a1a14'; X.beginPath(); X.moveTo(-2.4, 6); X.lineTo(2.4, 6); X.lineTo(3.2, -14); X.lineTo(-3.2, -14); X.closePath(); X.fill();
        X.fillStyle = '#e6b655'; X.fillRect(-3.6, -16, 7.2, 2.6);
        var g = X.createRadialGradient(-2, -23, 1, 0, -21, 8); g.addColorStop(0, '#efe4d6'); g.addColorStop(1, '#8c7466');
        X.fillStyle = g; X.beginPath(); X.arc(0, -21, 6.8, 0, 7); X.fill();
        X.strokeStyle = 'rgba(42,26,20,.35)'; X.lineWidth = .7;
        for(var i = -4.5; i <= 4.5; i += 2.25){ X.beginPath(); X.moveTo(i, -26.5 + Math.abs(i)*.4); X.lineTo(i, -15.5 - Math.abs(i)*.4); X.stroke(); }
      } else if(C.prop === 'book'){
        X.rotate(-.15 + P.prop*.25); X.translate(0, -6);
        X.fillStyle = '#7a2a1f'; X.fillRect(-12, -9, 24, 17);
        X.fillStyle = '#fbf1e2'; X.fillRect(-11, -8, 10.4, 14.5); X.fillRect(.6, -8, 10.4, 14.5);
        X.strokeStyle = 'rgba(122,42,31,.35)'; X.lineWidth = .7;
        for(var j = -5; j <= 3; j += 2.6){ X.beginPath(); X.moveTo(-9.5, j); X.lineTo(-2.5, j); X.moveTo(2.5, j); X.lineTo(9.5, j); X.stroke(); }
        X.fillStyle = '#e6b655'; X.fillRect(4, 6, 2, 7);
      } else if(C.prop === 'axe'){
        X.rotate(.2 + P.prop*.5);
        X.strokeStyle = '#6b4a2e'; X.lineWidth = 3.4; X.lineCap = 'round'; X.beginPath(); X.moveTo(0, 10); X.lineTo(0, -32); X.stroke();
        X.fillStyle = '#c2c8cc'; X.beginPath(); X.moveTo(-3, -34); X.lineTo(14, -36); X.lineTo(16, -32); X.lineTo(3, -30); X.lineTo(-12, -28); X.lineTo(-13, -31); X.closePath(); X.fill();
        X.fillStyle = '#8a9296'; X.fillRect(-2.2, -36, 4.4, 6); X.fillStyle = '#c2c8cc'; X.beginPath(); X.moveTo(-1.4, 10); X.lineTo(0, 15); X.lineTo(1.4, 10); X.fill();
      } else if(C.prop === 'lantern'){
        var sw = RM ? 0 : Math.sin(T*.004)*.12; X.rotate(sw);
        X.strokeStyle = '#3a2a20'; X.lineWidth = 1.6; X.beginPath(); X.moveTo(0, 2); X.lineTo(0, 8); X.stroke();
        X.fillStyle = '#2a1c16'; X.fillRect(-7, 8, 14, 3); X.fillRect(-7, 27, 14, 3);
        var lg = X.createRadialGradient(0, 19, 1, 0, 19, 22); lg.addColorStop(0, 'rgba(255,214,140,.55)'); lg.addColorStop(1, 'rgba(255,214,140,0)'); X.fillStyle = lg; X.beginPath(); X.arc(0, 19, 22, 0, 7); X.fill();
        X.fillStyle = 'rgba(255,226,160,.92)'; X.fillRect(-5.5, 11, 11, 16);
        X.strokeStyle = '#2a1c16'; X.lineWidth = 1.4; X.strokeRect(-5.5, 11, 11, 16); X.beginPath(); X.moveTo(0, 11); X.lineTo(0, 27); X.stroke();
        X.fillStyle = '#ffb347'; X.beginPath(); X.ellipse(0, 20, 2, 3.4, 0, 0, 7); X.fill();
      } else if(C.prop === 'glass'){
        X.rotate(.25 + P.prop*.5);
        X.strokeStyle = '#3a2418'; X.lineWidth = 4; X.lineCap = 'round'; X.beginPath(); X.moveTo(0, 6); X.lineTo(0, -16); X.stroke();
        X.strokeStyle = '#d9b25a'; X.lineWidth = 3.2; X.beginPath(); X.arc(0, -27, 10.5, 0, 7); X.stroke();
        X.fillStyle = 'rgba(200,230,255,.28)'; X.beginPath(); X.arc(0, -27, 9, 0, 7); X.fill();
        X.fillStyle = 'rgba(255,255,255,.6)'; X.beginPath(); X.ellipse(-3.5, -31, 3, 1.6, -.6, 0, 7); X.fill();
      } else if(C.prop === 'trumpet'){
        X.rotate(.35 + P.prop*.45);
        X.strokeStyle = '#e6b655'; X.lineWidth = 3; X.lineCap = 'round'; X.beginPath(); X.moveTo(0, 6); X.lineTo(0, -36); X.stroke();
        X.fillStyle = '#e6b655'; X.beginPath(); X.moveTo(-2, -34); X.lineTo(2, -34); X.lineTo(9, -47); X.lineTo(-9, -47); X.closePath(); X.fill();
        X.fillStyle = '#f2d27a'; X.beginPath(); X.ellipse(0, -47, 9, 2.6, 0, 0, 7); X.fill();
        X.fillStyle = '#c4502e'; X.beginPath(); X.moveTo(1.5, -10); X.lineTo(15, -11); X.lineTo(14, -24); X.lineTo(9, -21); X.lineTo(1.5, -25); X.closePath(); X.fill();
        X.fillStyle = '#e6b655'; crown(8, -17, 3.2);
      }
      X.restore();
    }
    function torso(P){
      var c = C.coat;
      X.fillStyle = rgb(c);
      X.beginPath(); X.moveTo(-36, -80); X.quadraticCurveTo(-44, -40, -50, 6); X.lineTo(50, 6); X.quadraticCurveTo(44, -40, 36, -80);
      X.quadraticCurveTo(0, -90, -36, -80); X.fill();
      X.fillStyle = rgb(C.coatDark, .55); X.beginPath(); X.moveTo(12, -84); X.quadraticCurveTo(40, -70, 50, 6); X.lineTo(26, 6); X.closePath(); X.fill();
      if(C.tabard){
        X.fillStyle = rgb(C.shirt); X.beginPath(); X.moveTo(-10, -86); X.lineTo(10, -86); X.lineTo(0, -72); X.closePath(); X.fill();
        X.fillStyle = rgb(C.lapel); X.fillRect(-23, -78, 4, 84); X.fillRect(19, -78, 4, 84);
        X.fillStyle = rgb(C.lapel); crown(0, -46, 11);
        X.fillStyle = rgb(C.coatDark); X.beginPath(); X.arc(0, -44, 2.2, 0, 7); X.fill();
        return;
      }
      /* shirt V and lapels */
      X.fillStyle = rgb(C.shirt); X.beginPath(); X.moveTo(-15, -86); X.lineTo(15, -86); X.lineTo(0, -38); X.closePath(); X.fill();
      X.fillStyle = rgb(C.lapel);
      X.beginPath(); X.moveTo(-17, -86); X.lineTo(-2, -42); X.lineTo(-14, -30); X.lineTo(-30, -78); X.closePath(); X.fill();
      X.beginPath(); X.moveTo(17, -86); X.lineTo(2, -42); X.lineTo(14, -30); X.lineTo(30, -78); X.closePath(); X.fill();
      if(C.tie){ X.fillStyle = rgb(C.tie);
        X.beginPath(); X.moveTo(0, -80); X.lineTo(-10, -85); X.lineTo(-10, -75); X.closePath(); X.fill();
        X.beginPath(); X.moveTo(0, -80); X.lineTo(10, -85); X.lineTo(10, -75); X.closePath(); X.fill();
        X.fillStyle = rgb(shade(C.tie, .78)); circle(0, -80, 2.6); }
      if(C.brooch){ X.fillStyle = '#e6b655'; circle(-21, -60, 3.2); X.fillStyle = '#d9694f'; circle(-21, -60, 1.5); }
      /* buttons */
      if(C.zip){ X.strokeStyle = '#6b2a1c'; X.lineWidth = 1.6; X.beginPath(); X.moveTo(0, -84); X.lineTo(0, 6); X.stroke(); }
      if(C.rope){ X.strokeStyle = '#d8c39c'; X.lineWidth = 4.5; X.lineCap = 'round'; X.beginPath(); X.moveTo(-30, -80); X.quadraticCurveTo(0, -40, 34, -2); X.stroke();
        X.strokeStyle = '#a8906a'; X.lineWidth = 1.2; X.setLineDash([3, 4]); X.beginPath(); X.moveTo(-30, -80); X.quadraticCurveTo(0, -40, 34, -2); X.stroke(); X.setLineDash([]); }
      if(C.buttons){ X.fillStyle = '#d8a23c'; [-62,-48,-34,-20].forEach(function(yy){ circle(-9, yy, 2.2); circle(9, yy, 2.2); }); }
      else { X.fillStyle = rgb(shade(C.coat, .7)); circle(0, -30, 1.8); circle(0, -16, 1.8); }
    }
    function head(P, T, opts){
      opts = opts || {};
      var hx = P.look*4, hy = -116, R = 25, st = C.hairStyle;
      X.save(); X.translate(hx, hy); X.rotate(P.tilt);
      /* neck */
      if(!opts.noNeck){ X.fillStyle = rgb(shade(C.skin, .82)); X.fillRect(-7, 14, 14, 16); }
      /* hair and coverings behind the face */
      X.fillStyle = rgb(C.hair);
      if(st === 'ponytail'){ var ps = RM ? 0 : Math.sin(T*.004)*3;
        X.beginPath(); X.moveTo(14, -18); X.quadraticCurveTo(40 + ps, -10, 30 + ps, 26); X.quadraticCurveTo(26, 6, 10, -6); X.fill(); }
      if(st === 'bun'){ circle(0, -R*1.02, R*.42); X.fillStyle = rgb(shade(C.hair, .88)); circle(-3, -R*1.06, R*.2); }
      if(st === 'afro'){ X.beginPath(); X.ellipse(0, -R*.42, R*1.32, R*1.12, 0, 0, 7); X.fill();
        X.fillStyle = rgb(mix(C.hair, [80,60,50], .18)); for(var q = 0; q < 14; q++){ var aa = q/14*Math.PI*2; circle(Math.cos(aa)*R*1.12, -R*.42 + Math.sin(aa)*R*.94, R*.2); } }
      if(st === 'long'){ X.beginPath(); X.moveTo(-R*1.05, -R*.2); X.quadraticCurveTo(-R*1.25, R*.9, -R*1.05, R*1.55); X.lineTo(R*1.05, R*1.55); X.quadraticCurveTo(R*1.25, R*.9, R*1.05, -R*.2); X.closePath(); X.fill(); }
      if(st === 'hijab'){ var hc = C.wrap;
        X.fillStyle = rgb(shade(hc, .85)); X.beginPath(); X.moveTo(-R*1.25, R*.2); X.quadraticCurveTo(-R*1.5, R*1.5, -R*1.6, R*2.3); X.lineTo(R*1.6, R*2.3); X.quadraticCurveTo(R*1.5, R*1.5, R*1.25, R*.2); X.closePath(); X.fill();
        X.fillStyle = rgb(hc); X.beginPath(); X.ellipse(0, -R*.12, R*1.24, R*1.3, 0, 0, 7); X.fill(); }
      /* ears */
      var covered = st === 'hijab' || st === 'turban';
      if(!covered || st === 'turban'){ X.fillStyle = rgb(C.skin); circle(-R*.97, 2, 5.2); circle(R*.97, 2, 5.2);
        if(C.earrings && !covered){ X.fillStyle = '#e6b655'; circle(-R*.98, 9, 2); circle(R*.98, 9, 2); } }
      /* face */
      var fw = st === 'hijab' ? R*.88 : R;
      X.fillStyle = rgb(C.skin); X.beginPath(); X.ellipse(0, 0, fw, R*1.08, 0, 0, 7); X.fill();
      X.save(); X.beginPath(); X.ellipse(0, 0, fw, R*1.08, 0, 0, 7); X.clip();
      X.fillStyle = rgb(shade(C.skin, .86), .7); X.beginPath(); X.ellipse(R*.55, R*.25, R*.8, R*1.1, 0, 0, 7); X.fill(); X.restore();
      /* hair in front */
      X.fillStyle = rgb(C.hair);
      if(st === 'short'){ X.beginPath(); X.ellipse(0, -R*.42, R*1.02, R*.72, 0, Math.PI*1.02, Math.PI*1.98); X.quadraticCurveTo(R*.5, -R*.86, 0, -R*.78); X.quadraticCurveTo(-R*.6, -R*.86, -R*1.0, -R*.4); X.fill();
        X.fillRect(-R*1.0, -R*.48, 4, R*.5); X.fillRect(R*1.0 - 4, -R*.48, 4, R*.5); }
      else if(st === 'bun'){ X.beginPath(); X.moveTo(-R*1.04, R*.1); X.quadraticCurveTo(-R*1.2, -R*1.05, 0, -R*1.0); X.quadraticCurveTo(R*1.2, -R*1.05, R*1.04, R*.1);
        X.quadraticCurveTo(R*.9, -R*.55, R*.2, -R*.62); X.quadraticCurveTo(-R*.1, -R*.45, -R*.5, -R*.58); X.quadraticCurveTo(-R*.95, -R*.5, -R*1.04, R*.1); X.fill(); }
      else if(st === 'ponytail'){ X.beginPath(); X.moveTo(-R*1.03, R*.05); X.quadraticCurveTo(-R*1.15, -R*1.1, 0, -R*1.04); X.quadraticCurveTo(R*1.15, -R*1.1, R*1.03, R*.05);
        X.quadraticCurveTo(R*.75, -R*.72, -R*.15, -R*.66); X.quadraticCurveTo(-R*.85, -R*.6, -R*1.03, R*.05); X.fill(); }
      else if(st === 'afro'){ X.beginPath(); X.moveTo(-R*1.02, -R*.05); X.quadraticCurveTo(-R*.9, -R*.75, 0, -R*.72); X.quadraticCurveTo(R*.9, -R*.75, R*1.02, -R*.05); X.lineTo(R*1.1, -R*.7); X.lineTo(-R*1.1, -R*.7); X.closePath(); X.fill(); }
      else if(st === 'long'){ X.beginPath(); X.moveTo(-R*1.04, R*.5); X.quadraticCurveTo(-R*1.2, -R*1.1, 0, -R*1.04); X.quadraticCurveTo(R*1.2, -R*1.1, R*1.04, R*.5);
        X.quadraticCurveTo(R*.85, -R*.3, R*.08, -R*.72); X.quadraticCurveTo(-R*.85, -R*.3, -R*1.04, R*.5); X.fill(); }
      else if(st === 'sidepart'){ X.beginPath(); X.moveTo(-R*1.02, -R*.15); X.quadraticCurveTo(-R*1.1, -R*1.12, R*.1, -R*1.06); X.quadraticCurveTo(R*1.15, -R*1.0, R*1.02, -R*.15);
        X.quadraticCurveTo(R*.9, -R*.62, R*.35, -R*.66); X.quadraticCurveTo(-R*.2, -R*.5, -R*.62, -R*.62); X.quadraticCurveTo(-R*.95, -R*.55, -R*1.02, -R*.15); X.fill();
        X.strokeStyle = rgb(shade(C.hair, 1.8), .35); X.lineWidth = 1.2; X.beginPath(); X.moveTo(-R*.35, -R*1.02); X.quadraticCurveTo(-R*.1, -R*.8, R*.3, -R*.7); X.stroke(); }
      else if(st === 'curly'){ for(var cq = 0; cq < 11; cq++){ var ca = Math.PI*(1.05 + cq*.09); circle(Math.cos(ca)*R*.86, -R*.2 + Math.sin(ca)*R*.86, R*.27); } circle(0, -R*.78, R*.32); }
      else if(st === 'bald'){ X.fillStyle = rgb(C.hair); X.beginPath(); X.ellipse(-R*.92, -R*.12, R*.16, R*.3, .2, 0, 7); X.fill(); X.beginPath(); X.ellipse(R*.92, -R*.12, R*.16, R*.3, -.2, 0, 7); X.fill();
        X.fillStyle = 'rgba(255,255,255,.16)'; X.beginPath(); X.ellipse(-R*.3, -R*.7, R*.25, R*.12, -.4, 0, 7); X.fill(); }
      else if(st === 'hijab'){ X.fillStyle = rgb(C.wrap); X.beginPath(); X.moveTo(-R*.95, R*.2); X.quadraticCurveTo(-R*1.0, -R*1.05, 0, -R*1.06); X.quadraticCurveTo(R*1.0, -R*1.05, R*.95, R*.2);
        X.quadraticCurveTo(R*.86, -R*.42, 0, -R*.5); X.quadraticCurveTo(-R*.86, -R*.42, -R*.95, R*.2); X.fill();
        X.strokeStyle = rgb(shade(C.wrap, .75)); X.lineWidth = 1.2; X.beginPath(); X.moveTo(-R*.7, -R*.62); X.quadraticCurveTo(0, -R*.72, R*.7, -R*.62); X.stroke(); }
      else if(st === 'turban'){ var tc = C.turban || [30,58,96];
        X.fillStyle = rgb(tc); X.beginPath(); X.moveTo(-R*1.04, -R*.12); X.quadraticCurveTo(-R*1.18, -R*1.3, 0, -R*1.38); X.quadraticCurveTo(R*1.18, -R*1.3, R*1.04, -R*.12);
        X.quadraticCurveTo(R*.6, -R*.5, 0, -R*.46); X.quadraticCurveTo(-R*.6, -R*.5, -R*1.04, -R*.12); X.fill();
        X.strokeStyle = rgb(shade(tc, 1.5), .5); X.lineWidth = 1.6;
        X.beginPath(); X.moveTo(-R*.95, -R*.4); X.quadraticCurveTo(-R*.2, -R*1.1, R*.6, -R*1.2); X.stroke();
        X.beginPath(); X.moveTo(-R*.8, -R*.75); X.quadraticCurveTo(0, -R*1.3, R*.8, -R*.8); X.stroke();
        X.beginPath(); X.moveTo(-R*.15, -R*.5); X.lineTo(0, -R*.9); X.lineTo(R*.15, -R*.5); X.stroke(); }
      /* facial hair, drawn under the mouth */
      if(C.facial === 'goatee'){ X.fillStyle = rgb(C.hair, .9); X.beginPath(); X.ellipse(0, R*.82, R*.34, R*.2, 0, 0, Math.PI); X.fill(); }
      if(C.facial === 'full' || C.facial === 'fullgrey'){ X.fillStyle = rgb(C.facial === 'fullgrey' ? C.hair : C.hair);
        X.beginPath(); X.moveTo(-R*.95, R*.05); X.quadraticCurveTo(-R*.95, R*1.35, 0, R*1.42); X.quadraticCurveTo(R*.95, R*1.35, R*.95, R*.05);
        X.quadraticCurveTo(R*.7, R*.55, R*.3, R*.45); X.quadraticCurveTo(0, R*.4, -R*.3, R*.45); X.quadraticCurveTo(-R*.7, R*.55, -R*.95, R*.05); X.fill();
        X.beginPath(); X.ellipse(0, R*.48, R*.34, R*.09, 0, 0, 7); X.fill(); }
      /* eyes */
      var ey = -R*.02, ex = R*.38, blink = !RM && T > blinkAt && T < blinkAt + 130, px = (P.look*.35 + saccade)*R*.12;
      for(var s2 = -1; s2 <= 1; s2 += 2){
        var x0 = s2*ex;
        if(blink || P.squint > .7){ X.strokeStyle = rgb(shade(C.hair, .5)); X.lineWidth = 2.4; X.lineCap = 'round'; X.beginPath();
          if(P.squint > .7 && !blink) X.arc(x0, ey + 3, R*.16, Math.PI*1.15, Math.PI*1.85); else X.arc(x0, ey - 1, R*.16, .25, Math.PI - .25); X.stroke(); }
        else { var oh = R*.2*(1 - P.squint*.45);
          X.fillStyle = '#fbf6ee'; X.beginPath(); X.ellipse(x0, ey, R*.17, oh, 0, 0, 7); X.fill();
          X.fillStyle = rgb(C.iris); circle(x0 + px, ey + 1, R*.1);
          X.fillStyle = '#1c1013'; circle(x0 + px, ey + 1, R*.055);
          X.fillStyle = '#fff'; circle(x0 + px + 2, ey - 1.5, R*.03);
          if(C.lashes){ X.strokeStyle = '#1c1013'; X.lineWidth = 1.4; X.lineCap = 'round'; X.beginPath(); X.moveTo(x0 + s2*R*.15, ey - oh*.55); X.lineTo(x0 + s2*R*.24, ey - oh*.95); X.stroke(); }
          if(P.squint > .05){ X.fillStyle = rgb(C.skin); X.beginPath(); X.ellipse(x0, ey + oh*1.55, R*.2, oh*.9, 0, 0, 7); X.fill(); } }
        if(C.older){ X.strokeStyle = rgb(shade(C.skin, .74)); X.lineWidth = 1; X.beginPath(); X.moveTo(x0 + s2*R*.26, ey + 1); X.lineTo(x0 + s2*R*.36, ey - 2); X.moveTo(x0 + s2*R*.26, ey + 4); X.lineTo(x0 + s2*R*.36, ey + 5); X.stroke(); }
      }
      if(C.glasses){ X.strokeStyle = '#7a5a3a'; X.lineWidth = 1.8; for(var g2 = -1; g2 <= 1; g2 += 2){ X.beginPath(); X.arc(g2*ex, ey, R*.27, 0, 7); X.stroke(); }
        X.beginPath(); X.moveTo(-ex + R*.27, ey); X.quadraticCurveTo(0, ey - 3, ex - R*.27, ey); X.stroke();
        X.fillStyle = 'rgba(255,255,255,.22)'; X.beginPath(); X.ellipse(-ex - 3, ey - 4, 2.4, 1.2, -.6, 0, 7); X.fill(); X.beginPath(); X.ellipse(ex - 3, ey - 4, 2.4, 1.2, -.6, 0, 7); X.fill(); }
      /* brows */
      var browCol = (st === 'bun' || st === 'bald') ? shade(C.hair, .7) : (st === 'hijab' || st === 'turban') ? [40,28,24] : shade(C.hair, .95);
      X.strokeStyle = rgb(browCol); X.lineWidth = 3; X.lineCap = 'round';
      var by = ey - R*.34 - P.brow*R*.12;
      for(var b = -1; b <= 1; b += 2){ var inner = b*ex - b*R*.15, outer = b*ex + b*R*.15;
        X.beginPath(); X.moveTo(outer, by + P.worry*R*.05); X.lineTo(inner, by - P.worry*R*.12); X.stroke(); }
      /* nose */
      X.strokeStyle = rgb(shade(C.skin, .72)); X.lineWidth = 1.8; X.beginPath(); X.moveTo(1, ey + R*.16); X.quadraticCurveTo(-4, ey + R*.36, 2, ey + R*.38); X.stroke();
      /* freckles and cheeks */
      if(C.freckles){ X.fillStyle = 'rgba(176,96,60,.55)'; [[-.55,.22],[-.45,.3],[-.62,.32],[.55,.22],[.45,.3],[.62,.32],[-.12,.18],[.1,.2]].forEach(function(f){ circle(f[0]*R, f[1]*R, .9); }); }
      if(P.smile > .4){ X.fillStyle = rgb([217,105,79], (P.smile - .4)*.28); circle(-R*.55, R*.36, R*.16); circle(R*.55, R*.36, R*.16); }
      if(C.older){ X.strokeStyle = rgb(shade(C.skin, .78)); X.lineWidth = 1; X.beginPath(); X.moveTo(-R*.42, R*.4); X.quadraticCurveTo(-R*.48, R*.58, -R*.38, R*.72); X.moveTo(R*.42, R*.4); X.quadraticCurveTo(R*.48, R*.58, R*.38, R*.72); X.stroke(); }
      /* mouth */
      var my = R*.6, o = Math.max(P.open, mouth), mw = R*(.27 + Math.max(0, P.smile)*.1);
      if(o > .06){ var mh = R*(.06 + o*.3);
        X.fillStyle = '#4a1a24'; X.beginPath(); X.moveTo(-mw, my - P.smile*2); X.quadraticCurveTo(0, my + mh*2 + P.smile*3, mw, my - P.smile*2); X.quadraticCurveTo(0, my - mh*.4, -mw, my - P.smile*2); X.fill();
        X.fillStyle = '#fbf6ee'; X.beginPath(); X.moveTo(-mw*.8, my - P.smile*2 + .5); X.quadraticCurveTo(0, my + mh*.5, mw*.8, my - P.smile*2 + .5); X.quadraticCurveTo(0, my - mh*.2, -mw*.8, my - P.smile*2 + .5); X.fill();
        if(o > .4){ X.fillStyle = '#c2565f'; X.beginPath(); X.ellipse(0, my + mh*1.15, mw*.45, mh*.4, 0, 0, 7); X.fill(); } }
      else { X.strokeStyle = rgb(C.lip); X.lineWidth = 2.4; X.lineCap = 'round'; X.beginPath(); X.moveTo(-mw, my - P.smile*1.5); X.quadraticCurveTo(0, my + P.smile*7, mw, my - P.smile*1.5); X.stroke(); }
      /* the herald's cap */
      if(C.hat === 'beanie'){ var by2 = st === 'afro' ? -R*1.25 : st === 'bun' ? -R*.98 : -R*.7;
        X.fillStyle = '#e6b655'; X.beginPath(); X.arc(0, by2 - R*.05, R*.98, Math.PI, 0); X.fill();
        X.fillStyle = 'rgba(0,0,0,.12)'; for(var rb = -3; rb <= 3; rb++){ X.fillRect(rb*R*.26 - 1, by2 - R*.8, 2, R*.75); }
        X.fillStyle = '#c99a3c'; X.fillRect(-R*1.0, by2 - R*.08, R*2.0, R*.28);
        X.fillStyle = '#fbf1e2'; X.beginPath(); X.arc(0, by2 - R*1.0, R*.2, 0, 7); X.fill(); }
      if(C.hat === 'captain'){ var hy = st === 'afro' ? -R*1.3 : st === 'bun' ? -R*1.02 : -R*.8;
        X.fillStyle = '#e8dcc4'; X.beginPath(); X.ellipse(0, hy - R*.18, R*1.02, R*.34, 0, 0, 7); X.fill();
        X.fillStyle = '#d6c8ae'; X.fillRect(-R*.92, hy - R*.2, R*1.84, R*.26);
        X.fillStyle = '#1c2a30'; X.fillRect(-R*.95, hy + R*.04, R*1.9, R*.16);
        X.fillStyle = '#121c20'; X.beginPath(); X.ellipse(R*.05, hy + R*.24, R*.92, R*.16, 0, 0, Math.PI); X.fill();
        X.fillStyle = '#d8a23c'; X.beginPath(); X.arc(0, hy - R*.06, R*.11, 0, 7); X.fill();
        X.strokeStyle = '#d8a23c'; X.lineWidth = 1.4; X.beginPath(); X.moveTo(-R*.85, hy + R*.12); X.lineTo(R*.85, hy + R*.12); X.stroke(); }
      if(C.hat === 'cap'){ var capY = st === 'afro' ? -R*1.35 : st === 'bun' ? -R*1.0 : -R*.82;
        X.fillStyle = '#7a2a1f'; X.beginPath(); X.ellipse(-2, capY, R*1.0, R*.36, -.12, 0, 7); X.fill();
        X.fillStyle = '#e6b655'; X.fillRect(-R*.95, capY + R*.04, R*1.8, 3.2);
        X.save(); X.translate(R*.55, capY - R*.13); X.rotate(.9 + (RM ? 0 : Math.sin(T*.003)*.08)); X.fillStyle = '#fbf1e2'; X.beginPath(); X.ellipse(0, -10, 3.6, 12, 0, 0, 7); X.fill();
        X.strokeStyle = 'rgba(194,169,154,.8)'; X.lineWidth = .8; X.beginPath(); X.moveTo(0, 1); X.lineTo(0, -21); X.stroke(); X.restore(); }
      /* sweat drop on a wince */
      if(sweat > 0 && T - sweat < 1600){ var k = (T - sweat)/1600; X.fillStyle = 'rgba(180,220,235,' + (1 - k) + ')';
        X.beginPath(); X.moveTo(R*.95, -R*.4 + k*10); X.quadraticCurveTo(R*1.2, -R*.05 + k*10, R*.95, R*.05 + k*10); X.quadraticCurveTo(R*.72, -R*.05 + k*10, R*.95, -R*.4 + k*10); X.fill(); }
      X.restore();
    }

    /* a head-and-shoulders portrait for the host picker */
    function portrait(){
      isPortrait = true;
      if(!W){ size(); if(!W) return; }
      X.clearRect(0, 0, W, H);
      var g = X.createRadialGradient(W/2, H*.4, 0, W/2, H*.4, W*.7); g.addColorStop(0, '#3a2228'); g.addColorStop(1, '#1c1013'); X.fillStyle = g; X.fillRect(0, 0, W, H);
      var U = H/92; X.save(); X.translate(W/2, H*.56); X.scale(U, U); X.translate(0, 116);
      X.fillStyle = rgb(C.coat); X.beginPath(); X.moveTo(-36, -80); X.quadraticCurveTo(0, -92, 36, -80); X.lineTo(44, -40); X.lineTo(-44, -40); X.closePath(); X.fill();
      head(POSES.calm, 0, {});
      X.restore();
    }

    function render(T){
      if(!W){ size(); if(!W) return; }
      X.clearRect(0, 0, W, H);
      if(!opts.transparent) backdrop(T);
      var P = cur;
      var U = H/188, bob = RM ? 0 : Math.sin(T*.0024)*.9, hop = P.hop*(RM ? 0 : Math.abs(Math.sin(T*.012))*7);
      X.save(); X.translate(W/2, H + 4); X.scale(U, U);
      /* shadow */
      X.fillStyle = 'rgba(0,0,0,.35)'; X.beginPath(); X.ellipse(0, 2, 58, 7, 0, 0, 7); X.fill();
      X.translate(0, -hop + bob); X.rotate(P.lean);
      torso(P);
      head(P, T);
      arm(-1, P, T);
      arm(1, P, T);
      /* confetti, in host units */
      for(var i = confetti.length - 1; i >= 0; i--){ var c = confetti[i];
        c.x += c.vx; c.y += c.vy; c.vy += .16; c.vx *= .99; c.r += c.vr; c.life -= .008;
        if(c.life <= 0){ confetti.splice(i, 1); continue; }
        X.save(); X.translate(c.x, c.y); X.rotate(c.r); X.fillStyle = rgb(c.c, Math.min(1, c.life*2)); X.fillRect(-c.w/2, -1.6, c.w, 3.2); X.restore(); }
      X.restore();
    }

    function tick(ts){
      var dt = Math.min(50, ts - (lastT || ts)); lastT = ts;
      if(!stepAt) stepAt = ts;
      if(mode === 'reel'){ var st = REEL[ri]; if(target !== POSES[st.p]){ target = POSES[st.p]; if(st.say) talkUntil = ts + 1400; if(st.p === 'celebrate') burst(); }
        if(ts - stepAt > st.d){ ri = (ri + 1) % REEL.length; stepAt = ts; } }
      /* springy pose motion */
      var k = .06*C.energy, d = .74;
      FIELDS.forEach(function(f){ var a = (target[f] - cur[f])*k; vel[f] = (vel[f] + a)*d; cur[f] += vel[f]*(dt/16.7); });
      /* talking: syllables of different sizes */
      if(ts < talkUntil){ if(ts > nextSyl){ mouthTarget = Math.random() < .2 ? 0 : .25 + Math.random()*.6; nextSyl = ts + 80 + Math.random()*90; } }
      else mouthTarget = 0;
      mouth += (mouthTarget - mouth)*.45;
      if(ts > blinkAt + 130) blinkAt = ts + 1800 + Math.random()*2600;
      if(ts > nextSacc){ saccade = (Math.random() - .5)*.8; nextSacc = ts + 900 + Math.random()*1800; }
      render(ts);
      requestAnimationFrame(tick);
    }

    function start(){ if(started) return; started = true; size();
      if(RM){ FIELDS.forEach(function(f){ cur[f] = POSES.welcome[f]; }); render(0); setTimeout(function(){ size(); render(now()); }, 350); return; }
      requestAnimationFrame(tick); }

    return {
      start: start,
      set: function(name){ hold = name; mode = 'pose'; setPose(name); },
      reel: function(){ if(mode === 'reel') return; mode = 'reel'; ri = 0; stepAt = 0; },
      say: function(ms){ talkUntil = now() + (ms || 1500); },
      resize: size,
      person: function(){ return personId; },
      setPerson: function(id, keep){ if(!PEOPLE[id]) return; personId = id; C = compose(who, id); if(!keep) savePerson(who, id); if(RM) render(now()); },
      portrait: portrait
    };
  }

  window.TBHost = {
    create: function(canvas, bubble, who, person, opts){ return Host(canvas, bubble, who, person, opts); },
    people: ORDER.slice(), defaults: DEFAULT, saved: savedPerson,
    /* draw a small portrait of one person dressed for one show into a canvas */
    portrait: function(canvas, who, person){ var h = Host(canvas, null, who, person); h.portrait(); return h; },
    /* build a row of tappable faces that switches the given host */
    picker: function(container, host, who){
      container.innerHTML = '';
      ORDER.forEach(function(id){
        var b = document.createElement('button'); b.type = 'button'; b.className = 'tb-face'; b.setAttribute('aria-pressed', host.person() === id ? 'true' : 'false');
        b.setAttribute('aria-label', 'Host ' + (ORDER.indexOf(id) + 1));
        var cv = document.createElement('canvas'); b.appendChild(cv); container.appendChild(b);
        requestAnimationFrame(function(){ window.TBHost.portrait(cv, who, id); });
        b.addEventListener('click', function(){ host.setPerson(id); [].forEach.call(container.children, function(x){ x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); });
      });
    }
  };

  function boot(){
    var cv = document.getElementById(CANVAS_ID); if(!cv) return;
    var h = Host(cv, document.getElementById(BUBBLE_ID), WHO);
    var pk = document.querySelector('[data-host-picker]'); if(pk) window.TBHost.picker(pk, h, WHO);
    window.HOST = h;
    if(document.fonts && document.fonts.ready){ document.fonts.ready.then(h.start); setTimeout(h.start, 400); } else h.start();
  }
  if(me && me.hasAttribute('data-host')){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
})();
