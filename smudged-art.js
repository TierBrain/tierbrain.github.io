/* ============================================================
   Smudged: the living sea, and the scenes that open and close a voyage.
   The game's sea is one canvas. Everything in it moves continuously: the waves and clouds carry
   their own momentum, the ship floats on the water with a little give, and the light, the weather
   and the last-seconds squall all ease in rather than switching. The canvas keeps one fixed height
   anchored to the bottom of its panel, so when the panel below grows the picture is cropped from
   the sky down instead of being rescaled.
   Usage: SeaArt.mount(canvas, { edition:'house'|'bible', reduce:bool, height:px })
          SeaArt.weather(k), .time(fraction, secondsLeft), .leak(n), .lightning(), .whale(), .lighthouse(on),
          .solved(), .newBottle(), .sink(), .reset()
          SeaArt.scene(kind, onEnd)   kind: open, sunk, time, done   (full screen, tap to skip)
          SeaArt.onSound = function(name){}
   ============================================================ */
(function(){
  'use strict';
  var ED = 'house', REDUCE = false, T = 0, last = 0, raf = 0, GAME = null, SCENE = null, FIXED_H = 250;
  var ctx, W, H, S, DPR;                                    // the view being drawn: the game or a scene
  function use(v){ ctx = v.ctx; W = v.W; H = v.H; S = v.S; DPR = v.DPR; S.ampU = v.scene ? Math.min(W, H) / 220 : H / 190; }
  function sound(n){ try{ if(API.onSound) API.onSound(n); }catch(e){} }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function clamp(x, a, b){ return x < a ? a : (x > b ? b : x); }
  function ease(t){ t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function hex(c){ return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mix(a, b, t){ return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function rgb(c, a){ return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')'; }

  function makeState(layers){
    var s = { sea:{ calm:1, open:0, storm:0 }, target:'calm', day:0, dayT:0, left:999, leftT:999, press:0, ph:[0, 0, 0, 0], cloudX:0,
      layers:layers || [{ y:.56, a:.35, k:3.2, s:.5, p:0 }, { y:.64, a:.6, k:2.4, s:.8, p:2 }, { y:.75, a:.85, k:1.7, s:1.1, p:4 }, { y:.86, a:1, k:1.3, s:1.4, p:1 }],
      leaks:0, list:0, draft:0, draftT:0, listT:0, parts:[], holes:[], bailT:1, bolt:null, flash:0, whale:null, light:0, lightT:0, sinking:null,
      bottles:[], ship:null, shipX:.5, gulls:[{ x:.2, y:.16, p:0 }, { x:.34, y:.22, p:1.7 }, { x:.72, y:.12, p:3.1 }], clouds:[], stars:[], crew:0 };
    for(var i = 0; i < 6; i++) s.clouds.push({ x:Math.random(), y:.06 + Math.random() * .2, s:.6 + Math.random() * .7, v:.004 + Math.random() * .006 });
    for(var j = 0; j < 46; j++) s.stars.push({ x:Math.random(), y:Math.random() * .4, r:Math.random() * 1.1 + .3, tw:Math.random() * 6 });
    return s;
  }

  /* ---------- light and weather ---------- */
  var SKY = {
    house:[[0, '#2d3c6e', '#f1a27c'], [.28, '#3f7cbc', '#b6dbee'], [.6, '#4a6aa6', '#e9c49a'], [.78, '#3a3a72', '#ef8a5a'], [.9, '#171d42', '#53406f'], [1, '#070c1e', '#172443']],
    bible:[[0, '#3d3f78', '#f3a86e'], [.28, '#4a86c0', '#f1dcae'], [.6, '#5a6fa8', '#f2b97a'], [.78, '#43376a', '#e9834e'], [.9, '#1d1c43', '#62406a'], [1, '#0b0c21', '#2a2442']]
  };
  function skyAt(d){ var k = SKY[ED] || SKY.house, i = 0; while(i < k.length - 2 && d > k[i + 1][0]) i++;
    var a = k[i], b = k[i + 1], t = clamp((d - a[0]) / (b[0] - a[0]), 0, 1); return [mix(hex(a[1]), hex(b[1]), t), mix(hex(a[2]), hex(b[2]), t)]; }
  function gloom(){ return clamp(S.sea.storm + S.sea.open * .25 + S.press * .55, 0, 1); }
  function wind(){ return S.sea.calm * .25 + S.sea.open * .7 + S.sea.storm * 1.2 + S.press * .5; }
  function night(){ return clamp((S.day - .8) / .2, 0, 1); }
  function amp(){ return (S.sea.calm * 2.6 + S.sea.open * 6.5 + S.sea.storm * 12 + S.press * 3) * S.ampU; }
  function waveY(i, x){ var L = S.layers[i], A = amp() * L.a, k = L.k / Math.max(1, W) * 6.2832, ph = S.ph[i];
    return L.y * H + A * (Math.sin(x * k + ph + L.p) * .6 + Math.sin(x * k * 2.3 - ph * 1.4 + L.p * 2) * .28 + Math.sin(x * k * 5.1 + ph * 2.2) * .12); }
  /* everything that moves is integrated, so a change of weather changes the speed, never the position */
  function advance(dt){
    ['calm', 'open', 'storm'].forEach(function(k){ S.sea[k] += ((S.target === k ? 1 : 0) - S.sea[k]) * Math.min(1, dt * 1.1); });
    S.day += (S.dayT - S.day) * Math.min(1, dt * 1.5); S.left += (S.leftT - S.left) * Math.min(1, dt * 3);
    S.press += ((S.left < 20 ? (20 - S.left) / 20 : 0) - S.press) * Math.min(1, dt * 1.5);
    var w = wind(); for(var i = 0; i < 4; i++) S.ph[i] += dt * S.layers[i].s * (.6 + w * .5); S.cloudX += dt * (.4 + w);
    S.draft += (S.draftT - S.draft) * Math.min(1, dt * 1.6); S.list += (S.listT - S.list) * Math.min(1, dt * 1.2);
    S.light += ((S.lightT ? 1 : 0) - S.light) * Math.min(1, dt * 1.5); S.flash = Math.max(0, S.flash - dt * 2.2);
    if(S.bolt) S.bolt.t += dt; if(S.whale) S.whale.t += dt; if(S.sinking) S.sinking.t += dt;
    S.gulls.forEach(function(g){ g.x += dt * .02; if(g.x > 1.1) g.x = -.1; });
    S.bottles.forEach(function(b){ b.t += dt; b.x += b.vx * dt; b.dy *= Math.pow(.25, dt); });
    S.bottles = S.bottles.filter(function(b){ return b.t < b.life; });
    var st = S.sea.storm + S.press * .5;
    if(st > .2 && !REDUCE) for(var r = 0, n = st * W / 40; r < n; r++) add({ k:'rain', x:Math.random() * W * 1.3 - W * .15, y:-10 - Math.random() * H * .2, vx:-W * .2 * w, vy:H * 3.2, g:0, t:0, life:.5, a:clamp((st - .2) * 1.6, 0, 1) });
    if(w > .6 && Math.random() < dt * w * 6){ var sx = Math.random() * W; splash(sx, waveY(3, sx), 3, H * .5); }
    stepParts(dt);
  }

  /* ---------- drawing the world ---------- */
  function drawSky(){
    var c = skyAt(S.day), g = gloom(), storm = [hex('#262c36'), hex('#4d5560')];
    var top = mix(c[0], storm[0], g * .85), bot = mix(c[1], storm[1], g * .8), hz = S.layers[0].y * H + 10;
    var gr = ctx.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, rgb(top)); gr.addColorStop(1, rgb(bot)); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, hz + 4);
    var n = night() * (1 - g);
    if(n > .02){ ctx.fillStyle = 'rgba(255,250,235,1)'; S.stars.forEach(function(s){ ctx.globalAlpha = n * (.5 + .5 * Math.sin(T * 1.5 + s.tw)); ctx.beginPath(); ctx.arc(s.x * W, s.y * hz, s.r, 0, 6.283); ctx.fill(); }); ctx.globalAlpha = 1; }
    var sa = clamp(S.day / .86, 0, 1), sx = lerp(W * .08, W * .92, sa), sy = lerp(hz, hz * .2, Math.sin(sa * Math.PI)), sunA = (1 - g * .9) * (1 - night()), R = Math.min(W, H) * .05;
    if(sunA > .02){ var sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, R * 6); sg.addColorStop(0, 'rgba(255,236,190,' + (.55 * sunA) + ')'); sg.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = sg; ctx.fillRect(sx - R * 6, sy - R * 6, R * 12, R * 12); ctx.fillStyle = 'rgba(255,244,214,' + sunA + ')'; ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.283); ctx.fill(); }
    var ma = night() * (1 - g * .8); if(ma > .02){ var mx = W * .78, my = lerp(hz, hz * .3, ma); ctx.fillStyle = 'rgba(243,238,220,' + ma + ')'; ctx.beginPath(); ctx.arc(mx, my, R, 0, 6.283); ctx.fill();
      ctx.fillStyle = rgb(top, ma * .9); ctx.beginPath(); ctx.arc(mx + R * .45, my - R * .25, R * .9, 0, 6.283); ctx.fill(); }
    var dusk = clamp(1 - Math.abs(S.day - .76) * 7, 0, 1);
    S.clouds.forEach(function(cl){ var x = ((cl.x + S.cloudX * cl.v) % 1.3) - .15, y = cl.y * hz * 1.3 * (1 - g * .3), s = cl.s * Math.min(H, W * .7) * (.09 + g * .07);
      var col = mix(mix(hex('#ffffff'), hex('#f3c9a8'), dusk), hex('#3a414c'), g); col = mix(col, hex('#2a3352'), night() * .7);
      ctx.fillStyle = rgb(col, .55 + g * .4); ctx.beginPath();
      [[0, 0, 1], [.9, .15, .75], [-.9, .2, .7], [.4, -.35, .7], [-.35, -.25, .6]].forEach(function(b){ ctx.moveTo(x * W + b[0] * s + b[2] * s, y + b[1] * s); ctx.arc(x * W + b[0] * s, y + b[1] * s, b[2] * s, 0, 6.283); });
      ctx.fill(); });
  }
  function seaColours(){
    var c = skyAt(S.day), g = gloom(), n = night(), base = ED === 'bible' ? [hex('#2d6f8f'), hex('#174a66')] : [hex('#2a6a8c'), hex('#0f3550')];
    return S.layers.map(function(L, i){ var t = i / (S.layers.length - 1), col = mix(base[0], base[1], t);
      col = mix(col, c[1], (1 - t) * .35 * (1 - g)); col = mix(col, hex('#22313b'), g * .55); return mix(col, hex('#08142a'), n * .6); });
  }
  function shimmer(){ var n = night(), g = gloom(), hz = S.layers[0].y * H; var a = (n > .3 ? n : clamp(1 - Math.abs(S.day - .76) * 6, 0, 1) * .8) * (1 - g); if(a < .05) return;
    var x = n > .3 ? W * .78 : lerp(W * .08, W * .92, clamp(S.day / .86, 0, 1)), col = n > .3 ? '236,236,220' : '255,214,150'; ctx.strokeStyle = 'rgba(' + col + ',' + (.45 * a) + ')'; ctx.lineWidth = 1.6; ctx.beginPath();
    for(var r = 0; r < 14; r++){ var y = hz + 4 + r * (H - hz) / 16, w = (4 + r * 2.2) * (.6 + .4 * Math.sin(T * 2.4 + r * 1.7)); ctx.moveTo(x - w, y); ctx.lineTo(x + w, y); } ctx.stroke(); }
  function drawLayer(i, col){ ctx.fillStyle = rgb(col); ctx.beginPath(); ctx.moveTo(0, H);
    for(var x = 0; x <= W + 8; x += 8) ctx.lineTo(x, waveY(i, x)); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    var f = clamp((amp() / S.ampU - 3) / 9, 0, 1) * (i / 3); if(f > .05){ ctx.strokeStyle = 'rgba(235,245,250,' + (f * .5).toFixed(3) + ')'; ctx.lineWidth = 1.4; ctx.beginPath();
      for(var x2 = 0; x2 <= W; x2 += 8){ var y = waveY(i, x2), y2 = waveY(i, x2 + 8); if(y2 < y - .4){ ctx.moveTo(x2, y); ctx.lineTo(x2 + 8, y2); } } ctx.stroke(); }
  }
  /* the ship floats: it follows the water through a little give rather than sticking to every ripple */
  function floatShip(dt, x, sz, layer){
    var ty = (waveY(layer, x - 12) + waveY(layer, x) * 2 + waveY(layer, x + 12)) / 4 + S.draft * sz * .2;
    var ta = Math.atan2(waveY(layer, x + 16) - waveY(layer, x - 16), 32) * .85 + S.list;
    if(!S.ship){ S.ship = { y:ty, a:ta }; } S.ship.y += (ty - S.ship.y) * Math.min(1, dt * 5); S.ship.a += (ta - S.ship.a) * Math.min(1, dt * 3.5);
    return { x:x, y:S.ship.y, a:S.ship.a, sz:sz };
  }
  function drawShip(p, opt){
    opt = opt || {}; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); var s = p.sz / 100; ctx.scale(s * (opt.flip ? -1 : 1), s);
    var bill = 6 + wind() * 8 + Math.sin(T * 3) * 1.5, dark = 1 - night() * .45 - gloom() * .2, ht = -12;
    var wood = ctx.createLinearGradient(0, ht, 0, 16); wood.addColorStop(0, rgb(mix(hex('#8a5a33'), [0, 0, 0], 1 - dark))); wood.addColorStop(1, rgb(mix(hex('#4c2e18'), [0, 0, 0], 1 - dark)));
    var sail = rgb(mix(hex('#f4ead2'), [40, 40, 52], 1 - dark)), sail2 = rgb(mix(hex('#e1d2b0'), [40, 40, 52], 1 - dark));
    if(ED === 'bible'){
      ctx.strokeStyle = '#5a3a20'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-2, ht); ctx.lineTo(0, -78); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-34, -70); ctx.lineTo(34, -70); ctx.stroke();
      if(!opt.furled){ ctx.fillStyle = sail; ctx.beginPath(); ctx.moveTo(-32, -68); ctx.quadraticCurveTo(-32 - bill * 1.1, -46, -30, -22); ctx.quadraticCurveTo(0, -18 + bill * .3, 30, -22); ctx.quadraticCurveTo(32 - bill * 1.1, -46, 32, -68); ctx.quadraticCurveTo(0, -64, -32, -68); ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgb(mix(hex('#a8392b'), [30, 20, 20], 1 - dark), .85); ctx.fillRect(-31, -52, 61, 7); }
      else { ctx.fillStyle = sail; ctx.beginPath(); ctx.ellipse(0, -67, 33, 4.5, 0, 0, 6.283); ctx.fill(); ctx.strokeStyle = 'rgba(90,60,30,.7)'; ctx.lineWidth = 1.5; [-18, 0, 18].forEach(function(x){ ctx.beginPath(); ctx.moveTo(x, -72); ctx.lineTo(x, -62); ctx.stroke(); }); }
      ctx.fillStyle = wood; ctx.beginPath(); ctx.moveTo(-50, ht); ctx.quadraticCurveTo(-46, 14, -18, 16); ctx.lineTo(26, 16); ctx.quadraticCurveTo(48, 12, 52, ht); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgb(mix(hex('#4c2e18'), [0, 0, 0], 1 - dark)); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(48, ht); ctx.quadraticCurveTo(60, -26, 50, -34); ctx.quadraticCurveTo(44, -36, 46, -28); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(40, -16); ctx.lineTo(56, 18); ctx.stroke();
    } else {
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, ht); ctx.lineTo(0, -86); ctx.stroke();
      if(!opt.furled){ ctx.fillStyle = sail; ctx.beginPath(); ctx.moveTo(3, -82); ctx.quadraticCurveTo(14 + bill * 2.2, -52, 40, -18); ctx.lineTo(3, -18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = sail2; ctx.beginPath(); ctx.moveTo(-3, -72); ctx.quadraticCurveTo(-14 - bill * 1.2, -46, -36, -18); ctx.lineTo(-3, -18); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(0, -86); ctx.lineTo(-14 - Math.sin(T * 8) * 2, -83 + Math.sin(T * 6) * 1.5); ctx.lineTo(0, -79); ctx.closePath(); ctx.fill();
      ctx.fillStyle = wood; ctx.beginPath(); ctx.moveTo(-50, ht); ctx.lineTo(54, ht - 4); ctx.quadraticCurveTo(46, 12, 30, 16); ctx.lineTo(-30, 16); ctx.quadraticCurveTo(-46, 10, -50, ht); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgb(mix(hex('#5c3a1e'), [0, 0, 0], 1 - dark)); ctx.fillRect(-34, -20, 18, 8);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1; [-4, 3, 10].forEach(function(y){ ctx.beginPath(); ctx.moveTo(-46, y); ctx.lineTo(48, y - 1); ctx.stroke(); });
    ctx.strokeStyle = 'rgba(232,194,124,' + (.75 * dark) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-48, ht + 3); ctx.lineTo(52, ht - 1); ctx.stroke();
    var lan = clamp(night() + gloom() * .6, 0, 1), lnx = ED === 'bible' ? 40 : -44;
    if(lan > .05){ var lg = ctx.createRadialGradient(lnx, -22, 1, lnx, -22, 22); lg.addColorStop(0, 'rgba(255,214,140,' + lan + ')'); lg.addColorStop(1, 'rgba(255,214,140,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lnx, -22, 22, 0, 6.283); ctx.fill(); ctx.fillStyle = 'rgba(255,230,170,' + lan + ')'; ctx.fillRect(lnx - 2, -26, 4, 6); }
    S.holes.forEach(function(h){ ctx.fillStyle = 'rgba(20,12,6,.85)'; ctx.beginPath(); ctx.ellipse(h.x, h.y, 5, 3, .3, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(25,14,6,.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(h.x - 9, h.y - 3); ctx.lineTo(h.x - 2, h.y); ctx.lineTo(h.x + 4, h.y - 4); ctx.lineTo(h.x + 10, h.y + 1); ctx.stroke(); });
    if(!opt.empty){ drawSailor(ED === 'bible' ? 30 : -24, ht, 0, dark); if(S.leaks > 0) drawSailor(ED === 'bible' ? -14 : 18, ht, 1, dark); }
    ctx.restore();
  }
  function drawSailor(x, y, bailing, dark){
    var c = rgb(mix(hex('#24304a'), [0, 0, 0], 1 - dark)), arm = bailing ? Math.sin(S.crew * 6.283) : Math.sin(T * 2) * .2, bob = bailing ? Math.max(0, -arm) * 3 : 0;
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -12 + bob); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -16 + bob, 3.6, 0, 6.283); ctx.fill();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -10 + bob); ctx.lineTo(7 * Math.cos(arm), -10 + bob - 7 * Math.sin(arm) - 2); ctx.stroke();
    if(bailing){ ctx.fillStyle = rgb(mix(hex('#8a6a3a'), [0, 0, 0], 1 - dark)); ctx.fillRect(7 * Math.cos(arm) - 2, -10 + bob - 7 * Math.sin(arm) - 4, 5, 4); }
    ctx.restore();
  }
  function drawBottle(x, y, rot, sc, opt){ opt = opt || {};
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(150,210,195,.5)'; ctx.strokeStyle = 'rgba(205,242,232,.95)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(6, -5); ctx.lineTo(10, -2.5); ctx.lineTo(15, -2.5); ctx.lineTo(15, 2.5); ctx.lineTo(10, 2.5); ctx.lineTo(6, 5); ctx.lineTo(-12, 5); ctx.quadraticCurveTo(-15, 0, -12, -5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#efe2c4'; ctx.fillRect(-9 + (opt.paperOut || 0), -2.5, 13, 5); ctx.strokeStyle = 'rgba(120,90,60,.5)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(-7 + (opt.paperOut || 0), -1); ctx.lineTo(2 + (opt.paperOut || 0), -1); ctx.moveTo(-7 + (opt.paperOut || 0), 1); ctx.lineTo(0 + (opt.paperOut || 0), 1); ctx.stroke();
    if(!opt.uncorked){ ctx.fillStyle = '#9a6a3a'; ctx.fillRect(15, -2, 3.5, 4); }
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-9, -4.2, 13, 1.1);
    ctx.restore(); }

  /* ---------- particles ---------- */
  function add(p){ if(!REDUCE && S.parts.length < 500) S.parts.push(p); }
  function stepParts(dt){ for(var i = S.parts.length - 1; i >= 0; i--){ var p = S.parts[i]; p.t += dt; if(p.t > p.life){ S.parts.splice(i, 1); continue; }
    p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if(p.spin) p.r += p.spin * dt; } }
  function drawParts(kind){
    var list = S.parts.filter(function(p){ return p.k === kind; }); if(!list.length) return;
    if(kind === 'rain'){ ctx.strokeStyle = 'rgba(205,222,236,' + (.4 * list[0].a) + ')'; ctx.lineWidth = 1; ctx.beginPath(); list.forEach(function(p){ ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx * .022, p.y + p.vy * .022); }); ctx.stroke(); return; }
    if(kind === 'drop'){ ctx.fillStyle = 'rgba(225,240,248,.8)'; ctx.beginPath(); list.forEach(function(p){ var r = p.s * (1 - p.t / p.life * .5); ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, 6.283); }); ctx.fill(); return; }
    if(kind === 'bubble'){ ctx.strokeStyle = 'rgba(220,240,250,.6)'; ctx.lineWidth = 1; ctx.beginPath(); list.forEach(function(p){ ctx.moveTo(p.x + p.s, p.y); ctx.arc(p.x, p.y, p.s, 0, 6.283); }); ctx.stroke(); return; }
    list.forEach(function(p){ var a = 1 - p.t / p.life;
      if(kind === 'splinter'){ ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = 'rgba(138,90,51,' + a + ')'; ctx.fillRect(-3, -1, 6, 2); ctx.restore(); }
      else if(kind === 'spark'){ ctx.fillStyle = p.c ? rgb(p.c, a) : 'rgba(255,226,150,' + a + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * a + .5, 0, 6.283); ctx.fill(); }
      else if(kind === 'smoke'){ ctx.fillStyle = 'rgba(120,110,105,' + (.25 * a) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 + p.t), 0, 6.283); ctx.fill(); }
      else if(kind === 'bit'){ ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = 'rgba(176,40,36,' + a + ')'; ctx.fillRect(-p.s, -p.s * .7, p.s * 2, p.s * 1.4); ctx.restore(); }
      else if(kind === 'cork'){ ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = '#9a6a3a'; ctx.fillRect(-p.s, -p.s * .6, p.s * 2, p.s * 1.2); ctx.restore(); } });
  }
  function splash(x, y, n, power){ for(var i = 0; i < n; i++){ var a = -Math.PI / 2 + (Math.random() - .5) * 1.6; add({ k:'drop', x:x + (Math.random() - .5) * 10, y:y, vx:Math.cos(a) * power * (.4 + Math.random()), vy:Math.sin(a) * power * (.6 + Math.random() * .6), g:H * 2.6, t:0, life:.7 + Math.random() * .4, s:1 + Math.random() * 1.6 }); } }

  /* ---------- moments inside the picture ---------- */
  function drawBolt(){ var b = S.bolt; if(!b) return; var a = 1 - b.t / .5; if(a <= 0){ S.bolt = null; return; }
    ctx.strokeStyle = 'rgba(240,246,255,' + a + ')'; ctx.lineWidth = 2.2; ctx.shadowColor = 'rgba(190,215,255,.9)'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.moveTo(b.pts[0][0], b.pts[0][1]);
    b.pts.forEach(function(p){ ctx.lineTo(p[0], p[1]); }); ctx.stroke(); ctx.shadowBlur = 0; }
  function bolt(awayFrom, quiet){ S.flash = 1; var x = awayFrom < W / 2 ? W * (.62 + Math.random() * .3) : W * (.08 + Math.random() * .3), y = 0, pts = [[x, y]];
    while(y < S.layers[0].y * H){ y += H * (.06 + Math.random() * .06); x += (Math.random() - .5) * W * .06; pts.push([x, y]); } S.bolt = { pts:pts, t:0 }; if(!quiet) sound('thunder'); }
  function drawWhale(){ var w = S.whale; if(!w) return; var u = w.t / 1.9; if(u >= 1){ S.whale = null; return; }
    var base = S.layers[1].y * H, x = w.x + (u - .5) * W * .16 * w.dir, y = base - Math.sin(u * Math.PI) * H * .2 + H * .07, rot = (u - .5) * 1.6 * w.dir, s = H / 190;
    if(!w.out && u > .08){ w.out = 1; splash(w.x - W * .07 * w.dir, base, 16, H * 1.2); sound('blow'); }
    if(!w.in && u > .86){ w.in = 1; splash(x, base, 22, H * 1.5); sound('splash'); }
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * w.dir, s); ctx.fillStyle = rgb(mix(hex('#2d3e4d'), hex('#10161e'), night()));
    ctx.beginPath(); ctx.moveTo(-34, 0); ctx.quadraticCurveTo(-30, -14, 0, -14); ctx.quadraticCurveTo(28, -14, 34, -2); ctx.quadraticCurveTo(36, 8, 20, 9); ctx.lineTo(-24, 6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-46, -10); ctx.lineTo(-42, 2); ctx.lineTo(-48, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(220,226,230,.85)'; ctx.beginPath(); ctx.moveTo(-20, 5); ctx.quadraticCurveTo(10, 12, 30, 4); ctx.quadraticCurveTo(10, 7, -20, 5); ctx.fill(); ctx.restore(); }
  function drawLighthouse(){ var l = S.light; if(l < .02) return; var x = W * .9, base = S.layers[0].y * H + 2, s = H / 190, dark = clamp(night() + gloom() * .7 + .25, 0, 1);
    ctx.save(); ctx.globalAlpha = l; ctx.fillStyle = rgb(mix(hex('#4a4f5a'), hex('#1a1f2a'), dark)); ctx.beginPath(); ctx.ellipse(x, base + 3 * s, 26 * s, 7 * s, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = rgb(mix(hex('#efe7da'), hex('#7a7a86'), dark * .6)); ctx.beginPath(); ctx.moveTo(x - 6 * s, base); ctx.lineTo(x - 4 * s, base - 30 * s); ctx.lineTo(x + 4 * s, base - 30 * s); ctx.lineTo(x + 6 * s, base); ctx.closePath(); ctx.fill();
    if(ED !== 'bible'){ ctx.fillStyle = '#b8402f'; ctx.fillRect(x - 5.2 * s, base - 22 * s, 10.4 * s, 4 * s); ctx.fillRect(x - 4.6 * s, base - 12 * s, 9.2 * s, 4 * s); }
    else { ctx.strokeStyle = 'rgba(90,80,70,.5)'; ctx.lineWidth = 1; for(var r = 1; r < 6; r++){ ctx.beginPath(); ctx.moveTo(x - 6 * s + r * .3 * s, base - r * 5 * s); ctx.lineTo(x + 6 * s - r * .3 * s, base - r * 5 * s); ctx.stroke(); } }
    var lx = x, ly = base - 33 * s; ctx.fillStyle = ED === 'bible' ? 'rgba(255,170,80,1)' : 'rgba(255,230,160,1)'; ctx.fillRect(lx - 3 * s, ly - 2 * s, 6 * s, 5 * s);
    var ang = Math.PI + Math.sin(T * 1.1) * .9, beam = ctx.createRadialGradient(lx, ly, 2, lx, ly, W * .7); beam.addColorStop(0, 'rgba(255,236,170,' + (.5 * dark) + ')'); beam.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, W * .7, ang - .1, ang + .1); ctx.closePath(); ctx.fill();
    var gl = ctx.createRadialGradient(lx, ly, 1, lx, ly, 16 * s); gl.addColorStop(0, 'rgba(255,236,170,.9)'); gl.addColorStop(1, 'rgba(255,236,170,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(lx, ly, 16 * s, 0, 6.283); ctx.fill();
    ctx.restore(); }
  function drawGulls(){ var a = S.sea.calm * (1 - night()); if(a < .05) return; ctx.strokeStyle = 'rgba(40,46,58,' + (.7 * a) + ')'; ctx.lineWidth = 1.4; ctx.beginPath();
    S.gulls.forEach(function(g){ var x = g.x * W, y = g.y * H + Math.sin(T + g.p) * 4, f = Math.sin(T * 6 + g.p) * 3; ctx.moveTo(x - 7, y + f); ctx.quadraticCurveTo(x - 3, y - 3, x, y); ctx.quadraticCurveTo(x + 3, y - 3, x + 7, y + f); }); ctx.stroke(); }
  function vignette(){ if(!S.vig || S.vig.w !== W || S.vig.h !== H){ var c = document.createElement('canvas'); c.width = Math.ceil(W); c.height = Math.ceil(H); var x = c.getContext('2d'), g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); x.fillStyle = g; x.fillRect(0, 0, W, H); S.vig = { c:c, w:W, h:H }; }
    ctx.globalAlpha = .18 + gloom() * .25; ctx.drawImage(S.vig.c, 0, 0, W, H); ctx.globalAlpha = 1; }

  /* ---------- the game's sea, one frame ---------- */
  function gameFrame(dt){
    var g = GAME; use(g); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if(dt){ advance(dt); if(S.leaks > 0 && !S.sinking){ S.crew += dt * (.6 + S.leaks * .25); S.bailT -= dt;
        if(S.bailT <= 0 && S.ship){ S.bailT = 2.6 - S.leaks * .5; var sx = W * S.shipX + Math.sin(T * .23) * W * .03, sz = shipSize();
          for(var b = 0; b < 7; b++) add({ k:'drop', x:sx + sz * .2, y:S.ship.y - sz * .18, vx:W * (.2 + Math.random() * .2), vy:-H * (.45 + Math.random() * .45), g:H * 2.6, t:0, life:.8, s:1 + Math.random() * 1.2 }); sound('bail'); } }
      if(S.sinking && S.sinking.t > .4 && Math.random() < dt * 25){ add({ k:'bubble', x:W * S.shipX + (Math.random() - .5) * shipSize() * .5, y:(S.ship ? S.ship.y : H * .7) + 6, vx:0, vy:-H * .25, g:0, t:0, life:1, s:1 + Math.random() * 2.5 }); } }
    drawSky(); drawLighthouse(); var cols = seaColours(); drawLayer(0, cols[0]); drawLayer(1, cols[1]); shimmer(); drawWhale(); drawGulls();
    var p = floatShip(dt || 0, W * S.shipX + Math.sin(T * .23) * W * .03, shipSize(), 2);
    if(S.sinking){ var u = S.sinking.t, dn = ease((u - .2) / 1.2); p = { x:p.x, y:p.y + dn * H * .3, a:p.a + (ED === 'bible' ? .15 : -.45) * ease(u / .5), sz:p.sz }; }
    drawShip(p); drawLayer(2, cols[2]); drawParts('drop'); drawParts('splinter');
    S.bottles.forEach(function(b){ var y = waveY(3, b.x) - 3 + b.dy, a = clamp(Math.min(b.t / .3, (b.life - b.t) / .4), 0, 1); ctx.globalAlpha = a; drawBottle(b.x, y, Math.sin(T * 2 + b.x) * .25, H / 150); ctx.globalAlpha = 1; });
    drawLayer(3, cols[3]); drawParts('bubble'); drawParts('spark'); drawBolt(); drawParts('rain');
    if(S.flash > 0){ ctx.fillStyle = 'rgba(233,242,255,' + (S.flash * .45) + ')'; ctx.fillRect(0, 0, W, H); }
    vignette();
  }
  function shipSize(){ return Math.min(W * .3, H * .5, 130); }

  /* ---------- the scenes: the voyage opens and ends with a short full-screen picture (tap to skip) ---------- */
  var CAPS = {
    house:{ open:['A bottle has washed ashore.', ''], sunk:['She sank.', ''], time:['The tide turned.', ''], done:['Every bottle read.', ''] },
    bible:{ open:['Neither sun nor stars in many days appeared.', 'Acts 27:20'], sunk:['And so it came to pass, that they escaped all safe to land.', 'Acts 27:44'],
            time:['They cast four anchors out of the stern, and wished for the day.', 'Acts 27:29'], done:['And so we went toward Rome.', 'Acts 28:14'] }
  };
  var DUR = { open:5.6, sunk:6, time:5.8, done:6.2 };
  function scene(kind, onEnd){
    if(REDUCE){ if(onEnd) setTimeout(onEnd, 0); return; }
    if(SCENE) endScene(true);
    var ov = document.createElement('div'); ov.className = 'sea-scene'; ov.setAttribute('role', 'img');
    ov.style.cssText = 'position:fixed;inset:0;z-index:60;background:#05080f;opacity:0;transition:opacity .5s ease;cursor:pointer;';
    var c = document.createElement('canvas'); c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    var cap = document.createElement('div'); cap.style.cssText = 'position:absolute;left:0;right:0;top:calc(9% + env(safe-area-inset-top,0px));padding:0 max(22px,env(safe-area-inset-left,0px));text-align:center;font-family:"Libre Baskerville",Georgia,serif;font-style:italic;font-weight:700;color:#f6ead0;text-shadow:0 2px 14px rgba(0,0,0,.65);opacity:0;transform:translateY(8px);transition:opacity .8s ease,transform .8s ease;';
    var cp = CAPS[ED === 'bible' ? 'bible' : 'house'][kind] || ['', ''];
    cap.innerHTML = '<div style="font-size:clamp(22px,5.6vw,38px);line-height:1.3;max-width:24ch;margin:0 auto"></div><div style="margin-top:8px;font-size:15px;font-style:normal;font-family:Nunito,system-ui,sans-serif;font-weight:800;letter-spacing:.08em;color:#e8c27c"></div>';
    cap.children[0].textContent = cp[0]; cap.children[1].textContent = cp[1]; ov.setAttribute('aria-label', cp[0] + (cp[1] ? ' ' + cp[1] : ''));
    var skip = document.createElement('div'); skip.textContent = 'Tap to skip'; skip.style.cssText = 'position:absolute;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));font:800 13px Nunito,system-ui,sans-serif;color:rgba(246,234,208,.6);';
    ov.appendChild(c); ov.appendChild(cap); ov.appendChild(skip); document.body.appendChild(ov);
    var tall = innerHeight > innerWidth, ys = tall ? [.56, .62, .7, .8] : [.48, .55, .64, .75];
    var layers = [{ y:ys[0], a:.4, k:3.4, s:.5, p:0 }, { y:ys[1], a:.6, k:2.6, s:.8, p:2 }, { y:ys[2], a:.85, k:1.9, s:1.1, p:4 }, { y:ys[3], a:1, k:1.4, s:1.4, p:1 }];
    var st = makeState(layers); var g = GAME && GAME.S;
    if(g){ st.day = st.dayT = g.day; ['calm', 'open', 'storm'].forEach(function(k){ st.sea[k] = g.sea[k]; }); st.target = g.target; st.leaks = g.leaks; st.holes = g.holes.slice(); st.draft = st.draftT = g.draft; st.list = st.listT = g.list; }
    SCENE = { kind:kind, t:0, dur:DUR[kind] || 5.6, ov:ov, cap:cap, onEnd:onEnd, view:{ cv:c, ctx:c.getContext('2d'), S:st, W:1, H:1, DPR:1, scene:1 }, fired:{}, ended:false };
    sizeScene(); SETUP[kind](st);
    ov.addEventListener('click', function(){ endScene(); });
    requestAnimationFrame(function(){ ov.style.opacity = '1'; });
  }
  function endScene(silent){ var s = SCENE; if(!s || s.ended) return; s.ended = true; s.ov.style.opacity = '0';
    setTimeout(function(){ if(s.ov.parentNode) s.ov.parentNode.removeChild(s.ov); if(SCENE === s) SCENE = null; if(!silent && s.onEnd) s.onEnd(); }, 520); }
  function sizeScene(){ var s = SCENE; if(!s) return; var v = s.view, r = s.ov.getBoundingClientRect(); v.W = Math.max(1, r.width); v.H = Math.max(1, r.height); v.DPR = Math.min(2, window.devicePixelRatio || 1);
    v.cv.width = Math.round(v.W * v.DPR); v.cv.height = Math.round(v.H * v.DPR); }
  function once(key, at){ var s = SCENE; if(s.t >= at && !s.fired[key]){ s.fired[key] = 1; return true; } return false; }
  var SETUP = {
    open:function(s){ if(ED === 'bible'){ s.day = s.dayT = .97; s.target = 'storm'; s.sea = { calm:0, open:0, storm:1 }; s.layers.forEach(function(L){ L.y -= .16; }); }
      else { s.day = s.dayT = .04; s.target = 'calm'; s.sea = { calm:1, open:0, storm:0 }; s.layers.forEach(function(L){ L.y -= .06; }); } },
    sunk:function(s){ if(ED === 'bible'){ s.day = s.dayT = .06; s.target = 'open'; s.sea = { calm:0, open:1, storm:0 }; } else { s.target = 'storm'; s.sea = { calm:0, open:0, storm:1 }; } s.shipX = ED === 'bible' ? .36 : .5; },
    time:function(s){ s.dayT = 1; if(ED === 'bible'){ s.day = s.dayT = .98; s.target = 'open'; s.sea = { calm:0, open:1, storm:0 }; } else { s.day = Math.min(s.day, .72); s.target = 'calm'; s.sea = { calm:1, open:0, storm:0 }; } s.shipX = .5; s.anchors = []; },
    done:function(s){ if(ED === 'bible'){ s.day = s.dayT = .08; } else { s.day = s.dayT = .82; } s.target = 'calm'; s.sea = { calm:1, open:0, storm:0 }; s.shipX = -.2; s.leaks = 0; s.holes = []; s.draftT = s.draft = 0; s.listT = s.list = 0; s.fw = []; }
  };
  function sceneFrame(dt){
    var sc = SCENE; use(sc.view); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); sc.t += dt; var t = sc.t, u = Math.min(W, H * .62) / 100;
    if(t > .5 && !sc.capOn){ sc.capOn = 1; sc.cap.style.opacity = '1'; sc.cap.style.transform = 'none'; }
    if(t > sc.dur) endScene();
    advance(dt);
    DRAW[sc.kind](t, dt, u);
    vignette();
  }
  function sand(y0, wet){ var g = ctx.createLinearGradient(0, y0, 0, H); g.addColorStop(0, rgb(mix(hex(ED === 'bible' ? '#e3c58c' : '#e6cf9e'), hex('#1a1e2e'), night() * .7))); g.addColorStop(1, rgb(mix(hex('#b8955c'), hex('#0f1220'), night() * .7)));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, y0 + 10); ctx.quadraticCurveTo(W * .5, y0 - 12, W, y0 + 6); ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); }
  var DRAW = {
    open:function(t, dt, u){
      if(ED === 'bible'){   // a sealed letter on the deck, in the storm, by lantern light
        drawSky(); var cols = seaColours(); for(var i = 0; i < 4; i++) drawLayer(i, cols[i]);
        if(once('b1', .8) || once('b2', 3.3)) bolt(W * .3);
        var dy = H * .58; ctx.fillStyle = '#3b2616'; ctx.fillRect(0, dy - 10, W, 12); for(var p = 0; p < 9; p++){ ctx.fillStyle = '#2c1c10'; ctx.fillRect(p * W / 8 - 4, dy - 26, 7, 26); }
        var dg = ctx.createLinearGradient(0, dy, 0, H); dg.addColorStop(0, '#5a3a20'); dg.addColorStop(1, '#2a180c'); ctx.fillStyle = dg; ctx.fillRect(0, dy, W, H - dy);
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; for(var k = 1; k < 9; k++){ var yy = dy + (H - dy) * Math.pow(k / 9, 1.6); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
        var sw = Math.sin(T * 1.6) * .35, lx = W * .78 + Math.sin(sw) * u * 30, ly = H * .3 + Math.cos(sw) * u * 30; ctx.strokeStyle = '#1e140c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W * .78, 0); ctx.lineTo(lx, ly); ctx.stroke();
        var lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, u * 70); lg.addColorStop(0, 'rgba(255,200,120,.55)'); lg.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffd890'; ctx.fillRect(lx - u * 3, ly, u * 6, u * 8); ctx.fillStyle = '#2a1a0e'; ctx.fillRect(lx - u * 3.6, ly - u, u * 7.2, u * 1.6);
        var sx = W * .5, sy = H * .76, open = ease((t - 3) / 1.1), w2 = u * 34;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(-.12);
        if(open > 0){ ctx.fillStyle = '#efe2c4'; ctx.fillRect(-w2 / 2, -u * 4, w2, u * 26 * open); ctx.strokeStyle = 'rgba(80,60,40,.45)'; ctx.lineWidth = 1; for(var ln = 1; ln < 6; ln++){ if(ln * 4.2 < 26 * open){ ctx.beginPath(); ctx.moveTo(-w2 / 2 + u * 3, -u * 4 + u * ln * 4.2); ctx.lineTo(w2 / 2 - u * (3 + (ln % 3) * 4), -u * 4 + u * ln * 4.2); ctx.stroke(); } } }
        ctx.fillStyle = '#e6d6b2'; ctx.beginPath(); ctx.ellipse(0, -u * 4 + u * 26 * open, w2 / 2, u * 4, 0, 0, 6.283); ctx.fill(); ctx.fillStyle = '#d4c094'; ctx.fillRect(-w2 / 2, -u * 8 + u * 26 * open, w2, u * 8);
        if(t < 2.7){ ctx.fillStyle = '#b02824'; ctx.beginPath(); ctx.arc(0, -u * 4, u * 4, 0, 6.283); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(-u, -u * 5, u * 1.3, 0, 6.283); ctx.fill(); }
        ctx.restore();
        if(once('crack', 2.7)){ sound('crack'); for(var b = 0; b < 9; b++) add({ k:'bit', x:sx, y:sy - u * 4, vx:(Math.random() - .5) * u * 90, vy:-u * (30 + Math.random() * 50), g:u * 220, t:0, life:1, r:Math.random() * 6, spin:(Math.random() - .5) * 14, s:u * (.8 + Math.random()) }); }
        drawParts('bit'); drawParts('rain'); drawBolt(); if(S.flash > 0){ ctx.fillStyle = 'rgba(233,242,255,' + (S.flash * .4) + ')'; ctx.fillRect(0, 0, W, H); }
        return; }
      // a bottle rides the surf up a dawn beach, comes to rest, and its cork pops
      drawSky(); drawGulls(); var cs = seaColours(); for(var j = 0; j < 4; j++) drawLayer(j, cs[j]);
      var by = (S.layers[3].y - .02) * H, wash = by + H * .05 + Math.sin(t * 1.9 - 1.4) * H * .045; sand(by, true);
      ctx.fillStyle = 'rgba(120,170,190,.45)'; ctx.beginPath(); ctx.moveTo(0, by); for(var x = 0; x <= W + 10; x += 10) ctx.lineTo(x, wash + Math.sin(x * .03 + T * 2) * 3); ctx.lineTo(W, by); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(250,252,255,.85)'; ctx.lineWidth = 2.4; ctx.beginPath(); for(var x2 = 0; x2 <= W + 10; x2 += 10){ var yy2 = wash + Math.sin(x2 * .03 + T * 2) * 3; if(x2) ctx.lineTo(x2, yy2); else ctx.moveTo(x2, yy2); } ctx.stroke();
      var k2 = ease(t / 2.6), bx = lerp(W * .3, W * .52, k2), byy = lerp(by - H * .04, by + (H - by) * .5, k2), rot = lerp(-.9, .12, k2) + (t < 2.6 ? Math.sin(T * 3) * .15 : Math.sin(T * 1.2) * .02), bs = u * .95;
      drawBottle(bx, byy, rot, bs, { uncorked:t > 3.7, paperOut:t > 4 ? Math.min(6, (t - 4) * 8) : 0 });
      if(once('land', 2.6)) sound('splash');
      if(t > 3 && t < 3.6){ var gl = 1 - Math.abs(t - 3.3) / .3; ctx.fillStyle = 'rgba(255,250,230,' + gl + ')'; ctx.save(); ctx.translate(bx - bs * 4, byy - bs * 4); ctx.rotate(T); ctx.fillRect(-bs * 4, -.6, bs * 8, 1.2); ctx.fillRect(-.6, -bs * 4, 1.2, bs * 8); ctx.restore(); }
      if(once('pop', 3.7)){ sound('pop'); add({ k:'cork', x:bx + Math.cos(rot) * bs * 16, y:byy + Math.sin(rot) * bs * 16, vx:u * 30, vy:-u * 90, g:u * 260, t:0, life:1.4, r:0, spin:9, s:bs * 1.8 });
        for(var q = 0; q < 12; q++) add({ k:'spark', x:bx + Math.cos(rot) * bs * 16, y:byy + Math.sin(rot) * bs * 16, vx:(Math.random() - .5) * u * 60, vy:-Math.random() * u * 60, g:u * 40, t:0, life:.9, s:1.5 }); }
      drawParts('cork'); drawParts('spark'); drawParts('drop');
    },
    sunk:function(t, dt, u){
      if(ED === 'bible'){   // aground on Malta at first light: everyone comes ashore to a fire on the beach
        drawSky(); var cols = seaColours(); drawLayer(0, cols[0]);
        var hz = S.layers[0].y * H; ctx.fillStyle = rgb(mix(hex('#7a8a4a'), hex('#2a3020'), night())); ctx.beginPath(); ctx.moveTo(W * .45, hz + 2); ctx.quadraticCurveTo(W * .72, hz - H * .1, W, hz - H * .06); ctx.lineTo(W, hz + 4); ctx.closePath(); ctx.fill();
        drawLayer(1, cols[1]); drawLayer(2, cols[2]); drawLayer(3, cols[3]);
        var by = S.layers[1].y * H; ctx.fillStyle = '#e3c58c'; ctx.beginPath(); ctx.moveTo(W * .42, H); ctx.lineTo(W * .5, by); ctx.quadraticCurveTo(W * .75, by - H * .015, W, by - 2); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(250,252,255,.8)'; ctx.lineWidth = 2.4; ctx.beginPath(); for(var e = 0; e <= 20; e++){ var ex = lerp(W * .42, W * .5, e / 20) + Math.sin(T * 2 + e) * 2, ey = lerp(H, by, e / 20); if(e) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey); } ctx.stroke();
        var sz = Math.min(W * .56, H * .34), sx = W * .3, sy = lerp(by, H, .45); drawShip({ x:sx, y:sy, a:.2 + Math.sin(T * .9) * .012, sz:sz }, { furled:true, empty:true });
        var fx = W * .8, fy = lerp(by, H, .62); if(t > 2.2){ var fl = clamp((t - 2.2) * 2, 0, 1);
          ctx.fillStyle = '#5a3a20'; ctx.fillRect(fx - u * 7, fy - u, u * 14, u * 2.4);
          for(var f = 0; f < 3; f++){ var hgt = u * (10 + Math.sin(T * 9 + f * 2) * 3) * fl; ctx.fillStyle = ['rgba(255,190,80,.9)', 'rgba(255,120,40,.85)', 'rgba(255,230,140,.9)'][f]; ctx.beginPath(); ctx.moveTo(fx - u * (5 - f), fy); ctx.quadraticCurveTo(fx + Math.sin(T * 7 + f) * u * 2, fy - hgt * 1.5, fx + u * (5 - f), fy); ctx.fill(); }
          var fg = ctx.createRadialGradient(fx, fy - u * 5, 2, fx, fy - u * 5, u * 50); fg.addColorStop(0, 'rgba(255,170,80,' + (.38 * fl) + ')'); fg.addColorStop(1, 'rgba(255,170,80,0)'); ctx.fillStyle = fg; ctx.fillRect(fx - u * 50, fy - u * 55, u * 100, u * 100);
          if(Math.random() < dt * 8) add({ k:'smoke', x:fx, y:fy - u * 12, vx:u * 3, vy:-u * 14, g:0, t:0, life:2.4, s:u * 2.4 });
          if(Math.random() < dt * 12) add({ k:'spark', x:fx, y:fy - u * 8, vx:(Math.random() - .5) * u * 12, vy:-u * (22 + Math.random() * 22), g:u * 10, t:0, life:1, s:1.4, c:[255, 190, 90] }); }
        if(once('fire', 2.2)) sound('crack');
        for(var m = 0; m < 9; m++){ var start = .3 + m * .3, k = ease((t - start) / 2.8); if(t < start) continue;
          var px = lerp(sx + sz * .15, fx + (m - 4) * u * 6.5, k), py = lerp(sy - sz * .05, fy + u * 3 + (m % 3) * u * 2, k), wet = px < W * .47;
          ctx.fillStyle = '#2a2236'; ctx.strokeStyle = '#2a2236'; ctx.lineCap = 'round'; ctx.lineWidth = u * 1.8;
          ctx.beginPath(); ctx.moveTo(px, py - u * 2); ctx.lineTo(px, py - u * 7); ctx.stroke(); ctx.beginPath(); ctx.arc(px, py - u * 9 + Math.sin(T * 7 + m) * u * .4, u * 1.8, 0, 6.283); ctx.fill();
          if(!wet){ ctx.lineWidth = u * 1.2; ctx.beginPath(); var st = Math.sin(T * 8 + m) * u * 1.5 * (1 - k); ctx.moveTo(px, py - u * 2); ctx.lineTo(px - u - st, py + u); ctx.moveTo(px, py - u * 2); ctx.lineTo(px + u + st, py + u); ctx.stroke(); }
          else { ctx.fillStyle = 'rgba(160,200,215,.7)'; ctx.fillRect(px - u * 3, py - u * 3, u * 6, u * 1.2); } }
        drawParts('smoke'); drawParts('spark'); drawParts('drop'); return; }
      // she goes down in the storm; the storm passes; a bottle comes up under the moon
      if(once('calm', 2.8)){ S.target = 'calm'; S.dayT = .96; }
      drawSky(); var cs = seaColours(); drawLayer(0, cs[0]); drawLayer(1, cs[1]); shimmer();
      var sz = Math.min(W * .5, H * .36), q = floatShip(dt, W * .5, sz, 2), dn = ease((t - .7) / 2.6); q = { x:q.x, y:q.y + dn * sz * 1.1, a:q.a - .45 * ease(t / 1.4) - dn * .45, sz:sz };
      if(dn < .98) drawShip(q); if(t > .7 && t < 3.4 && Math.random() < dt * 30) add({ k:'bubble', x:W * .5 + (Math.random() - .5) * sz * .5, y:waveY(2, W * .5) + 4, vx:0, vy:-u * 8, g:0, t:0, life:1, s:1 + Math.random() * 3 });
      if(once('gurgle', 1.2)) sound('splash');
      drawLayer(2, cs[2]);
      if(t > 3.6){ var r = ease((t - 3.6) / 1.2); drawBottle(W * .5 + (t - 3.6) * u * 3, waveY(3, W * .5) - u * 2 + (1 - r) * u * 18, Math.sin(T * 2) * .25, u * .8); if(once('bob', 3.7)){ splash(W * .5, waveY(3, W * .5), 10, H * .5); sound('splash'); } }
      drawLayer(3, cs[3]); drawParts('bubble'); drawParts('drop'); drawParts('rain'); drawBolt(); if(once('bolt', .5)) bolt(W * .5);
      if(S.flash > 0){ ctx.fillStyle = 'rgba(233,242,255,' + (S.flash * .4) + ')'; ctx.fillRect(0, 0, W, H); }
    },
    time:function(t, dt, u){
      drawSky(); var cs = seaColours(); drawLayer(0, cs[0]); drawLayer(1, cs[1]);
      if(ED === 'bible'){   // four anchors out of the stern, one after another, and the crew wait for the day
        var sz = Math.min(W * .5, H * .3), p = floatShip(dt, W * .42, sz, 2); drawShip(p); drawLayer(2, cs[2]); drawLayer(3, cs[3]);
        var stx = p.x + Math.cos(p.a) * sz * .5, sty = p.y + Math.sin(p.a) * sz * .5 - sz * .06;
        [1, 1.7, 2.4, 3.1].forEach(function(at, i){ if(t < at) return; var k = clamp((t - at) / .7, 0, 1), ax = stx + u * (8 + i * 6), wl = waveY(3, ax), ay = lerp(sty, wl + u * (4 + i * 2), k * k);
          var under = ay > wl; ctx.globalAlpha = under ? .45 : 1;
          ctx.strokeStyle = 'rgba(210,180,130,.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(stx, sty); ctx.quadraticCurveTo((stx + ax) / 2, Math.max(sty, ay) + u * 2, ax, ay); ctx.stroke();
          ctx.save(); ctx.translate(ax, ay); ctx.strokeStyle = '#2e2e36'; ctx.lineWidth = u * 1.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, u * 7); ctx.moveTo(-u * 3, u * 2); ctx.lineTo(u * 3, u * 2); ctx.moveTo(-u * 4, u * 4.5); ctx.quadraticCurveTo(0, u * 9.5, u * 4, u * 4.5); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
          if(once('a' + i, at + .5)){ splash(ax, wl, 14, H * .45); sound('anchor'); } });
        drawParts('drop'); return; }
      // the sun goes down, the ship sails on toward the horizon and the moon comes up
      shimmer();
      var k2 = ease(t / 5.6), sz2 = lerp(Math.min(W * .5, H * .34), Math.min(W * .3, H * .2), k2); S.layers[2].y = lerp(.58, .52, k2);
      var q = floatShip(dt, lerp(W * .44, W * .62, k2), sz2, 2); drawShip(q); drawLayer(2, cs[2]); drawLayer(3, cs[3]); drawParts('drop');
    },
    done:function(t, dt, u){
      drawSky(); var cs = seaColours(); drawLayer(0, cs[0]);
      var hz = S.layers[0].y * H, dk = night() * .6 + .3;
      if(ED === 'bible'){   // a Roman harbour at sunrise: a colonnade of arches along the quay
        ctx.fillStyle = rgb(mix(hex('#c9a77a'), hex('#3a3040'), .25)); ctx.fillRect(W * .5, hz - u * 26, W * .5, u * 26);
        ctx.fillStyle = rgb(mix(hex('#8a6e52'), hex('#2a2030'), .2)); for(var a = 0; a < 7; a++){ var ax = W * .53 + a * u * 9; if(ax > W) break; ctx.beginPath(); ctx.moveTo(ax, hz); ctx.lineTo(ax, hz - u * 14); ctx.arc(ax + u * 3.5, hz - u * 14, u * 3.5, Math.PI, 0); ctx.lineTo(ax + u * 7, hz); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = rgb(mix(hex('#e8d2a8'), hex('#3a3040'), .15)); ctx.fillRect(W * .5, hz - u * 30, W * .5, u * 4); ctx.beginPath(); ctx.moveTo(W * .7, hz - u * 30); ctx.lineTo(W * .82, hz - u * 38); ctx.lineTo(W * .94, hz - u * 30); ctx.closePath(); ctx.fill(); }
      else {   // a harbour town at dusk with lit windows, and fireworks over the water
        for(var hI = 0; hI < 9; hI++){ var hx = W * .52 + hI * u * 8, hh = u * (12 + (hI * 7 % 5) * 4); if(hx > W) break; ctx.fillStyle = rgb(mix(hex('#3a3550'), hex('#141428'), dk)); ctx.fillRect(hx, hz - hh, u * 7.4, hh);
          ctx.beginPath(); ctx.moveTo(hx - u * .5, hz - hh); ctx.lineTo(hx + u * 3.7, hz - hh - u * 4); ctx.lineTo(hx + u * 7.9, hz - hh); ctx.fill();
          ctx.fillStyle = 'rgba(255,214,140,' + (.5 + .4 * Math.sin(T * 2 + hI)) + ')'; ctx.fillRect(hx + u * 2, hz - hh + u * 4, u * 1.6, u * 2); if(hh > u * 18) ctx.fillRect(hx + u * 4.4, hz - hh + u * 10, u * 1.6, u * 2); }
        if(t > 1.4 && Math.random() < dt * 2.4){ var fx = W * (.15 + Math.random() * .7), fy = hz * (.25 + Math.random() * .4), col = [[255, 214, 120], [255, 140, 120], [160, 220, 255], [200, 255, 180]][Math.floor(Math.random() * 4)];
          for(var f = 0; f < 34; f++){ var an = f / 34 * 6.283, sp = u * (30 + Math.random() * 14); add({ k:'spark', x:fx, y:fy, vx:Math.cos(an) * sp, vy:Math.sin(an) * sp, g:u * 30, t:0, life:1.4, s:2.6, c:col }); } sound('firework'); } }
      drawLayer(1, cs[1]);
      var k = ease(t / 3.6), sz = Math.min(W * .4, H * .28), p = floatShip(dt, lerp(-W * .2, W * .36, k), sz, 2); drawShip(p);
      drawLayer(2, cs[2]); drawLayer(3, cs[3]); drawParts('spark'); drawParts('drop');
    }
  };

  /* ---------- the loop ---------- */
  function step(now){
    raf = requestAnimationFrame(step); var dt = Math.min(.05, (now - (last || now)) / 1000); last = now; if(document.hidden) return; T += dt;
    try{ if(GAME && GAME.W > 1) gameFrame(dt); }catch(e){}
    try{ if(SCENE) sceneFrame(dt); }catch(e){}
  }
  function sizeGame(){ if(!GAME) return; var g = GAME, r = g.cv.getBoundingClientRect(); g.W = Math.max(1, r.width); g.H = Math.max(1, r.height); g.DPR = Math.min(2, window.devicePixelRatio || 1);
    g.cv.width = Math.round(g.W * g.DPR); g.cv.height = Math.round(g.H * g.DPR); g.S.ship = null; if(REDUCE) gameFrame(0); }
  function redraw(){ if(REDUCE && GAME) gameFrame(0); }

  var API = {
    onSound:null,
    mount:function(c, o){ o = o || {}; ED = o.edition || 'house'; REDUCE = !!o.reduce; FIXED_H = o.height || 250;
      c.style.height = FIXED_H + 'px';
      GAME = { cv:c, ctx:c.getContext('2d'), S:makeState(), W:1, H:1, DPR:1 }; sizeGame();
      window.addEventListener('resize', function(){ sizeGame(); sizeScene(); });
      if(!REDUCE) raf = requestAnimationFrame(step); },
    reset:function(){ if(!GAME) return; var d = GAME.S.day; GAME.S = makeState(); GAME.S.day = GAME.S.dayT = 0; redraw(); },
    weather:function(k){ if(!GAME) return; GAME.S.target = k; if(REDUCE){ GAME.S.sea = { calm:0, open:0, storm:0 }; GAME.S.sea[k] = 1; redraw(); } },
    time:function(f, left){ if(!GAME) return; GAME.S.dayT = clamp(f, 0, 1); GAME.S.leftT = left; if(REDUCE){ GAME.S.day = GAME.S.dayT; } },
    lightning:function(){ if(!GAME || REDUCE) return; use(GAME); bolt(W * GAME.S.shipX, true); },
    leak:function(n){ if(!GAME) return; use(GAME); S.leaks = n; S.draftT = n * .35; S.listT = n * .045; S.bailT = Math.min(S.bailT, 1.2);
      var x = W * S.shipX, y = S.ship ? S.ship.y : H * .7, sz = shipSize(), hx = [-20, 12, 34][(n - 1) % 3], hy = [2, 6, 0][(n - 1) % 3]; S.holes.push({ x:hx, y:hy });
      for(var i = 0; i < 14; i++) add({ k:'splinter', x:x + hx * sz / 100, y:y + hy * sz / 100, vx:(Math.random() - .5) * W * .5, vy:-H * (.4 + Math.random() * .7), g:H * 2.4, t:0, life:.9, r:Math.random() * 6, spin:(Math.random() - .5) * 20 });
      splash(x + hx * sz / 100, y + sz * .1, 14, H * 1.1); sound('creak'); sound('splash'); redraw(); },
    whale:function(){ if(!GAME || REDUCE || GAME.S.whale) return; use(GAME); var left = GAME.S.shipX * W > W / 2; GAME.S.whale = { t:0, x:left ? W * .24 : W * .76, dir:left ? 1 : -1 }; },
    lighthouse:function(on){ if(!GAME) return; GAME.S.lightT = !!on; if(REDUCE){ GAME.S.light = on ? 1 : 0; redraw(); } },
    solved:function(){ if(!GAME) return; use(GAME); var x = W * S.shipX, y = S.ship ? S.ship.y : H * .7, sz = shipSize(); S.lightT = false;
      for(var i = 0; i < 26; i++){ var a = Math.random() * 6.283, v = H * (.3 + Math.random() * .6); add({ k:'spark', x:x, y:y - sz * .5, vx:Math.cos(a) * v, vy:Math.sin(a) * v - H * .2, g:H * .6, t:0, life:1 + Math.random() * .5, s:1.5 + Math.random() * 2 }); }
      S.bottles.push({ x:x + sz * .3, vx:W * .2, dy:-H * .05, t:0, life:2.4 }); redraw(); },
    newBottle:function(){ if(!GAME || REDUCE) return; use(GAME); var x = W * S.shipX; S.bottles.push({ x:W * 1.05, vx:-(W * 1.05 - x - shipSize() * .35) / 1.3, dy:0, t:0, life:1.3 });
      setTimeout(function(){ if(!GAME) return; use(GAME); splash(W * GAME.S.shipX + shipSize() * .35, waveY(3, W * GAME.S.shipX + shipSize() * .35), 8, H * .6); sound('pop'); }, 1250); },
    sink:function(){ if(!GAME) return; GAME.S.sinking = { t:0 }; sound('splash'); redraw(); },
    scene:function(kind, onEnd){ scene(kind, onEnd); },
    sceneOn:function(){ return !!SCENE; },
    state:function(){ return GAME && GAME.S; }
  };
  window.SeaArt = API;
})();
