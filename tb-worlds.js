/* TierBrain adventure maps: Escape the Keep, Out of the Labyrinth and Reach the Core.
   Draws each map as a living world instead of circles and lines: a torchlit dungeon of doors,
   portcullises, knights and vaults; a hedge maze of archways, closing walls and a Minotaur;
   a starfield of jump gates, energy walls, cruisers and airlocks. Your hero walks (or flies)
   along the path, obstacles break open when you beat them, and the goal comes alive at the top.

   Load before the game: <script src="tb-worlds.js?v=1" data-world="keep"></script>  (keep, maze, space)
   The game calls TBWorld.build(), update(), obstacle(), answer(), finish() and life(). */
(function(){
  'use strict';
  var S0 = document.currentScript || document.querySelector('script[src*="tb-worlds.js"]');
  var WORLD = (S0 && S0.getAttribute('data-world')) || 'keep';
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function rnd(n){ var x = Math.sin(n*127.1 + 311.7)*43758.5453; return x - Math.floor(x); }
  function clamp(x, a, b){ return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t){ return a + (b - a)*t; }
  function ease(t){ return t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2; }
  function hexA(h, a){ h = h.replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
  function rr(X, x, y, w, h, r){ X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }
  function glow(X, x, y, r, col, a){ var g = X.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); X.fillStyle = g; X.beginPath(); X.arc(x, y, r, 0, 7); X.fill(); }
  function shade(h, k){ h = h.replace('#', ''); var c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    c = c.map(function(v){ return Math.round(k < 0 ? v*(1 + k) : v + (255 - v)*k); }); return 'rgb(' + c.join(',') + ')'; }

  var PAL = {
    keep: { bg:'#16131d', stone:'#2a2532', stone2:'#221e29', mortar:'#0a080e', light:'#ffb347', path:'#4a4152', lip:'#4a4458', accent:'#ffce5c' },
    maze: { bg:'#10241a', stone:'#24482c', stone2:'#1c3a24', mortar:'#0a170f', light:'#ffe8a0', path:'#c7b289', lip:'#8c7a55', accent:'#e9c46a' },
    space:{ bg:'#060920', stone:'#5b2a86', stone2:'#1f4fa0', mortar:'#02030c', light:'#45e0ff', path:'#45e0ff', lip:'#2a6fa8', accent:'#ffce5c' }
  }[WORLD] || {};

  /* ================= the obstacles, drawn ================= */
  /* state: 'future' (far ahead), 'reach' (next move), 'done' (beaten), 'current' (where you stand) */
  var SPR = {};
  SPR.keep = {
    frame: function(X, x, y, s){ X.fillStyle = '#5d5769'; rr(X, x - s*.5, y - s*.58, s, s*1.08, s*.12); X.fill(); X.fillStyle = '#463f52'; rr(X, x - s*.42, y - s*.5, s*.84, s*.98, s*.08); X.fill(); },
    arch: function(X, x, y, w, h){ X.beginPath(); X.moveTo(x - w/2, y + h/2); X.lineTo(x - w/2, y - h/2 + w/2); X.arc(x, y - h/2 + w/2, w/2, Math.PI, 0); X.lineTo(x + w/2, y + h/2); X.closePath(); },
    gate: function(X, x, y, s, st, t){ this.frame(X, x, y, s); var w = s*.62, h = s*.8;
      if(st === 'done'){ X.fillStyle = '#07060a'; this.arch(X, x, y + s*.04, w, h); X.fill(); glow(X, x, y + s*.1, s*.4, '#ffb347', .25);
        X.fillStyle = '#5a361d'; X.beginPath(); X.moveTo(x - w/2, y - h/2 + s*.2); X.lineTo(x - w/2 - s*.12, y - h/2 + s*.26); X.lineTo(x - w/2 - s*.12, y + h/2 + s*.02); X.lineTo(x - w/2, y + h/2); X.fill(); return; }
      var g = X.createLinearGradient(x - w/2, 0, x + w/2, 0); g.addColorStop(0, '#5a361d'); g.addColorStop(.5, '#8a5a32'); g.addColorStop(1, '#4e2f19');
      X.fillStyle = g; this.arch(X, x, y + s*.04, w, h); X.fill();
      X.strokeStyle = 'rgba(30,16,8,.6)'; X.lineWidth = Math.max(1, s*.025); for(var i = 1; i < 4; i++){ X.beginPath(); X.moveTo(x - w/2 + w*i/4, y - h/2 + s*.12); X.lineTo(x - w/2 + w*i/4, y + h/2 + s*.04); X.stroke(); }
      X.fillStyle = '#2b2730'; [-.18, .22].forEach(function(k){ X.fillRect(x - w/2, y + s*k, w, s*.06); });
      X.strokeStyle = '#c9a24a'; X.lineWidth = Math.max(1.2, s*.035); X.beginPath(); X.arc(x + w*.22, y + s*.06, s*.06, 0, 7); X.stroke(); },
    timed: function(X, x, y, s, st, t){ this.frame(X, x, y, s); var w = s*.7, h = s*.82, lift = st === 'done' ? .78 : 0;
      X.fillStyle = '#07060a'; this.arch(X, x, y + s*.04, w, h); X.fill();
      if(st === 'done') glow(X, x, y + s*.1, s*.4, '#ffb347', .22);
      X.save(); this.arch(X, x, y + s*.04, w, h); X.clip(); var top = y - h/2 + s*.04, bot = y + h/2 + s*.04 - h*lift;
      X.strokeStyle = '#a3a7b3'; X.lineWidth = Math.max(1.5, s*.05);
      for(var i = 0; i < 5; i++){ var bx = x - w/2 + w*(i + .5)/5; X.beginPath(); X.moveTo(bx, top); X.lineTo(bx, bot); X.stroke();
        X.fillStyle = '#a3a7b3'; X.beginPath(); X.moveTo(bx - s*.04, bot); X.lineTo(bx, bot + s*.08); X.lineTo(bx + s*.04, bot); X.fill(); }
      for(i = 1; i < 4; i++){ var yy = top + (bot - top)*i/4; if(yy > top){ X.beginPath(); X.moveTo(x - w/2, yy); X.lineTo(x + w/2, yy); X.stroke(); } }
      X.restore();
      if(st !== 'done'){ var hx = x + s*.42, hy = y - s*.46; X.fillStyle = '#ff9d3c'; X.beginPath(); X.arc(hx, hy, s*.15, 0, 7); X.fill();
        X.fillStyle = '#2a1400'; X.beginPath(); X.moveTo(hx - s*.07, hy - s*.08); X.lineTo(hx + s*.07, hy - s*.08); X.lineTo(hx, hy); X.lineTo(hx + s*.07, hy + s*.08); X.lineTo(hx - s*.07, hy + s*.08); X.lineTo(hx, hy); X.closePath(); X.fill(); } },
    enemy: function(X, x, y, s, st, t){
      if(st === 'done'){ X.save(); X.translate(x, y + s*.22); X.rotate(1.2); X.fillStyle = '#6f7380'; rr(X, -s*.22, -s*.26, s*.44, s*.5, s*.12); X.fill(); X.restore();
        X.strokeStyle = '#8a8d96'; X.lineWidth = Math.max(1.5, s*.05); X.beginPath(); X.moveTo(x - s*.4, y + s*.38); X.lineTo(x - s*.05, y + s*.2); X.moveTo(x + s*.08, y + s*.16); X.lineTo(x + s*.36, y + s*.02); X.stroke(); return; }
      var bob = RM ? 0 : Math.sin(t*.003)*s*.02; y += bob;
      X.strokeStyle = '#c9ccd6'; X.lineWidth = Math.max(2, s*.07); X.lineCap = 'round'; X.beginPath(); X.moveTo(x - s*.45, y + s*.45); X.lineTo(x + s*.4, y - s*.5); X.stroke();
      X.strokeStyle = '#7a5a2a'; X.lineWidth = Math.max(2, s*.09); X.beginPath(); X.moveTo(x - s*.32, y + s*.2); X.lineTo(x - s*.14, y + s*.36); X.stroke();
      X.fillStyle = '#c0392b'; X.beginPath(); X.moveTo(x, y - s*.36); X.quadraticCurveTo(x + s*.32, y - s*.66, x + s*.36, y - s*.2); X.quadraticCurveTo(x + s*.12, y - s*.4, x, y - s*.3); X.fill();
      var g = X.createLinearGradient(x - s*.3, 0, x + s*.3, 0); g.addColorStop(0, '#6f7380'); g.addColorStop(.45, '#d5d8e0'); g.addColorStop(1, '#5b5f6b');
      X.fillStyle = g; rr(X, x - s*.27, y - s*.36, s*.54, s*.66, s*.16); X.fill(); X.strokeStyle = '#3b3e47'; X.lineWidth = Math.max(1, s*.03); X.stroke();
      X.fillStyle = '#0b0b10'; X.fillRect(x - s*.22, y - s*.1, s*.44, s*.07); X.fillRect(x - s*.02, y - s*.1, s*.04, s*.3);
      X.fillStyle = '#ff5d4d'; X.globalAlpha = .6 + .4*Math.sin(t*.006); X.fillRect(x - s*.15, y - s*.085, s*.07, s*.04); X.fillRect(x + s*.08, y - s*.085, s*.07, s*.04); X.globalAlpha = 1; },
    sealed: function(X, x, y, s, st, t){ this.frame(X, x, y, s); var w = s*.72, h = s*.84;
      var g = X.createLinearGradient(x, y - h/2, x, y + h/2); g.addColorStop(0, '#4b4656'); g.addColorStop(1, '#2b2733');
      if(st === 'done'){ X.fillStyle = '#07060a'; rr(X, x - w/2, y - h/2 + s*.04, w, h, s*.06); X.fill(); glow(X, x, y + s*.1, s*.4, '#b58be0', .3);
        X.fillStyle = g; X.save(); X.translate(x - w/2, y); X.transform(.35, 0, 0, 1, 0, 0); rr(X, 0, -h/2 + s*.04, w, h, s*.06); X.fill(); X.restore(); return; }
      X.fillStyle = g; rr(X, x - w/2, y - h/2 + s*.04, w, h, s*.06); X.fill();
      X.fillStyle = '#8a8396'; for(var i = 0; i < 4; i++) for(var j = 0; j < 2; j++){ X.beginPath(); X.arc(x - w*.38 + j*w*.76, y - h*.38 + i*h*.27 + s*.04, s*.03, 0, 7); X.fill(); }
      glow(X, x, y + s*.06, s*.36, '#b58be0', .35 + .15*Math.sin(t*.004));
      X.fillStyle = '#e8c35a'; rr(X, x - s*.15, y - s*.02, s*.3, s*.26, s*.05); X.fill();
      X.strokeStyle = '#e8c35a'; X.lineWidth = Math.max(1.5, s*.06); X.beginPath(); X.arc(x, y - s*.02, s*.1, Math.PI, 0); X.stroke();
      X.fillStyle = '#3a2600'; X.beginPath(); X.arc(x, y + s*.08, s*.035, 0, 7); X.fill(); X.fillRect(x - s*.015, y + s*.08, s*.03, s*.08); },
    start: function(X, x, y, s, st, t){ X.fillStyle = 'rgba(0,0,0,.4)'; X.beginPath(); X.ellipse(x, y + s*.1, s*.5, s*.3, 0, 0, 7); X.fill();
      X.strokeStyle = '#d8b04a'; X.lineWidth = Math.max(1, s*.03); for(var i = 0; i < 14; i++){ var a = rnd(i)*6.3, l = s*(.1 + rnd(i + 7)*.18), px = x + (rnd(i*3) - .5)*s*.7, py = y + s*.1 + (rnd(i*5) - .5)*s*.36;
        X.beginPath(); X.moveTo(px, py); X.lineTo(px + Math.cos(a)*l, py + Math.sin(a)*l*.5); X.stroke(); }
      X.strokeStyle = '#7d7f88'; X.lineWidth = Math.max(1.5, s*.05); X.beginPath(); X.arc(x - s*.42, y - s*.06, s*.06, 0, 7); X.arc(x - s*.3, y - s*.02, s*.06, 0, 7); X.stroke(); },
    goal: function(X, x, y, s, st, t, open){
      var tw = s*.42, H = s*1.15, gw = s*.9;
      X.fillStyle = '#4a4458'; [-1, 1].forEach(function(k){ var tx = x + k*(gw/2 + tw*.35); X.fillRect(tx - tw/2, y - H*.62, tw, H*1.1);
        for(var c = 0; c < 3; c++) X.fillRect(tx - tw/2 + c*tw*.4, y - H*.72, tw*.22, H*.12);
        X.fillStyle = '#ffce5c'; X.globalAlpha = .7 + .3*Math.sin(t*.005 + k); X.fillRect(tx - s*.04, y - H*.4, s*.08, s*.12); X.globalAlpha = 1; X.fillStyle = '#4a4458'; });
      X.fillStyle = '#3c3648'; X.fillRect(x - gw/2, y - H*.42, gw, H*.9);
      var sky = X.createLinearGradient(0, y - H*.3, 0, y + H*.45); sky.addColorStop(0, '#2a3a6e'); sky.addColorStop(1, '#ffcf8a');
      X.fillStyle = sky; this.arch(X, x, y + H*.04, gw*.62, H*.74); X.fill();
      X.fillStyle = '#fff6d8'; X.beginPath(); X.arc(x + gw*.1, y - H*.12, s*.07, 0, 7); X.fill();
      glow(X, x, y, s*(.9 + (open || 0)*1.2), '#ffce5c', .25 + (open || 0)*.4);
      X.save(); this.arch(X, x, y + H*.04, gw*.62, H*.74); X.clip(); X.strokeStyle = '#8f939e'; X.lineWidth = Math.max(1.5, s*.04);
      var drop = (1 - (open || 0))*H*.74, top = y + H*.04 - H*.37; for(var i = 0; i < 5; i++){ var bx = x - gw*.31 + gw*.62*(i + .5)/5; X.beginPath(); X.moveTo(bx, top); X.lineTo(bx, top + drop); X.stroke(); }
      for(i = 1; i < 4; i++){ var yy = top + drop*i/4; X.beginPath(); X.moveTo(x - gw*.31, yy); X.lineTo(x + gw*.31, yy); X.stroke(); } X.restore();
      X.fillStyle = '#c0392b'; [-1, 1].forEach(function(k){ var fx = x + k*(gw/2 + tw*.35), fy = y - H*.72 - s*.25; X.fillRect(fx - 1, fy, 2, s*.25);
        X.beginPath(); X.moveTo(fx, fy); X.lineTo(fx + s*.22, fy + s*.05 + Math.sin(t*.006 + k)*2); X.lineTo(fx, fy + s*.11); X.fill(); }); }
  };
  SPR.maze = {
    hedgeArch: function(X, x, y, w, h, inner){ X.fillStyle = '#2f6a3a'; X.beginPath(); X.moveTo(x - w/2 - h*.12, y + h/2); X.lineTo(x - w/2 - h*.12, y - h*.1); X.arc(x, y - h*.1, w/2 + h*.12, Math.PI, 0); X.lineTo(x + w/2 + h*.12, y + h/2); X.closePath(); X.fill();
      for(var i = 0; i < 10; i++){ var a = Math.PI + i/9*Math.PI; X.fillStyle = i % 2 ? '#3d8048' : '#27583a'; X.beginPath(); X.arc(x + Math.cos(a)*(w/2 + h*.08), y - h*.1 + Math.sin(a)*(w/2 + h*.08), h*.1, 0, 7); X.fill(); }
      X.fillStyle = inner; X.beginPath(); X.moveTo(x - w/2, y + h/2); X.lineTo(x - w/2, y - h*.1); X.arc(x, y - h*.1, w/2, Math.PI, 0); X.lineTo(x + w/2, y + h/2); X.closePath(); X.fill(); },
    gate: function(X, x, y, s, st, t){ this.hedgeArch(X, x, y, s*.5, s*.8, st === 'done' ? '#d9c79b' : '#0f2016'); if(st === 'done') glow(X, x, y, s*.4, '#ffe8a0', .3); },
    timed: function(X, x, y, s, st, t){ var gap = st === 'done' ? s*.32 : s*(.04 + (RM ? 0 : .03*(1 + Math.sin(t*.004)))) ;
      [-1, 1].forEach(function(k){ var g = X.createLinearGradient(x + k*gap, 0, x + k*(gap + s*.38), 0); g.addColorStop(0, '#a49c8c'); g.addColorStop(1, '#6e675b');
        X.fillStyle = g; rr(X, k < 0 ? x - gap - s*.38 : x + gap, y - s*.4, s*.38, s*.8, s*.04); X.fill();
        X.strokeStyle = 'rgba(40,34,26,.5)'; X.lineWidth = 1; for(var r = 1; r < 4; r++){ X.beginPath(); X.moveTo(k < 0 ? x - gap - s*.38 : x + gap, y - s*.4 + r*s*.2); X.lineTo(k < 0 ? x - gap : x + gap + s*.38, y - s*.4 + r*s*.2); X.stroke(); }
        if(st !== 'done'){ X.fillStyle = '#e9c46a'; X.beginPath(); var ax = x + k*(gap + s*.19); X.moveTo(ax - k*s*.08, y); X.lineTo(ax + k*s*.06, y - s*.08); X.lineTo(ax + k*s*.06, y + s*.08); X.fill(); } }); },
    enemy: function(X, x, y, s, st, t){ var dz = st === 'done';
      X.fillStyle = dz ? '#5c4a3c' : '#6b3f24'; X.beginPath(); X.ellipse(x, y + s*.02, s*.26, s*.32, 0, 0, 7); X.fill();
      X.fillStyle = dz ? '#7a6a5a' : '#8a5634'; X.beginPath(); X.ellipse(x, y + s*.22, s*.17, s*.13, 0, 0, 7); X.fill();
      X.strokeStyle = '#efe3c6'; X.lineWidth = Math.max(2, s*.08); X.lineCap = 'round';
      X.beginPath(); X.moveTo(x - s*.2, y - s*.16); X.quadraticCurveTo(x - s*.5, y - s*.2, x - s*.44, y - s*.5); X.stroke();
      X.beginPath(); X.moveTo(x + s*.2, y - s*.16); if(dz){ X.lineTo(x + s*.32, y - s*.26); } else X.quadraticCurveTo(x + s*.5, y - s*.2, x + s*.44, y - s*.5); X.stroke();
      if(dz){ X.strokeStyle = '#2a1a10'; X.lineWidth = Math.max(1.2, s*.03); [-1, 1].forEach(function(k){ X.beginPath(); X.moveTo(x + k*s*.12 - s*.04, y - s*.06); X.lineTo(x + k*s*.12 + s*.04, y + s*.0); X.moveTo(x + k*s*.12 + s*.04, y - s*.06); X.lineTo(x + k*s*.12 - s*.04, y + s*.0); X.stroke(); });
        for(var i = 0; i < 3; i++){ var a = t*.004 + i*2.1; X.fillStyle = '#ffe08a'; X.beginPath(); X.arc(x + Math.cos(a)*s*.3, y - s*.42 + Math.sin(a)*s*.08, s*.04, 0, 7); X.fill(); } return; }
      X.fillStyle = '#ff4d3a'; [-1, 1].forEach(function(k){ X.beginPath(); X.arc(x + k*s*.11, y - s*.04, s*.045, 0, 7); X.fill(); });
      X.strokeStyle = '#e9c46a'; X.lineWidth = Math.max(1.5, s*.04); X.beginPath(); X.arc(x, y + s*.3, s*.07, 0, Math.PI); X.stroke();
      if(!RM){ var ph = (t*.0012) % 1; X.fillStyle = 'rgba(230,230,230,' + (.5*(1 - ph)) + ')'; [-1, 1].forEach(function(k){ X.beginPath(); X.arc(x + k*(s*.08 + ph*s*.2), y + s*.3 + ph*s*.1, s*(.04 + ph*.06), 0, 7); X.fill(); }); } },
    sealed: function(X, x, y, s, st, t){ var off = st === 'done' ? s*.42 : 0;
      X.fillStyle = '#0f2016'; X.beginPath(); X.arc(x, y, s*.36, 0, 7); X.fill(); if(st === 'done') glow(X, x, y, s*.4, '#a78bdc', .35);
      var g = X.createRadialGradient(x + off - s*.1, y - s*.1, s*.05, x + off, y, s*.38); g.addColorStop(0, '#b8b1a2'); g.addColorStop(1, '#6d665a');
      X.fillStyle = g; X.beginPath(); X.arc(x + off, y, s*.38, 0, 7); X.fill();
      X.strokeStyle = hexA('#a78bdc', st === 'done' ? .3 : .6 + .4*Math.sin(t*.004)); X.lineWidth = Math.max(1.5, s*.04); X.beginPath(); X.arc(x + off, y, s*.24, 0, 7); X.stroke();
      for(var i = 0; i < 6; i++){ var a = i/6*6.283 + t*.0005; X.beginPath(); X.moveTo(x + off + Math.cos(a)*s*.14, y + Math.sin(a)*s*.14); X.lineTo(x + off + Math.cos(a)*s*.3, y + Math.sin(a)*s*.3); X.stroke(); } },
    start: function(X, x, y, s, st, t){ X.fillStyle = '#8f8676'; [-1, 1].forEach(function(k){ X.fillRect(x + k*s*.36 - s*.08, y - s*.4, s*.16, s*.7); });
      X.strokeStyle = '#8f8676'; X.lineWidth = s*.1; X.beginPath(); X.arc(x, y - s*.4, s*.36, Math.PI, 0); X.stroke();
      X.fillStyle = '#c0392b'; X.beginPath(); X.moveTo(x, y - s*.76); X.lineTo(x + s*.2, y - s*.7); X.lineTo(x, y - s*.62); X.fill(); X.fillRect(x - 1, y - s*.78, 2, s*.18); },
    goal: function(X, x, y, s, st, t, open){
      glow(X, x, y, s*(1 + (open || 0)), '#ffe8a0', .22 + (open || 0)*.35);
      X.fillStyle = '#8f8676'; X.beginPath(); X.arc(x, y, s*.82, 0, 7); X.fill();
      var w = X.createRadialGradient(x, y, s*.1, x, y, s*.72); w.addColorStop(0, '#9fe0ff'); w.addColorStop(1, '#2d7fa8'); X.fillStyle = w; X.beginPath(); X.arc(x, y, s*.7, 0, 7); X.fill();
      for(var i = 0; i < 3; i++){ var ph = ((t*.0006) + i/3) % 1; X.strokeStyle = 'rgba(255,255,255,' + (.5*(1 - ph)) + ')'; X.lineWidth = 1.5; X.beginPath(); X.arc(x, y, s*(.2 + ph*.5), 0, 7); X.stroke(); }
      X.fillStyle = '#d8d0bd'; X.beginPath(); X.arc(x, y, s*.2, 0, 7); X.fill();
      glow(X, x, y - s*.05, s*.35, '#ffe8a0', .6 + .3*Math.sin(t*.004)); X.fillStyle = '#fff6c8'; X.beginPath(); X.arc(x, y - s*.05, s*.09, 0, 7); X.fill();
      for(i = 0; i < 10; i++){ var a = i/10*6.283; X.fillStyle = ['#e58fb6', '#ffe08a', '#ffffff', '#e8765f'][i % 4]; X.beginPath(); X.arc(x + Math.cos(a)*s*.92, y + Math.sin(a)*s*.92, s*.06, 0, 7); X.fill(); } }
  };
  SPR.space = {
    gate: function(X, x, y, s, st, t){ var on = st !== 'done';
      if(on){ var g = X.createRadialGradient(x, y, 0, x, y, s*.34); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.4, 'rgba(69,224,255,.6)'); g.addColorStop(1, 'rgba(69,224,255,0)'); X.fillStyle = g; X.beginPath(); X.arc(x, y, s*.34, 0, 7); X.fill();
        X.strokeStyle = 'rgba(160,240,255,.6)'; X.lineWidth = 1.2; for(var i = 0; i < 3; i++){ X.beginPath(); X.arc(x, y, s*(.12 + i*.07), t*.004 + i, t*.004 + i + 2.2); X.stroke(); } }
      X.strokeStyle = on ? '#8fa7c8' : '#4a5670'; X.lineWidth = Math.max(3, s*.1); X.beginPath(); X.arc(x, y, s*.4, 0, 7); X.stroke();
      for(i = 0; i < 8; i++){ var a = i/8*6.283 + (on ? t*.0008 : 0); X.fillStyle = on ? (i % 2 ? '#45e0ff' : '#cfe6ff') : '#3a4256'; X.beginPath(); X.arc(x + Math.cos(a)*s*.4, y + Math.sin(a)*s*.4, s*.045, 0, 7); X.fill(); } },
    timed: function(X, x, y, s, st, t){ var on = st !== 'done';
      X.save(); X.globalAlpha = on ? .55 + .25*Math.sin(t*.01) : .18;
      for(var i = -1; i <= 1; i++) for(var j = -1; j <= 1; j++){ if(Math.abs(i) + Math.abs(j) > 1.5) continue; var hx = x + i*s*.28 + (j % 2 ? s*.14 : 0), hy = y + j*s*.24;
        X.strokeStyle = '#ff9d3c'; X.fillStyle = 'rgba(255,157,60,.18)'; X.lineWidth = 1.5; X.beginPath(); for(var k = 0; k < 6; k++){ var a = k/6*6.283 + .52; X.lineTo(hx + Math.cos(a)*s*.15, hy + Math.sin(a)*s*.15); } X.closePath(); X.fill(); X.stroke(); }
      X.restore();
      if(on && !RM && Math.sin(t*.013) > .6){ X.strokeStyle = '#fff3c4'; X.lineWidth = 1.5; X.beginPath(); var px = x - s*.4; X.moveTo(px, y - s*.1); for(var q = 1; q < 6; q++) X.lineTo(px + q*s*.16, y - s*.1 + (rnd(q + Math.floor(t/90)) - .5)*s*.3); X.stroke(); } },
    enemy: function(X, x, y, s, st, t){
      if(st === 'done'){ X.fillStyle = '#3f4452'; X.save(); X.translate(x - s*.16, y + s*.04); X.rotate(-.5); X.beginPath(); X.moveTo(-s*.2, -s*.1); X.lineTo(s*.16, -s*.04); X.lineTo(s*.1, s*.12); X.lineTo(-s*.24, s*.08); X.fill(); X.restore();
        X.save(); X.translate(x + s*.2, y - s*.04); X.rotate(.6); X.beginPath(); X.moveTo(-s*.12, -s*.08); X.lineTo(s*.2, 0); X.lineTo(-s*.12, s*.1); X.fill(); X.restore();
        for(var i = 0; i < 4; i++){ var ph = ((t*.0007) + i/4) % 1; X.fillStyle = 'rgba(160,160,170,' + (.35*(1 - ph)) + ')'; X.beginPath(); X.arc(x + (rnd(i) - .5)*s*.3, y - ph*s*.5, s*(.05 + ph*.1), 0, 7); X.fill(); } return; }
      var bob = RM ? 0 : Math.sin(t*.0025)*s*.03; y += bob;
      glow(X, x, y + s*.32, s*.25, '#ff5d4d', .4);
      var g = X.createLinearGradient(x - s*.4, 0, x + s*.4, 0); g.addColorStop(0, '#4a4f5e'); g.addColorStop(.5, '#9aa0b2'); g.addColorStop(1, '#4a4f5e');
      X.fillStyle = g; X.beginPath(); X.moveTo(x, y - s*.46); X.lineTo(x + s*.16, y - s*.1); X.lineTo(x + s*.44, y + s*.18); X.lineTo(x + s*.16, y + s*.3); X.lineTo(x, y + s*.22); X.lineTo(x - s*.16, y + s*.3); X.lineTo(x - s*.44, y + s*.18); X.lineTo(x - s*.16, y - s*.1); X.closePath(); X.fill();
      X.fillStyle = '#c0392b'; X.beginPath(); X.moveTo(x, y - s*.3); X.lineTo(x + s*.08, y - s*.05); X.lineTo(x - s*.08, y - s*.05); X.fill();
      X.fillStyle = Math.sin(t*.01) > 0 ? '#ff5d4d' : '#ffd0c8'; [-1, 1].forEach(function(k){ X.beginPath(); X.arc(x + k*s*.36, y + s*.16, s*.03, 0, 7); X.fill(); });
      X.fillStyle = '#ffb36b'; [-1, 1].forEach(function(k){ X.beginPath(); X.arc(x + k*s*.12, y + s*.3, s*.04, 0, 7); X.fill(); }); },
    sealed: function(X, x, y, s, st, t){ var open = st === 'done' ? s*.2 : 0;
      X.fillStyle = '#05060f'; hexPath(X, x, y, s*.42); X.fill(); if(open) glow(X, x, y, s*.4, '#b07cff', .45);
      [-1, 1].forEach(function(k){ X.save(); X.beginPath(); X.rect(k < 0 ? x - s : x, y - s, s, s*2); X.clip(); X.translate(k*open, 0);
        X.fillStyle = '#596276'; hexPath(X, x, y, s*.4); X.fill();
        X.save(); hexPath(X, x, y, s*.4); X.clip(); X.strokeStyle = '#e9c46a'; X.lineWidth = s*.06; for(var i = -4; i < 5; i++){ X.beginPath(); X.moveTo(x + i*s*.14, y - s*.5); X.lineTo(x + i*s*.14 + s*.3, y + s*.5); X.stroke(); } X.restore();
        X.restore(); });
      if(!open){ X.fillStyle = '#1b1f2c'; X.beginPath(); X.arc(x, y, s*.16, 0, 7); X.fill(); glow(X, x, y, s*.22, '#b07cff', .5 + .3*Math.sin(t*.005));
        X.fillStyle = '#d9c4ff'; rr(X, x - s*.07, y - s*.02, s*.14, s*.11, s*.02); X.fill(); X.strokeStyle = '#d9c4ff'; X.lineWidth = 1.6; X.beginPath(); X.arc(x, y - s*.02, s*.05, Math.PI, 0); X.stroke(); } },
    start: function(X, x, y, s, st, t){ X.strokeStyle = '#8fa7c8'; X.lineWidth = s*.08; X.beginPath(); X.ellipse(x, y, s*.42, s*.18, 0, 0, 7); X.stroke();
      X.lineWidth = 1.5; for(var i = 0; i < 4; i++){ var a = i/4*6.283 + t*.0004; X.beginPath(); X.moveTo(x, y); X.lineTo(x + Math.cos(a)*s*.42, y + Math.sin(a)*s*.18); X.stroke(); }
      X.fillStyle = '#cfd8e8'; X.beginPath(); X.arc(x, y, s*.1, 0, 7); X.fill(); X.fillStyle = Math.sin(t*.008) > 0 ? '#5fe0a8' : '#1c3a2c'; X.beginPath(); X.arc(x + s*.42, y, s*.03, 0, 7); X.fill(); },
    goal: function(X, x, y, s, st, t, open){ var o = open || 0, R = s*1.1;
      glow(X, x, y, R*(1.3 + o), '#ffce5c', .3 + o*.4);
      for(var arm = 0; arm < 4; arm++){ X.beginPath(); for(var i = 0; i <= 40; i++){ var u = i/40, a = arm/4*6.283 + u*4 + t*.0006*(RM ? 0 : 1), r = R*u;
          var px = x + Math.cos(a)*r, py = y + Math.sin(a)*r*.6; i ? X.lineTo(px, py) : X.moveTo(px, py); }
        X.strokeStyle = arm % 2 ? 'rgba(180,140,255,.55)' : 'rgba(120,200,255,.55)'; X.lineWidth = s*.1; X.lineCap = 'round'; X.stroke(); }
      glow(X, x, y, s*.5, '#fff6d8', .9); X.fillStyle = '#fffbe8'; X.beginPath(); X.arc(x, y, s*.14, 0, 7); X.fill(); }
  };
  function hexPath(X, x, y, r){ X.beginPath(); for(var k = 0; k < 6; k++){ var a = k/6*6.283 + Math.PI/6; X.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r); } X.closePath(); }

  /* ================= your hero ================= */
  function hero(X, x, y, s, col, t, moving){
    var bob = moving || RM ? 0 : Math.sin(t*.005)*s*.03; y += bob;
    X.fillStyle = 'rgba(0,0,0,.45)'; X.beginPath(); X.ellipse(x, y + s*.36, s*.28, s*.08, 0, 0, 7); X.fill();
    if(WORLD === 'space'){
      var g = X.createLinearGradient(x, y - s*.4, x, y + s*.3); g.addColorStop(0, shade(col, .4)); g.addColorStop(1, shade(col, -.3));
      if(!RM){ var f = s*(.18 + .08*Math.sin(t*.03)); glow(X, x, y + s*.32, s*.3, '#ffb36b', .6); X.fillStyle = '#fff1c8'; X.beginPath(); X.moveTo(x - s*.07, y + s*.24); X.lineTo(x, y + s*.24 + f); X.lineTo(x + s*.07, y + s*.24); X.fill(); }
      X.fillStyle = g; X.beginPath(); X.moveTo(x, y - s*.42); X.lineTo(x + s*.26, y + s*.26); X.lineTo(x, y + s*.16); X.lineTo(x - s*.26, y + s*.26); X.closePath(); X.fill();
      X.strokeStyle = 'rgba(255,255,255,.6)'; X.lineWidth = 1.2; X.stroke(); X.fillStyle = '#cfefff'; X.beginPath(); X.ellipse(x, y - s*.08, s*.06, s*.11, 0, 0, 7); X.fill(); return; }
    /* cloak */
    var c = X.createLinearGradient(x, y - s*.2, x, y + s*.36); c.addColorStop(0, shade(col, .15)); c.addColorStop(1, shade(col, -.35));
    X.fillStyle = c; X.beginPath(); X.moveTo(x - s*.24, y + s*.34); X.quadraticCurveTo(x - s*.28, y - s*.08, x, y - s*.16); X.quadraticCurveTo(x + s*.28, y - s*.08, x + s*.24, y + s*.34); X.closePath(); X.fill();
    X.fillStyle = '#f0c8a2'; X.beginPath(); X.arc(x, y - s*.24, s*.13, 0, 7); X.fill();
    if(WORLD === 'keep'){ X.fillStyle = '#b9bdc8'; X.beginPath(); X.arc(x, y - s*.27, s*.14, Math.PI*1.05, Math.PI*1.95); X.fill(); X.fillRect(x - s*.015, y - s*.3, s*.03, s*.14);
      X.strokeStyle = '#d5d8e0'; X.lineWidth = Math.max(1.5, s*.04); X.beginPath(); X.moveTo(x + s*.22, y + s*.2); X.lineTo(x + s*.36, y - s*.12); X.stroke(); }
    else { X.fillStyle = shade(col, -.2); X.beginPath(); X.arc(x, y - s*.27, s*.16, Math.PI*.95, Math.PI*2.05); X.lineTo(x + s*.12, y - s*.12); X.lineTo(x - s*.12, y - s*.12); X.closePath(); X.fill();
      var lx = x + s*.3, ly = y + s*.08; glow(X, lx, ly, s*.5, '#ffe8a0', .35 + .1*Math.sin(t*.01)); X.fillStyle = '#3a2a1a'; X.fillRect(lx - s*.06, ly - s*.1, s*.12, s*.18); X.fillStyle = '#ffe08a'; X.fillRect(lx - s*.04, ly - s*.07, s*.08, s*.11); }
    X.fillStyle = '#1c1013'; [-1, 1].forEach(function(k){ X.beginPath(); X.arc(x + k*s*.045, y - s*.23, Math.max(.8, s*.02), 0, 7); X.fill(); });
  }

  /* ================= the map ================= */
  var M = null;   /* { cv, X, map, W, H, bg, pos, prev, visited, reach, move, crew, parts, open, fin } */
  function edgeKey(a, b){ return a + '>' + b; }
  function build(inner, map, w, h, opts){
    opts = opts || {};
    var cv = inner.querySelector('#mapArt'); if(!cv){ cv = document.createElement('canvas'); cv.id = 'mapArt'; cv.setAttribute('aria-hidden', 'true'); inner.insertBefore(cv, inner.firstChild); }
    var app = document.getElementById('app'), z = app ? (parseFloat(app.style.zoom) || 1) : 1;   /* sharp on a TV too */
    var d = Math.min(3, (window.devicePixelRatio || 1)*z); cv.width = Math.round(w*d); cv.height = Math.round(h*d); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    var X = cv.getContext('2d'); X.setTransform(d, 0, 0, d, 0, 0);
    M = { cv:cv, X:X, map:map, W:w, H:h, d:d, pos:map.startId, prev:null, visited:{}, reach:[], move:null, crew:(opts.crew && opts.crew.col) || PAL.accent, parts:[], open:0, fin:0, s:Math.min(52, Math.max(38, w/7.5)) };
    M.bg = background(w, h, d, map);
    if(!M.loop){ M.loop = true; loop(); }
  }
  /* the ground: stone flags, hedges or stars; drawn once per map */
  function background(w, h, d, map){
    var c = document.createElement('canvas'); c.width = Math.round(w*d); c.height = Math.round(h*d); var X = c.getContext('2d'); X.setTransform(d, 0, 0, d, 0, 0);
    var i, j;
    if(WORLD === 'keep'){
      X.fillStyle = PAL.mortar; X.fillRect(0, 0, w, h);
      var th = 30, row = 0;
      for(var y = 0; y < h; y += th, row++){ var x = -rnd(row)*40; while(x < w){ var tw = 34 + rnd(row*31 + x)*30, k = rnd(row*7 + x*.3);
          X.fillStyle = shade(k < .5 ? PAL.stone : PAL.stone2, (rnd(x + row) - .5)*.18); rr(X, x + 1.5, y + 1.5, tw - 3, th - 3, 3); X.fill();
          if(rnd(x*row + 3) < .08){ X.strokeStyle = 'rgba(0,0,0,.45)'; X.lineWidth = 1; X.beginPath(); X.moveTo(x + tw*.3, y + 3); X.lineTo(x + tw*.45, y + th*.5); X.lineTo(x + tw*.38, y + th - 3); X.stroke(); }
          if(rnd(x + row*13) < .06){ X.fillStyle = 'rgba(100,140,80,.18)'; X.beginPath(); X.arc(x + tw*.5, y + th*.6, 10, 0, 7); X.fill(); }
          x += tw; } }
    } else if(WORLD === 'maze'){
      X.fillStyle = PAL.mortar; X.fillRect(0, 0, w, h);
      for(i = 0; i < w*h/60; i++){ var lx = rnd(i)*w, ly = rnd(i + 999)*h, r = 6 + rnd(i*3)*10; X.fillStyle = ['#1d4527', '#24552f', '#2c6438', '#17391f'][i % 4]; X.beginPath(); X.arc(lx, ly, r, 0, 7); X.fill(); }
      for(i = 0; i < w*h/900; i++){ X.fillStyle = 'rgba(255,255,255,.06)'; X.beginPath(); X.arc(rnd(i*7)*w, rnd(i*11)*h, 2 + rnd(i)*3, 0, 7); X.fill(); }
      /* gravel paths carved through the hedge */
      var paths = []; map.rows.forEach(function(rw){ rw.forEach(function(a){ a.out.forEach(function(b){ paths.push([a, map.nodes[b]]); }); }); });
      X.lineCap = 'round'; X.lineJoin = 'round';
      X.strokeStyle = 'rgba(0,0,0,.4)'; X.lineWidth = 40; paths.forEach(function(p){ X.beginPath(); X.moveTo(p[0].px, p[0].py + 3); X.lineTo(p[1].px, p[1].py + 3); X.stroke(); });
      X.strokeStyle = PAL.lip; X.lineWidth = 36; paths.forEach(function(p){ X.beginPath(); X.moveTo(p[0].px, p[0].py); X.lineTo(p[1].px, p[1].py); X.stroke(); });
      X.strokeStyle = PAL.path; X.lineWidth = 30; paths.forEach(function(p){ X.beginPath(); X.moveTo(p[0].px, p[0].py); X.lineTo(p[1].px, p[1].py); X.stroke(); });
      Object.keys(map.nodes).forEach(function(id){ var n = map.nodes[id]; X.fillStyle = PAL.lip; X.beginPath(); X.arc(n.px, n.py, 30, 0, 7); X.fill(); X.fillStyle = PAL.path; X.beginPath(); X.arc(n.px, n.py, 26, 0, 7); X.fill(); });
      for(i = 0; i < w*h/120; i++){ var gx = rnd(i*5)*w, gy = rnd(i*9)*h; X.fillStyle = 'rgba(90,75,50,.18)'; X.fillRect(gx, gy, 1.6, 1.6); }
    } else {
      var g = X.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#120a2e'); g.addColorStop(.5, '#060920'); g.addColorStop(1, '#03040f'); X.fillStyle = g; X.fillRect(0, 0, w, h);
      for(i = 0; i < 7; i++){ glow(X, rnd(i*3)*w, rnd(i*5)*h, 90 + rnd(i)*120, i % 2 ? '#5b2a86' : '#1f4fa0', .22); }
      for(i = 0; i < w*h/700; i++){ var sz = rnd(i*7) < .9 ? 1 : 2; X.fillStyle = 'rgba(255,255,255,' + (.3 + rnd(i*3)*.6) + ')'; X.fillRect(rnd(i)*w, rnd(i + 500)*h, sz, sz); }
    }
    return c;
  }
  function update(st){
    if(!M) return;
    if(st.pos !== M.pos){ M.prev = M.pos; M.move = { from:M.map.nodes[M.pos], to:M.map.nodes[st.pos], t0:performance.now(), dur:RM ? 1 : 750 }; M.pos = st.pos; }
    M.visited = st.visited || {}; M.reach = st.reach || []; if(st.crew) M.crew = st.crew;
  }
  function stateOf(id){ if(id === M.pos) return 'current'; if(M.visited[id]) return 'done'; if(M.reach.indexOf(id) >= 0) return 'reach'; return 'future'; }
  function loop(){
    var last = 0;
    (function step(now){
      requestAnimationFrame(step); if(!M || document.hidden) return; if(now - last < 33) return; last = now;
      if(!M.cv.isConnected) return;
      draw(now);
    })(0);
  }
  function heroAt(now){
    var n = M.map.nodes[M.pos]; if(!M.move) return { x:n.px, y:n.py, moving:false };
    var k = clamp((now - M.move.t0)/M.move.dur, 0, 1), e = ease(k);
    if(k >= 1){ M.move = null; return { x:n.px, y:n.py, moving:false }; }
    var a = M.move.from, b = M.move.to, hop = WORLD === 'space' ? 0 : Math.abs(Math.sin(k*Math.PI*4))*4;
    if(WORLD === 'space' && !RM && Math.random() < .8) M.parts.push({ x:lerp(a.px, b.px, e), y:lerp(a.py, b.py, e) + 10, vx:(Math.random() - .5)*.6, vy:(Math.random() - .1)*.8, life:0, max:24, col:'#ffb36b', r:2.5 });
    return { x:lerp(a.px, b.px, e), y:lerp(a.py, b.py, e) - hop, moving:true };
  }
  function draw(now){
    var X = M.X, W = M.W, H = M.H, map = M.map, s = M.s, T = RM ? 0 : now;
    var sc = document.getElementById('mapScroll'), top = sc ? sc.scrollTop - 80 : 0, bot = sc ? sc.scrollTop + sc.clientHeight + 80 : H;
    X.clearRect(0, 0, W, H); X.drawImage(M.bg, 0, 0, W, H);
    /* paths */
    var edges = []; map.rows.forEach(function(rw){ rw.forEach(function(a){ a.out.forEach(function(bid){ edges.push([a, map.nodes[bid]]); }); }); });
    edges.forEach(function(p){ var a = p[0], b = p[1], live = a.id === M.pos && M.reach.indexOf(b.id) >= 0, trod = M.visited[a.id] && (M.visited[b.id] || b.id === M.pos);
      if(Math.max(a.py, b.py) < top || Math.min(a.py, b.py) > bot) return;
      X.lineCap = 'round';
      if(WORLD === 'keep'){
        X.strokeStyle = 'rgba(0,0,0,.6)'; X.lineWidth = 36; X.beginPath(); X.moveTo(a.px, a.py); X.lineTo(b.px, b.py); X.stroke();
        X.strokeStyle = PAL.path; X.lineWidth = 28; X.stroke();
        X.strokeStyle = 'rgba(255,230,200,.06)'; X.lineWidth = 2; X.setLineDash([10, 14]); X.lineDashOffset = 0; X.stroke(); X.setLineDash([]);
        X.strokeStyle = live ? 'rgba(255,179,71,.55)' : trod ? 'rgba(255,179,71,.22)' : 'rgba(255,255,255,.04)'; X.lineWidth = live ? 6 : 3; X.setLineDash(live ? [2, 10] : []); X.lineDashOffset = -T*.02; X.stroke(); X.setLineDash([]);
      } else if(WORLD === 'maze'){
        if(live || trod){ X.strokeStyle = live ? 'rgba(255,224,138,.9)' : 'rgba(150,120,70,.5)'; X.lineWidth = live ? 4 : 3; X.setLineDash(live ? [3, 9] : [2, 7]); X.lineDashOffset = -T*.02; X.beginPath(); X.moveTo(a.px, a.py); X.lineTo(b.px, b.py); X.stroke(); X.setLineDash([]); }
      } else {
        X.strokeStyle = live ? 'rgba(69,224,255,.25)' : trod ? 'rgba(69,224,255,.18)' : 'rgba(120,150,220,.12)'; X.lineWidth = live ? 10 : 4; X.beginPath(); X.moveTo(a.px, a.py); X.lineTo(b.px, b.py); X.stroke();
        X.strokeStyle = live ? '#9ff0ff' : trod ? 'rgba(160,240,255,.6)' : 'rgba(150,170,230,.3)'; X.lineWidth = live ? 2.5 : 1.4; X.setLineDash(live ? [8, 10] : [3, 8]); X.lineDashOffset = -T*.05; X.stroke(); X.setLineDash([]);
      } });
    /* obstacles */
    var spr = SPR[WORLD];
    Object.keys(map.nodes).forEach(function(id){ var n = map.nodes[id]; if(n.py < top - 60 || n.py > bot + 60) return; var st = stateOf(id);
      if(n.type === 'core'){ spr.goal(X, n.px, n.py, s*.9, st, T, M.open); return; }
      if(st === 'reach'){ var pul = .5 + .5*Math.sin(T*.006); glow(X, n.px, n.py, s*(.8 + .15*pul), PAL.accent, .3 + .2*pul);
        X.strokeStyle = hexA(PAL.accent, .6 + .3*pul); X.lineWidth = 2.5; X.beginPath(); X.ellipse(n.px, n.py + s*.36, s*.5, s*.15, 0, 0, 7); X.stroke(); }
      X.save(); if(st === 'future') X.globalAlpha = .55; else if(st === 'done') X.globalAlpha = .85;
      if(st === 'current'){ if(n.type === 'start') spr.start(X, n.px, n.py, s, st, T); else spr[n.type](X, n.px, n.py, s, 'done', T); }
      else if(n.type === 'start') spr.start(X, n.px, n.py, s, st, T);
      else spr[n.type](X, n.px, n.py, s, st === 'done' ? 'done' : 'shut', T);
      X.restore();
      if(st === 'reach' && !RM){ var by = n.py - s*.85 + Math.sin(T*.008)*4; X.fillStyle = PAL.accent; X.beginPath(); X.moveTo(n.px - 7, by - 6); X.lineTo(n.px + 7, by - 6); X.lineTo(n.px, by + 3); X.closePath(); X.fill(); } });
    /* torchlight and fog: the way you have come is lit, the way ahead is dark */
    var hp = heroAt(now);
    if(WORLD !== 'space'){
      var fog = M.fog || (M.fog = document.createElement('canvas')); if(fog.width !== M.cv.width){ fog.width = M.cv.width; fog.height = M.cv.height; }
      var F = fog.getContext('2d'); F.setTransform(M.d, 0, 0, M.d, 0, 0); F.globalCompositeOperation = 'source-over'; F.clearRect(0, 0, W, H);
      F.fillStyle = WORLD === 'keep' ? 'rgba(4,3,8,.6)' : 'rgba(4,14,8,.42)'; F.fillRect(0, 0, W, H);
      F.globalCompositeOperation = 'destination-out';
      function hole(x, y, r, a){ var g = F.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); F.fillStyle = g; F.beginPath(); F.arc(x, y, r, 0, 7); F.fill(); }
      Object.keys(M.visited).forEach(function(id){ var n = map.nodes[id]; hole(n.px, n.py, s*2.2, .9); });
      M.reach.forEach(function(id){ var n = map.nodes[id]; hole(n.px, n.py, s*1.6, .75); });
      var core = map.nodes[map.coreId]; hole(core.px, core.py, s*2.4, .8);
      hole(hp.x, hp.y, s*(2.6 + .1*Math.sin(T*.012)), 1);
      X.drawImage(fog, 0, 0, W, H);
      if(WORLD === 'keep') Object.keys(M.visited).forEach(function(id){ var n = map.nodes[id]; if(n.py < top || n.py > bot) return; torch(X, n.px - s*.95, n.py - s*.2, T + n.px); torch(X, n.px + s*.95, n.py - s*.2, T + n.py); });
    }
    if(WORLD === 'maze' && !RM){ for(var i = 0; i < 16; i++){ var fx = (rnd(i)*W + Math.sin(T*.0004 + i)*40), fy = top + 80 + ((rnd(i + 9)*(bot - top) + T*.01*(rnd(i*3) - .5)*2) % (bot - top));
        glow(X, fx, fy, 8, '#e9ff8a', .5 + .5*Math.sin(T*.004 + i*2)); } }
    if(WORLD === 'space' && !RM){ for(i = 0; i < 20; i++){ var tx = rnd(i*7)*W, ty = top + rnd(i*13)*(bot - top), tw = .5 + .5*Math.sin(T*.003 + i*3); X.fillStyle = 'rgba(255,255,255,' + (.6*tw) + ')'; X.fillRect(tx, ty, 2, 2); } }
    /* particles */
    M.parts = M.parts.filter(function(p){ return p.life < p.max; });
    M.parts.forEach(function(p){ p.life++; p.x += p.vx; p.y += p.vy; p.vy += p.g || 0; X.globalAlpha = 1 - p.life/p.max; X.fillStyle = p.col; X.beginPath(); X.arc(p.x, p.y, p.r, 0, 7); X.fill(); X.globalAlpha = 1; });
    hero(X, hp.x, hp.y - (WORLD === 'space' ? 0 : s*.18), s*(WORLD === 'space' ? .8 : 1), M.crew, T, hp.moving);
    if(M.fin){ M.open = Math.min(1, M.open + .03); }
  }
  function torch(X, x, y, T){ glow(X, x, y, 34, '#ffb347', .22 + .06*Math.sin(T*.02)); X.fillStyle = '#5a361d'; X.fillRect(x - 2, y, 4, 12);
    var f = 8 + 2*Math.sin(T*.03); X.fillStyle = '#ff8a2a'; X.beginPath(); X.moveTo(x - 4, y); X.quadraticCurveTo(x, y - f*1.4, x + 4, y); X.fill(); X.fillStyle = '#ffe08a'; X.beginPath(); X.moveTo(x - 2, y); X.quadraticCurveTo(x, y - f*.8, x + 2, y); X.fill(); }

  /* ================= the obstacle card ================= */
  var OB = null, obLoop = false;
  function obstacle(type, label){
    var card = document.getElementById('obCard'); if(!card) return;
    var cv = document.getElementById('obArt');
    if(!cv){ cv = document.createElement('canvas'); cv.id = 'obArt'; cv.setAttribute('aria-hidden', 'true'); card.insertBefore(cv, card.firstChild); }
    var d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(300*d); cv.height = Math.round(120*d);
    OB = { cv:cv, X:cv.getContext('2d'), type:type, state:'shut', t0:performance.now(), fx:null, parts:[], d:d };
    OB.X.setTransform(d, 0, 0, d, 0, 0);
    if(!obLoop){ obLoop = true; (function step(now){ requestAnimationFrame(step); if(!OB || !OB.cv.isConnected || document.hidden) return; var w = document.getElementById('obWrap'); if(w && w.classList.contains('hidden')) return; drawOb(now); })(0); }
  }
  function drawOb(now){
    var X = OB.X, W = 300, H = 120, T = RM ? 0 : now, s = 84;
    X.clearRect(0, 0, W, H);
    var g = X.createRadialGradient(W/2, H*.55, 10, W/2, H*.55, W*.6);
    g.addColorStop(0, WORLD === 'keep' ? '#3a3346' : WORLD === 'maze' ? '#2a5230' : '#1c1d4a'); g.addColorStop(1, 'rgba(0,0,0,0)'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    if(WORLD === 'maze'){ X.fillStyle = PAL.path; X.beginPath(); X.ellipse(W/2, H*.86, 70, 14, 0, 0, 7); X.fill(); }
    if(WORLD === 'keep'){ X.fillStyle = 'rgba(0,0,0,.35)'; X.beginPath(); X.ellipse(W/2, H*.9, 60, 10, 0, 0, 7); X.fill(); torch(X, W/2 - 78, H*.5, T); torch(X, W/2 + 78, H*.5, T + 400); }
    if(WORLD === 'space'){ for(var i = 0; i < 40; i++){ X.fillStyle = 'rgba(255,255,255,' + (.2 + rnd(i)*.6) + ')'; X.fillRect(rnd(i*3)*W, rnd(i*5)*H, 1.5, 1.5); } }
    var k = OB.fx ? clamp((now - OB.fx.t0)/OB.fx.dur, 0, 1) : 0, ox = 0, sc = 1;
    if(OB.fx && OB.fx.kind === 'hit'){ ox = Math.sin(k*40)*(1 - k)*8; sc = 1 + Math.sin(k*Math.PI)*.18; }
    if(OB.fx && OB.fx.kind === 'good'){ sc = 1 + Math.sin(k*Math.PI)*.06; }
    X.save(); X.translate(W/2 + ox, H*.52); X.scale(sc, sc);
    var st = OB.state === 'done' ? 'done' : 'shut';
    SPR[WORLD][OB.type](X, 0, 0, s, st, T);
    X.restore();
    if(OB.fx && OB.fx.kind === 'hit' && k < 1){ X.fillStyle = 'rgba(232,80,80,' + (.35*(1 - k)) + ')'; X.fillRect(0, 0, W, H); }
    if(OB.fx && OB.fx.kind === 'good' && k < 1){ X.fillStyle = 'rgba(255,255,255,' + (.3*(1 - k)) + ')'; X.fillRect(0, 0, W, H); }
    OB.parts = OB.parts.filter(function(p){ return p.life < p.max; });
    OB.parts.forEach(function(p){ p.life++; p.x += p.vx; p.y += p.vy; p.vy += .12; X.globalAlpha = 1 - p.life/p.max; X.fillStyle = p.col; X.fillRect(p.x, p.y, p.r, p.r); X.globalAlpha = 1; });
  }
  function answer(kind){
    /* kind: 'good' (one of two), 'through' (beaten), 'wrong', 'dead' */
    if(!OB) return;
    if(kind === 'wrong' || kind === 'dead'){ OB.fx = { kind:'hit', t0:performance.now(), dur:500 }; return; }
    if(kind === 'good'){ OB.fx = { kind:'good', t0:performance.now(), dur:400 }; return; }
    OB.state = 'done'; OB.fx = { kind:'good', t0:performance.now(), dur:500 };
    var cols = WORLD === 'keep' ? ['#8a5a32', '#c9a24a', '#a3a7b3', '#ffb347'] : WORLD === 'maze' ? ['#3d8048', '#9fe07a', '#e9c46a', '#d9c79b'] : ['#45e0ff', '#ffce5c', '#b07cff', '#ffffff'];
    if(!RM) for(var i = 0; i < 40; i++){ var a = Math.random()*6.283, sp = 1.5 + Math.random()*4; OB.parts.push({ x:150, y:62, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp - 2, life:0, max:30 + Math.random()*20, col:cols[i % 4], r:2 + Math.random()*3 }); }
  }
  function finish(win){ if(!M) return; if(win){ M.fin = 1; } }

  /* ================= lives, the menu picture, and a bigger screen ================= */
  var LIFE = {
    keep:'<svg viewBox="0 0 24 24" class="%c"><path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z" fill="currentColor"/><path d="M12 6v12M7.5 10h9" stroke="rgba(0,0,0,.35)" stroke-width="2"/></svg>',
    maze:'<svg viewBox="0 0 24 24" class="%c"><path d="M9 2.5h6v2H9z" fill="currentColor"/><path d="M7.5 6h9l1 2.5v9l-1 2.5h-9l-1-2.5v-9z" fill="currentColor"/><circle cx="12" cy="13" r="3" fill="rgba(255,246,200,.9)"/></svg>',
    space:'<svg viewBox="0 0 24 24" class="%c"><path d="M12 2l8.5 5v10L12 22l-8.5-5V7z" fill="currentColor"/><path d="M12 7l4.3 2.5v5L12 17l-4.3-2.5v-5z" fill="rgba(255,255,255,.3)"/></svg>'
  };
  function life(alive){ return (LIFE[WORLD] || LIFE.keep).replace('%c', alive ? '' : 'lost'); }

  function menuArt(){
    var menu = document.getElementById('menu'); if(!menu || document.getElementById('menuArt')) return;
    var cv = document.createElement('canvas'); cv.id = 'menuArt'; cv.setAttribute('aria-hidden', 'true'); menu.insertBefore(cv, menu.firstChild);
    var X = cv.getContext('2d'), d = Math.min(2, window.devicePixelRatio || 1), W = 0, H = 150;
    function size(){ W = cv.clientWidth || 340; cv.width = Math.round(W*d); cv.height = Math.round(H*d); X.setTransform(d, 0, 0, d, 0, 0); }
    size(); window.addEventListener('resize', size);
    (function step(now){ if(!cv.isConnected) return; requestAnimationFrame(step); if(menu.classList.contains('hidden')) return; var T = RM ? 0 : now; X.clearRect(0, 0, W, H);
      var s = 46, spr = SPR[WORLD];
      if(WORLD === 'keep'){ var g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1b1830'); g.addColorStop(1, '#2a2436'); X.fillStyle = g; rr(X, 0, 0, W, H, 16); X.fill();
        X.fillStyle = '#fff6d8'; X.beginPath(); X.arc(W*.82, 34, 14, 0, 7); X.fill(); glow(X, W*.82, 34, 50, '#fff6d8', .2);
        spr.goal(X, W/2, H*.62, 54, 'future', T, .25 + .25*Math.sin(T*.001));
        hero(X, W*.2, H*.72, 46, '#8aa0b8', T); spr.enemy(X, W*.78, H*.72, 40, 'shut', T); torch(X, W*.33, H*.5, T); torch(X, W*.67, H*.5, T + 300); }
      else if(WORLD === 'maze'){ X.fillStyle = PAL.mortar; rr(X, 0, 0, W, H, 16); X.fill(); X.save(); rr(X, 0, 0, W, H, 16); X.clip();
        for(var i = 0; i < 120; i++){ X.fillStyle = ['#1d4527', '#24552f', '#2c6438', '#17391f'][i % 4]; X.beginPath(); X.arc(rnd(i)*W, rnd(i + 50)*H, 8 + rnd(i*3)*10, 0, 7); X.fill(); }
        X.strokeStyle = PAL.path; X.lineWidth = 22; X.lineJoin = 'round'; X.beginPath(); X.moveTo(20, H - 20); X.lineTo(W*.3, H - 20); X.lineTo(W*.3, 40); X.lineTo(W*.62, 40); X.lineTo(W*.62, H*.62); X.lineTo(W*.5, H*.62); X.stroke();
        spr.goal(X, W*.5, H*.62, 30, 'future', T, 0); hero(X, W*.3, H*.42 + Math.sin(T*.001)*20, 40, '#5fd1a6', T); spr.enemy(X, W*.82, H*.55, 44, 'shut', T);
        for(i = 0; i < 6; i++) glow(X, rnd(i*7)*W, rnd(i*9)*H, 7, '#e9ff8a', .5 + .5*Math.sin(T*.004 + i)); X.restore(); }
      else { var g2 = X.createLinearGradient(0, 0, W, H); g2.addColorStop(0, '#120a2e'); g2.addColorStop(1, '#060920'); X.fillStyle = g2; rr(X, 0, 0, W, H, 16); X.fill(); X.save(); rr(X, 0, 0, W, H, 16); X.clip();
        for(i = 0; i < 90; i++){ X.fillStyle = 'rgba(255,255,255,' + (.3 + rnd(i)*.6) + ')'; X.fillRect(rnd(i*3)*W, rnd(i*5)*H, 1.5, 1.5); }
        spr.goal(X, W*.72, H*.48, 46, 'future', T, 0); spr.enemy(X, W*.42, H*.3, 36, 'shut', T);
        var fx = W*.15 + ((T*.03) % (W*.4)); hero(X, fx, H*.68, 40, '#45e0ff', T); X.restore(); }
    })(0);
  }
  /* the result: the way out thrown open, or the thing that stopped you */
  var RES = null;
  function result(win){
    var box = document.getElementById('result'); if(!box) return;
    var cv = document.getElementById('resArt'); if(!cv){ cv = document.createElement('canvas'); cv.id = 'resArt'; cv.setAttribute('aria-hidden', 'true'); box.insertBefore(cv, box.firstChild); }
    var d = Math.min(2, window.devicePixelRatio || 1), W = 360, H = 150; cv.width = Math.round(W*d); cv.height = Math.round(H*d); var X = cv.getContext('2d'); X.setTransform(d, 0, 0, d, 0, 0);
    var crew = (M && M.crew) || PAL.accent, t0 = performance.now(), parts = [];
    RES = { win:win, id:t0 };
    (function step(now){ if(!RES || RES.id !== t0 || !cv.isConnected) return; requestAnimationFrame(step); if(box.classList.contains('hidden')) return;
      var T = RM ? 0 : now, k = clamp((now - t0)/1400, 0, 1), spr = SPR[WORLD]; X.clearRect(0, 0, W, H);
      var bg = X.createLinearGradient(0, 0, 0, H);
      if(WORLD === 'keep'){ bg.addColorStop(0, win ? '#2a3a6e' : '#1a1016'); bg.addColorStop(1, win ? '#3a2f3c' : '#0c080b'); }
      else if(WORLD === 'maze'){ bg.addColorStop(0, win ? '#1f4a2a' : '#0f1d14'); bg.addColorStop(1, '#0a170f'); }
      else { bg.addColorStop(0, '#120a2e'); bg.addColorStop(1, '#03040f'); }
      X.fillStyle = bg; rr(X, 0, 0, W, H, 16); X.fill(); X.save(); rr(X, 0, 0, W, H, 16); X.clip();
      if(WORLD === 'space') for(var i = 0; i < 70; i++){ X.fillStyle = 'rgba(255,255,255,' + (.3 + rnd(i)*.6) + ')'; X.fillRect(rnd(i*3)*W, rnd(i*5)*H, 1.5, 1.5); }
      if(WORLD === 'maze') for(i = 0; i < 70; i++){ X.fillStyle = ['#1d4527', '#24552f', '#2c6438', '#17391f'][i % 4]; X.beginPath(); X.arc(rnd(i)*W, rnd(i + 50)*H, 8 + rnd(i*3)*10, 0, 7); X.fill(); }
      if(win){
        spr.goal(X, W/2, H*(WORLD === 'keep' ? .6 : .5), WORLD === 'keep' ? 60 : 50, 'current', T, ease(k));
        hero(X, W/2 + (WORLD === 'space' ? -70 + k*40 : -60), H*.72 - (WORLD === 'space' ? k*20 : 0), WORLD === 'space' ? 38 : 44, crew, T);
        if(!RM && Math.random() < .5) parts.push({ x:Math.random()*W, y:H + 4, vx:(Math.random() - .5)*.6, vy:-1 - Math.random()*1.5, life:0, max:80, col:['#ffce5c', '#ffffff', '#86bf9d', '#e8765f'][parts.length % 4], r:2 + Math.random()*2 });
      } else {
        var foe = WORLD === 'keep' ? 'enemy' : WORLD === 'maze' ? 'enemy' : 'enemy';
        X.save(); X.translate(W/2, H*.52); var sc = 1.6 + .1*Math.sin(T*.002); X.scale(sc, sc); spr[foe](X, 0, 0, 56, 'shut', T); X.restore();
        var v = X.createRadialGradient(W/2, H/2, 30, W/2, H/2, W*.6); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(120,10,20,.55)'); X.fillStyle = v; X.fillRect(0, 0, W, H);
      }
      parts = parts.filter(function(p){ return p.life < p.max; }); parts.forEach(function(p){ p.life++; p.x += p.vx; p.y += p.vy; X.globalAlpha = 1 - p.life/p.max; X.fillStyle = p.col; X.beginPath(); X.arc(p.x, p.y, p.r, 0, 7); X.fill(); X.globalAlpha = 1; });
      X.restore();
    })(0);
  }
  function crewIcons(){
    document.querySelectorAll('#charRow .chip').forEach(function(b){ if(b.querySelector('canvas')) return; var col = getComputedStyle(b).getPropertyValue('--cc').trim() || PAL.accent;
      var dot = b.querySelector('.dot'); var cv = document.createElement('canvas'); cv.width = 56; cv.height = 56; cv.style.cssText = 'width:24px;height:24px;margin:-4px 0;';
      var X = cv.getContext('2d'); X.scale(2, 2); hero(X, 14, 16, 26, col.indexOf('#') === 0 ? col : PAL.accent, 0, true);
      if(dot) dot.replaceWith(cv); else b.insertBefore(cv, b.firstChild); });
  }
  function tv(){
    var app = document.getElementById('app'); if(!app) return;
    function fit(){ var z = 1; if(innerWidth >= 900 && innerHeight >= 640) z = clamp(Math.min(innerHeight/860, innerWidth/700), 1, 1.6);
      if(z > 1.04){ app.style.zoom = z; app.style.height = (innerHeight/z) + 'px'; app.style.maxHeight = 'none'; } else { app.style.zoom = ''; app.style.height = ''; app.style.maxHeight = ''; } }
    window.addEventListener('resize', fit); fit();
  }
  var css = [
    'body.tbw #edgesSvg{display:none;}',
    'body.tbw #mapArt{position:absolute;left:0;top:0;z-index:1;pointer-events:none;display:block;}',
    'body.tbw .node{background:transparent !important;border-color:transparent !important;box-shadow:none !important;animation:none !important;color:transparent !important;width:58px;height:58px;font-size:0 !important;}',
    'body.tbw .node svg{display:none;}',
    'body.tbw .node.core{width:96px;height:96px;}',
    'body.tbw .node.reachable{cursor:pointer;}',
    'body.tbw .node:focus-visible{outline:3px solid ' + PAL.accent + ';outline-offset:2px;}',
    'body.tbw #mapScroll{background:#000;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),0 10px 30px rgba(0,0,0,.4);}',
    'body.tbw #menuArt{display:block;width:100%;height:150px;flex:none;border-radius:16px;}',
    'body.tbw #menu{padding-top:58px;}',
    'body.tbw #resArt{display:block;width:100%;max-width:420px;height:150px;margin:0 auto;flex:none;}',
    'body.tbw #obArt{display:block;width:100%;height:120px;margin:-6px 0 -4px;}',
    'body.tbw #obCard{animation:tbwCard .35s cubic-bezier(.2,1.2,.4,1);}',
    '@keyframes tbwCard{from{opacity:0;transform:translateY(16px) scale(.95)}to{opacity:1;transform:none}}',
    'body.tbw #obCard.tbw-hit{animation:tbwHit .4s ease;}',
    '@keyframes tbwHit{0%,100%{transform:none}25%{transform:translateX(-8px)}50%{transform:translateX(6px)}75%{transform:translateX(-3px)}}',
    'body.tbw #livesBox svg{width:22px;height:22px;}',
    'body.tbw #livesBox svg.lost{opacity:.25;}',
    '@media (prefers-reduced-motion: reduce){ body.tbw #obCard, body.tbw #obCard.tbw-hit{animation:none;} }'
  ].join('\n');
  function boot(){ document.body.classList.add('tbw', 'tbw-' + WORLD); var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    menuArt(); tv(); setTimeout(crewIcons, 0);
    var cr = document.getElementById('charRow'); if(cr) new MutationObserver(crewIcons).observe(cr, { childList:true }); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.TBWorld = { world:WORLD, build:build, update:update, obstacle:obstacle, answer:answer, finish:finish, life:life, result:result, hit:function(){ var c = document.getElementById('obCard'); if(c){ c.classList.remove('tbw-hit'); void c.offsetWidth; c.classList.add('tbw-hit'); } } };
})();
