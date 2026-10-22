/* Creak & Coil artwork, shared by the solo climb and the Shared Climb.
   Stone tiles that crack, wooden ladders whose rungs split as they age, snakes with
   heads, scales and sleepy eyes, little climbers in woolly hats, and a mountain sky
   that runs from morning to dusk as the leader climbs, with storms that roll in.

   Board pieces take B = { X, CELL, COLS, ROWS, TOP, W, H, sq, T, isCrater, age }
     X: the 2D context, sq(n): centre of square n, T: animation clock in ms,
     isCrater(n): true for a missing tile, age: turns played (tiles crack with age). */
(function(){
  'use strict';
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function rnd(n){ var x = Math.sin(n*127.1 + 311.7)*43758.5453; return x - Math.floor(x); }
  function clamp(x, a, b){ return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t){ return a + (b - a)*t; }
  function hex(h){ h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mixc(a, b, t){ var A = typeof a === 'string' ? hex(a) : a, C = typeof b === 'string' ? hex(b) : b;
    return [Math.round(lerp(A[0], C[0], t)), Math.round(lerp(A[1], C[1], t)), Math.round(lerp(A[2], C[2], t))]; }
  function rgba(c, a){ return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; }
  function shade(h, k){ var c = hex(h); return k < 0 ? rgba(mixc(c, [0, 0, 0], -k)) : rgba(mixc(c, [255, 255, 255], k)); }
  function rr(X, x, y, w, h, r){ X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }
  var FONT = "Nunito, 'Baloo 2', system-ui, sans-serif";

  /* ================= the board: stone tiles, cracks and craters ================= */
  function cellOf(n, COLS){ var i = n - 1, row = Math.floor(i/COLS), inRow = i % COLS; return { row:row, col:(row % 2 === 0) ? inRow : (COLS - 1 - inRow) }; }
  function squareAt(row, col, COLS){ if(row < 0 || col < 0 || col >= COLS) return -1; return row*COLS + ((row % 2 === 0) ? col : (COLS - 1 - col)) + 1; }

  function crackLine(X, x, y, ang, len, seed, w, depth){
    var pts = [[x, y]], steps = 4 + Math.floor(rnd(seed)*3), cx = x, cy = y, a = ang;
    for(var i = 1; i <= steps; i++){ a += (rnd(seed + i*3.1) - .5)*.9; var l = len/steps; cx += Math.cos(a)*l; cy += Math.sin(a)*l; pts.push([cx, cy]); }
    X.lineCap = 'round'; X.lineJoin = 'round';
    X.strokeStyle = 'rgba(255,232,205,.10)'; X.lineWidth = w*1.1; X.beginPath(); pts.forEach(function(p, i){ i ? X.lineTo(p[0] + w*.7, p[1] + w*.7) : X.moveTo(p[0] + w*.7, p[1] + w*.7); }); X.stroke();
    X.strokeStyle = 'rgba(12,6,6,.82)'; X.lineWidth = w; X.beginPath(); pts.forEach(function(p, i){ i ? X.lineTo(p[0], p[1]) : X.moveTo(p[0], p[1]); }); X.stroke();
    if((depth || 0) < 1 && rnd(seed + 9) < .7){ var k = 1 + Math.floor(rnd(seed + 4)*(pts.length - 2)); crackLine(X, pts[k][0], pts[k][1], ang + (rnd(seed + 5) < .5 ? -.9 : .9), len*.45, seed + 17, w*.7, 1); }
  }

  function tile(X, n, B, wear){
    var c = B.sq(n), CELL = B.CELL, g = Math.max(1, CELL*.035), x = c.x - CELL/2 + g, y = c.y - CELL/2 + g, s = CELL - 2*g, r = CELL*.1;
    var rc = cellOf(n, B.COLS), checker = (rc.row + rc.col) % 2;
    var hue = 18 + rnd(n*1.7)*16, sat = 9 + rnd(n*2.3)*8, lit = 18 + rnd(n*3.9)*5 + checker*3;
    if(n === B.TOP){ hue = 40; sat = 45; lit = 34; }
    var gr = B.X.createLinearGradient(x, y, x + s, y + s);
    gr.addColorStop(0, 'hsl(' + hue + ',' + sat + '%,' + (lit + 5) + '%)'); gr.addColorStop(1, 'hsl(' + hue + ',' + sat + '%,' + (lit - 4) + '%)');
    X.fillStyle = gr; rr(X, x, y, s, s, r); X.fill();
    /* bevel: light on the top and left, shadow on the bottom and right */
    X.save(); rr(X, x, y, s, s, r); X.clip();
    X.lineWidth = Math.max(1, CELL*.035);
    X.strokeStyle = 'rgba(255,238,215,.13)'; X.beginPath(); X.moveTo(x, y + s); X.lineTo(x, y); X.lineTo(x + s, y); X.stroke();
    X.strokeStyle = 'rgba(0,0,0,.38)'; X.beginPath(); X.moveTo(x + s, y); X.lineTo(x + s, y + s); X.lineTo(x, y + s); X.stroke();
    /* pits and speckles in the stone */
    for(var i = 0; i < 7; i++){ var px = x + rnd(n*9 + i)*s, py = y + rnd(n*7 + i*2.3)*s, pr = CELL*(.008 + rnd(n + i*5)*.018);
      X.fillStyle = i % 3 ? 'rgba(0,0,0,.22)' : 'rgba(255,240,220,.08)'; X.beginPath(); X.arc(px, py, pr, 0, 7); X.fill(); }
    if(rnd(n*4.4) < .16 && n !== B.TOP){ var mx = x + (rnd(n*5.5) < .5 ? s*.15 : s*.85), my = y + s*.85, mg = X.createRadialGradient(mx, my, 0, mx, my, s*.4);
      mg.addColorStop(0, 'rgba(120,160,80,.30)'); mg.addColorStop(1, 'rgba(120,160,80,0)'); X.fillStyle = mg; X.fillRect(x, y, s, s); }
    /* hairline cracks that spread as the climb wears on */
    if(n !== B.TOP && rnd(n*6.1) < wear*.5){ var side = Math.floor(rnd(n*8.2)*4), t0 = .25 + rnd(n*3.3)*.5;
      var sx = [x + s*t0, x + s, x + s*t0, x][side], sy = [y, y + s*t0, y + s, y + s*t0][side], ang = [Math.PI/2, Math.PI, -Math.PI/2, 0][side];
      crackLine(X, sx, sy, ang + (rnd(n) - .5)*.6, s*(.3 + wear*.35), n*11, Math.max(1, CELL*.018)); }
    X.restore();
    /* the number, carved into the stone */
    if(n !== B.TOP){ var fs = Math.max(8, CELL*.21); X.font = '800 ' + fs + 'px ' + FONT; X.textAlign = 'left'; X.textBaseline = 'top';
      X.fillStyle = 'rgba(0,0,0,.45)'; X.fillText(n, x + CELL*.08, y + CELL*.07 + Math.max(1, CELL*.012));
      X.fillStyle = 'rgba(236,220,196,.62)'; X.fillText(n, x + CELL*.08, y + CELL*.07); }
    return { x:x, y:y, s:s };
  }

  function crater(X, n, B){
    var c = B.sq(n), CELL = B.CELL, pts = [], k, m = 13;
    for(k = 0; k < m; k++){ var a = k/m*Math.PI*2 + rnd(n + k)*.3, rr2 = CELL*(.33 + rnd(n*3 + k)*.12); pts.push([c.x + Math.cos(a)*rr2, c.y + Math.sin(a)*rr2*.92]); }
    function path(dx, dy){ X.beginPath(); pts.forEach(function(p, i){ i ? X.lineTo(p[0] + dx, p[1] + dy) : X.moveTo(p[0] + dx, p[1] + dy); }); X.closePath(); }
    /* broken edges reaching out to the corners of what is left of the tile */
    for(k = 0; k < 4; k++){ var cxn = c.x + (k % 2 ? 1 : -1)*CELL*.42, cyn = c.y + (k > 1 ? 1 : -1)*CELL*.42; var e = pts[Math.floor(rnd(n + k*7)*m)];
      if(rnd(n*2 + k) < .75){ X.save(); crackLine(X, e[0], e[1], Math.atan2(cyn - e[1], cxn - e[0]), Math.hypot(cxn - e[0], cyn - e[1])*.8, n*5 + k, Math.max(1, CELL*.02), 1); X.restore(); } }
    X.save(); path(0, 0); X.clip();
    var wall = X.createLinearGradient(0, c.y - CELL*.45, 0, c.y + CELL*.2); wall.addColorStop(0, '#5a3828'); wall.addColorStop(1, '#170c09');
    X.fillStyle = wall; X.fillRect(c.x - CELL, c.y - CELL, CELL*2, CELL*2);
    var deep = X.createRadialGradient(c.x, c.y + CELL*.14, CELL*.02, c.x, c.y + CELL*.14, CELL*.45); deep.addColorStop(0, '#000'); deep.addColorStop(.7, '#07030a'); deep.addColorStop(1, '#1b0e0b');
    X.fillStyle = deep; path(0, CELL*.13); X.fill();
    X.restore();
    X.lineJoin = 'round'; X.strokeStyle = 'rgba(0,0,0,.65)'; X.lineWidth = Math.max(1.5, CELL*.03); path(0, 0); X.stroke();
    X.save(); X.beginPath(); X.rect(c.x - CELL, c.y - CELL, CELL*2, CELL*.75); X.clip();
    X.strokeStyle = 'rgba(255,214,170,.22)'; X.lineWidth = Math.max(1, CELL*.018); path(0, CELL*.015); X.stroke(); X.restore();
    for(k = 0; k < 4; k++){ var p = pts[Math.floor(rnd(n*3 + k*5)*m)], sz = CELL*(.025 + rnd(n + k*9)*.03);
      X.fillStyle = k % 2 ? '#6b5246' : '#4c3a31'; X.beginPath(); X.ellipse(p[0] + (rnd(k + n) - .5)*CELL*.08, p[1] + (rnd(k*2 + n) - .3)*CELL*.06, sz*1.3, sz, rnd(n + k)*3, 0, 7); X.fill(); }
  }

  function craterCracks(X, B){
    (B.craters || []).forEach(function(h){
      var rc = cellOf(h, B.COLS);
      for(var dr = -1; dr <= 1; dr++) for(var dc = -1; dc <= 1; dc++){
        if(!dr && !dc) continue; var n = squareAt(rc.row + dr, rc.col + dc, B.COLS); if(n < 1 || n > B.TOP || B.isCrater(n)) continue;
        if((dr && dc) && rnd(h*3 + n) < .5) continue;
        var c = B.sq(n), CELL = B.CELL, hc = B.sq(h), ang = Math.atan2(c.y - hc.y, c.x - hc.x);
        var sx = c.x - Math.cos(ang)*CELL*.46, sy = c.y - Math.sin(ang)*CELL*.46;
        X.save(); X.beginPath(); X.rect(c.x - CELL/2, c.y - CELL/2, CELL, CELL); X.clip();
        crackLine(X, sx, sy, ang + (rnd(n + h) - .5)*.7, CELL*(.35 + rnd(n*h)*.3), n*13 + h, Math.max(1, CELL*.022));
        X.restore();
      }
    });
  }

  function baseCamp(X, B){
    var n = Math.round(B.TOP/2), c = B.sq(n), C = B.CELL, x = c.x + C*.2, y = c.y + C*.28;
    X.save(); X.globalAlpha = .55;
    X.fillStyle = '#d98b4a'; X.beginPath(); X.moveTo(x - C*.17, y); X.lineTo(x, y - C*.2); X.lineTo(x + C*.17, y); X.closePath(); X.fill();
    X.fillStyle = '#3a2016'; X.beginPath(); X.moveTo(x - C*.04, y); X.lineTo(x, y - C*.11); X.lineTo(x + C*.04, y); X.closePath(); X.fill();
    X.restore();
  }

  var layerCache = { key:'', cv:null };
  function boardLayer(B, dpr){
    var wear = clamp((B.age || 0)/45, 0, 1), wb = Math.round(wear*8)/8;
    var key = [B.W, B.H, B.CELL, dpr, (B.craters || []).slice().sort().join('.'), wb, B.TOP].join('|');
    if(layerCache.key === key && layerCache.cv) return layerCache.cv;
    var cv = layerCache.cv || document.createElement('canvas'); cv.width = Math.max(1, Math.round(B.W*dpr)); cv.height = Math.max(1, Math.round(B.H*dpr));
    var X = cv.getContext('2d'); X.setTransform(dpr, 0, 0, dpr, 0, 0); X.clearRect(0, 0, B.W, B.H);
    var base = X.createLinearGradient(0, 0, 0, B.H); base.addColorStop(0, '#1a0f10'); base.addColorStop(1, '#120a0b'); X.fillStyle = base; X.fillRect(0, 0, B.W, B.H);
    var L = Object.assign({}, B, { X:X });
    for(var n = 1; n <= B.TOP; n++) tile(X, n, L, wb);
    craterCracks(X, L);
    for(n = 1; n <= B.TOP; n++) if(B.isCrater(n)) crater(X, n, L);
    baseCamp(X, L);
    layerCache.key = key; layerCache.cv = cv; return cv;
  }

  function summit(X, B){
    var c = B.sq(B.TOP), C = B.CELL, T = RM ? 0 : B.T;
    var glow = X.createRadialGradient(c.x, c.y, 0, c.x, c.y, C*.7); glow.addColorStop(0, 'rgba(255,214,120,' + (.22 + .08*Math.sin(T*.003)) + ')'); glow.addColorStop(1, 'rgba(255,214,120,0)');
    X.fillStyle = glow; X.fillRect(c.x - C, c.y - C, C*2, C*2);
    var by = c.y + C*.3;
    X.fillStyle = '#5b4236'; X.beginPath(); X.moveTo(c.x - C*.36, by); X.lineTo(c.x - C*.05, by - C*.42); X.lineTo(c.x + C*.36, by); X.closePath(); X.fill();
    X.fillStyle = '#f6ecdc'; X.beginPath(); X.moveTo(c.x - C*.13, by - C*.31); X.lineTo(c.x - C*.05, by - C*.42); X.lineTo(c.x + C*.06, by - C*.3); X.lineTo(c.x, by - C*.33); X.lineTo(c.x - C*.06, by - C*.29); X.closePath(); X.fill();
    var px = c.x - C*.05, top = by - C*.78;
    X.strokeStyle = '#2a1a14'; X.lineWidth = Math.max(1.5, C*.03); X.beginPath(); X.moveTo(px, by - C*.4); X.lineTo(px, top); X.stroke();
    X.fillStyle = '#e6b655'; X.beginPath(); X.moveTo(px, top);
    for(var i = 0; i <= 6; i++){ var u = i/6; X.lineTo(px + u*C*.32, top + C*.04 + Math.sin(u*4 - T*.008)*C*.035*u); }
    for(i = 6; i >= 0; i--){ u = i/6; X.lineTo(px + u*C*.32, top + C*.17 + Math.sin(u*4 - T*.008)*C*.035*u); }
    X.closePath(); X.fill();
  }

  /* ================= ladders ================= */
  function ladder(X, a, b, l, B){
    var C = B.CELL, maxH = l.maxHealth || 9, r = clamp((l.health == null ? maxH : l.health)/maxH, 0, 1);
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx/len, uy = dy/len, nx = -uy, ny = ux, w = C*.17, ext = C*.2;
    var A = { x:a.x - ux*ext, y:a.y - uy*ext }, Bt = { x:b.x + ux*ext, y:b.y + uy*ext };
    var fresh = '#d6a05a', aged = '#8f7258', wood = rgba(mixc(aged, fresh, r)), woodDk = rgba(mixc('#4a3326', '#8a5a2b', r)), woodHi = rgba(mixc('#b8a08a', '#f3cf92', r));
    var rungs = Math.max(3, Math.floor(len/(C*.4))), i, t, px, py;
    function railPath(s, ox, oy){ X.beginPath(); X.moveTo(A.x + nx*w*s + ox, A.y + ny*w*s + oy); X.lineTo(Bt.x + nx*w*s + ox, Bt.y + ny*w*s + oy); }
    function rungState(i){ var f = rnd(l.from*13 + l.to*7 + i); if(r < f*.55) return 2; if(r < .3 + f*.55) return 1; return 0; }
    /* shadow on the stone */
    var sx = C*.05, sy = C*.08; X.lineCap = 'round'; X.strokeStyle = 'rgba(0,0,0,.38)';
    X.lineWidth = C*.085; [-1, 1].forEach(function(s){ railPath(s, sx, sy); X.stroke(); });
    X.lineWidth = C*.06;
    for(i = 1; i < rungs; i++){ if(rungState(i) === 2) continue; t = i/rungs; px = a.x + dx*t + sx; py = a.y + dy*t + sy; X.beginPath(); X.moveTo(px + nx*w, py + ny*w); X.lineTo(px - nx*w, py - ny*w); X.stroke(); }
    /* rungs */
    for(i = 1; i < rungs; i++){
      t = i/rungs; px = a.x + dx*t; py = a.y + dy*t; var st = rungState(i);
      if(st === 2){
        [-1, 1].forEach(function(s){ var bx = px + nx*w*s, by = py + ny*w*s, ex = px + nx*w*s*.25 - ux*C*.12, ey = py + ny*w*s*.25 - uy*C*.12;
          X.strokeStyle = woodDk; X.lineWidth = C*.065; X.beginPath(); X.moveTo(bx, by); X.lineTo(ex, ey); X.stroke();
          X.strokeStyle = wood; X.lineWidth = C*.04; X.beginPath(); X.moveTo(bx, by); X.lineTo(ex, ey); X.stroke();
          X.fillStyle = woodHi; X.beginPath(); X.moveTo(ex, ey); X.lineTo(ex - nx*s*C*.03 - ux*C*.04, ey - ny*s*C*.03 - uy*C*.04); X.lineTo(ex + ux*C*.02, ey + uy*C*.02); X.closePath(); X.fill(); });
        continue;
      }
      var sag = st === 1 ? C*.035 : 0, mx = px - ux*sag, my = py - uy*sag;
      X.strokeStyle = woodDk; X.lineWidth = C*.075; X.beginPath(); X.moveTo(px + nx*w, py + ny*w); X.quadraticCurveTo(mx, my, px - nx*w, py - ny*w); X.stroke();
      X.strokeStyle = wood; X.lineWidth = C*.05; X.beginPath(); X.moveTo(px + nx*w, py + ny*w); X.quadraticCurveTo(mx, my, px - nx*w, py - ny*w); X.stroke();
      X.strokeStyle = woodHi; X.globalAlpha = .55; X.lineWidth = Math.max(1, C*.012); X.beginPath(); X.moveTo(px + nx*w*.8 + ux*C*.012, py + ny*w*.8 + uy*C*.012); X.lineTo(px - nx*w*.8 + ux*C*.012, py - ny*w*.8 + uy*C*.012); X.stroke(); X.globalAlpha = 1;
      if(st === 1){ X.strokeStyle = 'rgba(20,10,6,.9)'; X.lineWidth = Math.max(1, C*.016); X.beginPath();
        X.moveTo(mx + nx*C*.015 + ux*C*.03, my + ny*C*.015 + uy*C*.03); X.lineTo(mx - nx*C*.01, my - ny*C*.01 + 0); X.lineTo(mx + nx*C*.01 - ux*C*.03, my + ny*C*.01 - uy*C*.03); X.stroke(); }
    }
    /* rails */
    [-1, 1].forEach(function(s){
      X.strokeStyle = woodDk; X.lineWidth = C*.095; railPath(s, 0, 0); X.stroke();
      X.strokeStyle = wood; X.lineWidth = C*.065; railPath(s, 0, 0); X.stroke();
      X.strokeStyle = woodHi; X.globalAlpha = .6; X.lineWidth = Math.max(1, C*.016); railPath(s, -nx*C*.015, -ny*C*.015); X.stroke(); X.globalAlpha = 1;
      /* grain */
      X.strokeStyle = 'rgba(60,35,20,.35)'; X.lineWidth = Math.max(.8, C*.01);
      for(var g = 0; g < 4; g++){ var g0 = rnd(l.from + g*3 + s)*.8, g1 = g0 + .06 + rnd(l.to + g)*.08;
        X.beginPath(); X.moveTo(A.x + (Bt.x - A.x)*g0 + nx*w*s + nx*C*.012, A.y + (Bt.y - A.y)*g0 + ny*w*s + ny*C*.012); X.lineTo(A.x + (Bt.x - A.x)*g1 + nx*w*s + nx*C*.012, A.y + (Bt.y - A.y)*g1 + ny*w*s + ny*C*.012); X.stroke(); }
    });
    /* nails where each rung meets a rail */
    X.fillStyle = 'rgba(40,30,28,.85)';
    for(i = 1; i < rungs; i++){ if(rungState(i) === 2) continue; t = i/rungs; px = a.x + dx*t; py = a.y + dy*t;
      [-1, 1].forEach(function(s){ X.beginPath(); X.arc(px + nx*w*s, py + ny*w*s, Math.max(1, C*.014), 0, 7); X.fill(); }); }
    /* rot, moss and a split rail as the ladder gives out */
    if(r < .55){ for(i = 0; i < 3; i++){ var u = .15 + rnd(l.from*3 + i)*.7, s2 = i % 2 ? 1 : -1, qx = A.x + (Bt.x - A.x)*u + nx*w*s2, qy = A.y + (Bt.y - A.y)*u + ny*w*s2;
        X.fillStyle = i === 1 ? 'rgba(110,150,80,.75)' : 'rgba(40,25,18,.7)'; X.beginPath(); X.ellipse(qx, qy, C*.035, C*.025, Math.atan2(uy, ux), 0, 7); X.fill(); } }
    if(r < .34){ var su = .3 + rnd(l.to*5)*.4, s3 = rnd(l.from*9) < .5 ? -1 : 1, cx = A.x + (Bt.x - A.x)*su + nx*w*s3, cy = A.y + (Bt.y - A.y)*su + ny*w*s3;
      X.strokeStyle = 'rgba(15,8,5,.95)'; X.lineWidth = Math.max(1.2, C*.02); X.beginPath();
      X.moveTo(cx - ux*C*.09, cy - uy*C*.09); X.lineTo(cx - ux*C*.03 + nx*C*.02, cy - uy*C*.03 + ny*C*.02); X.lineTo(cx + ux*C*.03 - nx*C*.02, cy + uy*C*.03 - ny*C*.02); X.lineTo(cx + ux*C*.09, cy + uy*C*.09); X.stroke(); }
  }

  /* ================= snakes ================= */
  var SNAKE_COLS = [ { b:'#5fb36c', d:'#2c6a3a', p:'#3d8a4c', e:'#f2d34a' }, { b:'#a3b545', d:'#556220', p:'#748629', e:'#f5b84a' },
                     { b:'#46a796', d:'#1d5a50', p:'#2f7f71', e:'#f2d34a' }, { b:'#d38a42', d:'#7a4519', p:'#a8622a', e:'#ffe07a' } ];
  function snakePoint(s, u, B){
    var head = B.sq(s.from), tail = B.sq(s.to), dx = tail.x - head.x, dy = tail.y - head.y, len = Math.hypot(dx, dy) || 1, nx = -dy/len, ny = dx/len;
    var amp = B.CELL*.34, strike = s._writhe || 0, T = RM ? 0 : B.T, speed = (s.stir || 0) > 0 ? .0032 : .0016;
    var wob = Math.sin(u*Math.PI*3 + T*speed + s.from + strike*6)*amp*(1 - u*.12)*(1 + strike*1.1)*(.15 + .85*u);
    return { x:head.x + dx*u + nx*wob, y:head.y + dy*u + ny*wob };
  }
  function snake(X, s, B){
    var C = B.CELL, pal = SNAKE_COLS[Math.floor(rnd(s.from*2.7 + s.to)*SNAKE_COLS.length)], N = 46, P = [], i, T = RM ? 0 : B.T;
    for(i = 0; i <= N; i++) P.push(snakePoint(s, .035 + .965*i/N, B));
    var base = C*.25, L = [], R = [], W = [];
    for(i = 0; i <= N; i++){
      var u = i/N, p = P[i], q = P[Math.min(N, i + 1)], o = P[Math.max(0, i - 1)], tx = q.x - o.x, ty = q.y - o.y, tl = Math.hypot(tx, ty) || 1;
      var w = base*(u < .08 ? .72 + u/.08*.28 : Math.pow(1 - (u - .08)/.92, .85)*.92 + .08); W.push(w);
      L.push({ x:p.x - ty/tl*w/2, y:p.y + tx/tl*w/2 }); R.push({ x:p.x + ty/tl*w/2, y:p.y - tx/tl*w/2 });
    }
    function body(ox, oy){ X.beginPath(); X.moveTo(L[0].x + ox, L[0].y + oy); for(var k = 1; k <= N; k++) X.lineTo(L[k].x + ox, L[k].y + oy);
      for(k = N; k >= 0; k--) X.lineTo(R[k].x + ox, R[k].y + oy); X.closePath(); }
    X.fillStyle = 'rgba(0,0,0,.36)'; body(C*.05, C*.09); X.fill();
    X.fillStyle = pal.b; body(0, 0); X.fill();
    /* scales: a row of diamonds along the back, and a sheen down one side */
    X.save(); body(0, 0); X.clip();
    X.fillStyle = pal.p;
    for(i = 2; i < N - 2; i += 2){ var p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], ww = W[i + 1]*.34, ax = p2.x - p0.x, ay = p2.y - p0.y, al = Math.hypot(ax, ay) || 1;
      X.beginPath(); X.moveTo(p0.x, p0.y); X.lineTo(p1.x - ay/al*ww, p1.y + ax/al*ww); X.lineTo(p2.x, p2.y); X.lineTo(p1.x + ay/al*ww, p1.y - ax/al*ww); X.closePath(); X.fill(); }
    X.strokeStyle = 'rgba(255,255,255,.22)'; X.lineCap = 'round';
    for(i = 1; i < N; i++){ var pp = P[i], lw = W[i]; X.lineWidth = Math.max(1, lw*.16); X.beginPath(); X.moveTo((L[i].x*3 + pp.x)/4, (L[i].y*3 + pp.y)/4); X.lineTo((L[i + 1].x*3 + P[i + 1].x)/4, (L[i + 1].y*3 + P[i + 1].y)/4); X.stroke(); }
    X.restore();
    X.strokeStyle = pal.d; X.lineWidth = Math.max(1, C*.018); X.lineJoin = 'round'; body(0, 0); X.stroke();
    /* the head */
    var h = snakePoint(s, 0, B), nk = P[2], hx = h.x - nk.x, hy = h.y - nk.y, hl = Math.hypot(hx, hy) || 1, ang = Math.atan2(hy/hl, hx/hl);
    var stir = s.stir || 0, awake = stir > 0 || (s._writhe || 0) > .05, angry = stir >= (s.threshold || 3) - 1 && stir > 0;
    s._eye = s._eye == null ? (awake ? 1 : 0) : s._eye + ((awake ? 1 : 0) - s._eye)*(RM ? 1 : .12);
    X.save(); X.translate(h.x, h.y); X.rotate(ang);
    var HL = C*.21, HW = C*.165;
    X.fillStyle = 'rgba(0,0,0,.36)'; X.beginPath(); X.ellipse(C*.05, C*.09, HL, HW, 0, 0, 7); X.fill();
    X.fillStyle = pal.b; X.beginPath(); X.moveTo(-HL*.9, -HW*.85); X.bezierCurveTo(HL*.2, -HW*1.25, HL*1.15, -HW*.6, HL*1.1, 0); X.bezierCurveTo(HL*1.15, HW*.6, HL*.2, HW*1.25, -HL*.9, HW*.85); X.closePath(); X.fill();
    X.strokeStyle = pal.d; X.lineWidth = Math.max(1, C*.018); X.stroke();
    X.fillStyle = pal.p; X.beginPath(); X.ellipse(-HL*.1, 0, HL*.38, HW*.3, 0, 0, 7); X.fill();
    X.fillStyle = 'rgba(255,255,255,.18)'; X.beginPath(); X.ellipse(HL*.15, -HW*.45, HL*.45, HW*.18, 0, 0, 7); X.fill();
    X.fillStyle = pal.d; X.beginPath(); X.arc(HL*.92, -HW*.22, Math.max(.8, C*.012), 0, 7); X.arc(HL*.92, HW*.22, Math.max(.8, C*.012), 0, 7); X.fill();
    var eo = s._eye, er = C*.058;
    [-1, 1].forEach(function(sd){ var ex = HL*.35, ey = HW*.55*sd;
      X.fillStyle = pal.d; X.beginPath(); X.arc(ex, ey, er*1.18, 0, 7); X.fill();
      if(eo < .12){ X.strokeStyle = '#1c1013'; X.lineWidth = Math.max(1.2, C*.02); X.lineCap = 'round'; X.beginPath(); X.arc(ex, ey - er*.2*sd, er*.8, sd > 0 ? .3 : Math.PI + .3, sd > 0 ? Math.PI - .3 : Math.PI*2 - .3); X.stroke(); return; }
      X.save(); X.beginPath(); X.ellipse(ex, ey, er, er*eo, 0, 0, 7); X.clip();
      X.fillStyle = angry ? '#ff8a3d' : pal.e; X.beginPath(); X.arc(ex, ey, er, 0, 7); X.fill();
      X.fillStyle = '#140a0a'; X.beginPath(); X.ellipse(ex + er*.1, ey, er*.55, er*.2, 0, 0, 7); X.fill();
      X.fillStyle = 'rgba(255,255,255,.8)'; X.beginPath(); X.arc(ex - er*.35, ey - er*.35*sd, er*.22, 0, 7); X.fill();
      X.restore();
      X.strokeStyle = pal.d; X.lineWidth = Math.max(1, C*.016); X.beginPath(); X.ellipse(ex, ey, er, er*Math.max(eo, .12), 0, 0, 7); X.stroke(); });
    if(awake && eo > .6){ var ph = ((T*.001 + s.from*.37) % 1.6); if(ph < .35){ var tg = C*(.12 + .1*Math.sin(ph/.35*Math.PI));
        X.strokeStyle = '#e04a4a'; X.lineWidth = Math.max(1.2, C*.018); X.lineCap = 'round'; X.beginPath(); X.moveTo(HL*1.05, 0); X.lineTo(HL*1.05 + tg, 0);
        X.lineTo(HL*1.05 + tg + C*.04, -C*.03); X.moveTo(HL*1.05 + tg, 0); X.lineTo(HL*1.05 + tg + C*.04, C*.03); X.stroke(); } }
    X.restore();
    /* asleep: a lazy trail of z's */
    if(eo < .5){ X.save(); X.textAlign = 'center'; X.textBaseline = 'middle';
      for(i = 0; i < 3; i++){ var f = RM ? i/3 : ((T*.00045 + s.from*.13 + i/3) % 1), zs = C*(.13 + f*.12);
        X.globalAlpha = Math.sin(f*Math.PI)*.9*(1 - eo*2); X.font = '900 ' + zs + 'px ' + FONT;
        X.fillStyle = 'rgba(28,16,19,.6)'; X.fillText('z', h.x + C*(.18 + f*.22) + 1, h.y - C*(.2 + f*.42) + 1);
        X.fillStyle = '#fbf1e2'; X.fillText('z', h.x + C*(.18 + f*.22), h.y - C*(.2 + f*.42)); }
      X.restore(); }
  }

  /* ================= climbers ================= */
  var SKIN = ['#f3cfae', '#dba57d', '#b07650', '#7c4b33', '#e8b98f'];
  function climber(X, x, y, B, o){
    o = o || {}; var C = B.CELL, S = C*.4*(o.scale || 1), col = o.col || '#e6b655', T = RM ? 0 : B.T;
    var small = C < 42;
    X.save();
    X.fillStyle = 'rgba(0,0,0,.4)'; X.beginPath(); X.ellipse(x, y + S*.62, S*.62, S*.2, 0, 0, 7); X.fill();
    if(o.active){ var pul = .5 + .5*Math.sin(T*.006); X.strokeStyle = 'rgba(255,230,160,' + (.45 + .4*pul) + ')'; X.lineWidth = Math.max(1.5, C*.03);
      X.beginPath(); X.ellipse(x, y + S*.62, S*(.8 + .15*pul), S*(.28 + .05*pul), 0, 0, 7); X.stroke(); }
    /* backpack */
    X.fillStyle = '#6b4128'; rr(X, x + S*.28, y - S*.08, S*.42, S*.5, S*.12); X.fill();
    X.fillStyle = 'rgba(0,0,0,.25)'; rr(X, x + S*.28, y + S*.24, S*.42, S*.18, S*.08); X.fill();
    /* body */
    var bg = X.createLinearGradient(x, y - S*.15, x, y + S*.62); bg.addColorStop(0, shade(col, .12)); bg.addColorStop(1, shade(col, -.3));
    X.fillStyle = bg; X.beginPath(); X.moveTo(x - S*.42, y + S*.6); X.quadraticCurveTo(x - S*.52, y - S*.05, x, y - S*.18); X.quadraticCurveTo(x + S*.52, y - S*.05, x + S*.42, y + S*.6); X.closePath(); X.fill();
    X.strokeStyle = shade(col, -.5); X.lineWidth = Math.max(1, C*.015); X.stroke();
    if(o.initial && !small){ X.font = '900 ' + (S*.5) + 'px ' + FONT; X.textAlign = 'center'; X.textBaseline = 'middle';
      X.lineWidth = Math.max(1.5, S*.1); X.strokeStyle = 'rgba(20,10,12,.6)'; X.strokeText(o.initial, x, y + S*.3); X.fillStyle = '#fffaf0'; X.fillText(o.initial, x, y + S*.3); }
    /* head */
    var hy = y - S*.42, hr = S*.34;
    X.fillStyle = o.skin || SKIN[0]; X.beginPath(); X.arc(x, hy, hr, 0, 7); X.fill(); X.strokeStyle = 'rgba(60,30,20,.55)'; X.lineWidth = Math.max(1, C*.012); X.stroke();
    if(!small){ X.fillStyle = '#1c1013'; X.beginPath(); X.arc(x - hr*.36, hy + hr*.12, Math.max(.9, hr*.11), 0, 7); X.arc(x + hr*.36, hy + hr*.12, Math.max(.9, hr*.11), 0, 7); X.fill();
      X.fillStyle = 'rgba(230,110,100,.35)'; X.beginPath(); X.arc(x - hr*.55, hy + hr*.42, hr*.16, 0, 7); X.arc(x + hr*.55, hy + hr*.42, hr*.16, 0, 7); X.fill(); }
    /* woolly hat with a bobble */
    var hat = shade(col, .28);
    X.fillStyle = hat; X.beginPath(); X.moveTo(x - hr*1.02, hy - hr*.05); X.quadraticCurveTo(x - hr*.95, hy - hr*1.35, x, hy - hr*1.3); X.quadraticCurveTo(x + hr*.95, hy - hr*1.35, x + hr*1.02, hy - hr*.05); X.closePath(); X.fill();
    X.fillStyle = shade(col, -.15); rr(X, x - hr*1.08, hy - hr*.32, hr*2.16, hr*.36, hr*.16); X.fill();
    if(!small){ X.strokeStyle = 'rgba(0,0,0,.18)'; X.lineWidth = Math.max(.8, C*.008); for(var k = -2; k <= 2; k++){ X.beginPath(); X.moveTo(x + k*hr*.32, hy - hr*.34); X.lineTo(x + k*hr*.28, hy - hr*1.1); X.stroke(); } }
    X.fillStyle = '#fbf1e2'; X.beginPath(); X.arc(x, hy - hr*1.35, hr*.3, 0, 7); X.fill();
    X.restore();
  }

  /* ================= the sky: morning to dusk, clouds, storms ================= */
  var SKY = [ [0,   '#22284f', '#6c5a86', '#f0a66e', '#ffd9a0'],
              [.35, '#2c4a7c', '#6d8db0', '#d9c9a4', '#fff2c8'],
              [.7,  '#3a3f72', '#9a6a86', '#f0ad6a', '#ffd08a'],
              [1,   '#160f2c', '#5c2848', '#e2683a', '#ff9a5a'] ];
  function skyCols(p){ for(var i = 1; i < SKY.length; i++){ if(p <= SKY[i][0]){ var a = SKY[i - 1], b = SKY[i], t = (p - a[0])/(b[0] - a[0]);
      return [mixc(a[1], b[1], t), mixc(a[2], b[2], t), mixc(a[3], b[3], t), mixc(a[4], b[4], t)]; } }
    var z = SKY[SKY.length - 1]; return [hex(z[1]), hex(z[2]), hex(z[3]), hex(z[4])]; }
  function ridge(W, H, seed, base, amp, jag){ var pts = [], n = 90, k = Math.min(1, W*.75/H); amp *= k; jag *= k;
    for(var i = 0; i <= n; i++){ var u = i/n, y = base;
      y -= amp*(.55*Math.max(0, Math.sin(u*Math.PI*(2 + seed % 2) + seed)) + .3*Math.sin(u*Math.PI*5.3 + seed*2) + .15*Math.sin(u*Math.PI*11 + seed*3));
      y += (rnd(seed*100 + i) - .5)*jag; pts.push([u*W, y*H]); }
    return pts; }
  function drawRidge(X, pts, W, H, fill){ X.fillStyle = fill; X.beginPath(); X.moveTo(0, H); pts.forEach(function(p){ X.lineTo(p[0], p[1]); }); X.lineTo(W, H); X.closePath(); X.fill(); }
  function cloud(X, x, y, s, col, a){ X.fillStyle = rgba(col, a); X.beginPath();
    X.ellipse(x, y, s*1.6, s*.55, 0, 0, 7); X.ellipse(x - s*.8, y + s*.08, s*.8, s*.45, 0, 0, 7); X.ellipse(x + s*.7, y - s*.18, s*.9, s*.6, 0, 0, 7); X.ellipse(x + s*.05, y - s*.4, s*.7, s*.5, 0, 0, 7); X.fill(); }

  function drawSky(X, W, H, st, T){
    var p = clamp(st.prog, 0, 1), storm = clamp(st.storm, 0, 1), K = skyCols(p), dark = [14, 14, 26];
    var top = mixc(K[0], dark, storm*.6), mid = mixc(K[1], [40, 42, 60], storm*.65), hor = mixc(K[2], [70, 70, 84], storm*.7);
    var g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgba(top)); g.addColorStop(.5, rgba(mid)); g.addColorStop(.78, rgba(hor)); g.addColorStop(1, rgba(hor));
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    var night = clamp((p - .72)/.28, 0, 1)*(1 - storm);
    if(night > 0){ for(var i = 0; i < 90; i++){ var sx = rnd(i*3.3)*W, sy = rnd(i*5.1)*H*.5, tw = .5 + .5*Math.sin(T*.002 + i);
        X.fillStyle = 'rgba(255,245,225,' + (night*.75*(.4 + .6*tw)*(1 - sy/(H*.55))) + ')'; X.fillRect(sx, sy, 1.6, 1.6); } }
    /* the sun, low in the morning, high at noon, setting at dusk */
    var sunX = W*(.1 + .8*p), sunY = H*(.6 - .42*Math.sin(Math.PI*p)), sr = Math.min(W, H)*.06, sa = 1 - storm*.85;
    var sg = X.createRadialGradient(sunX, sunY, 0, sunX, sunY, sr*6); sg.addColorStop(0, rgba(K[3], .55*sa)); sg.addColorStop(.25, rgba(K[3], .18*sa)); sg.addColorStop(1, rgba(K[3], 0));
    X.fillStyle = sg; X.fillRect(0, 0, W, H);
    X.fillStyle = rgba(mixc(K[3], [255, 255, 255], .35), .95*sa); X.beginPath(); X.arc(sunX, sunY, sr, 0, 7); X.fill();
    /* far range with snow, then nearer ranges fading into the dark */
    var far = mixc(mixc(K[1], [30, 26, 44], .45), dark, storm*.5);
    var R1 = ridge(W, H, 3, .66, .3, .012), R2 = ridge(W, H, 7, .78, .2, .01), R3 = ridge(W, H, 11, .9, .14, .008);
    drawRidge(X, R1, W, H, rgba(far));
    X.save(); X.beginPath(); X.moveTo(0, H); R1.forEach(function(q){ X.lineTo(q[0], q[1]); }); X.lineTo(W, H); X.closePath(); X.clip();
    var snowLine = H*.46; var sgr = X.createLinearGradient(0, H*.3, 0, snowLine); sgr.addColorStop(0, rgba(mixc([250, 244, 236], K[2], .25), .85*(1 - storm*.4))); sgr.addColorStop(1, rgba([250, 244, 236], 0));
    X.fillStyle = sgr; X.fillRect(0, 0, W, snowLine);
    var lit = X.createLinearGradient(sunX - W*.3, 0, sunX + W*.3, 0); lit.addColorStop(0, rgba(K[3], 0)); lit.addColorStop(.5, rgba(K[3], .16*sa)); lit.addColorStop(1, rgba(K[3], 0));
    X.fillStyle = lit; X.fillRect(0, 0, W, H); X.restore();
    /* clouds drifting across */
    var cc = mixc(mixc(K[2], [255, 255, 255], .3), [70, 72, 90], storm), nCl = 6 + Math.round(storm*6);
    for(i = 0; i < nCl; i++){ var cs = Math.min(W, H)*(.05 + rnd(i*7.7)*.06), span = W + cs*6, cx = ((rnd(i*2.2)*span + (RM ? 0 : T)*(.004 + rnd(i)*.006)*(1 + storm*2)) % span) - cs*3;
      cloud(X, cx, H*(.08 + rnd(i*4.4)*.32), cs, cc, (.22 + rnd(i*1.3)*.2)*(1 - p*.2) + storm*.35); }
    drawRidge(X, R2, W, H, rgba(mixc(mixc(far, [24, 16, 22], .45), dark, storm*.4)));
    drawRidge(X, R3, W, H, rgba(mixc([24, 14, 18], dark, storm*.3)));
    /* pines on the nearest ridge */
    X.fillStyle = rgba(mixc([14, 8, 10], dark, storm*.3));
    for(i = 0; i < 46; i++){ var u = rnd(i*9.9), idx = Math.round(u*90), q = R3[idx], th = H*(.03 + rnd(i*3.7)*.035);
      X.beginPath(); X.moveTo(q[0] - th*.32, q[1] + th*.15); X.lineTo(q[0], q[1] - th); X.lineTo(q[0] + th*.32, q[1] + th*.15); X.closePath(); X.fill(); }
    /* a few birds on calm days */
    if(storm < .3 && !RM){ X.strokeStyle = 'rgba(30,20,28,' + (.55*(1 - storm*3)) + ')'; X.lineWidth = 1.6;
      for(i = 0; i < 3; i++){ var bx = ((T*.03*(1 + i*.2) + i*W*.4) % (W + 200)) - 100, by = H*(.18 + i*.05) + Math.sin(T*.001 + i)*H*.02, bw = 7 + i*2, fl = Math.sin(T*.012 + i*2)*3;
        X.beginPath(); X.moveTo(bx - bw, by - fl); X.quadraticCurveTo(bx - bw*.4, by - bw*.4, bx, by); X.quadraticCurveTo(bx + bw*.4, by - bw*.4, bx + bw, by - fl); X.stroke(); } }
    if(storm > 0){ X.fillStyle = 'rgba(8,8,18,' + (storm*.28) + ')'; X.fillRect(0, 0, W, H); }
  }
  function drawWeather(X, W, H, st, T){
    var storm = clamp(st.storm, 0, 1);
    if(storm > .01){
      X.fillStyle = 'rgba(6,6,16,' + (storm*.22) + ')'; X.fillRect(0, 0, W, H);
      var n = Math.round(storm*(RM ? 60 : 260)); X.strokeStyle = 'rgba(190,205,235,' + (.35*storm + .1) + ')'; X.lineWidth = 1.3; X.beginPath();
      for(var i = 0; i < n; i++){ var sp = .7 + rnd(i*1.9)*.6, len = 14 + rnd(i*3.1)*18, x0 = rnd(i*5.7)*(W + 200), y = ((rnd(i*2.3)*H + (RM ? 0 : T)*sp) % (H + 40)) - 20, x = x0 - y*.25;
        X.moveTo(x, y); X.lineTo(x - len*.25, y + len); }
      X.stroke();
    }
    if(st.flash > .01){ X.fillStyle = 'rgba(235,240,255,' + (st.flash*.5) + ')'; X.fillRect(0, 0, W, H); }
  }

  var Sky = { st:{ prog:0, storm:0, flash:0 }, target:{ prog:0, storm:0 }, cv:null, wx:null, raf:0, last:0, bolts:0,
    mount: function(){
      if(Sky.cv) return;
      var cv = document.createElement('canvas'); cv.id = 'ccSky'; cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;display:block;border:0;border-radius:0;box-shadow:none;background:none;margin:0;';
      var wx = document.createElement('canvas'); wx.id = 'ccWeather'; wx.setAttribute('aria-hidden', 'true');
      wx.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:4;pointer-events:none;display:block;border:0;border-radius:0;box-shadow:none;background:none;margin:0;';
      document.body.insertBefore(cv, document.body.firstChild); document.body.appendChild(wx); Sky.cv = cv; Sky.wx = wx;
      function size(){ var d = Math.min(1.5, window.devicePixelRatio || 1); [cv, wx].forEach(function(c){ c.width = Math.round(innerWidth*d); c.height = Math.round(innerHeight*d); c.getContext('2d').setTransform(d, 0, 0, d, 0, 0); }); Sky.paint(performance.now(), true); }
      window.addEventListener('resize', size); size();
      function tick(now){ Sky.raf = requestAnimationFrame(tick); if(document.hidden) return; if(now - Sky.last < 33) return; var dt = Math.min(100, now - (Sky.last || now)); Sky.last = now; Sky.step(dt, now); Sky.paint(now); }
      Sky.raf = requestAnimationFrame(tick);
    },
    step: function(dt, now){
      var s = Sky.st, t = Sky.target;
      s.prog += (t.prog - s.prog)*Math.min(1, dt*.0015); s.storm += (t.storm - s.storm)*Math.min(1, dt*(t.storm > s.storm ? .003 : .0012));
      s.flash = Math.max(0, s.flash - dt*.004);
      if(!RM && t.storm > .5 && s.storm > .6 && Math.random() < dt*.0006) Sky.lightning();
    },
    paint: function(now, force){
      if(!Sky.cv) return; var W = innerWidth, H = innerHeight, X = Sky.cv.getContext('2d'), Y = Sky.wx.getContext('2d');
      drawSky(X, W, H, Sky.st, now); Y.clearRect(0, 0, W, H); drawWeather(Y, W, H, Sky.st, now);
    },
    progress: function(p){ Sky.target.prog = clamp(p, 0, 1); },
    storm: function(on){ Sky.target.storm = on ? 1 : 0; if(on && !RM) setTimeout(Sky.lightning, 500); },
    lightning: function(){ if(RM) return; Sky.st.flash = 1; Sky.bolts++; try{ if(window.CreakArt.onThunder) window.CreakArt.onThunder(); }catch(e){} }
  };

  window.CreakArt = { tile:tile, crater:crater, boardLayer:boardLayer, summit:summit, ladder:ladder, snake:snake, snakePoint:snakePoint,
    climber:climber, sky:Sky, drawSky:drawSky, drawWeather:drawWeather, SKIN:SKIN, RM:RM };
})();
