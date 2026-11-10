/* LXX cutscenes: an opening, one scene per level, a win and a loss, and the Triumph.
   LXXScenes.play(kind, host, options) paints the scene into a canvas placed inside host and returns
   { D: length in seconds, at: when the title should arrive, stop() }.
   Everything is drawn on a 1600 x 900 stage that covers the host, so the middle 400 units must carry the story on a phone.
   The lower part of the stage sits under the title plaque: keep the action in the top half. */
(function(){
'use strict';
const TAU = Math.PI * 2;
const clamp = x => x < 0 ? 0 : x > 1 ? 1 : x;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const out = x => 1 - Math.pow(1 - clamp(x), 3);
const back = x => { x = clamp(x); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = s => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => { const A = hex(a), B = hex(b); t = clamp(t); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; };
function lin(X, x0, y0, x1, y1, stops){ const g = X.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; }
function glow(X, x, y, r, c0, c1){ const g = X.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c0); g.addColorStop(1, c1); X.fillStyle = g; X.fillRect(x - r, y - r, r * 2, r * 2); }
function rr(X, x, y, w, h, r){ X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }

/* ---------- shared pieces ---------- */
function sky(X, stops){ X.fillStyle = lin(X, 0, 0, 0, 900, stops); X.fillRect(-400, 0, 2400, 900); }
function sun(X, x, y, r, t, col, rayA){
  glow(X, x, y, r * 5, 'rgba(255,244,205,.75)', 'rgba(255,244,205,0)');
  X.save(); X.translate(x, y); X.rotate(t * .12); X.fillStyle = 'rgba(255,236,170,' + (rayA == null ? .22 : rayA) + ')';
  for (let i = 0; i < 16; i++) { X.rotate(TAU / 16); X.beginPath(); X.moveTo(0, 0); X.lineTo(1500, -70); X.lineTo(1500, 70); X.closePath(); X.fill(); }
  X.restore(); X.fillStyle = col || '#fff3c4'; X.beginPath(); X.arc(x, y, r, 0, TAU); X.fill();
}
function hills(X, base, amp, seed, col, shift){
  X.fillStyle = col; X.beginPath(); X.moveTo(-400, 900);
  for (let x = -400; x <= 2000; x += 20) { const u = (x + (shift || 0)) / 1600; X.lineTo(x, base - amp * (Math.sin(u * 5.1 + seed) * .55 + Math.sin(u * 11.3 + seed * 2.3) * .3 + Math.sin(u * 23 + seed * 4.1) * .15)); }
  X.lineTo(2000, 900); X.closePath(); X.fill();
}
function cloud(X, x, y, s, a){ X.fillStyle = 'rgba(255,255,255,' + a + ')'; [[0, 0, 60], [55, 10, 46], [-58, 12, 42], [22, -24, 44], [-24, -18, 38]].forEach(c => { X.beginPath(); X.ellipse(x + c[0] * s, y + c[1] * s, c[2] * s, c[2] * s * .62, 0, 0, TAU); X.fill(); }); }
function pine(X, x, y, s, dark){ /* umbrella pine */
  X.strokeStyle = '#6b4a2f'; X.lineWidth = 9 * s; X.lineCap = 'round'; X.beginPath(); X.moveTo(x, y); X.quadraticCurveTo(x + 6 * s, y - 70 * s, x - 2 * s, y - 130 * s); X.stroke();
  X.lineWidth = 5 * s; X.beginPath(); X.moveTo(x, y - 95 * s); X.lineTo(x + 34 * s, y - 132 * s); X.moveTo(x, y - 100 * s); X.lineTo(x - 36 * s, y - 134 * s); X.stroke();
  [[0, -150, 74, 30], [-48, -138, 46, 22], [50, -136, 48, 22], [0, -168, 48, 20]].forEach((c, i) => { X.fillStyle = i === 3 ? (dark ? '#4f7a3a' : '#6c9a48') : (dark ? '#3f6730' : '#557f3a'); X.beginPath(); X.ellipse(x + c[0] * s, y + c[1] * s, c[2] * s, c[3] * s, 0, 0, TAU); X.fill(); });
}
function cypress(X, x, y, s){ X.fillStyle = '#35592c'; X.beginPath(); X.moveTo(x, y - 190 * s); X.bezierCurveTo(x + 30 * s, y - 120 * s, x + 26 * s, y - 30 * s, x, y); X.bezierCurveTo(x - 26 * s, y - 30 * s, x - 30 * s, y - 120 * s, x, y - 190 * s); X.fill(); X.fillStyle = 'rgba(255,255,255,.08)'; X.beginPath(); X.moveTo(x, y - 190 * s); X.bezierCurveTo(x + 12 * s, y - 120 * s, x + 10 * s, y - 30 * s, x, y); X.fill(); }
function temple(X, x, y, s, wall, shade, roof, cols){
  const n = cols || 6, w = 46 * n * s;
  X.fillStyle = shade; X.fillRect(x - w / 2 - 10 * s, y - 14 * s, w + 20 * s, 14 * s); X.fillRect(x - w / 2 - 4 * s, y - 24 * s, w + 8 * s, 10 * s);
  X.fillStyle = shade; X.fillRect(x - w / 2, y - 150 * s, w, 126 * s);
  for (let i = 0; i < n; i++) { const cx = x - w / 2 + (i + .5) * (w / n); X.fillStyle = wall; X.fillRect(cx - 9 * s, y - 150 * s, 18 * s, 126 * s); X.fillStyle = 'rgba(0,0,0,.08)'; X.fillRect(cx + 3 * s, y - 150 * s, 6 * s, 126 * s); }
  X.fillStyle = wall; X.fillRect(x - w / 2 - 8 * s, y - 166 * s, w + 16 * s, 16 * s);
  X.fillStyle = roof; X.beginPath(); X.moveTo(x - w / 2 - 14 * s, y - 166 * s); X.lineTo(x, y - 230 * s); X.lineTo(x + w / 2 + 14 * s, y - 166 * s); X.closePath(); X.fill();
  X.fillStyle = 'rgba(255,255,255,.25)'; X.beginPath(); X.moveTo(x - w / 2 + 16 * s, y - 172 * s); X.lineTo(x, y - 216 * s); X.lineTo(x + w / 2 - 16 * s, y - 172 * s); X.closePath(); X.fill();
}
function arches(X, x0, x1, y, h, span, col, hole){
  X.fillStyle = col; X.fillRect(x0, y - h, x1 - x0, h);
  X.fillStyle = hole; for (let x = x0 + span * .15; x < x1 - span * .5; x += span) { const w = span * .7; X.beginPath(); X.moveTo(x, y); X.lineTo(x, y - h * .5); X.arc(x + w / 2, y - h * .5, w / 2, Math.PI, 0); X.lineTo(x + w, y); X.closePath(); X.fill(); }
}
function colosseum(X, x, y, s, wall, shade, hole){
  for (let tier = 0; tier < 3; tier++) { const w = (330 - tier * 14) * s, h = 62 * s, ty = y - tier * h; X.fillStyle = tier % 2 ? shade : wall; rr(X, x - w / 2, ty - h, w, h, 6 * s); X.fill();
    X.fillStyle = hole; const n = 9; for (let i = 0; i < n; i++) { const ax = x - w / 2 + (i + .5) * (w / n), aw = w / n * .56; X.beginPath(); X.moveTo(ax - aw / 2, ty - 4 * s); X.lineTo(ax - aw / 2, ty - h * .5); X.arc(ax, ty - h * .5, aw / 2, Math.PI, 0); X.lineTo(ax + aw / 2, ty - 4 * s); X.closePath(); X.fill(); } }
  X.fillStyle = wall; rr(X, x - 150 * s, y - 3 * 62 * s - 34 * s, 300 * s, 34 * s, 4 * s); X.fill();
}
function soldier(X, x, y, s, ph, dark){
  const sw = Math.sin(ph) * 12 * s, bob = Math.abs(Math.cos(ph)) * 4 * s; y -= bob;
  X.lineCap = 'round'; X.strokeStyle = dark || '#8a5a3a'; X.lineWidth = 9 * s;
  X.beginPath(); X.moveTo(x - 4 * s, y - 40 * s); X.lineTo(x - 4 * s + sw, y); X.moveTo(x + 4 * s, y - 40 * s); X.lineTo(x + 4 * s - sw, y); X.stroke();
  X.strokeStyle = dark || '#5b4a3a'; X.lineWidth = 3.5 * s; X.beginPath(); X.moveTo(x - 12 * s, y - 30 * s); X.lineTo(x + 6 * s, y - 150 * s); X.stroke();
  X.fillStyle = dark || '#c9ccd2'; X.beginPath(); X.moveTo(x + 6 * s, y - 150 * s); X.lineTo(x + 2 * s, y - 132 * s); X.lineTo(x + 9 * s, y - 133 * s); X.closePath(); X.fill();
  X.fillStyle = dark || '#b9342a'; rr(X, x - 13 * s, y - 84 * s, 26 * s, 48 * s, 5 * s); X.fill();
  X.fillStyle = dark || '#d9a77c'; X.beginPath(); X.arc(x, y - 96 * s, 11 * s, 0, TAU); X.fill();
  X.fillStyle = dark || '#c9ccd2'; X.beginPath(); X.arc(x, y - 99 * s, 12 * s, Math.PI, 0); X.fill(); X.fillRect(x - 13 * s, y - 100 * s, 26 * s, 4 * s);
  X.fillStyle = dark || '#b9342a'; X.beginPath(); X.ellipse(x, y - 112 * s, 12 * s, 5 * s, 0, Math.PI, 0); X.fill();
  X.fillStyle = dark || '#9e2a22'; rr(X, x + 2 * s, y - 82 * s, 28 * s, 56 * s, 7 * s); X.fill();
  if (!dark) { X.strokeStyle = '#e2b84a'; X.lineWidth = 2.5 * s; rr(X, x + 5 * s, y - 79 * s, 22 * s, 50 * s, 5 * s); X.stroke(); X.fillStyle = '#e2b84a'; X.beginPath(); X.arc(x + 16 * s, y - 54 * s, 5 * s, 0, TAU); X.fill(); }
}
function eagle(X, x, y, s, spread){ /* the aquila */
  X.fillStyle = '#e2b84a'; X.strokeStyle = '#a97a1c'; X.lineWidth = 2 * s;
  [-1, 1].forEach(d => { X.beginPath(); X.moveTo(x, y); for (let i = 0; i <= 5; i++) { const a = -0.25 - spread * .55 + i * .12, len = (92 - i * 9) * s; X.lineTo(x + d * Math.cos(a) * len, y + Math.sin(a) * len + i * 9 * s); } X.lineTo(x, y + 44 * s); X.closePath(); X.fill(); X.stroke(); });
  X.beginPath(); X.ellipse(x, y + 18 * s, 17 * s, 30 * s, 0, 0, TAU); X.fill(); X.stroke();
  X.beginPath(); X.arc(x + 2 * s, y - 16 * s, 12 * s, 0, TAU); X.fill(); X.stroke();
  X.fillStyle = '#a97a1c'; X.beginPath(); X.moveTo(x + 11 * s, y - 18 * s); X.lineTo(x + 28 * s, y - 12 * s); X.lineTo(x + 11 * s, y - 9 * s); X.closePath(); X.fill();
}
function standard(X, x, top, s, spread, wave, col){
  X.strokeStyle = '#6b4a2f'; X.lineWidth = 9 * s; X.lineCap = 'round'; X.beginPath(); X.moveTo(x, top + 40 * s); X.lineTo(x, 1000); X.stroke();
  X.fillStyle = '#e2b84a'; X.fillRect(x - 60 * s, top + 60 * s, 120 * s, 8 * s);
  X.fillStyle = col || '#9e2a22'; X.beginPath(); X.moveTo(x - 54 * s, top + 68 * s);
  for (let i = 0; i <= 10; i++) X.lineTo(x - 54 * s + i * 10.8 * s, top + 68 * s + (i ? 0 : 0));
  for (let i = 10; i >= 0; i--) X.lineTo(x - 54 * s + i * 10.8 * s + Math.sin(wave + i * .6) * 4 * s, top + 196 * s + Math.sin(wave * 1.3 + i * .9) * 6 * s);
  X.closePath(); X.fill();
  X.fillStyle = '#f0cf6a'; X.font = '900 ' + Math.round(34 * s) + "px 'Cinzel','Times New Roman',serif"; X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillText('SPQR', x, top + 132 * s);
  eagle(X, x, top, s, spread);
}
function petals(X, t, n, cols){
  for (let i = 0; i < n; i++) { const sp = 90 + rnd(i + 3) * 120, x = rnd(i) * 2000 - 200 + Math.sin(t * 1.3 + i) * 40, y = ((rnd(i + 9) * 1000 + t * sp) % 1000) - 50;
    X.save(); X.translate(x, y); X.rotate(t * (1 + rnd(i + 5) * 2) + i); X.fillStyle = cols[i % cols.length]; X.beginPath(); X.ellipse(0, 0, 11 + rnd(i + 2) * 8, 6 + rnd(i + 4) * 4, 0, 0, TAU); X.fill(); X.restore(); }
}
function leg(X, hx, hy, a, b, l1, l2, w){ const kx = hx + Math.sin(a) * l1, ky = hy + Math.cos(a) * l1, fx = kx + Math.sin(a + b) * l2, fy = ky + Math.cos(a + b) * l2; X.lineWidth = w; X.beginPath(); X.moveTo(hx, hy); X.lineTo(kx, ky); X.lineTo(fx, fy); X.stroke(); }
function horse(X, x, y, s, ph, coat, maneC){
  X.save(); X.translate(x, y - Math.abs(Math.sin(ph)) * 10 * s); X.rotate(Math.sin(ph * 2) * .035); X.lineCap = 'round'; X.lineJoin = 'round';
  X.strokeStyle = mix(coat, '#000000', .25);
  leg(X, -44 * s, -66 * s, Math.sin(ph + 2.2) * .9 - .1, -.5 - .5 * Math.sin(ph + 3.2), 34 * s, 36 * s, 9 * s);
  leg(X, 40 * s, -66 * s, Math.sin(ph + .9) * .9 + .1, .4 + .5 * Math.sin(ph + 2.1), 34 * s, 36 * s, 9 * s);
  X.strokeStyle = maneC; X.lineWidth = 7 * s; X.beginPath(); X.moveTo(-64 * s, -84 * s); X.quadraticCurveTo(-104 * s, -92 * s + Math.sin(ph) * 10 * s, -116 * s, -60 * s + Math.cos(ph) * 12 * s); X.stroke();
  X.fillStyle = coat; X.beginPath(); X.ellipse(0, -78 * s, 66 * s, 27 * s, 0, 0, TAU); X.fill();
  X.beginPath(); X.moveTo(36 * s, -98 * s); X.lineTo(70 * s, -150 * s); X.lineTo(92 * s, -138 * s); X.lineTo(62 * s, -70 * s); X.closePath(); X.fill();
  X.beginPath(); X.ellipse(92 * s, -146 * s, 26 * s, 13 * s, .45, 0, TAU); X.fill();
  X.beginPath(); X.moveTo(74 * s, -156 * s); X.lineTo(78 * s, -176 * s); X.lineTo(86 * s, -158 * s); X.closePath(); X.fill();
  X.strokeStyle = maneC; X.lineWidth = 8 * s; X.beginPath(); X.moveTo(70 * s, -152 * s); X.quadraticCurveTo(44 * s, -130 * s, 34 * s, -100 * s); X.stroke();
  X.fillStyle = '#2a1f17'; X.beginPath(); X.arc(98 * s, -150 * s, 2.6 * s, 0, TAU); X.fill();
  X.strokeStyle = coat;
  leg(X, -48 * s, -66 * s, Math.sin(ph + 1.6) * .9 - .1, -.5 - .5 * Math.sin(ph + 2.6), 34 * s, 36 * s, 10 * s);
  leg(X, 44 * s, -66 * s, Math.sin(ph + .3) * .9 + .1, .4 + .5 * Math.sin(ph + 1.5), 34 * s, 36 * s, 10 * s);
  X.restore();
}
function rider(X, x, y, s, ph, cloak){
  const by = y - Math.abs(Math.sin(ph)) * 10 * s;
  X.fillStyle = cloak; X.beginPath(); X.moveTo(x - 6 * s, by - 150 * s);
  X.bezierCurveTo(x - 60 * s, by - 150 * s + Math.sin(ph * 2) * 10 * s, x - 90 * s, by - 126 * s + Math.cos(ph * 2) * 14 * s, x - 128 * s, by - 132 * s + Math.sin(ph * 2 + 1) * 18 * s);
  X.bezierCurveTo(x - 92 * s, by - 104 * s, x - 50 * s, by - 100 * s, x - 2 * s, by - 104 * s); X.closePath(); X.fill();
  X.fillStyle = '#f1e7d2'; rr(X, x - 14 * s, by - 152 * s, 30 * s, 58 * s, 10 * s); X.fill();
  X.strokeStyle = '#d9a77c'; X.lineWidth = 8 * s; X.lineCap = 'round'; X.beginPath(); X.moveTo(x + 8 * s, by - 136 * s); X.lineTo(x + 44 * s, by - 118 * s); X.stroke();
  X.strokeStyle = '#8a5a3a'; X.lineWidth = 9 * s; X.beginPath(); X.moveTo(x + 2 * s, by - 100 * s); X.lineTo(x + 16 * s, by - 62 * s); X.stroke();
  X.fillStyle = '#d9a77c'; X.beginPath(); X.arc(x + 4 * s, by - 166 * s, 13 * s, 0, TAU); X.fill();
  X.fillStyle = '#5b3b22'; X.beginPath(); X.arc(x + 2 * s, by - 170 * s, 13 * s, Math.PI * .95, Math.PI * 1.95); X.fill();
}
function gladiator(X, x, y, s, arm, step){
  X.lineCap = 'round'; X.lineJoin = 'round';
  X.fillStyle = 'rgba(70,45,15,.28)'; X.beginPath(); X.ellipse(x, y + 4 * s, 78 * s, 13 * s, 0, 0, TAU); X.fill();
  const sw = Math.sin(step) * 12 * s;
  X.strokeStyle = '#c08f62'; X.lineWidth = 22 * s; X.beginPath(); X.moveTo(x - 16 * s, y - 86 * s); X.lineTo(x - 22 * s + sw, y - 8 * s); X.moveTo(x + 16 * s, y - 86 * s); X.lineTo(x + 24 * s - sw, y - 8 * s); X.stroke();
  X.strokeStyle = '#b08a3a'; X.lineWidth = 24 * s; X.beginPath(); X.moveTo(x - 21 * s + sw * .8, y - 44 * s); X.lineTo(x - 22 * s + sw, y - 10 * s); X.moveTo(x + 22 * s - sw * .8, y - 44 * s); X.lineTo(x + 24 * s - sw, y - 10 * s); X.stroke();
  X.fillStyle = '#7a2a22'; X.beginPath(); X.moveTo(x - 38 * s, y - 108 * s); X.lineTo(x + 38 * s, y - 108 * s); X.lineTo(x + 46 * s, y - 62 * s); X.lineTo(x - 46 * s, y - 62 * s); X.closePath(); X.fill();
  X.fillStyle = '#c08f62'; X.beginPath(); X.moveTo(x - 44 * s, y - 196 * s); X.lineTo(x + 44 * s, y - 196 * s); X.lineTo(x + 36 * s, y - 104 * s); X.lineTo(x - 36 * s, y - 104 * s); X.closePath(); X.fill();
  X.fillStyle = '#5b3b22'; X.fillRect(x - 40 * s, y - 118 * s, 80 * s, 16 * s); X.fillStyle = '#e2b84a'; X.fillRect(x - 10 * s, y - 120 * s, 20 * s, 20 * s);
  X.strokeStyle = '#5b3b22'; X.lineWidth = 8 * s; X.beginPath(); X.moveTo(x - 40 * s, y - 192 * s); X.lineTo(x + 34 * s, y - 122 * s); X.stroke();
  /* sword arm */
  const sx = x + 46 * s, sy = y - 184 * s, a = lerp(.5, -2.2, arm), ex = sx + Math.cos(a) * 46 * s, ey = sy + Math.sin(a) * 46 * s, a2 = a - .5 * arm - .2, hx = ex + Math.cos(a2) * 40 * s, hy = ey + Math.sin(a2) * 40 * s;
  X.strokeStyle = '#8f96a0'; X.lineWidth = 20 * s; X.beginPath(); X.moveTo(sx, sy); X.lineTo(ex, ey); X.stroke();
  X.strokeStyle = '#c08f62'; X.lineWidth = 16 * s; X.beginPath(); X.moveTo(ex, ey); X.lineTo(hx, hy); X.stroke();
  X.strokeStyle = '#e8edf2'; X.lineWidth = 9 * s; X.beginPath(); X.moveTo(hx, hy); X.lineTo(hx + Math.cos(a2 - .5) * 84 * s, hy + Math.sin(a2 - .5) * 84 * s); X.stroke();
  X.strokeStyle = '#e2b84a'; X.lineWidth = 7 * s; X.beginPath(); X.moveTo(hx - Math.sin(a2 - .5) * 14 * s, hy + Math.cos(a2 - .5) * 14 * s); X.lineTo(hx + Math.sin(a2 - .5) * 14 * s, hy - Math.cos(a2 - .5) * 14 * s); X.stroke();
  /* helmet */
  X.fillStyle = '#c08f62'; X.fillRect(x - 12 * s, y - 212 * s, 24 * s, 20 * s);
  X.fillStyle = '#b08a3a'; X.beginPath(); X.arc(x, y - 236 * s, 32 * s, Math.PI, 0); X.lineTo(x + 32 * s, y - 206 * s); X.lineTo(x - 32 * s, y - 206 * s); X.closePath(); X.fill();
  X.fillStyle = '#8a6a2a'; X.beginPath(); X.ellipse(x, y - 236 * s, 46 * s, 9 * s, 0, 0, TAU); X.fill();
  X.fillStyle = '#3a2a1a'; for (let i = -2; i <= 2; i++) for (let j = 0; j < 3; j++) { X.beginPath(); X.arc(x + i * 10 * s, y - 226 * s + j * 8 * s, 2.6 * s, 0, TAU); X.fill(); }
  X.fillStyle = '#b9342a'; X.beginPath(); X.moveTo(x - 30 * s, y - 262 * s); X.quadraticCurveTo(x, y - 318 * s, x + 30 * s, y - 262 * s); X.quadraticCurveTo(x, y - 280 * s, x - 30 * s, y - 262 * s); X.fill();
  /* shield */
  X.fillStyle = '#9e2a22'; rr(X, x - 92 * s, y - 196 * s, 70 * s, 132 * s, 14 * s); X.fill(); X.strokeStyle = '#e2b84a'; X.lineWidth = 5 * s; rr(X, x - 86 * s, y - 190 * s, 58 * s, 120 * s, 10 * s); X.stroke();
  X.fillStyle = '#e2b84a'; X.beginPath(); X.arc(x - 57 * s, y - 130 * s, 12 * s, 0, TAU); X.fill();
}
function senator(X, x, y, s, seed, raise, a){
  X.globalAlpha = a;
  const skin = ['#d9a77c', '#c08f62', '#e6bd96', '#a87550'][Math.floor(rnd(seed) * 4)];
  if (raise > 0) { X.strokeStyle = skin; X.lineWidth = 9 * s; X.lineCap = 'round'; X.beginPath(); X.moveTo(x + 16 * s, y - 50 * s); X.lineTo(x + 26 * s, y - 50 * s - raise * 46 * s); X.stroke(); }
  X.fillStyle = '#fbf6ea'; X.beginPath(); X.moveTo(x - 26 * s, y); X.quadraticCurveTo(x - 30 * s, y - 62 * s, x, y - 66 * s); X.quadraticCurveTo(x + 30 * s, y - 62 * s, x + 26 * s, y); X.closePath(); X.fill();
  X.strokeStyle = '#7a2f6b'; X.lineWidth = 6 * s; X.beginPath(); X.moveTo(x - 12 * s, y - 62 * s); X.quadraticCurveTo(x + 6 * s, y - 34 * s, x + 16 * s, y - 2 * s); X.stroke();
  X.fillStyle = skin; X.beginPath(); X.arc(x, y - 78 * s, 13 * s, 0, TAU); X.fill();
  X.fillStyle = ['#e8e4dc', '#5b3b22', '#2a1f17', '#b9b2a6'][Math.floor(rnd(seed + 7) * 4)]; X.beginPath(); X.arc(x, y - 81 * s, 13 * s, Math.PI * 1.02, Math.PI * 1.98); X.fill();
  X.globalAlpha = 1;
}
function raider(X, x, y, s, seed, col){
  X.fillStyle = col; X.strokeStyle = col; X.lineCap = 'round';
  X.beginPath(); X.arc(x, y - 96 * s, 15 * s, 0, TAU); X.fill();
  X.beginPath(); X.moveTo(x - 30 * s, y); X.quadraticCurveTo(x - 34 * s, y - 78 * s, x, y - 82 * s); X.quadraticCurveTo(x + 34 * s, y - 78 * s, x + 30 * s, y); X.closePath(); X.fill();
  X.lineWidth = 5 * s; const lean = (rnd(seed) - .5) * 26 * s; X.beginPath(); X.moveTo(x + 30 * s, y - 20 * s); X.lineTo(x + 30 * s + lean, y - 210 * s); X.stroke();
  X.beginPath(); X.moveTo(x + 30 * s + lean, y - 232 * s); X.lineTo(x + 23 * s + lean, y - 204 * s); X.lineTo(x + 37 * s + lean, y - 204 * s); X.closePath(); X.fill();
  X.beginPath(); X.arc(x - 22 * s, y - 44 * s, 24 * s, 0, TAU); X.fill();
  for (let i = 0; i < 5; i++) { X.beginPath(); X.moveTo(x - 10 * s + i * 5 * s, y - 108 * s); X.lineTo(x - 14 * s + i * 7 * s, y - 122 * s - rnd(seed + i) * 8 * s); X.lineWidth = 4 * s; X.stroke(); }
}
function flame(X, x, y, s, t, seed){
  const f = .8 + .2 * Math.sin(t * 13 + seed * 5) + .1 * Math.sin(t * 29 + seed);
  glow(X, x, y - 14 * s, 150 * s * f, 'rgba(255,190,90,.55)', 'rgba(255,190,90,0)');
  X.fillStyle = '#ff9a3a'; X.beginPath(); X.moveTo(x - 12 * s, y); X.quadraticCurveTo(x - 16 * s, y - 24 * s * f, x + Math.sin(t * 9 + seed) * 5 * s, y - 50 * s * f); X.quadraticCurveTo(x + 16 * s, y - 22 * s * f, x + 12 * s, y); X.closePath(); X.fill();
  X.fillStyle = '#ffe08a'; X.beginPath(); X.moveTo(x - 6 * s, y); X.quadraticCurveTo(x - 8 * s, y - 14 * s * f, x, y - 28 * s * f); X.quadraticCurveTo(x + 8 * s, y - 12 * s * f, x + 6 * s, y); X.closePath(); X.fill();
}

/* ---------- the scenes ---------- */
const SCENES = {
  /* dawn over Rome: the sun climbs behind the Capitol, the legion marches, the eagle is raised */
  opening: { D: 6.6, at: 2.7, draw(X, t){
    const d = ease(seg(t, 0, 4.2));
    sky(X, [mix('#e58f6c', '#6fb1e0', d), mix('#f6b98a', '#bfe0f2', d), mix('#ffd9a0', '#fff3d6', d)]);
    sun(X, 800, lerp(640, 300, out(seg(t, 0, 4.4))), 96, t, '#fff6cf', .1 + d * .16);
    for (let i = 0; i < 5; i++) cloud(X, ((i * 430 + t * 14) % 2200) - 300, 110 + rnd(i) * 150, .8 + rnd(i + 2) * .7, .5 + d * .35);
    hills(X, 520, 60, 1.3, mix('#b58aa0', '#b9c9d8', d)); hills(X, 560, 46, 4.1, mix('#9a6f7a', '#a9bf9a', d));
    const wall = mix('#8a5a52', '#f6ead0', d), shade = mix('#6f4442', '#dcc7a0', d), roof = mix('#6a2f2c', '#b5523a', d), hole = mix('#4f2d2c', '#8a6a52', d);
    arches(X, -200, 520, 590, 96, 64, shade, mix('#e58f6c', '#cfe3ee', d)); X.fillStyle = wall; X.fillRect(-200, 486, 720, 12);
    colosseum(X, 1180, 600, 1, wall, shade, hole);
    temple(X, 560, 596, .62, wall, shade, roof, 5); temple(X, 1450, 600, .7, wall, shade, roof, 5);
    X.fillStyle = mix('#7a4d47', '#c9b48c', d); X.beginPath(); X.moveTo(560, 610); X.quadraticCurveTo(800, 500, 1040, 610); X.closePath(); X.fill();
    temple(X, 800, 556, 1.02, wall, shade, roof, 6);
    for (let i = 0; i < 9; i++) { const bx = 80 + i * 190 + rnd(i) * 60, bh = 40 + rnd(i + 4) * 50; X.fillStyle = i % 2 ? wall : shade; X.fillRect(bx, 620 - bh, 90, bh); X.fillStyle = roof; X.beginPath(); X.moveTo(bx - 6, 620 - bh); X.lineTo(bx + 45, 604 - bh); X.lineTo(bx + 96, 620 - bh); X.closePath(); X.fill(); }
    cypress(X, 420, 640, .7); cypress(X, 1010, 644, .6); pine(X, 280, 650, .8); pine(X, 1330, 650, .9);
    X.fillStyle = lin(X, 0, 620, 0, 900, [mix('#7a5a48', '#c9b07a', d), mix('#5f4336', '#a98f5c', d)]); X.fillRect(-400, 620, 2400, 280);
    for (let i = 0; i < 16; i++) soldier(X, ((i * 132 + t * 150) % 2112) - 250, 742 + (i % 2) * 8, 1.15, t * 7 + i * 1.7);
    const up = back(seg(t, 1.1, 2.5)); standard(X, 800, lerp(940, 96, up), 1.25, seg(t, 2.2, 3.2), t * 4);
    for (let i = 0; i < 5; i++) { const bx = 300 + i * 190 + t * 46, by = 190 + Math.sin(t * 1.2 + i) * 22 + i * 14; X.strokeStyle = 'rgba(60,40,30,.7)'; X.lineWidth = 3; X.beginPath(); X.moveTo(bx - 14, by - Math.sin(t * 9 + i) * 7); X.quadraticCurveTo(bx, by + 5, bx + 14, by - Math.sin(t * 9 + i) * 7); X.stroke(); }
  } },

  /* the Via Appia: a courier at full gallop, milestones flying past */
  via: { D: 6.2, at: 2.5, draw(X, t){
    const sp = t * 560;
    sky(X, ['#6db4e6', '#bfe2f4', '#fdf2d2']); sun(X, 1040, 150, 70, t, '#fff6cf', .14);
    for (let i = 0; i < 5; i++) cloud(X, ((i * 470 - t * 22) % 2300 + 2300) % 2300 - 300, 90 + rnd(i) * 130, .8 + rnd(i + 2) * .8, .85);
    hills(X, 380, 70, 2.2, '#a8bfd6', sp * .04); hills(X, 420, 50, 5.2, '#9fbf8a', sp * .1);
    for (let i = 0; i < 3; i++) { const ax = 1900 - ((sp * .16 + i * 900) % 2700); arches(X, ax, ax + 520, 440, 110, 74, '#e6d3ad', '#bcd9c0'); X.fillStyle = '#f3e3c2'; X.fillRect(ax - 8, 322, 536, 12); }
    hills(X, 452, 22, 1.1, '#86ab62', sp * .3);
    for (let i = 0; i < 6; i++) { const px = 1900 - ((sp * .45 + i * 420) % 2500); (i % 3 ? pine : cypress)(X, px, 462, .9 + rnd(i) * .3, true); }
    X.fillStyle = lin(X, 0, 452, 0, 900, ['#cbb98f', '#b29d70']); X.fillRect(-400, 452, 2400, 448);
    X.fillStyle = '#d9c9a2'; X.fillRect(-400, 452, 2400, 70);
    for (let i = 0; i < 26; i++) { const px = 1800 - ((sp + i * 96) % 2400); X.strokeStyle = 'rgba(120,100,70,.35)'; X.lineWidth = 3; X.beginPath(); X.moveTo(px, 456); X.lineTo(px - 14, 520); X.stroke(); }
    const NUM = ['X', 'XX', 'XXX', 'XL', 'L', 'LX']; for (let i = 0; i < 6; i++) { const cyc = sp + i * 760, px = 1900 - (cyc % 4560); if (px < -100 || px > 1700) continue; X.fillStyle = '#efe6d4'; rr(X, px - 20, 388, 40, 70, 8); X.fill(); X.strokeStyle = '#8a7a66'; X.lineWidth = 3; X.stroke(); X.fillStyle = '#9e2a22'; X.font = "900 20px 'Cinzel',serif"; X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillText(NUM[i], px, 416); }
    const ph = t * 15, rx = lerp(520, 800, out(seg(t, 0, 1.6)));
    for (let i = 0; i < 9; i++) { const age = (t * 2.4 + i / 9) % 1; X.fillStyle = 'rgba(214,196,150,' + (.5 * (1 - age)) + ')'; X.beginPath(); X.arc(rx - 110 - age * 260, 468 - age * 46 + rnd(i) * 16, 14 + age * 42, 0, TAU); X.fill(); }
    X.fillStyle = 'rgba(70,50,20,.22)'; X.beginPath(); X.ellipse(rx, 488, 120, 14, 0, 0, TAU); X.fill();
    horse(X, rx, 484, 1.25, ph, '#7a4a2c', '#2a1f17'); rider(X, rx - 8, 484, 1.25, ph, '#b9342a');
    for (let i = 0; i < 12; i++) { const ly = 120 + rnd(i) * 300, lx = 1900 - ((sp * 2.4 + i * 311) % 2600); X.strokeStyle = 'rgba(255,255,255,.35)'; X.lineWidth = 3; X.beginPath(); X.moveTo(lx, ly); X.lineTo(lx + 120 + rnd(i + 3) * 120, ly); X.stroke(); }
    for (let i = 0; i < 4; i++) { const px = 2000 - ((sp * 1.7 + i * 800) % 3200); cypress(X, px, 760, 2.1); }
  } },

  /* the gate goes up and Spiculus walks out onto the sand */
  arena: { D: 6.4, at: 2.9, draw(X, t){
    const z = 1 + ease(seg(t, 0, 6)) * .07; X.save(); X.translate(800, 380); X.scale(z, z); X.translate(-800, -380);
    sky(X, ['#5aa9e2', '#bfe2f4', '#f8ecd0']);
    for (let i = 0; i < 12; i++) { X.fillStyle = i % 2 ? '#b9342a' : '#f6ead0'; X.beginPath(); X.moveTo(i * 150 - 100, 60); X.quadraticCurveTo(i * 150 - 25, 120 + Math.sin(t * 2 + i) * 6, i * 150 + 50, 60); X.closePath(); X.fill(); }
    X.fillStyle = '#ead9b4'; X.fillRect(-400, 78, 2400, 260);
    for (let row = 0; row < 3; row++) { const y = 112 + row * 34; X.fillStyle = row % 2 ? '#dcc7a0' : '#e6d3ad'; X.fillRect(-400, y - 14, 2400, 34);
      for (let i = 0; i < 74; i++) { const cx = i * 23 + (row % 2) * 11 - 40, jump = Math.max(0, Math.sin(t * 7 + i * .9 + row)) * (4 + 7 * seg(t, 1.8, 3)); X.fillStyle = ['#c9a37a', '#a87d57', '#e0c39b', '#8a5a3a'][(i + row) % 4]; X.beginPath(); X.arc(cx, y - jump, 8, 0, TAU); X.fill(); X.fillStyle = ['#b9342a', '#f6ead0', '#2d5885', '#b48526', '#56732f'][(i * 3 + row) % 5]; X.fillRect(cx - 8, y + 7 - jump, 16, 12); } }
    arches(X, -400, 2000, 338, 130, 120, '#e2cfa6', '#7a5a3f'); X.fillStyle = '#f3e3c2'; X.fillRect(-400, 200, 2400, 12);
    X.fillStyle = lin(X, 0, 338, 0, 900, ['#f3dfa8', '#d7b46c']); X.fillRect(-400, 338, 2400, 562);
    for (let i = 0; i < 40; i++) { X.fillStyle = 'rgba(160,120,60,.25)'; X.beginPath(); X.ellipse(rnd(i) * 1600, 360 + rnd(i + 5) * 500, 30 + rnd(i + 2) * 40, 4, 0, 0, TAU); X.fill(); }
    const w = out(seg(t, 1.0, 3.0)), gs = lerp(.55, 1.12, w), gy = lerp(372, 520, w);
    gladiator(X, 800, gy, gs, back(seg(t, 3.0, 3.7)), t < 3 ? t * 6 : 0);
    X.restore();
    /* the tunnel mouth and the gate */
    X.fillStyle = lin(X, 0, 0, 0, 900, ['#3a2a20', '#241812']); X.beginPath(); X.rect(-400, -10, 2400, 920); X.moveTo(470, 910); X.lineTo(470, 300); X.arc(800, 300, 330, Math.PI, 0); X.lineTo(1130, 910); X.closePath(); X.fill('evenodd');
    X.strokeStyle = 'rgba(255,225,160,.35)'; X.lineWidth = 10; X.beginPath(); X.moveTo(470, 910); X.lineTo(470, 300); X.arc(800, 300, 330, Math.PI, 0); X.lineTo(1130, 910); X.stroke();
    for (let i = 0; i < 9; i++) { X.strokeStyle = 'rgba(0,0,0,.25)'; X.lineWidth = 3; const a = Math.PI + i * Math.PI / 8; X.beginPath(); X.moveTo(800 + Math.cos(a) * 330, 300 + Math.sin(a) * 330); X.lineTo(800 + Math.cos(a) * 420, 300 + Math.sin(a) * 420); X.stroke(); }
    const up = ease(seg(t, .35, 2.1)) * 960; X.save(); X.beginPath(); X.moveTo(470, 910); X.lineTo(470, 300); X.arc(800, 300, 330, Math.PI, 0); X.lineTo(1130, 910); X.closePath(); X.clip();
    X.strokeStyle = '#2a1c14'; X.lineWidth = 16; for (let i = 0; i < 9; i++) { const bx = 500 + i * 75; X.beginPath(); X.moveTo(bx, -40 - up); X.lineTo(bx, 880 - up); X.stroke(); X.fillStyle = '#2a1c14'; X.beginPath(); X.moveTo(bx - 10, 880 - up); X.lineTo(bx, 912 - up); X.lineTo(bx + 10, 880 - up); X.closePath(); X.fill(); }
    X.lineWidth = 12; for (let j = 0; j < 7; j++) { const by = 60 + j * 130 - up; X.beginPath(); X.moveTo(470, by); X.lineTo(1130, by); X.stroke(); }
    X.restore();
    for (let i = 0; i < 40; i++) { const a = .2 + .5 * Math.abs(Math.sin(t * 1.4 + i)); X.fillStyle = 'rgba(255,240,200,' + a * .6 + ')'; X.beginPath(); X.arc(500 + rnd(i) * 600 + Math.sin(t + i) * 12, ((rnd(i + 3) * 900 - t * 26) % 900 + 900) % 900, 2 + rnd(i + 8) * 3, 0, TAU); X.fill(); }
  } },

  /* the Senate takes its seats and the banner drops */
  senate: { D: 6.2, at: 2.6, draw(X, t){
    X.fillStyle = lin(X, 0, 0, 0, 900, ['#fbf4e4', '#efe2c8']); X.fillRect(-400, 0, 2400, 900);
    for (let i = 0; i < 9; i++) { const px = i * 220 - 80; X.fillStyle = '#e9dcc0'; X.fillRect(px, 0, 60, 520); X.fillStyle = 'rgba(255,255,255,.5)'; X.fillRect(px + 8, 0, 10, 520); X.fillStyle = '#dccba6'; X.fillRect(px - 10, 0, 80, 26); }
    X.fillStyle = '#b9342a'; X.fillRect(-400, 26, 2400, 10); X.fillStyle = '#e2b84a'; X.fillRect(-400, 36, 2400, 4);
    X.save(); X.translate(800, -40); X.rotate(Math.sin(t * .4) * .03); X.fillStyle = 'rgba(255,246,214,.42)'; X.beginPath(); X.moveTo(-90, 0); X.lineTo(90, 0); X.lineTo(560, 1000); X.lineTo(-560, 1000); X.closePath(); X.fill(); X.restore();
    const drop = back(seg(t, 1.3, 2.3)); X.fillStyle = '#9e2a22'; X.beginPath(); X.moveTo(690, 40); X.lineTo(910, 40); X.lineTo(910, 40 + 150 * drop); X.lineTo(800, 40 + 186 * drop + Math.sin(t * 3) * 3); X.lineTo(690, 40 + 150 * drop); X.closePath(); X.fill();
    X.strokeStyle = '#e2b84a'; X.lineWidth = 5; X.beginPath(); X.moveTo(702, 44); X.lineTo(702, 34 + 150 * drop); X.lineTo(800, 30 + 180 * drop); X.lineTo(898, 34 + 150 * drop); X.lineTo(898, 44); X.stroke();
    if (drop > .5) { X.fillStyle = '#f0cf6a'; X.font = "900 46px 'Cinzel','Times New Roman',serif"; X.textAlign = 'center'; X.textBaseline = 'middle'; X.globalAlpha = seg(drop, .5, 1); X.fillText('SPQR', 800, 40 + 84 * drop); X.globalAlpha = 1; }
    let n = 0;
    for (let row = 3; row >= 0; row--) { const y = 300 + (3 - row) * 62, R = 300 + row * 150, count = 7 + row * 4;
      X.fillStyle = row % 2 ? '#e1d2b2' : '#eadcbf'; X.beginPath(); X.ellipse(800, y + 250, R + 110, 262, 0, Math.PI, 0); X.lineTo(800 + R + 110, 900); X.lineTo(800 - R - 110, 900); X.closePath(); X.fill();
      X.strokeStyle = 'rgba(120,96,60,.25)'; X.lineWidth = 3; X.beginPath(); X.ellipse(800, y + 250, R + 110, 262, 0, Math.PI, 0); X.stroke();
      for (let i = 0; i < count; i++, n++) { const a = Math.PI * (.12 + .76 * (i + .5) / count), sx = 800 - Math.cos(a) * (R + 60), sy = y + 250 - Math.sin(a) * 250 + 14, k = seg(t, .3 + n * .035, .7 + n * .035);
        if (k <= 0) continue; const raise = rnd(n + 20) > .45 ? ease(seg(t, 3.3 + rnd(n) * .8, 3.8 + rnd(n) * .8)) : 0; senator(X, sx, sy + (1 - out(k)) * 24, .92 + (3 - row) * .1, n, raise, k); } }
    for (const d of [-1, 1]) { const cx = 800 + d * lerp(640, 690, ease(seg(t, 0, 6))); X.fillStyle = lin(X, cx - 70, 0, cx + 70, 0, ['#e6d7b8', '#fffaf0', '#d9c7a2']); X.fillRect(cx - 62, 90, 124, 820); for (let i = -2; i <= 2; i++) { X.fillStyle = 'rgba(120,96,60,.18)'; X.fillRect(cx + i * 22 - 3, 90, 6, 820); } X.fillStyle = '#f6ecd6'; rr(X, cx - 84, 40, 168, 54, 10); X.fill(); X.fillStyle = '#e2b84a'; X.fillRect(cx - 84, 84, 168, 8); }
  } },

  /* dusk at the Wall: torches are lit, and spears rise out of the heather */
  wall: { D: 6.4, at: 2.9, draw(X, t){
    sky(X, ['#3f5a96', '#b67aa0', '#f6b77a', '#ffe0a8']);
    for (let i = 0; i < 40; i++) { X.fillStyle = 'rgba(255,255,255,' + (.35 + .35 * Math.sin(t * 3 + i * 2)) * (1 - rnd(i + 2) * .6) + ')'; X.beginPath(); X.arc(rnd(i) * 1600, rnd(i + 7) * 220, 1.5 + rnd(i + 3) * 1.6, 0, TAU); X.fill(); }
    glow(X, 800, 430, 420, 'rgba(255,224,160,.7)', 'rgba(255,224,160,0)');
    for (let i = 0; i < 4; i++) cloud(X, ((i * 520 + t * 16) % 2300) - 300, 130 + rnd(i) * 110, 1 + rnd(i + 2) * .6, .22);
    hills(X, 400, 60, 3.3, '#6f5f8f'); hills(X, 430, 44, 6.1, '#56557a');
    const f = x => 392 - 44 * Math.sin(x / 380 + 1.2) - 18 * Math.sin(x / 150);
    X.fillStyle = '#4c5a4a'; X.beginPath(); X.moveTo(-400, 900); for (let x = -400; x <= 2000; x += 20) X.lineTo(x, f(x) + 46); X.lineTo(2000, 900); X.closePath(); X.fill();
    for (let x = -60; x < 1700; x += 24) { const y = f(x); X.fillStyle = (x / 24) % 2 ? '#d9c9a8' : '#cdbb96'; X.fillRect(x, y, 25, 52); if ((x / 24) % 2 === 0) X.fillRect(x, y - 12, 14, 13); X.fillStyle = 'rgba(40,30,60,.22)'; X.fillRect(x, y + 30, 25, 22); }
    [380, 800, 1220].forEach((x, i) => { const y = f(x); X.fillStyle = '#d9c9a8'; X.fillRect(x - 44, y - 62, 88, 118); X.fillStyle = 'rgba(40,30,60,.2)'; X.fillRect(x + 8, y - 62, 36, 118); X.fillStyle = '#cdbb96'; for (let k = 0; k < 4; k++) X.fillRect(x - 44 + k * 25, y - 78, 14, 17); X.fillStyle = '#3a2a2a'; rr(X, x - 9, y - 30, 18, 30, 8); X.fill();
      const lit = seg(t, .7 + i * .55, 1.0 + i * .55); if (lit > 0) flame(X, x, y - 80, (i === 1 ? 1.5 + seg(t, 3, 4) * .8 : 1.1) * lit, t, i); });
    for (let i = 0; i < 3; i++) { X.fillStyle = 'rgba(255,255,255,.14)'; X.beginPath(); X.ellipse(((i * 700 + t * 60) % 2400) - 300, 470 + i * 26, 520, 26, 0, 0, TAU); X.fill(); }
    const rise = out(seg(t, 2.1, 3.6));
    for (let i = 0; i < 13; i++) { const x = 120 + i * 118 + rnd(i) * 40, s = 1.25 + rnd(i + 4) * .5; raider(X, x, 640 + (1 - rise) * 280 + Math.sin(t * 3 + i) * 5 + rnd(i + 1) * 30, s, i, i % 3 ? '#1f2440' : '#2a2f52'); }
    for (let i = 0; i < 4; i++) { const x = 260 + i * 370, y = 560 + (1 - rise) * 300; X.strokeStyle = '#1f2440'; X.lineWidth = 7; X.beginPath(); X.moveTo(x, y + 200); X.lineTo(x, y - 190); X.stroke(); X.fillStyle = '#2d5885'; X.beginPath(); X.moveTo(x, y - 186); for (let k = 0; k <= 8; k++) X.lineTo(x + k * 14, y - 186 + Math.sin(t * 5 + k * .7 + i) * 7); for (let k = 8; k >= 0; k--) X.lineTo(x + k * 14, y - 110 + Math.sin(t * 5 + k * .7 + i + 1) * 7); X.closePath(); X.fill(); }
    hills(X, 800, 30, 2.2, '#171a30');
  } },

  /* a level won */
  victory: { D: 3.8, at: 1.1, draw(X, t){
    sky(X, ['#6fb1e0', '#cfe8f6', '#fff3d6']); sun(X, 800, 250, 110, t * 3, '#fff6cf', .3);
    hills(X, 640, 40, 1.4, '#a9c98a'); hills(X, 690, 30, 3.3, '#8fb56e');
    [-1, 1].forEach(d => { for (let i = 0; i < 12; i++) { const k = back(seg(t, .25 + i * .05, .6 + i * .05)); if (k <= 0) continue; const a = Math.PI / 2 + d * (.35 + i * .2), lx = 800 + Math.cos(a) * 250, ly = 250 + Math.sin(a) * 215; X.save(); X.translate(lx, ly); X.rotate(a + d * 2.1); X.scale(k, k); X.fillStyle = i % 2 ? '#56732f' : '#7a9a48'; X.beginPath(); X.ellipse(0, 0, 40, 14, 0, 0, TAU); X.fill(); X.restore(); } });
    const k = back(seg(t, .15, .9)); X.save(); X.translate(800, 240); X.scale(k, k); eagle(X, 0, 0, 1.9, seg(t, .5, 1.3)); X.restore();
    petals(X, t, 70, ['#c2414b', '#e07b86', '#f0b4b9', '#e2b84a', '#fbf6ea']);
  } },

  /* a level lost: rain on a fallen standard */
  defeat: { D: 3.8, at: 1.1, draw(X, t){
    sky(X, ['#7f8ea8', '#aeb9c8', '#d9d6cf']);
    for (let i = 0; i < 5; i++) cloud(X, ((i * 430 + t * 40) % 2300) - 300, 90 + rnd(i) * 120, 1.4 + rnd(i + 2), .5);
    hills(X, 560, 50, 2.4, '#8f9a8a'); hills(X, 620, 34, 5.3, '#76826f');
    X.save(); X.translate(800, 600); X.rotate(lerp(-.05, .42, out(seg(t, .1, 1.4)))); X.translate(-800, -600); standard(X, 800, 120, 1.15, 0, t * 1.5, '#7a3a36'); X.restore();
    X.fillStyle = '#69745f'; X.fillRect(-400, 600, 2400, 300);
    X.strokeStyle = 'rgba(235,240,250,.55)'; X.lineWidth = 2.5; for (let i = 0; i < 150; i++) { const x = rnd(i) * 2000 - 200, y = ((rnd(i + 5) * 900 + t * (900 + rnd(i + 2) * 500)) % 950) - 40; X.beginPath(); X.moveTo(x, y); X.lineTo(x - 10, y + 34); X.stroke(); }
    for (let i = 0; i < 9; i++) { const a = (t * .9 + rnd(i)) % 1; X.strokeStyle = 'rgba(235,240,250,' + (.5 * (1 - a)) + ')'; X.lineWidth = 2; X.beginPath(); X.ellipse(500 + rnd(i + 3) * 600, 630 + rnd(i + 6) * 40, a * 44, a * 9, 0, 0, TAU); X.stroke(); }
  } },

  /* the Triumph: a four-horse chariot rolls through the arch under falling petals */
  triumph: { D: 7.6, at: 4.2, draw(X, t, o){
    const col = o.colour || '#9e2a22';
    sky(X, ['#4f9fe0', '#bfe2f4', '#fff3d6']); sun(X, 800, 150, 80, t, '#fff6cf', .2);
    for (let i = 0; i < 5; i++) cloud(X, ((i * 430 + t * 14) % 2200) - 300, 80 + rnd(i) * 120, .8 + rnd(i + 2) * .7, .85);
    hills(X, 430, 40, 2.1, '#a9c98a');
    temple(X, 300, 470, .8, '#f6ead0', '#dcc7a0', '#b5523a', 5); temple(X, 1300, 470, .8, '#f6ead0', '#dcc7a0', '#b5523a', 5); colosseum(X, 60, 470, .7, '#f6ead0', '#dcc7a0', '#8a6a52');
    X.fillStyle = lin(X, 0, 470, 0, 900, ['#e6d6ae', '#cdb884']); X.fillRect(-400, 470, 2400, 430);
    /* the arch */
    X.fillStyle = '#fbf4e2'; X.fillRect(560, 120, 480, 356); X.fillStyle = '#e9dcc0'; X.fillRect(540, 96, 520, 34); X.fillRect(548, 196, 504, 14);
    X.fillStyle = lin(X, 0, 250, 0, 476, ['#9fd0ee', '#e9f4f6']); X.beginPath(); X.moveTo(700, 476); X.lineTo(700, 320); X.arc(800, 320, 100, Math.PI, 0); X.lineTo(900, 476); X.closePath(); X.fill();
    [600, 1000].forEach(x => { X.fillStyle = lin(X, x - 34, 0, x + 34, 0, ['#e6d7b8', '#fffaf0', '#d9c7a2']); X.fillRect(x - 30, 214, 60, 262); X.fillStyle = '#e2b84a'; X.fillRect(x - 36, 206, 72, 10); });
    X.fillStyle = '#9e2a22'; X.font = "900 46px 'Cinzel','Times New Roman',serif"; X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillText('LXX', 800, 164);
    [640, 960].forEach((x, i) => { X.fillStyle = col; X.beginPath(); X.moveTo(x - 26, 226); X.lineTo(x + 26, 226); X.lineTo(x + 26 + Math.sin(t * 3 + i) * 4, 370); X.lineTo(x + Math.sin(t * 3 + i) * 6, 396); X.lineTo(x - 26 + Math.sin(t * 3 + i) * 4, 370); X.closePath(); X.fill(); });
    X.save(); X.translate(800, 96); eagle(X, 0, -44, .9, 1); X.restore();
    /* far crowd */
    for (let i = 0; i < 80; i++) { const cx = i * 21 - 30; if (cx > 690 && cx < 910) continue; const j = Math.max(0, Math.sin(t * 8 + i * 1.3)) * 8; X.fillStyle = ['#c9a37a', '#a87d57', '#e0c39b', '#8a5a3a'][i % 4]; X.beginPath(); X.arc(cx, 452 - j, 9, 0, TAU); X.fill(); X.fillStyle = ['#b9342a', '#f6ead0', '#2d5885', '#b48526', '#56732f'][(i * 3) % 5]; rr(X, cx - 10, 461 - j, 20, 26, 6); X.fill(); }
    /* the quadriga */
    const cx = lerp(-200, 950, out(seg(t, .4, 3.6))) + seg(t, 3.6, 7.2) * 40, ph = t * (seg(t, 3.2, 3.8) < 1 ? 13 : 5), gy = 566;
    X.fillStyle = 'rgba(70,50,20,.22)'; X.beginPath(); X.ellipse(cx - 40, gy + 6, 330, 18, 0, 0, TAU); X.fill();
    for (let i = 3; i >= 0; i--) horse(X, cx + 60 + i * 26, gy - i * 7, 1.15, ph + i * .8, i % 2 ? '#f3efe6' : '#e2dccd', '#b9b2a6');
    X.strokeStyle = '#6b4a2f'; X.lineWidth = 6; X.beginPath(); X.moveTo(cx - 150, gy - 86); X.lineTo(cx + 40, gy - 92); X.stroke();
    const chx = cx - 230;
    X.fillStyle = '#d9a77c'; X.beginPath(); X.arc(chx + 10, gy - 252, 19, 0, TAU); X.fill();
    X.strokeStyle = '#56732f'; X.lineWidth = 7; X.beginPath(); X.arc(chx + 10, gy - 256, 20, Math.PI * .95, Math.PI * 2.05); X.stroke();
    X.fillStyle = '#fbf6ea'; rr(X, chx - 14, gy - 234, 50, 120, 14); X.fill();
    X.fillStyle = col; X.beginPath(); X.moveTo(chx - 12, gy - 232); X.bezierCurveTo(chx - 70, gy - 220 + Math.sin(t * 6) * 8, chx - 100, gy - 170 + Math.cos(t * 6) * 10, chx - 140, gy - 160 + Math.sin(t * 6 + 1) * 14); X.bezierCurveTo(chx - 100, gy - 130, chx - 50, gy - 126, chx - 6, gy - 130); X.closePath(); X.fill();
    X.strokeStyle = '#d9a77c'; X.lineWidth = 11; X.lineCap = 'round'; X.beginPath(); X.moveTo(chx + 30, gy - 214); X.lineTo(chx + 62, gy - 262 - Math.sin(t * 5) * 8); X.stroke();
    X.strokeStyle = '#56732f'; X.lineWidth = 6; X.beginPath(); X.arc(chx + 66, gy - 282 - Math.sin(t * 5) * 8, 17, 0, TAU); X.stroke();
    X.fillStyle = '#e2b84a'; X.beginPath(); X.moveTo(chx - 60, gy - 60); X.quadraticCurveTo(chx - 70, gy - 170, chx - 10, gy - 176); X.lineTo(chx + 86, gy - 150); X.lineTo(chx + 96, gy - 60); X.closePath(); X.fill();
    X.strokeStyle = '#a97a1c'; X.lineWidth = 5; X.stroke(); X.fillStyle = col; X.beginPath(); X.arc(chx + 22, gy - 112, 22, 0, TAU); X.fill();
    X.save(); X.translate(chx + 10, gy - 44); X.rotate(cx / 50); X.strokeStyle = '#6b4a2f'; X.lineWidth = 10; X.beginPath(); X.arc(0, 0, 46, 0, TAU); X.stroke(); X.lineWidth = 5; for (let i = 0; i < 8; i++) { X.rotate(TAU / 8); X.beginPath(); X.moveTo(0, 0); X.lineTo(46, 0); X.stroke(); } X.fillStyle = '#e2b84a'; X.beginPath(); X.arc(0, 0, 9, 0, TAU); X.fill(); X.restore();
    for (let i = 0; i < 10; i++) { const age = (t * 2 + i / 10) % 1; X.fillStyle = 'rgba(214,196,150,' + (.4 * (1 - age)) + ')'; X.beginPath(); X.arc(chx - 90 - age * 200, gy - 6 - age * 30, 14 + age * 36, 0, TAU); X.fill(); }
    petals(X, t, 110, ['#c2414b', '#e07b86', '#f0b4b9', '#e2b84a', '#fbf6ea']);
  } }
};

function paint(X, cv, w, h, dpr, sc, t, o){
  const s = Math.max(w / 1600, h / 900) * dpr;
  X.setTransform(1, 0, 0, 1, 0, 0); X.clearRect(0, 0, cv.width, cv.height);
  X.setTransform(s, 0, 0, s, (w * dpr - 1600 * s) / 2, (h * dpr - 900 * s) / 2); X.globalAlpha = 1;
  sc.draw(X, t, o || {});
  const fade = 1 - seg(t, 0, .45); if (fade > 0) { X.setTransform(1, 0, 0, 1, 0, 0); X.fillStyle = 'rgba(247,242,232,' + fade + ')'; X.fillRect(0, 0, cv.width, cv.height); }
}
function play(kind, host, o){
  const sc = SCENES[kind]; if (!sc) return null;
  const cv = document.createElement('canvas'); cv.className = 'cinecv'; cv.setAttribute('aria-hidden', 'true'); host.insertBefore(cv, host.firstChild);
  const X = cv.getContext('2d'); let w = 0, h = 0, dpr = 1, raf = 0, dead = false;
  const size = () => { dpr = Math.min(window.devicePixelRatio || 1, 2); w = host.clientWidth; h = host.clientHeight; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); };
  size(); window.addEventListener('resize', size);
  const t0 = performance.now();
  const loop = now => { if (dead) return; paint(X, cv, w, h, dpr, sc, Math.max(0, (now - t0) / 1000), o); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return { D: sc.D, at: sc.at, stop(){ dead = true; cancelAnimationFrame(raf); window.removeEventListener('resize', size); } };
}
/* one still frame, for checking a scene at a given moment */
function frame(kind, cv, t, o){ const X = cv.getContext('2d'); paint(X, cv, cv.width, cv.height, 1, SCENES[kind], t, o); }
window.LXXScenes = { play, frame, kinds: Object.keys(SCENES), length: k => SCENES[k].D };
})();
