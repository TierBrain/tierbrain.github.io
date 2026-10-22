/* TierBrain quiz family: the shared look.
   A living, themed backdrop for each game, a richer card and answer style, hearts for lives,
   a streak meter, level banners, bursts for right answers, a shake for wrong ones, stars and
   confetti at the end, and a bigger layout on a TV.

   It reads the page rather than changing how a game plays, so every game keeps its own rules.
   Load with: <script src="tb-quiz.js?v=1" data-theme="climb" defer></script>
   Themes: climb, higher, odd, lie, fact, match, scramble, recall, shot, clues.
   Optional: data-stars="0" for games scored in points rather than right answers. */
(function(){
  'use strict';
  var S = document.currentScript || document.querySelector('script[src*="tb-quiz.js"]');
  var THEME = (S && S.getAttribute('data-theme')) || 'climb';
  var STARS = !(S && S.getAttribute('data-stars') === '0');
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $ = function(id){ return document.getElementById(id); };
  function rnd(n){ var x = Math.sin(n*127.1 + 311.7)*43758.5453; return x - Math.floor(x); }
  function clamp(x, a, b){ return x < a ? a : x > b ? b : x; }

  /* each game's colours: base sky, accent, second accent */
  var PAL = {
    climb:   { a:'#2a1840', b:'#1a0e18', acc:'#e6b655', acc2:'#86bf9d' },
    higher:  { a:'#10283a', b:'#150d14', acc:'#7fc8e8', acc2:'#e6b655' },
    odd:     { a:'#1f2a1a', b:'#140c10', acc:'#a8d08d', acc2:'#e8765f' },
    lie:     { a:'#1a1f33', b:'#100a10', acc:'#e8a55a', acc2:'#e8765f' },
    fact:    { a:'#14302b', b:'#2a1216', acc:'#86bf9d', acc2:'#e8765f' },
    match:   { a:'#22163a', b:'#120b14', acc:'#b9a4ff', acc2:'#e6b655' },
    scramble:{ a:'#2e1f12', b:'#140c0c', acc:'#f2c87a', acc2:'#d98b4a' },
    recall:  { a:'#161a30', b:'#100a12', acc:'#8fb8ff', acc2:'#e6b655' },
    shot:    { a:'#14281c', b:'#120b0e', acc:'#e9d27a', acc2:'#d9694f' },
    clues:   { a:'#2a1d14', b:'#120a0b', acc:'#e6b655', acc2:'#c94f4f' }
  }[THEME] || { a:'#2a1840', b:'#1a0e18', acc:'#e6b655', acc2:'#86bf9d' };

  /* ================= styles ================= */
  var css = [
    'body.tbq{background:linear-gradient(170deg,' + PAL.a + ',' + PAL.b + ') fixed !important;}',
    '#tbqSky,#tbqFx{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;display:block;}',
    '#tbqSky{z-index:-1;} #tbqFx{z-index:60;}',
    /* the HUD */
    'body.tbq #hud{position:relative;z-index:2;gap:8px;}',
    'body.tbq .lvlpill{box-shadow:0 0 0 2px rgba(255,255,255,.08),0 6px 16px rgba(0,0,0,.35);transition:background .4s;}',
    '.tbq-tier{display:inline-flex;gap:2px;align-items:flex-end;height:16px;margin-left:-3px;}',
    '.tbq-tier i{display:block;width:4px;border-radius:2px;background:rgba(255,255,255,.14);transition:background .3s,box-shadow .3s;}',
    '.tbq-tier i:nth-child(1){height:5px}.tbq-tier i:nth-child(2){height:9px}.tbq-tier i:nth-child(3){height:12px}.tbq-tier i:nth-child(4){height:16px}',
    '.tbq-tier i.on{background:' + PAL.acc + ';box-shadow:0 0 8px ' + PAL.acc + '88;}',
    'body.tbq #strikes{flex-direction:row-reverse;gap:3px;}',
    'body.tbq .strike{width:17px;height:15px;border:0;border-radius:0;background:#e8765f;box-shadow:none;' +
      '-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 22\'%3E%3Cpath d=\'M12 21s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12z\'/%3E%3C/svg%3E") center/contain no-repeat;' +
      'mask:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 22\'%3E%3Cpath d=\'M12 21s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12z\'/%3E%3C/svg%3E") center/contain no-repeat;' +
      'transition:background .3s,transform .3s;}',
    'body.tbq .strike.used{background:rgba(255,255,255,.16);box-shadow:none;}',
    'body.tbq .strike.tbq-lost{animation:tbqLost .6s ease;}',
    '@keyframes tbqLost{0%{transform:scale(1.5);background:#ff5d5d}60%{transform:scale(.8)}100%{transform:scale(1)}}',
    '.tbq-streak{display:inline-flex;align-items:center;gap:4px;font:900 14px "Baloo 2",Nunito,sans-serif;color:#ffcf7a;padding:3px 10px;border-radius:999px;' +
      'background:rgba(255,140,40,.14);border:1px solid rgba(255,170,80,.35);transition:transform .2s,opacity .25s;}',
    '.tbq-streak[hidden]{display:none;}',
    '.tbq-streak.pop{animation:tbqPop .45s ease;}',
    '@keyframes tbqPop{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}',
    'body.tbq #xStreak{display:none !important;}',
    '.tbq-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:24px;}',
    '.tbq-row .tbq-streak{padding:1px 9px;font-size:13px;}',
    'body.tbq .timer{background:rgba(0,0,0,.28);padding:3px 11px 3px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.08);}',
    'body.tbq .progwrap{height:10px;background:rgba(0,0,0,.35);box-shadow:inset 0 1px 2px rgba(0,0,0,.5);}',
    'body.tbq .progbar{background:linear-gradient(90deg,' + PAL.acc2 + ',' + PAL.acc + ');box-shadow:0 0 12px ' + PAL.acc + '66;}',
    /* the question card and answers */
    'body.tbq .qbox{position:relative;background:linear-gradient(180deg,rgba(52,32,40,.92),rgba(30,18,24,.94));border:1px solid rgba(255,255,255,.08);' +
      'box-shadow:0 18px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06);overflow:hidden;}',
    'body.tbq .qbox::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,' + PAL.acc2 + ',' + PAL.acc + ');opacity:.9;}',
    'body.tbq .qbox.tbq-in{animation:tbqCard .45s cubic-bezier(.2,1.2,.4,1) both;}',
    '@keyframes tbqCard{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}',
    'body.tbq .opt{background:linear-gradient(180deg,rgba(50,30,38,.94),rgba(36,22,28,.94));border-color:rgba(255,255,255,.09);box-shadow:0 4px 0 rgba(0,0,0,.28);}',
    '@media (hover:hover){ body.tbq .opts:not(.locked) .opt:not(.correct):not(.wrong):not(.chosen):hover:not(:disabled){border-color:' + PAL.acc + '99;transform:translateY(-1px);} }',
    'body.tbq .opts.tbq-in .opt{animation:tbqOpt .38s cubic-bezier(.2,1.1,.4,1) both;}',
    'body.tbq .opts.tbq-in .opt:nth-child(2){animation-delay:.05s}body.tbq .opts.tbq-in .opt:nth-child(3){animation-delay:.1s}body.tbq .opts.tbq-in .opt:nth-child(4){animation-delay:.15s}',
    '@keyframes tbqOpt{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}',
    'body.tbq .opt .key{color:#1c1013;font-weight:800;}',
    'body.tbq .opt:nth-child(1) .key{background:#e6b655}body.tbq .opt:nth-child(2) .key{background:#86bf9d}body.tbq .opt:nth-child(3) .key{background:#a99af0}body.tbq .opt:nth-child(4) .key{background:#e8916f}',
    'body.tbq .opt.correct{background:linear-gradient(180deg,rgba(64,128,94,.55),rgba(40,92,66,.55));border-color:#86bf9d;box-shadow:0 0 0 2px #86bf9d,0 0 24px rgba(134,191,157,.45);animation:tbqGood .5s ease;}',
    'body.tbq .opt.wrong{background:linear-gradient(180deg,rgba(150,52,52,.5),rgba(110,36,40,.5));border-color:#e8765f;}',
    'body.tbq .opt.chosen{background:linear-gradient(180deg,rgba(120,90,30,.45),rgba(90,64,20,.45));border-color:#e6b655;}',
    'body.tbq .opt.correct .key{background:#86bf9d;}body.tbq .opt.wrong .key{background:#e8765f;}',
    'body.tbq .opt.wrong{animation:tbqBad .45s ease;}',
    '@keyframes tbqGood{0%{transform:scale(1)}35%{transform:scale(1.04)}100%{transform:scale(1)}}',
    '@keyframes tbqBad{0%,100%{transform:none}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}',
    'body.tbq #toast{display:none !important;}',
    'body.tbq .reveal.show{color:#f1dfcf;}',
    /* level banner and a quick shake for a wrong answer */
    '.tbq-banner{position:fixed;left:50%;top:22%;z-index:70;transform:translate(-50%,-50%) scale(.6);opacity:0;pointer-events:none;text-align:center;' +
      'padding:14px 30px 12px;border-radius:20px;background:rgba(20,10,14,.88);border:2px solid currentColor;box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 40px currentColor;}',
    '.tbq-banner b{display:block;font:800 clamp(28px,8vw,46px)/1 "Baloo 2",Nunito,sans-serif;color:#fff8ea;text-shadow:0 2px 0 rgba(0,0,0,.3);}',
    '.tbq-banner span{display:block;margin-top:4px;font:800 14px Nunito,sans-serif;letter-spacing:.14em;text-transform:uppercase;}',
    '.tbq-banner.show{animation:tbqBanner 1.7s cubic-bezier(.2,1.2,.4,1) both;}',
    '@keyframes tbqBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}15%{opacity:1;transform:translate(-50%,-50%) scale(1.06)}25%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-62%) scale(.96)}}',
    'body.tbq #app.tbq-shake{animation:tbqShake .38s ease;}',
    '@keyframes tbqShake{0%,100%{transform:none}25%{transform:translateX(-6px)}50%{transform:translateX(5px)}75%{transform:translateX(-3px)}}',
    '.tbq-flash{position:fixed;inset:0;z-index:59;pointer-events:none;background:radial-gradient(circle at 50% 50%,transparent 45%,rgba(232,80,80,.35));opacity:0;}',
    '.tbq-flash.on{animation:tbqFlash .5s ease;}',
    '@keyframes tbqFlash{0%{opacity:0}25%{opacity:1}100%{opacity:0}}',
    /* start and end screens */
    'body.tbq .screen{background:linear-gradient(170deg,rgba(26,14,20,.86),rgba(18,10,14,.92));backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);}',
    '.tbq-emblem{display:block;width:150px;height:96px;margin:0 auto -6px;}',
    'body.tbq button.cta.blue{background:linear-gradient(180deg,#e0a458,#c98a3e);box-shadow:0 7px 0 #8a5f0a,0 12px 26px rgba(224,164,88,.35);color:#fff;}',
    'body.tbq .namebox{max-width:min(380px,100%);} body.tbq .namebox input{min-width:0;}',
    'body.tbq .rules{background:rgba(0,0,0,.28);border-color:rgba(255,255,255,.08);}',
    '.tbq-stars{display:flex;gap:10px;justify-content:center;margin:-4px 0 2px;}',
    '.tbq-stars i{width:40px;height:38px;background:rgba(255,255,255,.14);' +
      '-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 23\'%3E%3Cpath d=\'M12 1l3.4 7 7.6 1.1-5.5 5.4 1.3 7.6L12 18.5 5.2 22.1l1.3-7.6L1 9.1 8.6 8z\'/%3E%3C/svg%3E") center/contain no-repeat;' +
      'mask:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 23\'%3E%3Cpath d=\'M12 1l3.4 7 7.6 1.1-5.5 5.4 1.3 7.6L12 18.5 5.2 22.1l1.3-7.6L1 9.1 8.6 8z\'/%3E%3C/svg%3E") center/contain no-repeat;}',
    '.tbq-stars i.on{background:linear-gradient(180deg,#ffe08a,#e6a43a);animation:tbqStar .5s cubic-bezier(.2,1.6,.4,1) both;}',
    '.tbq-stars i:nth-child(2).on{animation-delay:.25s}.tbq-stars i:nth-child(3).on{animation-delay:.5s}',
    '@keyframes tbqStar{from{transform:scale(0) rotate(-40deg)}to{transform:none}}',
    '.tbq-verdict{font:800 15px Nunito,sans-serif;color:#f2d27a;margin-top:-6px;}',
    '@media (prefers-reduced-motion: reduce){ .tbq-banner.show{animation-duration:2.2s;} body.tbq #app.tbq-shake, body.tbq .opt.wrong, body.tbq .opt.correct{animation:none;} }'
  ].join('\n');

  function boot(){
    if(document.body.classList.contains('tbq')) return;
    document.body.classList.add('tbq', 'tbq-' + THEME);
    var st = document.createElement('style'); st.id = 'tbq-style'; st.textContent = css; document.head.appendChild(st);
    sky(); fx(); hud(); watch(); emblem(); tv();
  }

  /* ================= the living backdrop ================= */
  var prog = 0, progShown = 0, pulse = 0;
  function sky(){
    var cv = document.createElement('canvas'); cv.id = 'tbqSky'; cv.setAttribute('aria-hidden', 'true'); document.body.insertBefore(cv, document.body.firstChild);
    var X = cv.getContext('2d'), W = 0, H = 0, last = 0;
    function size(){ var d = Math.min(1.5, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W*d); cv.height = Math.round(H*d); X.setTransform(d, 0, 0, d, 0, 0); paint(performance.now()); }
    function paint(T){
      if(RM) T = 0;
      progShown += (prog - progShown)*.06; pulse *= .95;
      X.clearRect(0, 0, W, H);
      (THEMES[THEME] || THEMES.climb)(X, W, H, T, progShown);
      var v = X.createRadialGradient(W/2, H*.45, Math.min(W, H)*.3, W/2, H*.5, Math.max(W, H)*.8);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)'); X.fillStyle = v; X.fillRect(0, 0, W, H);
      if(pulse > .01){ X.fillStyle = 'rgba(255,240,200,' + (pulse*.06) + ')'; X.fillRect(0, 0, W, H); }
    }
    window.addEventListener('resize', size); size();
    (function loop(now){ requestAnimationFrame(loop); if(document.hidden || RM) return; if(now - last < 40) return; last = now; paint(now); })(0);
  }
  function glow(X, x, y, r, col, a){ var g = X.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); X.fillStyle = g; X.beginPath(); X.arc(x, y, r, 0, 7); X.fill(); }
  function hexA(h, a){ h = h.replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
  function stars(X, W, H, T, n, a){ for(var i = 0; i < n; i++){ var tw = .5 + .5*Math.sin(T*.0015 + i*1.7); X.fillStyle = 'rgba(255,245,225,' + (a*(.3 + .7*tw)) + ')'; X.fillRect(rnd(i)*W, rnd(i + 99)*H*.7, 1.6, 1.6); } }
  function rr(X, x, y, w, h, r){ X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }

  var THEMES = {
    /* Quiz Climb: a night mountain; a lantern lights on the path for every question you get through */
    climb: function(X, W, H, T, p){
      stars(X, W, H, T, 90, .7);
      glow(X, W*.78, H*.18, Math.min(W, H)*.22, '#fff2c8', .12);
      X.fillStyle = 'rgba(255,240,210,.85)'; X.beginPath(); X.arc(W*.78, H*.18, Math.min(W, H)*.035, 0, 7); X.fill();
      X.fillStyle = '#24152a'; X.beginPath(); X.moveTo(0, H); X.lineTo(0, H*.7); X.lineTo(W*.2, H*.55); X.lineTo(W*.32, H*.62); X.lineTo(W*.5, H*.28); X.lineTo(W*.68, H*.6); X.lineTo(W*.8, H*.52); X.lineTo(W, H*.68); X.lineTo(W, H); X.fill();
      X.fillStyle = 'rgba(250,244,236,.75)'; X.beginPath(); X.moveTo(W*.5, H*.28); X.lineTo(W*.545, H*.355); X.lineTo(W*.52, H*.345); X.lineTo(W*.5, H*.37); X.lineTo(W*.475, H*.345); X.lineTo(W*.455, H*.355); X.closePath(); X.fill();
      var path = []; for(var i = 0; i <= 20; i++){ var u = i/20; path.push([W*.5 + Math.sin(u*Math.PI*4.5)*W*.13*(1 - u*.7), H*(.98 - u*.66)]); }
      X.strokeStyle = 'rgba(230,182,85,.18)'; X.setLineDash([4, 6]); X.lineWidth = 2; X.beginPath(); path.forEach(function(q, k){ k ? X.lineTo(q[0], q[1]) : X.moveTo(q[0], q[1]); }); X.stroke(); X.setLineDash([]);
      var lit = p*20;
      path.forEach(function(q, k){ if(k === 0) return; var on = k <= lit + .01, cur = Math.abs(k - Math.ceil(lit + .01)) < .5;
        if(on){ glow(X, q[0], q[1], 22, PAL.acc, .5); X.fillStyle = '#ffe3a0'; } else X.fillStyle = cur ? 'rgba(255,227,160,' + (.35 + .3*Math.sin(T*.006)) + ')' : 'rgba(255,255,255,.12)';
        X.beginPath(); X.arc(q[0], q[1], on ? 4 : 3, 0, 7); X.fill(); });
      X.fillStyle = '#e6b655'; X.strokeStyle = '#3a2420'; X.lineWidth = 2; X.beginPath(); X.moveTo(W*.5, H*.28); X.lineTo(W*.5, H*.22); X.stroke();
      X.beginPath(); X.moveTo(W*.5, H*.22); X.lineTo(W*.5 + 22, H*.23 + Math.sin(T*.006)*2); X.lineTo(W*.5, H*.245); X.closePath(); X.fill();
    },
    /* Higher or Lower: a skyline of bars rising and falling, with a measuring scale */
    higher: function(X, W, H, T, p){
      X.strokeStyle = 'rgba(127,200,232,.07)'; X.lineWidth = 1; for(var y = H*.12; y < H; y += H*.08){ X.beginPath(); X.moveTo(0, y); X.lineTo(W, y); X.stroke(); }
      var n = Math.max(14, Math.round(W/46)), bw = W/n;
      for(var i = 0; i < n; i++){ var h = H*(.18 + .4*rnd(i) + .08*Math.sin(T*.0007 + i*1.3)), x = i*bw + bw*.16;
        var g = X.createLinearGradient(0, H - h, 0, H); g.addColorStop(0, hexA(i % 3 ? PAL.acc : PAL.acc2, .22)); g.addColorStop(1, hexA(i % 3 ? PAL.acc : PAL.acc2, .03));
        X.fillStyle = g; X.fillRect(x, H - h, bw*.68, h); X.fillStyle = hexA(i % 3 ? PAL.acc : PAL.acc2, .45); X.fillRect(x, H - h, bw*.68, 2); }
      for(i = 0; i < 9; i++){ var up = i % 2 === 0, ph = ((T*.00005*(1 + rnd(i)) + rnd(i*3)) % 1), ax = rnd(i*7)*W, ay = up ? H*(1 - ph) : H*ph;
        X.fillStyle = hexA(up ? '#86bf9d' : '#e8765f', .16*Math.sin(ph*Math.PI)); X.beginPath();
        if(up){ X.moveTo(ax, ay - 12); X.lineTo(ax + 10, ay + 6); X.lineTo(ax - 10, ay + 6); } else { X.moveTo(ax, ay + 12); X.lineTo(ax + 10, ay - 6); X.lineTo(ax - 10, ay - 6); } X.fill(); }
    },
    /* Odd One Out: rows of matching discs; now and then one changes shape and glows */
    odd: function(X, W, H, T, p){
      var sp = Math.max(70, Math.min(W, H)/7), cols = Math.ceil(W/sp) + 1, rows = Math.ceil(H/sp) + 1, cyc = Math.floor(T/2600), odd = Math.floor(rnd(cyc)*cols*rows), k = (T % 2600)/2600, show = Math.sin(k*Math.PI);
      for(var r = 0; r < rows; r++) for(var c = 0; c < cols; c++){ var id = r*cols + c, x = c*sp + (r % 2)*sp/2 + Math.sin(T*.0006 + id)*6, y = r*sp + Math.cos(T*.0005 + id)*6;
        if(id === odd){ glow(X, x, y, sp*.45, PAL.acc2, .25*show); X.fillStyle = hexA(PAL.acc2, .18 + .3*show); X.save(); X.translate(x, y); X.rotate(show*.8); X.fillRect(-sp*.13, -sp*.13, sp*.26, sp*.26); X.restore(); }
        else { X.fillStyle = hexA(PAL.acc, .1); X.beginPath(); X.arc(x, y, sp*.14, 0, 7); X.fill(); } }
    },
    /* Spot the Lie: light through blinds, drifting smoke and a polygraph trace */
    lie: function(X, W, H, T, p){
      X.save(); X.translate(W*.1, -H*.1); X.rotate(-.35);
      for(var i = 0; i < 9; i++){ var y = i*H*.13 + (T*.01 % (H*.13)); X.fillStyle = hexA(PAL.acc, .05); X.fillRect(-W*.5, y, W*2, H*.05); } X.restore();
      for(i = 0; i < 6; i++){ var sx = ((rnd(i)*W + T*.012*(1 + rnd(i*2))) % (W + 400)) - 200, sy = H*(.2 + rnd(i*5)*.6); glow(X, sx, sy, 160 + rnd(i)*120, '#c8c8d8', .05); }
      X.strokeStyle = hexA(PAL.acc2, .35); X.lineWidth = 2; X.beginPath(); var base = H*.88;
      for(var x = 0; x <= W; x += 4){ var tt = x*.02 - T*.004, spike = Math.exp(-Math.pow(((x/W*3 + T*.0002) % 3) - 1.5, 2)*30), y2 = base + Math.sin(tt)*6 + Math.sin(tt*3.1)*3 + Math.sin(x*.5)*spike*28;
        x ? X.lineTo(x, y2) : X.moveTo(x, y2); } X.stroke();
    },
    /* Fact or Fiction: a true side and a false side, with ticks and crosses drifting */
    fact: function(X, W, H, T, p){
      var wob = Math.sin(T*.0008)*W*.03;
      X.fillStyle = 'rgba(134,191,157,.10)'; X.beginPath(); X.moveTo(0, 0); X.lineTo(W*.62 + wob, 0); X.lineTo(W*.38 - wob, H); X.lineTo(0, H); X.fill();
      X.fillStyle = 'rgba(232,118,95,.09)'; X.beginPath(); X.moveTo(W*.62 + wob, 0); X.lineTo(W, 0); X.lineTo(W, H); X.lineTo(W*.38 - wob, H); X.fill();
      X.lineCap = 'round'; X.lineWidth = 5;
      for(var i = 0; i < 14; i++){ var left = i % 2 === 0, ph = ((T*.00004*(1 + rnd(i)) + rnd(i*3)) % 1), x = left ? rnd(i*7)*W*.45 : W*.55 + rnd(i*7)*W*.45, y = H*(1.05 - ph*1.1), s = 14 + rnd(i)*16, a = .16*Math.sin(ph*Math.PI);
        X.strokeStyle = left ? 'rgba(134,191,157,' + a + ')' : 'rgba(232,118,95,' + a + ')'; X.beginPath();
        if(left){ X.moveTo(x - s*.6, y); X.lineTo(x - s*.1, y + s*.5); X.lineTo(x + s*.7, y - s*.5); } else { X.moveTo(x - s*.5, y - s*.5); X.lineTo(x + s*.5, y + s*.5); X.moveTo(x + s*.5, y - s*.5); X.lineTo(x - s*.5, y + s*.5); } X.stroke(); }
    },
    /* Match Up: a drifting constellation whose stars link up in pairs */
    match: function(X, W, H, T, p){
      var n = 34, P = [];
      for(var i = 0; i < n; i++) P.push([rnd(i)*W + Math.sin(T*.0003 + i)*30, rnd(i + 50)*H + Math.cos(T*.00025 + i*2)*30]);
      for(i = 0; i < n; i += 2){ var a = P[i], b = P[i + 1], ph = .5 + .5*Math.sin(T*.0012 + i); X.strokeStyle = hexA(i % 4 ? PAL.acc : PAL.acc2, .05 + .2*ph); X.lineWidth = 1.5;
        X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(a[0] + (b[0] - a[0])*ph, a[1] + (b[1] - a[1])*ph); X.stroke(); }
      P.forEach(function(q, k){ glow(X, q[0], q[1], 14, k % 4 < 2 ? PAL.acc : PAL.acc2, .3); X.fillStyle = 'rgba(255,250,240,.6)'; X.fillRect(q[0] - 1, q[1] - 1, 2.4, 2.4); });
    },
    /* Unscramble: letter tiles drifting down like slow snow */
    scramble: function(X, W, H, T, p){
      var L = 'ABCDEFGHIJKLMNOPRSTUWY', n = Math.round(W*H/26000);
      X.textAlign = 'center'; X.textBaseline = 'middle';
      for(var i = 0; i < n; i++){ var s = 22 + rnd(i)*26, ph = ((T*.00003*(1 + rnd(i*3)) + rnd(i*5)) % 1), x = rnd(i*7)*W + Math.sin(T*.0006 + i)*20, y = -s + ph*(H + s*2);
        X.save(); X.translate(x, y); X.rotate(Math.sin(T*.0005 + i)*.5); X.globalAlpha = .1 + .08*rnd(i*9);
        X.fillStyle = '#f2d6a2'; rr(X, -s/2, -s/2, s, s, s*.18); X.fill(); X.fillStyle = '#4a2c18'; X.font = '800 ' + (s*.6) + 'px "Baloo 2",Nunito,sans-serif'; X.fillText(L[i % L.length], 0, s*.04); X.restore(); }
    },
    /* Recall: four soft lights pulsing in turn */
    recall: function(X, W, H, T, p){
      var C = ['#e85d5d', '#4cc38a', '#e6c04a', '#5a8fe8'], seq = Math.floor(T/700), cur = Math.floor(rnd(seq)*4), k = (T % 700)/700;
      [[.18, .22], [.82, .22], [.18, .8], [.82, .8]].forEach(function(q, i){ var on = i === cur ? Math.sin(k*Math.PI) : 0; glow(X, W*q[0], H*q[1], Math.min(W, H)*(.35 + .1*on), C[i], .07 + .16*on); });
    },
    /* Call Your Shot: a great dartboard turning slowly, with darts landing */
    shot: function(X, W, H, T, p){
      var cx = W*.82, cy = H*.6, R = Math.max(W, H)*.45, rot = T*.00005;
      for(var s = 0; s < 20; s++){ var a0 = rot + s/20*Math.PI*2, a1 = a0 + Math.PI*2/20; X.fillStyle = s % 2 ? 'rgba(0,0,0,.12)' : 'rgba(233,210,122,.05)';
        X.beginPath(); X.moveTo(cx, cy); X.arc(cx, cy, R, a0, a1); X.closePath(); X.fill(); }
      [[1, PAL.acc2], [.62, PAL.acc], [.58, PAL.acc2], [.1, PAL.acc2]].forEach(function(r){ X.strokeStyle = hexA(r[1], .18); X.lineWidth = r[0] === .62 || r[0] === .58 ? 8 : 3; X.beginPath(); X.arc(cx, cy, R*r[0], 0, 7); X.stroke(); });
      for(var d = 0; d < 4; d++){ var cyc = Math.floor(T/3000 + d*.25), ph = ((T/3000 + d*.25) % 1), ang = rnd(cyc*4 + d)*Math.PI*2, dist = R*rnd(cyc*9 + d)*.8, tx = cx + Math.cos(ang)*dist, ty = cy + Math.sin(ang)*dist, fly = Math.min(1, ph*4);
        var x = tx - (1 - fly)*W*.4, y = ty - (1 - fly)*H*.2; X.strokeStyle = 'rgba(255,240,210,' + (.25*(1 - Math.max(0, ph - .7)/.3)) + ')'; X.lineWidth = 3; X.beginPath(); X.moveTo(x, y); X.lineTo(x - 26, y - 10); X.stroke(); }
    },
    /* Five Clues: a case board of pinned cards joined by red string, with a lens sweeping over it */
    clues: function(X, W, H, T, p){
      var n = 9, C = [];
      for(var i = 0; i < n; i++) C.push([W*(.08 + rnd(i)*.84) + Math.sin(T*.0003 + i)*4, H*(.08 + rnd(i + 20)*.84) + Math.cos(T*.0003 + i)*4, rnd(i*3) - .5]);
      X.strokeStyle = 'rgba(201,79,79,.22)'; X.lineWidth = 1.6; X.beginPath(); C.forEach(function(c, k){ k ? X.lineTo(c[0], c[1]) : X.moveTo(c[0], c[1]); }); X.stroke();
      C.forEach(function(c, k){ X.save(); X.translate(c[0], c[1]); X.rotate(c[2]*.3); X.fillStyle = 'rgba(244,232,208,.07)'; X.fillRect(-46, -30, 92, 60);
        X.strokeStyle = 'rgba(244,232,208,.08)'; for(var l = 0; l < 3; l++){ X.beginPath(); X.moveTo(-36, -12 + l*12); X.lineTo(30 - l*10, -12 + l*12); X.stroke(); }
        X.fillStyle = 'rgba(201,79,79,.5)'; X.beginPath(); X.arc(0, -30, 4, 0, 7); X.fill(); X.restore(); });
      var lx = W*(.5 + .4*Math.sin(T*.00025)), ly = H*(.5 + .3*Math.sin(T*.00037));
      glow(X, lx, ly, 120, '#fff4d6', .07); X.strokeStyle = 'rgba(230,182,85,.22)'; X.lineWidth = 6; X.beginPath(); X.arc(lx, ly, 70, 0, 7); X.stroke();
      X.lineWidth = 10; X.beginPath(); X.moveTo(lx + 50, ly + 50); X.lineTo(lx + 100, ly + 100); X.stroke();
    }
  };

  /* ================= bursts, sparks and confetti ================= */
  var FX = null, parts = [], running = false;
  function fx(){
    var cv = document.createElement('canvas'); cv.id = 'tbqFx'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv);
    var fl = document.createElement('div'); fl.className = 'tbq-flash'; fl.id = 'tbqFlash'; document.body.appendChild(fl);
    var X = cv.getContext('2d');
    function size(){ var d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(innerWidth*d); cv.height = Math.round(innerHeight*d); X.setTransform(d, 0, 0, d, 0, 0); }
    window.addEventListener('resize', size); size();
    FX = { X:X, cv:cv };
  }
  function run(){
    if(running) return; running = true;
    (function step(){
      var X = FX.X; X.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(function(p){ return p.life < p.max; });
      parts.forEach(function(p){ p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; var k = 1 - p.life/p.max;
        X.save(); X.globalAlpha = Math.min(1, k*1.6); X.translate(p.x, p.y); X.rotate(p.rot);
        if(p.text){ X.font = '900 ' + p.size + 'px "Baloo 2",Nunito,sans-serif'; X.textAlign = 'center'; X.fillStyle = p.col; X.strokeStyle = 'rgba(20,10,14,.7)'; X.lineWidth = 4; X.strokeText(p.text, 0, 0); X.fillText(p.text, 0, 0); }
        else if(p.kind === 'spark'){ X.fillStyle = p.col; X.beginPath(); X.arc(0, 0, p.size*k + .5, 0, 7); X.fill(); }
        else { X.fillStyle = p.col; X.fillRect(-p.size/2, -p.size/4, p.size, p.size/2); }
        X.restore(); });
      if(parts.length) requestAnimationFrame(step); else { running = false; X.clearRect(0, 0, innerWidth, innerHeight); }
    })();
  }
  var COLS = ['#e6b655', '#86bf9d', '#e8765f', '#a99af0', '#7fc8e8', '#f2d27a'];
  function burst(x, y, n, spread){
    if(RM || !FX) return;
    for(var i = 0; i < n; i++){ var a = Math.random()*Math.PI*2, sp = (spread || 5)*(.4 + Math.random());
      parts.push({ x:x, y:y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp - 2, g:.18, life:0, max:40 + Math.random()*25, rot:0, vr:0, size:2 + Math.random()*3, col:COLS[i % COLS.length], kind:'spark' }); }
    run();
  }
  function floatText(x, y, text, col, size){ if(!FX) return; parts.push({ x:x, y:y, vx:0, vy:-1.2, g:.012, life:0, max:RM ? 50 : 70, rot:0, vr:0, size:size || 26, col:col || '#ffe08a', text:text }); run(); }
  function confetti(n){
    if(RM || !FX) return;
    for(var i = 0; i < n; i++) parts.push({ x:Math.random()*innerWidth, y:-20 - Math.random()*innerHeight*.5, vx:(Math.random() - .5)*2, vy:2 + Math.random()*3, g:.04, life:0, max:160 + Math.random()*80, rot:Math.random()*6, vr:(Math.random() - .5)*.3, size:8 + Math.random()*6, col:COLS[i % COLS.length], kind:'paper' });
    run();
  }

  /* ================= the HUD: tier steps and a streak meter ================= */
  var tierEl = null, streakEl = null;
  function hud(){
    var pill = $('lvlPill'); if(!pill) return;
    tierEl = document.createElement('span'); tierEl.className = 'tbq-tier'; tierEl.setAttribute('aria-hidden', 'true'); tierEl.innerHTML = '<i></i><i></i><i></i><i></i>';
    pill.parentNode.insertBefore(tierEl, pill.nextSibling);
    streakEl = document.createElement('span'); streakEl.className = 'tbq-streak'; streakEl.hidden = true; streakEl.setAttribute('aria-live', 'polite');
    /* the streak sits on the line under the progress bar, beside "Question 3 of 20", so the HUD never wraps on a phone */
    var qc = $('qcount');
    if(qc){ var row = document.createElement('div'); row.className = 'tbq-row'; qc.parentNode.insertBefore(row, qc); row.appendChild(qc); row.appendChild(streakEl); }
    else pill.parentNode.appendChild(streakEl);
  }
  function levelOf(){ var p = $('lvlPill'); if(!p) return 1; var t = p.textContent.toUpperCase(); if(/LEGEND/.test(t)) return 4; var m = /(\d)/.exec(t); return m ? +m[1] : 1; }
  function levelName(){ var p = $('lvlPill'); return p ? p.textContent.replace(/^LEVEL\s*\d\s*[·:-]?\s*/i, '').trim() : ''; }
  function paintTier(){ if(!tierEl) return; var lv = levelOf(); [].forEach.call(tierEl.children, function(i, k){ i.classList.toggle('on', k < lv); }); }

  /* ================= watching the game ================= */
  var lastTap = null, streak = 0, best = 0, lastStrikes = 0, lastProg = 0, lastLevel = 1, playing = false, judgeT = 0;
  function rectOf(el){ try{ var r = el.getBoundingClientRect(); if(r.width) return r; }catch(e){} return null; }
  function strikesUsed(){ return document.querySelectorAll('#strikes .strike.used').length; }
  function progOf(){ var b = $('progbar'); if(!b) return 0; var w = parseFloat(b.style.width) || 0; return w/100; }
  function screenOpen(){ return [].some.call(document.querySelectorAll('.screen'), function(s){ return !s.classList.contains('hidden'); }); }

  function judge(){
    var s = strikesUsed(), p = progOf();
    if(p < lastProg - .01 || (p === 0 && lastProg > 0)){ /* a new run */ streak = 0; best = 0; lastStrikes = s; lastProg = p; lastLevel = levelOf(); paintStreak(); prog = p; return; }
    var lost = s > lastStrikes, moved = p > lastProg + .001;
    if(lost){ wrong(s); }
    else if(moved){ right(); }
    lastStrikes = s; lastProg = p; prog = p;
  }
  function anchor(){
    var el = lastTap && document.body.contains(lastTap) ? lastTap : (document.querySelector('.qbox') || $('app'));
    var r = el && rectOf(el); return r ? { x:r.left + r.width/2, y:r.top + r.height/2 } : { x:innerWidth/2, y:innerHeight/2 };
  }
  function right(){
    streak++; best = Math.max(best, streak); pulse = 1; var a = anchor();
    burst(a.x, a.y, 18 + Math.min(30, streak*4), 5 + Math.min(4, streak*.6));
    if(streak >= 3) floatText(a.x, a.y - 24, streak + ' in a row!', '#ffcf7a', 22 + Math.min(10, streak));
    if(streak === 5 || streak === 10 || streak === 15) banner(streak === 5 ? 'On fire!' : streak === 10 ? 'Unstoppable!' : 'Legendary!', streak + ' right in a row', '#ff9f43');
    paintStreak(true);
  }
  function wrong(s){
    streak = 0; paintStreak();
    var app = $('app'); if(app && !RM){ app.classList.remove('tbq-shake'); void app.offsetWidth; app.classList.add('tbq-shake'); }
    var fl = $('tbqFlash'); if(fl){ fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on'); }
    var hearts = document.querySelectorAll('#strikes .strike.used'), h = hearts[hearts.length - 1]; if(h){ h.classList.add('tbq-lost'); }
  }
  function paintStreak(pop){
    if(!streakEl) return; streakEl.hidden = streak < 2; streakEl.textContent = '🔥 ' + streak;
    streakEl.style.boxShadow = '0 0 ' + Math.min(24, streak*3) + 'px rgba(255,150,40,' + Math.min(.6, streak*.08) + ')';
    if(pop && streak >= 2){ streakEl.classList.remove('pop'); void streakEl.offsetWidth; streakEl.classList.add('pop'); }
  }
  var bannerEl = null;
  function banner(big, small, col){
    if(!bannerEl){ bannerEl = document.createElement('div'); bannerEl.className = 'tbq-banner'; bannerEl.setAttribute('role', 'status'); document.body.appendChild(bannerEl); }
    bannerEl.style.color = col || PAL.acc; bannerEl.innerHTML = '<b></b><span></span>'; bannerEl.firstChild.textContent = big; bannerEl.lastChild.textContent = small || '';
    bannerEl.classList.remove('show'); void bannerEl.offsetWidth; bannerEl.classList.add('show');
  }
  function levelChanged(){
    paintTier(); var lv = levelOf();
    if(!playing || screenOpen() || progOf() === 0){ lastLevel = lv; return; }
    var pill = $('lvlPill'), col = pill ? getComputedStyle(pill).backgroundColor : PAL.acc;
    if(lv > lastLevel){ banner('Level up!', levelName(), col); var r = pill && rectOf(pill); if(r) burst(r.left + r.width/2, r.top + r.height/2, 40, 7); }
    else if(lv < lastLevel){ banner('Level down', levelName(), col); }
    lastLevel = lv;
  }
  function screensChanged(){
    var open = screenOpen(); if(!open && !playing){ playing = true; lastStrikes = strikesUsed(); lastProg = progOf(); lastLevel = levelOf(); streak = 0; paintStreak(); }
    if(open) playing = false;
    var done = $('doneScreen'), out = $('outScreen');
    if(done && !done.classList.contains('hidden') && !done.dataset.tbq){ done.dataset.tbq = '1'; finish(done); }
    if(done && done.classList.contains('hidden')) delete done.dataset.tbq;
    if(out && !out.classList.contains('hidden') && !out.dataset.tbq){ out.dataset.tbq = '1'; }
    if(out && out.classList.contains('hidden')) delete out.dataset.tbq;
  }
  function finish(done){
    confetti(140);
    if(!STARS) return;
    var k;
    if(typeof window.tbqStars === 'function'){ try{ k = clamp(+window.tbqStars() || 0, 0, 3); }catch(e){ return; } }
    else {
      var c = $('doneCorr'), n = c ? parseInt(c.textContent, 10) : NaN, tot = 20;
      var m = /\/\s*(\d+)/.exec(done.textContent); if(m) tot = +m[1];
      if(isNaN(n)) return;
      var pct = n/tot; k = pct >= .95 ? 3 : pct >= .75 ? 2 : pct >= .45 ? 1 : 0;
    }
    var row = done.querySelector('.tbq-stars'); if(!row){ row = document.createElement('div'); row.className = 'tbq-stars'; row.setAttribute('role', 'img');
      var v = document.createElement('div'); v.className = 'tbq-verdict'; var first = done.firstElementChild; done.insertBefore(row, first.nextSibling); done.insertBefore(v, row.nextSibling); }
    row.innerHTML = '<i></i><i></i><i></i>'; row.setAttribute('aria-label', k + ' out of 3 stars');
    setTimeout(function(){ [].forEach.call(row.children, function(i, j){ if(j < k) i.classList.add('on'); }); }, 120);
    row.nextSibling.textContent = ['Keep climbing', 'Good run', 'Great run', 'Outstanding!'][k] + (best >= 3 ? ' · best streak ' + best : '');
  }

  function watch(){
    document.addEventListener('pointerdown', function(e){ var b = e.target.closest && e.target.closest('button, .opt, .mutile, .utile, .pad, [id^="ring"]'); if(b) lastTap = b; }, true);
    var mo = new MutationObserver(function(ms){
      var j = false, lv = false, sc = false, q = false;
      ms.forEach(function(m){ var t = m.target;
        if(t.id === 'progbar' || (t.closest && t.closest('#strikes'))) j = true;
        if(t.id === 'strikes') j = true;
        if(t.id === 'lvlPill' || (t.parentNode && t.parentNode.id === 'lvlPill')) lv = true;
        if(t.classList && t.classList.contains('screen')) sc = true;
        if(t.id === 'qtext' || (t.parentNode && t.parentNode.id === 'qtext') || t.id === 'opts' || t.id === 'clueArea' || t.id === 'uSlots' || t.id === 'muLeft') q = true; });
      if(sc) screensChanged();
      if(j){ clearTimeout(judgeT); judgeT = setTimeout(judge, 30); }
      if(lv) levelChanged();
      if(q) entered();
    });
    mo.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class', 'style'] });
    paintTier(); screensChanged();
  }
  var lastQ = '';
  function entered(){
    var qt = $('qtext'), txt = qt ? qt.textContent : '', box = $('opts');
    if(qt && txt && txt !== lastQ){ lastQ = txt; var qb = document.querySelector('.qbox'); if(qb){ qb.classList.remove('tbq-in'); void qb.offsetWidth; qb.classList.add('tbq-in'); }
      if(box){ box.classList.remove('tbq-in'); void box.offsetWidth; box.classList.add('tbq-in'); } }
  }

  /* ================= the start screen emblem ================= */
  function emblem(){
    var start = $('startScreen'); if(!start) return; var head = start.querySelector('h1'); if(!head) return;
    var cv = document.createElement('canvas'); cv.className = 'tbq-emblem'; cv.setAttribute('aria-hidden', 'true'); cv.width = 300; cv.height = 192;
    var sub = start.querySelector('.sub'); start.insertBefore(cv, sub && sub.compareDocumentPosition(head) & 4 ? sub : head);
    var X = cv.getContext('2d'); X.scale(2, 2);
    (function loop(now){ if(!document.body.contains(cv)) return; if(!start.classList.contains('hidden')){ X.clearRect(0, 0, 150, 96); EMB(X, RM ? 0 : now); } requestAnimationFrame(loop); })(0);
  }
  function EMB(X, T){
    var W = 150, H = 96, a = PAL.acc, b = PAL.acc2, i;
    glow(X, W/2, H/2, 60, a, .25);
    X.lineCap = 'round'; X.lineJoin = 'round';
    switch(THEME){
      case 'climb':
        X.fillStyle = '#3b2731'; X.beginPath(); X.moveTo(20, 90); X.lineTo(75, 14); X.lineTo(130, 90); X.fill();
        X.fillStyle = '#f4ece0'; X.beginPath(); X.moveTo(75, 14); X.lineTo(88, 32); X.lineTo(80, 30); X.lineTo(75, 36); X.lineTo(69, 30); X.lineTo(62, 32); X.fill();
        for(i = 0; i < 5; i++){ var on = (T/400 % 6) > i; X.fillStyle = on ? '#ffe3a0' : 'rgba(255,255,255,.25)'; X.beginPath(); X.arc(48 + i*7 + (i % 2)*8, 84 - i*12, 3, 0, 7); X.fill(); }
        X.strokeStyle = '#2a1a14'; X.lineWidth = 2; X.beginPath(); X.moveTo(75, 14); X.lineTo(75, 3); X.stroke(); X.fillStyle = a; X.beginPath(); X.moveTo(75, 3); X.lineTo(90, 6 + Math.sin(T*.008)*2); X.lineTo(75, 10); X.fill(); break;
      case 'higher':
        var h1 = 34 + Math.sin(T*.003)*10, h2 = 56 - Math.sin(T*.003)*10;
        X.fillStyle = b; rr(X, 40, 88 - h1, 28, h1, 5); X.fill(); X.fillStyle = a; rr(X, 82, 88 - h2, 28, h2, 5); X.fill();
        X.fillStyle = '#fff8ea'; X.font = '900 22px "Baloo 2",Nunito'; X.textAlign = 'center'; X.fillText(h2 > h1 ? '▲' : '▼', 96, 84 - h2); break;
      case 'odd':
        for(i = 0; i < 4; i++){ var x = 30 + i*30, y = 50 + Math.sin(T*.004 + i)*4; if(i === 2){ X.fillStyle = b; X.save(); X.translate(x, y); X.rotate(Math.sin(T*.003)*.4); X.fillRect(-11, -11, 22, 22); X.restore(); } else { X.fillStyle = a; X.beginPath(); X.arc(x, y, 12, 0, 7); X.fill(); } } break;
      case 'lie':
        X.fillStyle = 'rgba(255,248,234,.92)'; rr(X, 22, 18, 84, 46, 12); X.fill(); X.beginPath(); X.moveTo(40, 62); X.lineTo(34, 78); X.lineTo(56, 62); X.fill();
        X.fillStyle = '#1c1013'; X.font = '900 30px "Baloo 2",Nunito'; X.textAlign = 'center'; X.fillText('?!', 64, 52);
        var lx = 104 + Math.sin(T*.002)*6, ly = 58 + Math.cos(T*.002)*4; X.strokeStyle = a; X.lineWidth = 5; X.beginPath(); X.arc(lx, ly, 16, 0, 7); X.stroke(); X.lineWidth = 7; X.beginPath(); X.moveTo(lx + 12, ly + 12); X.lineTo(lx + 26, ly + 26); X.stroke(); break;
      case 'fact':
        X.fillStyle = '#86bf9d'; rr(X, 24, 22, 48, 52, 12); X.fill(); X.fillStyle = '#e8765f'; rr(X, 78, 22, 48, 52, 12); X.fill();
        X.strokeStyle = '#1c1013'; X.lineWidth = 6; X.beginPath(); X.moveTo(36, 48); X.lineTo(46, 58); X.lineTo(62, 38); X.stroke(); X.beginPath(); X.moveTo(92, 36); X.lineTo(112, 60); X.moveTo(112, 36); X.lineTo(92, 60); X.stroke(); break;
      case 'match':
        var k = .5 + .5*Math.sin(T*.003); X.fillStyle = a; rr(X, 18, 30, 40, 36, 8); X.fill(); X.fillStyle = b; rr(X, 92, 30, 40, 36, 8); X.fill();
        X.strokeStyle = '#fff8ea'; X.lineWidth = 4; X.setLineDash([5, 5]); X.beginPath(); X.moveTo(58, 48); X.lineTo(58 + 34*k, 48); X.stroke(); X.setLineDash([]); break;
      case 'scramble':
        'WORD'.split('').forEach(function(ch, j){ var x = 30 + j*30, y = 48 + Math.sin(T*.004 + j*1.3)*8, r = Math.sin(T*.003 + j)*.25; X.save(); X.translate(x, y); X.rotate(r);
          X.fillStyle = '#f2d6a2'; rr(X, -13, -13, 26, 26, 5); X.fill(); X.fillStyle = '#4a2c18'; X.font = '800 18px "Baloo 2",Nunito'; X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillText(ch, 0, 1); X.restore(); }); break;
      case 'recall':
        var C = ['#e85d5d', '#4cc38a', '#e6c04a', '#5a8fe8'], cur = Math.floor(T/450) % 4;
        C.forEach(function(c, j){ var x = 48 + (j % 2)*30, y = 20 + Math.floor(j/2)*30; X.fillStyle = c; X.globalAlpha = j === cur ? 1 : .35; rr(X, x, y, 26, 26, 6); X.fill(); X.globalAlpha = 1; }); break;
      case 'shot':
        [[34, b], [26, '#2a1a1c'], [20, a], [13, '#2a1a1c'], [7, b]].forEach(function(r){ X.fillStyle = r[1]; X.beginPath(); X.arc(75, 48, r[0], 0, 7); X.fill(); });
        var f = (T % 1800)/1800, dx = 75 + (1 - Math.min(1, f*3))*60, dy = 48 - (1 - Math.min(1, f*3))*30; X.strokeStyle = '#fff8ea'; X.lineWidth = 3; X.beginPath(); X.moveTo(dx, dy); X.lineTo(dx + 24, dy - 10); X.stroke();
        X.fillStyle = '#86bf9d'; X.beginPath(); X.moveTo(dx + 24, dy - 10); X.lineTo(dx + 32, dy - 18); X.lineTo(dx + 30, dy - 8); X.fill(); break;
      case 'clues':
        for(i = 0; i < 5; i++){ X.fillStyle = 'rgba(244,232,208,' + (i < 1 + (T/600 % 5) ? .9 : .25) + ')'; rr(X, 16 + i*24, 30 + (i % 2)*10, 20, 28, 3); X.fill();
          X.fillStyle = '#1c1013'; X.font = '800 13px "Baloo 2",Nunito'; X.textAlign = 'center'; X.fillText(String(i + 1), 26 + i*24, 50 + (i % 2)*10); } break;
    }
  }

  /* ================= a bigger game on a TV ================= */
  function tv(){
    var app = $('app'); if(!app) return;
    function fit(){
      var z = 1; if(innerWidth >= 900 && innerHeight >= 640) z = clamp(Math.min(innerHeight/780, innerWidth/720), 1, 1.6);
      if(z > 1.04){ app.style.zoom = z; app.style.height = (innerHeight/z) + 'px'; app.style.maxHeight = 'none'; }
      else { app.style.zoom = ''; app.style.height = ''; app.style.maxHeight = ''; }
    }
    window.addEventListener('resize', fit); fit();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.TBQuiz = { banner:banner, burst:burst, confetti:confetti, theme:THEME };
})();
