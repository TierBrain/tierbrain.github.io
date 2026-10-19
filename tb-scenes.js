/* TierBrain show cutscenes: openings and round breaks for The Big Quiz, Chapter & Verse and Hold The Throne.
   TBScenes.play(stage, show, kind, options) where kind is 'opening' or 'break'.
   The stage is any positioned element; the scene fills it and removes itself when done.
   Tap, click or press a key to skip. Needs tb-hosts.js loaded first. */
(function(){
  'use strict';
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clamp(x){ return x < 0 ? 0 : x > 1 ? 1 : x; }
  function seg(t, a, b){ return clamp((t - a)/(b - a)); }
  function ease(x){ x = clamp(x); return x*x*(3 - 2*x); }
  function easeOut(x){ x = clamp(x); return 1 - Math.pow(1 - x, 3); }
  function bounce(x){ x = clamp(x); var n = 7.5625, d = 2.75;
    if(x < 1/d) return n*x*x; if(x < 2/d){ x -= 1.5/d; return n*x*x + .75; } if(x < 2.5/d){ x -= 2.25/d; return n*x*x + .9375; } x -= 2.625/d; return n*x*x + .984375; }
  function rr(X, x, y, w, h, r){ X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }
  function crown(X, x, y, s){ X.beginPath(); X.moveTo(x - s, y + s*.6); X.lineTo(x - s, y - s*.2); X.lineTo(x - s*.5, y + s*.15); X.lineTo(x, y - s*.55); X.lineTo(x + s*.5, y + s*.15); X.lineTo(x + s, y - s*.2); X.lineTo(x + s, y + s*.6); X.closePath(); X.fill(); }
  function rnd(seed){ var x = Math.sin(seed*127.1)*43758.5453; return x - Math.floor(x); }
  var FONT = "'Baloo 2', 'Nunito', system-ui, sans-serif";

  /* ---------- synthesised sound ---------- */
  var AC = null, muted = false;
  function ac(){ if(muted) return null; try{ if(!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if(AC.state === 'suspended') AC.resume(); }catch(e){ return null; } return AC; }
  function noiseBuf(a, secs){ var b = a.createBuffer(1, Math.floor(a.sampleRate*secs), a.sampleRate), d = b.getChannelData(0); for(var i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1; return b; }
  function noise(at, dur, type, freq, q, gain, attack, release){
    var a = ac(); if(!a) return; var t = a.currentTime + at, src = a.createBufferSource(); src.buffer = noiseBuf(a, dur + .05);
    var f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    var g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + (attack || .005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + dur + .05); return { f:f, g:g, t:t };
  }
  function tone(at, freq, dur, type, gain, glide){
    var a = ac(); if(!a) return; var t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t); if(glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + .02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + .05);
  }
  var SFX = {
    drumroll: function(at, dur){ for(var i = 0; i < dur*28; i++) noise(at + i/28, .06, 'bandpass', 180 + Math.random()*60, 1.2, .16 + i/(dur*28)*.14); },
    cymbal: function(at){ noise(at, 1.8, 'highpass', 6000, .7, .22, .002); },
    applause: function(at, dur, cutAt){
      var end = cutAt != null ? cutAt : at + dur;
      for(var i = 0; i < (end - at)*70; i++){ var tt = at + Math.random()*(end - at), swell = Math.min(1, (tt - at)/.5);
        noise(tt, .045, 'bandpass', 1300 + Math.random()*2200, 1.4, .05*swell*(.6 + Math.random()*.6), .002); }
      noise(at, end - at + .3, 'bandpass', 2400, .4, .05, .4);
    },
    whoosh: function(at){ var n = noise(at, .6, 'bandpass', 400, 2, .2, .15); if(n) n.f.frequency.exponentialRampToValueAtTime(2400, n.t + .55); },
    fanfare: function(at){ [[523,0],[659,.18],[784,.36],[1047,.54]].forEach(function(n){ tone(at + n[1], n[0], n[1] === .54 ? 1.1 : .32, 'sawtooth', .07); tone(at + n[1], n[0]*1.005, n[1] === .54 ? 1.1 : .32, 'square', .03); }); },
    ding: function(at){ tone(at, 1568, 1.2, 'sine', .12); tone(at, 2349, .9, 'sine', .05); },
    sting: function(at){ tone(at, 392, .25, 'sawtooth', .06); tone(at + .16, 523, .5, 'sawtooth', .07); tone(at + .16, 659, .5, 'triangle', .06); },
    page: function(at){ for(var i = 0; i < 5; i++) noise(at + i*.07, .09, 'highpass', 2500, .8, .07); },
    shush: function(at){ noise(at, .9, 'bandpass', 3800, 1.6, .22, .08); },
    flame: function(at){ noise(at, .45, 'lowpass', 900, .7, .25, .03); },
    thump: function(at){ tone(at, 95, .22, 'sine', .22, 55); noise(at, .12, 'lowpass', 500, .8, .14, .003); },
    creak: function(at){ var a = ac(); if(!a) return; tone(at, 180, .7, 'sawtooth', .025, 120); noise(at, .6, 'bandpass', 700, 6, .05, .2); },
    splash: function(at){ noise(at, .7, 'lowpass', 1400, .7, .3, .01); noise(at + .05, .5, 'bandpass', 3200, 1.2, .1, .02); tone(at, 160, .3, 'sine', .12, 60); },
    whistle: function(at){ tone(at, 2100, .55, 'sine', .08, 2300); tone(at + .6, 2100, .25, 'sine', .07); },
    chime: function(at){ [784, 988, 1175].forEach(function(f, i){ tone(at + i*.09, f, .8, 'sine', .07); }); }
  };

  /* ---------- the scenes: each draws a back layer (behind the host) and a front layer (in front) ---------- */
  var SCENES = {};

  /* The Big Quiz: curtain up */
  SCENES.quiz = {
    opening: { dur: 8.2, title: 'The Big Quiz',
      cues: [ [0, 'drumroll', 1.3], [1.25, 'cymbal'], [1.3, 'applause', 3.2], [2.7, 'whoosh'], [3.25, 'ding'] ],
      host: [ [0, 'hidden'], [3.0, 'show'], [3.2, 'welcome', 'Welcome to The Big Quiz!'], [6.0, 'present'] ],
      back: function(X, W, H, t){ studio(X, W, H, t, seg(t, 1.9, 3.0), seg(t, 1.4, 2.2)); },
      front: function(X, W, H, t){ curtain(X, W, H, ease(seg(t, 1.25, 2.7))); board(X, W, H, t, bounce(seg(t, 2.7, 3.5)), 'The Big Quiz', ''); }
    },
    brk: { dur: 3.4, cues: [ [.15, 'sting'] ], host: [ [0, 'show'], [.3, 'present'] ],
      back: function(X, W, H, t, o){ studio(X, W, H, t, 1, 1); },
      front: function(X, W, H, t, o){ var d = bounce(seg(t, 0, .6)) - easeOut(seg(t, 2.8, 3.3)); board(X, W, H, t, d, o.round || 'Round 2', o.name || 'Fill the Gap'); }
    }
  };
  function studio(X, W, H, t, bulbs, spots){
    var g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d1013'); g.addColorStop(1, '#0f080a'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    var cx = W/2, ar = Math.min(W*.44, H*.98), cy = H*1.04, n = 26;
    X.strokeStyle = 'rgba(230,182,85,.14)'; X.lineWidth = Math.max(6, ar*.045); X.beginPath(); X.arc(cx, cy, ar, Math.PI*1.04, Math.PI*1.96); X.stroke();
    for(var i = 0; i <= n; i++){ var lit = i/n <= bulbs, chase = RM ? true : (Math.floor(t*5) + i) % 3 !== 0, on = lit && (bulbs < 1 || chase);
      var a = Math.PI*1.04 + Math.PI*.92*(i/n), bx = cx + Math.cos(a)*ar, by = cy + Math.sin(a)*ar, r = Math.max(2.4, ar*.02);
      X.fillStyle = on ? 'rgba(255,226,150,.95)' : 'rgba(120,86,50,.45)'; X.beginPath(); X.arc(bx, by, r, 0, 7); X.fill();
      if(on){ X.fillStyle = 'rgba(255,214,140,.15)'; X.beginPath(); X.arc(bx, by, r*3.4, 0, 7); X.fill(); } }
    for(var k = 0; k < 2; k++){ if(spots <= 0) break; var sw = RM ? 0 : Math.sin(t*.45 + k*2.4)*.3, ox = k ? W*.96 : W*.04;
      X.save(); X.globalAlpha = spots; X.translate(ox, -10); X.rotate((k ? .55 : -.55) + sw);
      var sg = X.createLinearGradient(0, 0, 0, H*1.3); sg.addColorStop(0, 'rgba(255,230,170,.24)'); sg.addColorStop(1, 'rgba(255,230,170,0)');
      X.fillStyle = sg; X.beginPath(); X.moveTo(-6, 0); X.lineTo(6, 0); X.lineTo(H*.34, H*1.3); X.lineTo(-H*.34, H*1.3); X.closePath(); X.fill(); X.restore(); }
    var fg = X.createRadialGradient(W/2, H, 0, W/2, H, H*.75); fg.addColorStop(0, 'rgba(230,182,85,.18)'); fg.addColorStop(1, 'rgba(230,182,85,0)'); X.fillStyle = fg; X.fillRect(0, 0, W, H);
  }
  function curtain(X, W, H, up){
    if(up >= 1) return; var y = -H*1.08*up;
    X.save(); X.translate(0, y);
    var folds = 14, fw = W/folds;
    for(var i = 0; i < folds; i++){ var g = X.createLinearGradient(i*fw, 0, (i + 1)*fw, 0);
      g.addColorStop(0, '#5a1418'); g.addColorStop(.45, '#a3262c'); g.addColorStop(.55, '#b4322f'); g.addColorStop(1, '#5a1418');
      X.fillStyle = g; X.fillRect(i*fw - 1, 0, fw + 2, H); }
    var sp = X.createRadialGradient(W/2, H*.55, 0, W/2, H*.55, H*.55); sp.addColorStop(0, 'rgba(255,220,160,.22)'); sp.addColorStop(1, 'rgba(255,220,160,0)'); X.fillStyle = sp; X.fillRect(0, 0, W, H);
    X.fillStyle = '#e6b655'; X.fillRect(0, H - H*.05, W, H*.05);
    X.fillStyle = '#c99a3c'; for(var j = 0; j < W; j += H*.025){ X.beginPath(); X.moveTo(j, H - H*.002); X.lineTo(j + H*.0125, H + H*.035); X.lineTo(j + H*.025, H - H*.002); X.fill(); }
    X.restore();
  }
  function board(X, W, H, t, drop, title, sub){
    if(drop <= 0) return;
    var bw = Math.min(W*.62, H*1.2), bh = sub ? H*.32 : H*.24, bx = W/2 - bw/2, by = -bh - 10 + (H*.06 + bh + 10)*drop;
    X.save(); X.shadowColor = 'rgba(0,0,0,.5)'; X.shadowBlur = 24; X.shadowOffsetY = 8;
    X.fillStyle = '#26151a'; rr(X, bx, by, bw, bh, bh*.18); X.fill(); X.restore();
    X.strokeStyle = '#e6b655'; X.lineWidth = Math.max(2, H*.008); rr(X, bx + 5, by + 5, bw - 10, bh - 10, bh*.15); X.stroke();
    var per = Math.floor((bw + bh)*2/(H*.045)), path = (bw - 20)*2 + (bh - 20)*2;
    for(var i = 0; i < per; i++){ var d = i/per*path, px, py, iw = bw - 20, ih = bh - 20;
      if(d < iw){ px = bx + 10 + d; py = by + 10; } else if(d < iw + ih){ px = bx + 10 + iw; py = by + 10 + d - iw; } else if(d < iw*2 + ih){ px = bx + 10 + iw - (d - iw - ih); py = by + 10 + ih; } else { px = bx + 10; py = by + 10 + ih - (d - iw*2 - ih); }
      var on = RM || (Math.floor(t*8) + i) % 2 === 0; X.fillStyle = on ? '#ffe296' : 'rgba(150,110,60,.6)'; X.beginPath(); X.arc(px, py, Math.max(1.6, H*.006), 0, 7); X.fill(); }
    var g = X.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, '#f2d27a'); g.addColorStop(1, '#e0a458');
    X.fillStyle = g; X.textAlign = 'center'; X.textBaseline = 'middle';
    X.font = '800 ' + Math.round(bh*(sub ? .32 : .44)) + 'px ' + FONT; X.fillText(title, W/2, by + bh*(sub ? .4 : .53));
    if(sub){ X.fillStyle = '#fbf1e2'; X.font = '700 ' + Math.round(bh*.16) + 'px ' + FONT; X.fillText(sub, W/2, by + bh*.74); }
  }

  /* Chapter & Verse: the book opens, the audience cheers, the storyteller shushes them */
  SCENES.verse = {
    opening: { dur: 9.0,
      cues: [ [.3, 'chime'], [1.7, 'page'], [2.2, 'page'], [3.5, 'applause', 1.6, 4.85], [4.7, 'shush'] ],
      host: [ [0, 'hidden'], [3.9, 'show'], [3.95, 'celebrate'], [4.55, 'shush', 'Shh!'], [6.0, 'welcome', 'Welcome, everyone. Let’s begin.'], [8.0, 'calm'] ],
      back: function(X, W, H, t){ studyBack(X, W, H, t, ease(seg(t, .2, 1.4))); },
      front: function(X, W, H, t){ book(X, W, H, t, ease(seg(t, 1.3, 2.1)), seg(t, 1.8, 2.9), ease(seg(t, 2.9, 3.7)), 'Chapter', '& Verse'); }
    },
    brk: { dur: 3.4, cues: [ [.05, 'page'], [.4, 'chime'] ], host: [ [0, 'show'], [.3, 'calm'] ],
      back: function(X, W, H, t){ studyBack(X, W, H, t, 1); },
      front: function(X, W, H, t, o){ pageCard(X, W, H, t, o.round || 'Chapter 2', o.name || 'Who said it?'); }
    }
  };
  function studyBack(X, W, H, t, lamp){
    var g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1a0f12'); g.addColorStop(1, '#0e0709'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    for(var sd = -1; sd <= 1; sd += 2){ var sx0 = sd < 0 ? 0 : W - W*.24, sw = W*.24;
      X.fillStyle = 'rgba(70,44,32,' + (.35 + lamp*.3) + ')'; X.fillRect(sx0, H*.1, sw, H);
      for(var row = 0; row < 4; row++){ var ry = H*.12 + row*H*.21; X.fillStyle = 'rgba(30,18,14,.9)'; X.fillRect(sx0, ry + H*.18, sw, Math.max(3, H*.018));
        var bxp = sx0 + 4, seed = row*13 + (sd > 0 ? 50 : 0);
        while(bxp < sx0 + sw - 6){ var bw = 6 + rnd(seed)*10, bh = H*.13 + rnd(seed + 1)*H*.05, cs = [[134,72,60],[96,120,90],[150,112,60],[86,70,100],[170,140,96]][Math.floor(rnd(seed + 2)*5)], k = .35 + lamp*.4;
          X.fillStyle = 'rgb(' + (cs[0]*k|0) + ',' + (cs[1]*k|0) + ',' + (cs[2]*k|0) + ')'; X.fillRect(bxp, ry + H*.18 - bh, bw - 1.5, bh); bxp += bw; seed += 3; } } }
    var fl = RM ? 1 : 1 + Math.sin(t*9)*.03 + Math.sin(t*23)*.02, lg = X.createRadialGradient(W/2, H*.55, 0, W/2, H*.55, H*.95*fl);
    lg.addColorStop(0, 'rgba(255,206,130,' + (.32*lamp) + ')'); lg.addColorStop(1, 'rgba(255,206,130,0)'); X.fillStyle = lg; X.fillRect(0, 0, W, H);
  }
  function book(X, W, H, t, open, flutter, write, left, right){
    var cx = W/2, bw = Math.min(W*.27, H*.5), bh = bw*.66, by = H - bh*.8;
    /* lectern */
    X.fillStyle = '#4a2c22'; X.beginPath(); X.moveTo(cx - bw*1.15, H); X.lineTo(cx - bw*1.05, by + bh*.55); X.lineTo(cx + bw*1.05, by + bh*.55); X.lineTo(cx + bw*1.15, H); X.closePath(); X.fill();
    X.fillStyle = '#5e3a2c'; X.fillRect(cx - bw*1.1, by + bh*.5, bw*2.2, bh*.1);
    var cw = Math.cos(open*Math.PI), lift = Math.sin(open*Math.PI)*bh*.08;
    /* back cover under the right-hand pages */
    X.fillStyle = '#5a221c'; rr(X, cx - 2, by - 4, bw + 6, bh + 8, 5); X.fill();
    if(cw < 0){ X.fillStyle = '#5a221c'; X.beginPath(); X.moveTo(cx, by - 4); X.lineTo(cx + (bw + 6)*cw, by - 4 - lift); X.lineTo(cx + (bw + 6)*cw, by + bh + 4 - lift); X.lineTo(cx, by + bh + 4); X.closePath(); X.fill(); }
    X.fillStyle = '#efe2c4'; rr(X, cx, by, bw, bh, 4); X.fill();
    if(open >= 1){ X.fillStyle = '#efe2c4'; rr(X, cx - bw, by, bw, bh, 4); X.fill(); X.fillStyle = 'rgba(0,0,0,.18)'; X.fillRect(cx - 2, by, 4, bh); }
    for(var p = 0; p < 4; p++){ var ph = clamp(flutter*1.6 - p*.2); if(ph <= 0 || ph >= 1) continue; var px = Math.cos(ph*Math.PI);
      X.fillStyle = 'rgba(244,234,210,' + (.95 - p*.1) + ')'; X.beginPath(); X.moveTo(cx, by + 3); X.lineTo(cx + bw*px, by + 3 - Math.sin(ph*Math.PI)*bh*.12); X.lineTo(cx + bw*px, by + bh - 3 - Math.sin(ph*Math.PI)*bh*.12); X.lineTo(cx, by + bh - 3); X.closePath(); X.fill(); }
    if(cw >= 0){ X.fillStyle = '#6e2a22'; X.beginPath(); X.moveTo(cx, by - 4); X.lineTo(cx + (bw + 6)*cw, by - 4 - lift); X.lineTo(cx + (bw + 6)*cw, by + bh + 4 - lift); X.lineTo(cx, by + bh + 4); X.closePath(); X.fill();
      if(cw > .2){ X.strokeStyle = 'rgba(230,182,85,.8)'; X.lineWidth = 2; X.strokeRect(cx + bw*cw*.12, by + bh*.1, bw*cw*.76, bh*.8);
        X.fillStyle = '#e6b655'; X.beginPath(); X.moveTo(cx + bw*cw*.5, by + bh*.32); X.lineTo(cx + bw*cw*.58, by + bh*.5); X.lineTo(cx + bw*cw*.5, by + bh*.68); X.lineTo(cx + bw*cw*.42, by + bh*.5); X.closePath(); X.fill(); } }
    else if(open < 1){ X.fillStyle = '#efe2c4'; X.beginPath(); X.moveTo(cx, by); X.lineTo(cx + bw*cw, by - lift); X.lineTo(cx + bw*cw, by + bh - lift); X.lineTo(cx, by + bh); X.closePath(); X.fill(); }
    if(write > 0 && open >= 1){
      X.save(); X.beginPath(); X.rect(cx - bw, by, bw*2*write, bh); X.clip();
      X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillStyle = '#7a2a1f'; X.font = '800 ' + Math.round(bh*.24) + 'px ' + FONT;
      X.fillText(left, cx - bw/2, by + bh*.45); X.fillText(right, cx + bw/2, by + bh*.45);
      X.strokeStyle = 'rgba(122,42,31,.3)'; X.lineWidth = 1;
      for(var l = 0; l < 3; l++){ X.beginPath(); X.moveTo(cx - bw*.82, by + bh*(.66 + l*.09)); X.lineTo(cx - bw*.18, by + bh*(.66 + l*.09)); X.moveTo(cx + bw*.18, by + bh*(.66 + l*.09)); X.lineTo(cx + bw*.82, by + bh*(.66 + l*.09)); X.stroke(); }
      X.restore(); }
  }
  function pageCard(X, W, H, t, a, b){
    var turnIn = ease(seg(t, 0, .7)), turnOut = ease(seg(t, 2.7, 3.3)), x0 = W*(1 - turnIn) - W*turnOut;
    X.save(); X.translate(x0, 0);
    var g = X.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#d8c39c'); g.addColorStop(.06, '#efe2c4'); g.addColorStop(1, '#e6d4ae');
    var cw = Math.min(W*.56, H*1.05), ch = H*.27, cx0 = W/2 - cw/2, cy0 = H*.04;
    X.fillStyle = 'rgba(0,0,0,.3)'; X.fillRect(cx0 + 4, cy0 + 6, cw, ch);
    X.fillStyle = g; X.fillRect(cx0, cy0, cw, ch);
    X.strokeStyle = 'rgba(122,42,31,.35)'; X.lineWidth = 1.5; X.strokeRect(cx0 + 6, cy0 + 6, cw - 12, ch - 12);
    X.textAlign = 'center'; X.textBaseline = 'middle';
    X.fillStyle = '#7a2a1f'; X.font = '800 ' + Math.round(ch*.4) + 'px ' + FONT; X.fillText(a, W/2, cy0 + ch*.42);
    X.fillStyle = '#4a2c22'; X.font = '700 ' + Math.round(ch*.17) + 'px ' + FONT; X.fillText(b, W/2, cy0 + ch*.76);
    X.restore();
  }

  /* Hold The Throne: torches, banners, fanfare, crown */
  SCENES.throne = {
    opening: { dur: 8.4,
      cues: [ [.35, 'flame'], [.8, 'flame'], [1.25, 'flame'], [1.7, 'flame'], [2.0, 'whoosh'], [3.0, 'fanfare'], [4.25, 'ding'], [4.3, 'applause', 1.8] ],
      host: [ [0, 'hidden'], [2.5, 'show'], [2.9, 'celebrate'], [4.0, 'point'], [5.0, 'welcome', 'Hear ye! Who will hold the throne?'], [7.2, 'present'] ],
      back: function(X, W, H, t){ hall(X, W, H, t, [seg(t, .35, .6), seg(t, .8, 1.05), seg(t, 1.25, 1.5), seg(t, 1.7, 1.95)], easeOut(seg(t, 2.0, 2.9)), bounce(seg(t, 3.4, 4.25))); },
      front: function(X, W, H, t){ ribbon(X, W, H, easeOut(seg(t, 4.5, 5.2)), 'Hold The Throne'); }
    },
    brk: { dur: 3.4, cues: [ [0, 'drumroll', 1.0], [1.0, 'fanfare'] ], host: [ [0, 'show'], [.2, 'point'], [1.0, 'celebrate'] ],
      back: function(X, W, H, t){ hall(X, W, H, t, [1,1,1,1], 1, 1); },
      front: function(X, W, H, t, o){ ribbon(X, W, H, easeOut(seg(t, .9, 1.5)) - ease(seg(t, 2.9, 3.3)), o.name || 'The Grand Finale'); }
    }
  };
  function hall(X, W, H, t, torches, banners, crownDrop){
    var lit = (torches[0] + torches[1] + torches[2] + torches[3])/4;
    var g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#160a10'); g.addColorStop(1, '#0c0608'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    var tw = Math.min(W*.3, H*.56), tx = W/2;
    X.fillStyle = 'rgba(' + (60 + lit*40|0) + ',30,32,' + (.4 + lit*.3) + ')'; X.beginPath(); X.moveTo(tx - tw/2, H); X.lineTo(tx - tw/2, H*.32);
    X.quadraticCurveTo(tx - tw*.5, H*.14, tx - tw*.2, H*.17); X.lineTo(tx, H*.08); X.lineTo(tx + tw*.2, H*.17); X.quadraticCurveTo(tx + tw*.5, H*.14, tx + tw/2, H*.32); X.lineTo(tx + tw/2, H); X.closePath(); X.fill();
    /* the crown comes down onto the throne */
    if(crownDrop > 0){ var cy = -H*.2 + (H*.2 + H*.07)*crownDrop; X.fillStyle = '#e6b655'; crown(X, tx, cy, tw*.17);
      X.fillStyle = '#d9694f'; X.beginPath(); X.arc(tx, cy + tw*.05, tw*.025, 0, 7); X.fill();
      if(crownDrop >= 1 && !RM){ var sp = (t*2) % 1; X.fillStyle = 'rgba(255,240,190,' + (1 - sp) + ')'; for(var s = 0; s < 6; s++){ var a = s/6*Math.PI*2 + t; X.beginPath(); X.arc(tx + Math.cos(a)*tw*(.2 + sp*.15), cy + Math.sin(a)*tw*(.12 + sp*.1), 2, 0, 7); X.fill(); } } }
    for(var b = -1; b <= 1; b += 2){ var bx = W/2 + b*W*.36, bw = Math.min(W*.12, H*.22), bh = H*.6*banners, sway = RM ? 0 : Math.sin(t*1.2 + b)*bw*.04;
      if(bh > 2){ X.fillStyle = '#7a2a1f'; X.beginPath(); X.moveTo(bx - bw/2, H*.02); X.lineTo(bx + bw/2, H*.02); X.lineTo(bx + bw/2 + sway, H*.02 + bh); X.lineTo(bx + sway, H*.02 + bh*.86); X.lineTo(bx - bw/2 + sway, H*.02 + bh); X.closePath(); X.fill();
        if(banners > .5){ X.fillStyle = 'rgba(230,182,85,' + (banners - .5)*2 + ')'; crown(X, bx + sway*.5, H*.24, bw*.28); } }
      X.fillStyle = '#3a2420'; X.fillRect(bx - bw*.6, H*.015, bw*1.2, H*.02); }
    var pos = [.06, .2, .8, .94];
    for(var i = 0; i < 4; i++){ var x = W*pos[i], y = H*.46, on = torches[i];
      X.fillStyle = '#4a2c22'; X.fillRect(x - 3, y, 6, H*.12); X.fillStyle = '#6e4a32'; X.fillRect(x - 7, y - 4, 14, 7);
      if(on > 0){ var fl = RM ? 1 : 1 + Math.sin(t*14 + i*2)*.12 + Math.sin(t*31 + i)*.08, fh = H*.07*on*fl;
        var gg = X.createRadialGradient(x, y - fh*.5, 0, x, y - fh*.5, H*.45*on); gg.addColorStop(0, 'rgba(255,170,90,.32)'); gg.addColorStop(1, 'rgba(255,170,90,0)'); X.fillStyle = gg; X.fillRect(0, 0, W, H);
        X.fillStyle = '#e0a458'; X.beginPath(); X.moveTo(x - fh*.32, y - 2); X.quadraticCurveTo(x - fh*.4, y - fh*.6, x, y - fh); X.quadraticCurveTo(x + fh*.4, y - fh*.6, x + fh*.32, y - 2); X.closePath(); X.fill();
        X.fillStyle = '#f2d27a'; X.beginPath(); X.moveTo(x - fh*.15, y - 2); X.quadraticCurveTo(x - fh*.2, y - fh*.45, x, y - fh*.7); X.quadraticCurveTo(x + fh*.2, y - fh*.45, x + fh*.15, y - 2); X.closePath(); X.fill(); } }
  }
  function ribbon(X, W, H, u, text){
    if(u <= 0) return; var rw = Math.min(W*.7, H*1.4), rh = H*.13, cx = W/2, cy = H*.84, half = rw/2*u;
    X.save();
    X.fillStyle = '#7a2a1f';
    for(var s = -1; s <= 1; s += 2){ X.beginPath(); X.moveTo(cx + s*half, cy - rh*.3); X.lineTo(cx + s*(half + rh*.7), cy - rh*.3); X.lineTo(cx + s*(half + rh*.45), cy + rh*.1); X.lineTo(cx + s*(half + rh*.7), cy + rh*.5); X.lineTo(cx + s*half, cy + rh*.5); X.closePath(); X.fill(); }
    var g = X.createLinearGradient(0, cy - rh/2, 0, cy + rh/2); g.addColorStop(0, '#d9694f'); g.addColorStop(1, '#b03823');
    X.fillStyle = g; X.fillRect(cx - half, cy - rh/2, half*2, rh);
    X.fillStyle = '#e6b655'; X.fillRect(cx - half, cy - rh/2, half*2, Math.max(2, rh*.06)); X.fillRect(cx - half, cy + rh/2 - Math.max(2, rh*.06), half*2, Math.max(2, rh*.06));
    X.beginPath(); X.rect(cx - half, cy - rh/2, half*2, rh); X.clip();
    X.fillStyle = '#fbf1e2'; X.textAlign = 'center'; X.textBaseline = 'middle'; X.font = '800 ' + Math.round(rh*.58) + 'px ' + FONT; X.fillText(text, cx, cy + rh*.04);
    X.restore();
  }

  /* Spines: the lamp clicks on and the books stack themselves on the desk */
  var SP_COLS = ['#5a2a24','#2f5a3f','#7a5a22','#2a3f5a','#6e3a52','#3d4a2a','#8a3a2a','#2a5a56','#5a4a2a','#4a2a5a','#2f4a3a','#7a2a2a'];
  var SP_SUBJ = ['History','Science','Music','Sport','Film & Screen','Geography','Art','Words','Nature','Myths','Food','General Knowledge'];
  var SP_BIBLE = ['Kings','Prophets','Parables','Miracles','Psalms','Women of the Bible','The Exodus','Early Church','Life of Jesus','Patriarchs','Wisdom','Judges'];
  SCENES.spines = {
    opening: { dur: 8.6,
      cues: [ [.3, 'flame'] ].concat(SP_COLS.map(function(c, i){ return [1.0 + i*.22, 'thump']; })).concat([[4.0, 'creak'], [4.9, 'shush'], [5.9, 'chime']]),
      host: [ [0, 'hidden'], [3.6, 'show'], [3.7, 'present'], [4.75, 'shush', 'Shh… steady now.'], [6.2, 'welcome', 'Whoever topples the pile is out!'], [8.0, 'calm'] ],
      back: function(X, W, H, t, o){ spStudy(X, W, H, t, ease(seg(t, .2, .9))); },
      front: function(X, W, H, t, o){ spPile(X, W, H, t, o, function(i){ return easeOut(seg(t, .85 + i*.22, 1.15 + i*.22)); }, t > 3.9 && t < 5.2 ? Math.sin((t - 3.9)*9)*(1 - seg(t, 3.9, 5.2))*.05 : 0);
        spTitle(X, W, H, ease(seg(t, 5.8, 6.4)), o.title || 'Spines', o.sub || ''); }
    },
    brk: { dur: 3.6, cues: [[.1, 'thump'], [.35, 'thump'], [.6, 'thump'], [.85, 'thump'], [1.2, 'chime']], host: [ [0, 'show'], [.2, 'present'] ],
      back: function(X, W, H, t){ spStudy(X, W, H, t, 1); },
      front: function(X, W, H, t, o){ spPile(X, W, H, t, o, function(i){ return easeOut(seg(t, i*.08, .3 + i*.08)); }, 0);
        spTitle(X, W, H, ease(seg(t, .9, 1.4)) - ease(seg(t, 3.0, 3.5)), o.name || 'A fresh pile', o.round || ''); }
    }
  };
  function spStudy(X, W, H, t, lamp){
    var g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d3128'); g.addColorStop(1, '#0c1511'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    var lx = W*.16, flick = RM ? 1 : 1 + Math.sin(t*11)*.015;
    var cg = X.createRadialGradient(lx + W*.1, H*.2, 0, lx + W*.1, H*.25, H*1.1*flick); cg.addColorStop(0, 'rgba(255,220,150,' + (.34*lamp) + ')'); cg.addColorStop(.5, 'rgba(255,200,120,' + (.1*lamp) + ')'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = cg; X.fillRect(0, 0, W, H);
    /* the banker's lamp */
    var s = Math.min(H/230, W/420); X.save(); X.translate(lx - 50*s, H*.86 - 150*s); X.scale(s, s);
    X.strokeStyle = '#6b4a26'; X.lineWidth = 7; X.lineCap = 'round'; X.beginPath(); X.moveTo(14, 150); X.lineTo(62, 150); X.stroke();
    X.strokeStyle = '#b8862f'; X.lineWidth = 5; X.beginPath(); X.moveTo(38, 146); X.lineTo(30, 70); X.lineTo(74, 28); X.stroke();
    X.fillStyle = '#2f5a3f'; X.beginPath(); X.moveTo(60, 10); X.lineTo(104, 30); X.lineTo(86, 62); X.lineTo(44, 40); X.closePath(); X.fill();
    X.fillStyle = 'rgba(255,241,201,' + (.25 + lamp*.75) + ')'; X.beginPath(); X.ellipse(78, 52, 13, 6, .49, 0, 7); X.fill(); X.restore();
    /* the desk */
    var dy = H*.86; X.fillStyle = '#5a3a22'; X.fillRect(0, dy, W, H - dy); X.fillStyle = '#7a5232'; X.fillRect(0, dy, W, 3);
    X.fillStyle = 'rgba(0,0,0,.35)'; X.fillRect(0, dy + 3, W, 6);
  }
  function spPile(X, W, H, t, o, drop, sway){
    var subj = (o.subjects && o.subjects.length) ? o.subjects : (o.bible ? SP_BIBLE : SP_SUBJ), n = SP_COLS.length, dy = H*.86, bh = Math.min(H*.045, 28), cx = W*.5, y = dy;
    X.save(); X.translate(cx, dy); X.rotate(sway); X.translate(-cx, -dy);
    for(var i = 0; i < n; i++){
      var d = drop(i); if(d <= 0){ y -= bh; continue; }
      var bw = Math.min(W*.2, H*.42)*(.82 + rnd(i*7)*.3), jx = (rnd(i*3) - .5)*W*.012, by = y - bh, fy = -H*.4 + (by + H*.4)*d;
      X.fillStyle = SP_COLS[i]; X.fillRect(cx - bw/2 + jx, fy, bw, bh - 1.5);
      X.fillStyle = 'rgba(255,255,255,.12)'; X.fillRect(cx - bw/2 + jx, fy, bw, 2);
      X.fillStyle = 'rgba(241,211,140,.55)'; X.fillRect(cx - bw/2 + jx + 6, fy + 3, 2, bh - 7); X.fillRect(cx + bw/2 + jx - 8, fy + 3, 2, bh - 7);
      X.fillStyle = '#f1d38c'; X.textAlign = 'center'; X.textBaseline = 'middle'; X.font = '600 ' + Math.round(bh*.46) + "px Fraunces, Georgia, serif";
      X.fillText(subj[i % subj.length], cx + jx, fy + bh*.52);
      y -= bh;
    }
    X.restore();
  }
  function spTitle(X, W, H, u, a, b){
    if(u <= 0) return; X.save(); X.globalAlpha = Math.min(1, u);
    var w = Math.min(W*.5, H*.95), h = b ? H*.2 : H*.15, x = W*.5 - w/2, y = H*.05 - (1 - u)*H*.06;
    X.fillStyle = 'rgba(12,22,17,.88)'; rr(X, x, y, w, h, 12); X.fill(); X.strokeStyle = 'rgba(217,178,90,.7)'; X.lineWidth = 2; rr(X, x + 5, y + 5, w - 10, h - 10, 9); X.stroke();
    X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillStyle = '#f1d38c'; X.font = '700 ' + Math.round(h*(b ? .34 : .5)) + "px Fraunces, Georgia, serif";
    X.fillText(a, W/2, y + h*(b ? .4 : .52));
    if(b){ X.fillStyle = '#b9c4b4'; X.font = '700 ' + Math.round(h*.17) + 'px Nunito, system-ui, sans-serif'; X.fillText(b, W/2, y + h*.74); }
    X.restore();
  }

  /* Standing Room: the boards are laid over the water by lantern light, then one sinks */
  SCENES.harbour = {
    opening: { dur: 8.4,
      cues: [ [.3, 'chime'] ].concat([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(function(i){ return [1.0 + i*.12, 'thump']; })).concat([[3.4, 'splash'], [4.4, 'whistle'], [5.6, 'applause', 1.2]]),
      host: [ [0, 'hidden'], [3.0, 'show'], [3.1, 'present'], [3.5, 'wince', 'Mind the gaps!'], [4.4, 'point'], [5.6, 'welcome', 'Last one standing wins!'], [7.6, 'calm'] ],
      back: function(X, W, H, t){ srWater(X, W, H, t, ease(seg(t, 0, 1.0))); srDeck(X, W, H, t, function(i){ return easeOut(seg(t, 1.0 + i*.12, 1.3 + i*.12)); }, i => i === 9 ? seg(t, 3.3, 4.0) : 0); },
      front: function(X, W, H, t, o){ spTitle(X, W, H, ease(seg(t, 5.4, 6.0)), o.title || 'Standing Room', o.sub || 'Together'); }
    },
    brk: { dur: 3.6, cues: [ [.4, 'splash'] ], host: [ [0, 'show'], [.3, 'wince'], [1.4, 'calm'] ],
      back: function(X, W, H, t){ srWater(X, W, H, t, 1); srDeck(X, W, H, t, function(){ return 1; }, i => i === 6 ? seg(t, .3, 1.1) : 0); },
      front: function(X, W, H, t, o){ spTitle(X, W, H, ease(seg(t, 1.0, 1.5)) - ease(seg(t, 3.0, 3.5)), o.name || 'Into the water', o.round || ''); }
    }
  };
  function srWater(X, W, H, t, moon){
    var g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1c2c34'); g.addColorStop(.5, '#16232b'); g.addColorStop(1, '#0a1216'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    var mx = W*.82, my = H*(.3 - .14*moon), mr = Math.min(W, H)*.055;
    X.fillStyle = 'rgba(232,220,196,' + (.85*moon) + ')'; X.beginPath(); X.arc(mx, my, mr, 0, 7); X.fill();
    var wl = H*.42; X.fillStyle = '#101b22'; X.fillRect(0, wl, W, H - wl);
    for(var k = 0; k < 18; k++){ var wy = wl + 4 + k*k*1.2, ph = RM ? 0 : t*1.4 + k;
      X.strokeStyle = 'rgba(232,220,196,' + (.16 - k*.007)*moon + ')'; X.lineWidth = 1.3; X.beginPath(); X.moveTo(mx - 24 - k*5 + Math.sin(ph)*7, wy); X.lineTo(mx + 24 + k*5 + Math.sin(ph)*7, wy); X.stroke(); }
  }
  function srDeck(X, W, H, t, lay, sink){
    var n = 4, size = Math.min(W*.44, H*.72), tile = size/n, gap = tile*.07, x0 = W*.37 - size/2, y0 = H*.44;
    for(var i = 0; i < n*n; i++){
      var r = Math.floor(i/n), c = i % n, d = lay(i), s = sink(i); if(d <= 0) continue;
      var x = x0 + c*tile, y = y0 + r*tile*.62 - (1 - d)*H*.3 + s*tile*.8, a = 1 - s;
      if(a <= 0) continue;
      X.save(); X.globalAlpha = a; X.translate(x + tile/2, y + tile*.31); X.rotate(s*.3);
      var gg = X.createLinearGradient(0, -tile*.31, 0, tile*.31); gg.addColorStop(0, '#a58760'); gg.addColorStop(1, '#6b5540');
      X.fillStyle = gg; X.fillRect(-tile/2 + gap/2, -tile*.31 + gap/2, tile - gap, tile*.62 - gap);
      X.fillStyle = 'rgba(0,0,0,.35)'; X.fillRect(-tile/2 + gap/2, tile*.31 - gap/2 - 3, tile - gap, 3);
      X.restore();
      if(s > 0 && s < 1 && !RM){ X.strokeStyle = 'rgba(232,220,196,' + (1 - s)*.7 + ')'; X.lineWidth = 2; X.beginPath(); X.ellipse(x + tile/2, y0 + r*tile*.62 + tile*.5, tile*(.3 + s*.8), tile*(.08 + s*.2), 0, 0, 7); X.stroke(); }
    }
  }

  /* ---------- player ---------- */
  function play(stage, show, kind, o){
    o = o || {}; var def = SCENES[show] && SCENES[show][kind === 'break' ? 'brk' : 'opening']; if(!def) return null;
    if(o.muted != null) muted = !!o.muted;
    var wrap = document.createElement('div'); wrap.className = 'tb-scene';
    wrap.style.cssText = 'position:absolute;inset:0;z-index:50;overflow:hidden;background:#0c0608;cursor:pointer;transition:opacity .45s;';
    var back = document.createElement('canvas'), front = document.createElement('canvas'), hostBox = document.createElement('div'), hostCv = document.createElement('canvas'), bubble = document.createElement('div');
    [back, front].forEach(function(c){ c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'; });
    hostBox.style.cssText = (show === 'spines' || show === 'harbour') ? 'position:absolute;left:58%;width:40%;bottom:0;height:74%;transition:none;' : 'position:absolute;left:22%;width:56%;bottom:0;height:78%;transition:none;';
    hostCv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    bubble.className = 'tb-scene-bubble hide';
    bubble.style.cssText = 'position:absolute;left:' + ({quiz:'61%',verse:'60%',throne:'61%',spines:'54%',harbour:'54%'}[show] || '60%') + ';top:' + ({quiz:'40%',verse:'22%',throne:'24%',spines:'26%',harbour:'26%'}[show] || '24%') + ';max-width:34%;background:#fbf1e2;color:#1c1013;font:800 clamp(13px,2.2vw,22px)/1.25 Nunito,system-ui,sans-serif;padding:.5em .8em;border-radius:14px 14px 14px 4px;box-shadow:0 8px 20px rgba(0,0,0,.4);display:none;';
    hostBox.appendChild(hostCv);
    var skip = document.createElement('div'); skip.textContent = 'Tap to skip';
    skip.style.cssText = 'position:absolute;right:12px;bottom:10px;font:800 12px Nunito,system-ui,sans-serif;color:rgba(251,241,226,.55);pointer-events:none;';
    wrap.appendChild(back); wrap.appendChild(hostBox); wrap.appendChild(front); wrap.appendChild(bubble); wrap.appendChild(skip);
    if(getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
    stage.appendChild(wrap);
    var host = window.TBHost.create(hostCv, bubble, show, o.person, { transparent:true });
    var BX = back.getContext('2d'), FX = front.getContext('2d'), W = 0, H = 0;
    function size(){ var r = wrap.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
      [back, front].forEach(function(c){ c.width = Math.round(W*d); c.height = Math.round(H*d); c.getContext('2d').setTransform(d, 0, 0, d, 0, 0); }); host.resize(); }
    size(); host.start();
    var start = performance.now(), dur = RM ? 1.6 : def.dur, done = false, raf = 0, fired = {}, bubbleT = 0;
    function cue(c){
      var fn = SFX[c[1]]; if(!fn || RM) return;
      if(c[1] === 'applause') fn(0, c[2], c[3] != null ? c[3] - c[0] : null); else if(c[1] === 'drumroll') fn(0, c[2]); else fn(0);
    }
    function hostCue(c){
      if(c[1] === 'hidden'){ hostBox.style.opacity = 0; return; }
      if(c[1] === 'show'){ hostBox.style.transition = 'opacity .5s, transform .6s cubic-bezier(.2,1.2,.4,1)'; hostBox.style.opacity = 1; hostBox.style.transform = 'translateY(0)'; return; }
      host.set(c[1]);
      if(c[2]){ bubble.textContent = c[2]; bubble.classList.remove('hide'); bubble.style.display = 'block'; clearTimeout(bubbleT);
        bubbleT = setTimeout(function(){ bubble.classList.add('hide'); bubble.style.display = 'none'; }, 1900); }
    }
    hostBox.style.transform = 'translateY(12%)';
    if(RM){ (def.host || []).forEach(function(c){ if(c[1] !== 'hidden') hostCue(c); }); }
    function frame(now){
      var t = (now - start)/1000; if(RM) t = def.dur - .01;
      if(!W) size();
      (def.cues || []).forEach(function(c, i){ if(!fired['c' + i] && t >= c[0]){ fired['c' + i] = 1; cue(c); } });
      (def.host || []).forEach(function(c, i){ if(!fired['h' + i] && t >= c[0]){ fired['h' + i] = 1; if(!RM) hostCue(c); } });
      BX.clearRect(0, 0, W, H); FX.clearRect(0, 0, W, H);
      def.back(BX, W, H, t, o); def.front(FX, W, H, t, o);
      if(((now - start)/1000) >= dur) return finish();
      raf = requestAnimationFrame(frame);
    }
    function finish(){ if(done) return; done = true; cancelAnimationFrame(raf); wrap.style.opacity = 0;
      setTimeout(function(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); if(o.onEnd) o.onEnd(); }, 460); }
    wrap.addEventListener('click', finish);
    function key(e){ if(e.key === 'Escape' || e.key === ' ' || e.key === 'Enter'){ document.removeEventListener('keydown', key); finish(); } }
    document.addEventListener('keydown', key);
    window.addEventListener('resize', size);
    raf = requestAnimationFrame(frame);
    return { skip: finish };
  }

  window.TBScenes = { play: play, mute: function(m){ muted = !!m; }, shows: Object.keys(SCENES) };
})();
