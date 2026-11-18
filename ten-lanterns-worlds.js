/* Ten Lanterns: the ten worlds, full size and alive.
   When the dial sends you into a lantern, its world fills the screen behind the round and keeps moving:
   a chariot race, a submarine running deep, an airliner over the clouds, a train across a viaduct, a galleon
   in a storm, firelight in a cave, a balloon over fields, a manor at midnight, a circus at dusk and a city of
   searchlights. Each scene is drawn in a 1600 x 900 box. The busy parts sit along the bottom and the sides,
   where the question card does not cover them. Only transform and opacity move, so a television keeps up.
   With reduced motion, everything holds still and the passing sparks, bubbles and rain are left out.
   Invented places only: no real cities or landmarks, except Ancient Rome. */
(function(){
'use strict';

const W = 1600, H = 900;
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f = n => (Math.round(n * 10) / 10).toString();
/* an animation as a style attribute: name, seconds, delay, easing, extra css */
const an = (name, d, del, ease, more) => ' style="animation:tlw-' + name + ' ' + d + 's ' + (ease || 'ease-in-out') + ' ' + f(del || 0) + 's infinite' + (more ? ';' + more : '') + '"';
/* a layer that slides left for ever: the tile is drawn three times so the loop never shows a seam */
const scroll = (tile, secs, y) => '<g' + (y ? ' transform="translate(0 ' + y + ')"' : '') + '><g' + an('scroll', secs, 0, 'linear') + '>'
  + '<g transform="translate(-1600 0)">' + tile + '</g>' + tile + '<g transform="translate(1600 0)">' + tile + '</g></g></g>';
const grad = (id, stops, x2, y2) => '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + (x2 || 0) + '" y2="' + (y2 === undefined ? 1 : y2) + '">'
  + stops.map(([o, c, a]) => '<stop offset="' + o + '" stop-color="' + c + '"' + (a !== undefined ? ' stop-opacity="' + a + '"' : '') + '/>').join('') + '</linearGradient>';
const radial = (id, stops) => '<radialGradient id="' + id + '">' + stops.map(([o, c, a]) => '<stop offset="' + o + '" stop-color="' + c + '" stop-opacity="' + (a === undefined ? 1 : a) + '"/>').join('') + '</radialGradient>';
const rect = (fill, y, h) => '<rect x="0" y="' + (y || 0) + '" width="' + W + '" height="' + (h || H) + '" fill="' + fill + '"/>';
function stars(seed, n, ymax, colour){ const r = rng(seed); let s = '';
  for (let i = 0; i < n; i++) { const x = r() * W, y = r() * ymax, z = .8 + r() * 2.2, tw = r() < .6;
    s += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(z) + '" fill="' + (colour || '#fff') + '" opacity="' + f(.35 + r() * .55) + '"' + (tw ? an('tw', 2 + r() * 4, -r() * 6) : '') + '/>'; }
  return s; }
/* small things that drift up and fade: sparks, bubbles, smoke, embers */
function risers(seed, n, x, y, spread, o){ const r = rng(seed); let s = '';
  for (let i = 0; i < n; i++) { const d = o.dur[0] + r() * (o.dur[1] - o.dur[0]);
    s += '<circle class="fx" cx="' + f(x + (r() - .5) * spread) + '" cy="' + f(y) + '" r="' + f(o.r[0] + r() * (o.r[1] - o.r[0])) + '" fill="' + (o.fill || 'none') + '"' + (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw || 2) + '"' : '')
      + ' style="--dx:' + f((o.dx || 0) + (r() - .5) * (o.wob || 40)) + 'px;--dy:' + f(-(o.rise || 300) * (.7 + r() * .5)) + 'px;--sc:' + (o.sc || 1.6) + ';--o:' + (o.op || .85) + ';animation:tlw-rise ' + f(d) + 's ' + (o.ease || 'ease-out') + ' ' + f(-r() * d) + 's infinite"/>'; }
  return s; }
/* a bird or bat: two wings that beat */
const flier = (x, y, s, colour, beat, bat) => '<g transform="translate(' + f(x) + ' ' + f(y) + ') scale(' + s + ')"><g' + an('flap', beat, -((x * 7 + y * 3) % 100) / 100 * beat) + '>'
  + (bat ? '<path d="M0 0 C-6 -8 -14 -10 -26 -6 C-20 -2 -18 2 -20 6 C-14 2 -8 4 0 4 C8 4 14 2 20 6 C18 2 20 -2 26 -6 C14 -10 6 -8 0 0Z" fill="' + colour + '"/>'
         : '<path d="M-22 -2 Q-10 -12 0 0 Q10 -12 22 -2" fill="none" stroke="' + colour + '" stroke-width="3.5" stroke-linecap="round"/>') + '</g></g>';
const range = (a, b, s) => { const out = []; for (let x = a; x <= b + 1e-6; x += s) out.push(x); return out; };

/* ===================================================================== the worlds */
const WORLDS = {};

/* ---- Ancient Rome: chariots thunder round the track under a hot sky ---- */
WORLDS.rome = () => {
  const defs = grad('w-rome-sky', [[0, '#f9c27a'], [.55, '#e9874a'], [1, '#c4512e']]) + radial('w-rome-sun', [[0, '#fff2c0', .95], [.35, '#ffd27a', .6], [1, '#ffb347', 0]])
    + grad('w-rome-sand', [[0, '#e8c48c'], [1, '#c99a62']]) + radial('w-rome-dust', [[0, '#f2d29b', .9], [1, '#f2d29b', 0]]);
  let s = rect('url(#w-rome-sky)');
  s += '<circle cx="1260" cy="170" r="230" fill="url(#w-rome-sun)"' + an('glow', 6, 0, 'ease-in-out', '--g:.6') + '/><circle cx="1260" cy="170" r="62" fill="#fff0c4"/>';
  s += '<g' + an('cross', 46, -12, 'linear', '--from:300px;--to:-1900px') + '>' + flier(1500, 120, 1, '#7a3a22', .7) + flier(1550, 150, .8, '#7a3a22', .6) + flier(1590, 110, .7, '#7a3a22', .65) + '</g>';
  s += '<path d="M0 360 Q200 300 420 340 T860 320 T1300 340 T1600 320 V420 H0Z" fill="#d9925a" opacity=".7"/>';
  // the arena wall: two tiers of arches, banners on top
  s += '<rect x="0" y="330" width="1600" height="330" fill="#e2bb84"/><rect x="0" y="322" width="1600" height="14" fill="#c99d68"/><rect x="0" y="476" width="1600" height="10" fill="#c99d68"/>';
  s += range(20, 1580, 80).map(x => '<path d="M' + (x + 8) + ' 470 V392 a32 32 0 0 1 64 0 V470Z" fill="#9a6a46"/>').join('');
  s += range(10, 1590, 100).map(x => '<path d="M' + (x + 12) + ' 660 V552 a38 38 0 0 1 76 0 V660Z" fill="#7c4f33"/>').join('');
  s += range(40, 1560, 200).map((x, k) => '<g transform="translate(' + x + ' 322)"><path d="M0 0 V-74" stroke="#6b4628" stroke-width="5"/><g' + an('wave', 1.6 + (k % 3) * .3, -k * .4, 'ease-in-out') + ' class="flag"><path d="M2 -72 L62 -60 L2 -46Z" fill="' + (k % 2 ? '#b8322c' : '#e9a23b') + '"/></g></g>').join('');
  // the track, its centre wall and turning posts
  s += '<rect x="0" y="650" width="1600" height="250" fill="url(#w-rome-sand)"/><path d="M0 700 H1600 M0 820 H1600" stroke="#d4a870" stroke-width="3" opacity=".6"/>';
  s += '<rect x="300" y="676" width="1000" height="22" rx="4" fill="#c99d68"/>' + [280, 1320].map(x => '<g transform="translate(' + x + ' 690)">' + [-24, 0, 24].map(d => '<path d="M' + (d - 9) + ' 0 L' + d + ' -58 L' + (d + 9) + ' 0Z" fill="#a8743f"/>').join('') + '</g>').join('');
  // two chariots, racing past in turn
  const chariot = (c1, c2) => '<g class="race-bob"' + an('bob', .32, 0, 'ease-in-out', '--b:-5px') + '>'
    + '<path d="M150 -50 C162 -58 180 -60 196 -58 L224 -60 C232 -70 240 -76 250 -74 L258 -66 L252 -62 L246 -63 C243 -55 240 -48 236 -45 L238 -30 L246 -12 L240 -10 L230 -28 L226 -38 C216 -36 202 -36 192 -38 L182 -24 L170 -10 L164 -12 L174 -26 L176 -38 C166 -36 156 -40 150 -50Z" fill="' + c1 + '"/>'
    + '<path d="M120 -46 C134 -54 150 -56 166 -54 L194 -56 C202 -66 210 -72 220 -70 L228 -62 L222 -58 L216 -59 C213 -51 210 -44 206 -41 L208 -26 L216 -8 L210 -6 L200 -24 L196 -34 C186 -32 172 -32 162 -34 L152 -20 L140 -6 L134 -8 L144 -22 L146 -34 C136 -32 126 -36 120 -46Z" fill="' + c2 + '"/>'
    + '<path d="M118 -44 C108 -48 100 -44 96 -36 C104 -38 110 -38 118 -40Z" fill="' + c2 + '"/>'
    + '<path d="M40 -46 Q70 -44 84 -24 L84 -8 L36 -8Z" fill="#a8322a"/><path d="M50 -46 L50 -78 M50 -70 L128 -52" stroke="#3a2416" stroke-width="3"/><circle cx="50" cy="-84" r="9" fill="#3a2416"/><path d="M42 -76 L60 -76 L56 -48 L46 -48Z" fill="#e9d6b0"/>'
    + '<g transform="translate(60 -8)"><circle r="22" fill="none" stroke="#3a2416" stroke-width="5"/><g' + an('spin', .45, 0, 'linear') + ' class="wheel"><path d="M-20 0 H20 M0 -20 V20 M-14 -14 L14 14 M14 -14 L-14 14" stroke="#3a2416" stroke-width="3"/></g></g>'
    + risers(31, 6, 20, -6, 30, { r: [12, 22], fill: 'url(#w-rome-dust)', dur: [.9, 1.4], dx: -140, rise: 50, op: .9, sc: 2.4 }) + '</g>';
  s += '<g transform="translate(0 820) scale(1.45)"><g' + an('race', 9, 0, 'linear', '--from:-500px;--to:1500px') + '>' + chariot('#5a3020', '#3f2116') + '</g></g>';
  s += '<g transform="translate(0 745) scale(1.05)"><g' + an('race', 9, 4.5, 'linear', '--from:1900px;--to:-500px') + '><g transform="scale(-1 1)">' + chariot('#4b4038', '#2f2924') + '</g></g></g>';
  s += '<g class="fx">' + risers(7, 8, 800, 860, 1500, { r: [40, 70], fill: 'url(#w-rome-dust)', dur: [6, 10], dx: 80, rise: 100, op: .45, sc: 2, wob: 120 }) + '</g>';
  return { defs, body: s };
};

/* ---- The submarine: running deep, the sonar pinging ---- */
WORLDS.submarine = () => {
  const defs = grad('w-sub-sea', [[0, '#1d5a86'], [.5, '#0b2c4d'], [1, '#04121f']]) + grad('w-sub-hull', [[0, '#6d8090'], [.5, '#3b4b5a'], [1, '#1f2a33']])
    + grad('w-sub-beam', [[0, '#fff7c8', .55], [1, '#fff7c8', 0]], 1, 0) + grad('w-sub-shaft', [[0, '#bfe6ff', .22], [1, '#bfe6ff', 0]]);
  let s = rect('url(#w-sub-sea)');
  s += [[160, 120], [760, 120], [1300, 100]].map(([x, w]) => '<g transform="translate(' + x + ' 0)"><g class="shaft"><path d="M0 0 L' + w + ' 0 L' + (w + 160) + ' 900 L80 900Z" fill="url(#w-sub-shaft)"/></g></g>').join('');
  s += '<g class="fx">' + risers(3, 14, 800, 900, 1600, { r: [1.2, 2.6], fill: '#cfeaff', dur: [10, 18], rise: 900, op: .5, sc: 1, wob: 80 }) + '</g>';
  // fish passing
  const fish = (x, y, s2) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s2 + ')" d="M0 0 Q14 -8 28 0 Q14 8 0 0Z M28 0 L38 -7 L38 7Z" fill="#7fb6d8" opacity=".75"/>';
  const r = rng(5); let shoal = ''; for (let i = 0; i < 14; i++) shoal += fish(r() * 220, r() * 90, .7 + r() * .5);
  s += '<g transform="translate(0 210)"><g' + an('cross', 34, -8, 'linear', '--from:1700px;--to:-500px') + '><g transform="scale(-1 1)">' + shoal + '</g></g></g>';
  s += '<g transform="translate(0 120)"><g' + an('cross', 52, -30, 'linear', '--from:1800px;--to:-400px') + ' opacity=".6"><g transform="scale(-.8 .8)">' + shoal + '</g></g></g>';
  // the seabed slides by: far ridge, then rocks and swaying kelp
  s += scroll('<path d="M0 760 Q120 700 260 740 T520 720 T800 750 T1060 710 T1320 740 T1600 760 V900 H0Z" fill="#0a2236"/>', 90);
  const kr = rng(9); let kelp = '<path d="M0 840 Q200 800 400 830 T800 820 T1200 836 T1600 840 V900 H0Z" fill="#071827"/>';
  for (let i = 0; i < 12; i++) { const x = 40 + i * 132 + kr() * 40, h = 120 + kr() * 160;
    kelp += '<g transform="translate(' + f(x) + ' 850)"><g class="kelp"' + an('sway', 4 + kr() * 3, -kr() * 4, 'ease-in-out', '--s:' + f(4 + kr() * 5) + 'deg') + '><path d="M0 0 C-14 -' + f(h * .3) + ' 14 -' + f(h * .6) + ' 0 -' + f(h) + '" stroke="#2c6b4f" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M0 -' + f(h * .45) + ' q16 -10 22 -30 M0 -' + f(h * .75) + ' q-16 -8 -20 -26" stroke="#2c6b4f" stroke-width="5" fill="none" stroke-linecap="round"/></g></g>'; }
  for (let i = 0; i < 5; i++) kelp += '<ellipse cx="' + f(100 + i * 330 + kr() * 80) + '" cy="868" rx="' + f(40 + kr() * 40) + '" ry="' + f(18 + kr() * 14) + '" fill="#0d2a3e"/>';
  s += scroll(kelp, 38);
  // the boat itself, bobbing, its sonar pinging ahead
  s += '<g transform="translate(1180 640)">' + [0].map(d => '<circle r="420" fill="none" stroke="#8fe3ff" stroke-width="4" class="fx ping"' + an('ping', 4.2, d, 'ease-out') + '/>').join('') + '</g>';
  s += '<g transform="translate(420 560)"><g' + an('bob', 6, 0, 'ease-in-out', '--b:-14px') + '>'
    + '<path d="M760 80 L1400 -10 L1400 170Z" fill="url(#w-sub-beam)" class="beam"' + an('glow', 3, 0, 'ease-in-out', '--g:.55') + '/>'
    + '<path d="M40 80 C40 30 140 20 380 20 C620 20 760 40 770 80 C760 120 620 140 380 140 C140 140 40 130 40 80Z" fill="url(#w-sub-hull)"/>'
    + '<path d="M320 22 L340 -40 L470 -40 L500 22Z" fill="#33424f"/><path d="M420 -40 V-100 H460" stroke="#33424f" stroke-width="9" fill="none" stroke-linecap="round"/>'
    + '<path d="M70 80 H740" stroke="#25313b" stroke-width="3" opacity=".7"/>'
    + range(160, 640, 80).map((x, k) => '<circle cx="' + x + '" cy="74" r="13" fill="#ffd27a"' + an('glow', 2.5 + (k % 3) * .6, -k * .5, 'ease-in-out', '--g:.55') + '/>').join('')
    + '<path d="M40 80 L0 40 L10 80 L0 120Z" fill="#26323c"/>'
    + '<g transform="translate(-8 80)"><g class="prop"' + an('prop', .18, 0, 'linear') + '><ellipse rx="10" ry="38" fill="#7b8a96"/></g></g>'
    + risers(11, 10, -20, 80, 30, { r: [4, 10], stroke: '#cfeaff', sw: 2, dur: [1.6, 2.8], dx: -220, rise: 140, op: .7, sc: 1.4, wob: 60 })
    + '</g></g>';
  return { defs, body: s };
};

/* ---- The night flight: an airliner above the clouds ---- */
WORLDS.flight = () => {
  const defs = grad('w-fl-sky', [[0, '#0b1740'], [.6, '#1a3570'], [1, '#3a4f8a']]) + radial('w-fl-moon', [[0, '#fff6d6', .5], [1, '#fff6d6', 0]])
    + grad('w-fl-body', [[0, '#e8eef8'], [.55, '#b9c5da'], [1, '#7f8ca6']]);
  let s = rect('url(#w-fl-sky)') + stars(21, 90, 560);
  s += '<circle cx="1320" cy="150" r="170" fill="url(#w-fl-moon)"' + an('glow', 7, 0, 'ease-in-out', '--g:.6') + '/><circle cx="1320" cy="150" r="58" fill="#fff2c4"/><circle cx="1346" cy="134" r="52" fill="#13265a"/>';
  s += '<g class="fx"' + an('shoot', 11, -3, 'linear', '--from:0px') + '><path d="M300 80 l-180 70" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/></g>';
  const clouds = (seed, y, n, rx, colour, op) => { const r = rng(seed); let c = ''; for (let i = 0; i < n; i++) { const x = 60 + (i + r() * .6) * (1480 / n), w = rx * (.7 + r() * .6);
    c += '<g opacity="' + op + '"><ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(w) + '" ry="' + f(w * .22) + '" fill="' + colour + '"/><ellipse cx="' + f(x - w * .3) + '" cy="' + f(y - w * .12) + '" rx="' + f(w * .45) + '" ry="' + f(w * .2) + '" fill="' + colour + '"/><ellipse cx="' + f(x + w * .25) + '" cy="' + f(y - w * .16) + '" rx="' + f(w * .4) + '" ry="' + f(w * .22) + '" fill="' + colour + '"/></g>'; } return c; };
  s += scroll(clouds(1, 560, 6, 170, '#a9b8de', .22), 150) + scroll(clouds(2, 650, 5, 220, '#b9c6e8', .3), 80);
  // the airliner, nose to the right, rising and settling on the air
  s += '<g transform="translate(330 610)"><g' + an('bob', 5.5, 0, 'ease-in-out', '--b:-18px') + '><g' + an('pitch', 7, 0, 'ease-in-out') + ' class="plane">'
    + '<path d="M180 30 L330 30 L240 120 L170 120Z" fill="#8f9bb5"/>'
    + '<path d="M0 10 L-30 -60 L20 -60 L60 0Z" fill="#a9b5cc"/><path d="M-10 20 L-46 20 L-40 36 L10 34Z" fill="#a9b5cc"/>'
    + '<path d="M-10 20 Q-24 -4 20 -6 L520 -8 Q600 -6 620 18 Q600 44 520 46 L20 46 Q-20 44 -10 20Z" fill="url(#w-fl-body)"/>'
    + '<path d="M560 2 Q590 4 604 14 L560 14Z" fill="#33415f"/>'
    + range(90, 500, 34).map((x, k) => '<rect x="' + x + '" y="6" width="16" height="12" rx="3" fill="#ffd27a"' + (k % 4 === 1 ? an('glow', 5, -k, 'ease-in-out', '--g:.45') : '') + '/>').join('')
    + [[236, 62], [292, 84]].map(([x, y]) => '<g transform="translate(' + x + ' ' + y + ')"><path d="M-40 -11 H20 Q34 -11 38 0 Q34 11 20 11 H-40Z" fill="#5d6880"/><circle cx="38" cy="0" r="5" fill="#2b3346"/><g transform="translate(42 0)"><g class="prop"' + an('prop', .14, 0, 'linear') + '><ellipse rx="5" ry="34" fill="#e8eef8" opacity=".5"/></g></g></g>').join('')
    + '<circle cx="250" cy="120" r="6" fill="#ff4d4d"' + an('blink', 1.6, 0, 'steps(1,end)') + '/><circle cx="-38" cy="-58" r="5" fill="#fff"' + an('blink', 2.2, -.8, 'steps(1,end)') + '/>'
    + '</g></g></g>';
  s += scroll(clouds(3, 820, 4, 300, '#c8d3ef', .5), 34) + scroll(clouds(4, 900, 4, 340, '#d6def4', .55), 26);
  return { defs, body: s };
};

/* ---- The mountain railway: a steam train across a viaduct at night ---- */
WORLDS.railway = () => {
  const defs = grad('w-rw-sky', [[0, '#2c2260'], [.6, '#4a3a7e'], [1, '#6b5592']]) + radial('w-rw-moon', [[0, '#f4ecd0', .45], [1, '#f4ecd0', 0]])
    + grad('w-rw-lamp', [[0, '#fff2b0', .6], [1, '#fff2b0', 0]], 1, 0) + radial('w-rw-mist', [[0, '#d9d4ea', .8], [1, '#d9d4ea', 0]]);
  let s = rect('url(#w-rw-sky)') + stars(41, 70, 420);
  s += '<circle cx="290" cy="150" r="150" fill="url(#w-rw-moon)"/><circle cx="290" cy="150" r="48" fill="#f4ecd0"/>';
  const peaks = (seed, base, amp, colour, snow) => { const r = rng(seed); let pts = [[0, base]], x = 0; while (x < 1600) { x = Math.min(1600, x + 120 + r() * 160); pts.push([x - 80, base - amp * (.5 + r() * .5)], [x, base]); }
    pts[pts.length - 1] = [1600, base];
    let p = '<path d="M' + pts.map(([a, b]) => f(a) + ' ' + f(b)).join(' L') + ' V900 H0Z" fill="' + colour + '"/>';
    if (snow) pts.forEach(([a, b], k) => { if (k % 2 === 1) p += '<path d="M' + f(a) + ' ' + f(b) + ' l-22 ' + f(amp * .14) + ' l14 -6 l8 10 l10 -8 l14 6Z" fill="#e8e6f4" opacity=".8"/>'; });
    return p; };
  s += scroll(peaks(2, 520, 300, '#2a2452', true), 160) + scroll(peaks(3, 600, 220, '#201b42', true), 80);
  const tr = rng(4); let pines = '<rect x="0" y="690" width="1600" height="210" fill="#141030"/>';
  for (let i = 0; i < 26; i++) { const x = i * 62 + tr() * 30, h = 70 + tr() * 70; pines += '<path d="M' + f(x) + ' 700 l' + f(h * .28) + ' -' + f(h) + ' l' + f(h * .28) + ' ' + f(h) + 'Z" fill="#141030"/>'; }
  s += scroll(pines, 30);
  // the viaduct races past under the train
  let via = '<rect x="0" y="726" width="1600" height="26" fill="#5a4a3c"/><rect x="0" y="720" width="1600" height="8" fill="#7a6650"/>';
  via += range(0, 1440, 160).map(x => '<path d="M' + x + ' 752 H' + (x + 160) + ' V900 H' + (x + 140) + ' V820 a60 60 0 0 0 -120 0 V900 H' + x + 'Z" fill="#4a3c30"/>').join('');
  s += scroll(via, 6);
  // the train: carriages, then the engine, with smoke streaming back
  const wheels = xs => xs.map(x => '<g transform="translate(' + x + ' 0)"><circle r="13" fill="#1b1b1b"/><g' + an('spin', .35, 0, 'linear') + ' class="wheel"><path d="M-11 0 H11 M0 -11 V11" stroke="#6b6b6b" stroke-width="3"/></g></g>').join('');
  let train = '';
  [0, 190, 380].forEach((x, k) => { train += '<g transform="translate(' + x + ' 0)"><rect x="0" y="-74" width="176" height="62" rx="6" fill="#7a2f2f"/><rect x="-4" y="-80" width="184" height="10" rx="4" fill="#5a2222"/>'
    + range(14, 140, 32).map((wx, j) => '<rect x="' + wx + '" y="-62" width="22" height="22" rx="3" fill="#ffd27a"' + ((j + k) % 3 === 0 ? an('glow', 3 + j, -j - k, 'ease-in-out', '--g:.55') : '') + '/>').join('')
    + '<g transform="translate(0 -6)">' + wheels([30, 146]) + '</g></g>'; });
  train += '<g transform="translate(580 0)"><rect x="0" y="-90" width="70" height="78" rx="4" fill="#262626"/><rect x="10" y="-80" width="30" height="26" rx="3" fill="#ffcf6a"/>'
    + '<rect x="70" y="-62" width="150" height="50" rx="24" fill="#303030"/><rect x="186" y="-104" width="22" height="44" fill="#262626"/><rect x="180" y="-110" width="34" height="10" rx="3" fill="#3c3c3c"/>'
    + '<rect x="120" y="-78" width="24" height="18" rx="8" fill="#3c3c3c"/><circle cx="224" cy="-40" r="9" fill="#fff2b0"/><path d="M228 -50 L520 -110 L520 30Z" fill="url(#w-rw-lamp)"' + an('glow', 2.2, 0, 'ease-in-out', '--g:.6') + '/>'
    + '<path d="M222 -14 L244 -4 L222 -4Z" fill="#7a2f2f"/><g transform="translate(0 -6)">' + wheels([30, 100, 160]) + '</g>'
    + risers(13, 9, 197, -112, 14, { r: [14, 24], fill: '#e9e6f2', dur: [2.2, 3.4], dx: -520, rise: 160, op: .6, sc: 2.6, wob: 60, ease: 'ease-out' }) + '</g>';
  s += '<g transform="translate(330 726)"><g' + an('bob', .28, 0, 'ease-in-out', '--b:-2px') + '>' + train + '</g></g>';
  return { defs, body: s };
};

/* ---- The galleon: a sailing ship in a storm ---- */
WORLDS.galleon = () => {
  const defs = grad('w-gal-sky', [[0, '#1c3238'], [.6, '#3d6670'], [1, '#4f7a80']]) + grad('w-gal-sea', [[0, '#1a4450'], [1, '#081c22']]);
  let s = rect('url(#w-gal-sky)');
  const cl = (seed, y, colour, op) => { const r = rng(seed); let c = ''; for (let i = 0; i < 7; i++) { const x = i * 240 + r() * 80, w = 160 + r() * 120; c += '<ellipse cx="' + f(x) + '" cy="' + f(y + r() * 60) + '" rx="' + f(w) + '" ry="' + f(w * .3) + '" fill="' + colour + '" opacity="' + op + '"/>'; } return c; };
  s += scroll(cl(1, 60, '#2b4a52', .9), 70) + scroll(cl(2, 160, '#22404a', .8), 44);
  // lightning: a bolt and a flash across the sky
  s += '<g class="fx"' + an('lightning', 9, -2, 'linear') + '><rect width="1600" height="900" fill="#eaf6ff" opacity=".35"/><path d="M1220 0 L1180 120 L1215 120 L1160 260 L1200 255 L1130 420" stroke="#fffbe0" stroke-width="7" fill="none" stroke-linejoin="round"/></g>';
  const waves = (y, colour, amp, len) => { let d = 'M0 ' + y; for (let x = 0; x < 1600; x += len) d += ' Q' + (x + len / 4) + ' ' + (y - amp) + ' ' + (x + len / 2) + ' ' + y + ' T' + (x + len) + ' ' + y; return '<path d="' + d + ' V900 H0Z" fill="' + colour + '"/>'; };
  s += scroll(waves(640, '#1a4450', 26, 200), 16);
  // the ship rolls and pitches
  s += '<g transform="translate(560 690)"><g' + an('bob', 4.5, 0, 'ease-in-out', '--b:-16px') + '><g class="ship"' + an('rock', 6, 0, 'ease-in-out') + '>'
    + '<path d="M-260 -40 L280 -40 L240 30 L-220 30Z" fill="#5a3a22"/><path d="M-250 -22 H270" stroke="#3d2716" stroke-width="5"/><path d="M200 -40 L300 -110 L300 -40Z" fill="#6b4628"/><path d="M-260 -40 L-290 -100 L-230 -100 L-220 -40Z" fill="#6b4628"/>'
    + range(-180, 200, 60).map(x => '<rect x="' + x + '" y="-20" width="16" height="12" fill="#2a1a10"/>').join('')
    + [[-120, 300], [20, 380], [160, 300]].map(([x, h], k) => '<path d="M' + x + ' -40 V-' + (h + 40) + '" stroke="#3a2614" stroke-width="8"/>'
      + '<g class="sail"' + an('billow', 3 + k * .4, -k, 'ease-in-out') + '><path d="M' + (x - 70) + ' -' + (h + 10) + ' Q' + x + ' -' + (h - 20) + ' ' + (x + 70) + ' -' + (h + 10) + ' L' + (x + 80) + ' -' + (h * .62) + ' Q' + x + ' -' + (h * .5) + ' ' + (x - 80) + ' -' + (h * .62) + 'Z" fill="#efe6d2"/>'
      + '<path d="M' + (x - 84) + ' -' + (h * .52) + ' Q' + x + ' -' + (h * .38) + ' ' + (x + 84) + ' -' + (h * .52) + ' L' + (x + 92) + ' -70 Q' + x + ' -60 ' + (x - 92) + ' -70Z" fill="#e5dcc6"/></g>').join('')
    + '<g transform="translate(20 -420)"><g class="flag"' + an('wave', 1.1, 0, 'ease-in-out') + '><path d="M0 0 L60 10 L0 22Z" fill="#c4442c"/></g></g>'
    + '<circle cx="-262" cy="-70" r="10" fill="#ffcf6a"' + an('glow', 1.8, 0, 'ease-in-out', '--g:.5') + '/>'
    + '</g></g></g>';
  s += scroll(waves(760, '#123843', 34, 260), 10) + scroll('<path d="' + range(0, 1500, 260).map(x => 'M' + (x + 20) + ' 760 q40 -30 90 -8').join(' ') + '" stroke="#bfe1e8" stroke-width="5" fill="none" opacity=".55"/>', 10);
  s += scroll(waves(840, '#0b2830', 30, 320), 7);
  // rain sheets
  const rr = rng(6); let rain = ''; for (let i = 0; i < 70; i++) { const x = rr() * 1900, y = rr() * 900; rain += '<path d="M' + f(x) + ' ' + f(y) + ' l-14 40" stroke="#cfe6ee" stroke-width="2" opacity=".45"/>'; }
  s += '<g class="fx"><g' + an('rain', .7, 0, 'linear') + '>' + rain + '<g transform="translate(0 -900)">' + rain + '</g></g></g>';
  return { defs, body: s };
};

/* ---- The Ice Age cave: firelight on a painted wall, snow at the mouth ---- */
WORLDS.cave = () => {
  const defs = radial('w-cave-fire', [[0, '#ffb347', .9], [.35, '#d9622b', .45], [1, '#2a170d', 0]]) + grad('w-cave-night', [[0, '#1e3256'], [1, '#5f7aa0']]) + grad('w-cave-flame', [[0, '#ffe28a'], [1, '#ff8a2b']]) + radial('w-cave-floor', [[0, '#ffb347', .55], [1, '#ffb347', 0]]);
  let s = rect('#1a110b');
  // the cave mouth on the right: night, snow, far hills
  s += '<path d="M1180 900 C1160 600 1220 300 1380 180 C1480 120 1560 140 1600 160 V900Z" fill="url(#w-cave-night)"/>';
  s += '<path d="M1200 720 Q1320 640 1440 690 T1600 660 V900 H1200Z" fill="#dfe8f4"/><circle cx="1500" cy="300" r="34" fill="#f4f1e4" opacity=".9"/>';
  const sr = rng(12); let snow = ''; for (let i = 0; i < 40; i++) snow += '<circle cx="' + f(1220 + sr() * 400) + '" cy="' + f(sr() * 900) + '" r="' + f(1.5 + sr() * 3) + '" fill="#fff" opacity=".85"/>';
  s += '<g class="fx"><g' + an('snow', 9, 0, 'linear') + '>' + snow + '<g transform="translate(0 -900)">' + snow + '</g></g></g>';
  // firelight washing over the walls, flickering
  s += '<g' + an('flicker', 2.4, 0, 'linear') + '><ellipse cx="760" cy="820" rx="900" ry="640" fill="url(#w-cave-fire)"/></g>';
  // the rock: ceiling teeth, walls, floor
  s += '<path d="M0 0 H1600 V140 C1540 120 1470 130 1400 170 L1360 110 L1320 210 L1280 150 L1230 260 L1180 170 L1130 230 L1080 120 L1020 200 L960 110 L900 180 L840 90 L780 170 L720 100 L660 190 L600 110 L540 170 L480 90 L420 180 L360 120 L300 200 L240 110 L180 170 L120 100 L60 190 L0 120Z" fill="#120b07"/>';
  s += [[1360, 110, 40], [1230, 260, 30], [1130, 230, 46], [1020, 200, 34]].map(([x, y, h]) => '<path d="M' + (x - 8) + ' ' + (y - 10) + ' L' + x + ' ' + (y + h) + ' L' + (x + 8) + ' ' + (y - 10) + 'Z" fill="#cfe2f2" opacity=".75"/>').join('');
  s += '<circle class="fx" cx="1130" cy="276" r="4" fill="#cfe2f2" style="--dy:420px;animation:tlw-drip 3.8s ease-in 0s infinite"/>';
  s += '<path d="M0 0 V900 H220 C180 700 140 500 160 300 C170 180 120 100 0 0Z" fill="#160e09"/><path d="M1180 900 C1150 700 1200 420 1240 300 L1260 900Z" fill="#160e09"/>';
  s += '<path d="M0 820 Q300 780 600 800 T1200 810 L1260 900 H0Z" fill="#24170e"/>';
  // the paintings: a mammoth, a deer, hands, catching the light
  s += '<g' + an('flicker', 3.1, -.7, 'linear') + ' opacity=".9">'
    + '<g transform="translate(330 300)" fill="none" stroke="#d27a3e" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"><path d="M0 40 Q4 -20 60 -30 Q100 -54 150 -30 Q190 -30 196 20 L190 90 L176 90 L174 50 L132 50 L130 90 L116 90 L112 50 L64 50 L60 90 L46 90 L42 50 Q14 56 4 80 Q-10 96 -24 90"/><path d="M196 20 Q216 46 206 80 M150 -30 Q160 -60 140 -70"/></g>'
    + '<g transform="translate(700 260)" fill="none" stroke="#c75f2e" stroke-width="5" stroke-linecap="round"><path d="M0 0 Q30 -14 70 -4 L90 -20 M70 -4 L84 40 M8 0 L-4 40 M20 4 L18 40 M60 0 L64 40 M90 -20 L80 -50 M90 -20 L108 -46 M86 -36 L70 -42 M98 -34 L116 -36"/></g>'
    + [[560, 190], [610, 170], [930, 330]].map(([x, y], k) => '<path transform="translate(' + x + ' ' + y + ') rotate(' + (k * 14 - 10) + ')" d="M0 40 Q-14 20 -12 0 L-10 -24 Q-6 -30 -2 -24 L0 -6 L2 -34 Q6 -40 10 -34 L10 -6 L14 -30 Q18 -36 22 -30 L20 -4 L26 -20 Q30 -24 33 -18 L28 14 Q24 36 12 44Z" fill="#b5542a" opacity=".7"/>').join('')
    + '</g>';
  // the fire: logs, three flames, embers rising
  s += '<ellipse cx="760" cy="850" rx="300" ry="60" fill="url(#w-cave-floor)"' + an('flicker', 1.7, 0, 'linear') + '/>';
  s += '<g transform="translate(760 840)"><path d="M-110 10 L110 -16 M-100 -18 L104 12" stroke="#3a2416" stroke-width="22" stroke-linecap="round"/>'
    + '<g class="flame"' + an('flick', .9, 0, 'ease-in-out') + '><path d="M-80 0 Q-90 -90 -30 -150 Q-20 -90 10 -110 Q20 -190 60 -230 Q70 -140 90 -100 Q110 -50 80 0Z" fill="#ff8a2b"/></g>'
    + '<g class="flame"' + an('flick', .7, -.3, 'ease-in-out') + '><path d="M-50 0 Q-60 -70 -10 -120 Q0 -70 20 -90 Q34 -150 50 -170 Q60 -100 70 -60 Q76 -20 56 0Z" fill="url(#w-cave-flame)"/></g>'
    + '<g class="flame"' + an('flick', .55, -.1, 'ease-in-out') + '><path d="M-20 0 Q-26 -40 4 -80 Q16 -40 30 -50 Q40 -20 30 0Z" fill="#fff2b0"/></g>'
    + risers(17, 18, 0, -60, 120, { r: [2, 4.5], fill: '#ffcf6a', dur: [1.6, 3], dx: 0, rise: 420, op: .95, sc: .4, wob: 160 }) + '</g>';
  return { defs, body: s };
};

/* ---- The hot air balloon: drifting over fields and rivers ---- */
WORLDS.balloon = () => {
  const defs = grad('w-bal-sky', [[0, '#5fb6ea'], [.7, '#bfe6fb'], [1, '#eef9ff']]) + radial('w-bal-sun', [[0, '#fff8d8', .9], [1, '#fff8d8', 0]])
    + radial('w-bal-flame', [[0, '#fff2b0', 1], [.5, '#ffb347', .8], [1, '#ff7a2b', 0]]);
  let s = rect('url(#w-bal-sky)');
  s += '<circle cx="1380" cy="140" r="200" fill="url(#w-bal-sun)"/>';
  const cl = (seed, n, y, colour, op) => { const r = rng(seed); let c = ''; for (let i = 0; i < n; i++) { const x = 80 + i * (1440 / n) + r() * 80, w = 90 + r() * 90, yy = y + r() * 120;
    c += '<g opacity="' + op + '"><ellipse cx="' + f(x) + '" cy="' + f(yy) + '" rx="' + f(w) + '" ry="' + f(w * .28) + '" fill="' + colour + '"/><ellipse cx="' + f(x - w * .25) + '" cy="' + f(yy - w * .18) + '" rx="' + f(w * .45) + '" ry="' + f(w * .3) + '" fill="' + colour + '"/><ellipse cx="' + f(x + w * .2) + '" cy="' + f(yy - w * .22) + '" rx="' + f(w * .38) + '" ry="' + f(w * .3) + '" fill="' + colour + '"/></g>'; } return c; };
  s += scroll(cl(1, 5, 120, '#fff', .75), 120) + scroll(cl(2, 4, 330, '#fff', .55), 70);
  // the land below slides by: far hills, patchwork fields, a river, hedges and trees
  s += scroll('<path d="M0 640 Q200 600 420 630 T860 610 T1300 640 T1600 640 V900 H0Z" fill="#9cc77a"/>', 120);
  const fr = rng(3); let fields = '<rect x="0" y="690" width="1600" height="210" fill="#7cb85e"/>';
  const cols = ['#8fc46a', '#6aa84f', '#c9d36a', '#a8c95e', '#5f9c48', '#d7c77a'];
  for (let i = 0; i < 8; i++) { const x = i * 200; fields += '<path d="M' + x + ' 690 L' + (x + 200) + ' 690 L' + (x + 230) + ' 790 L' + (x + 20) + ' 790Z" fill="' + cols[i % 6] + '"/><path d="M' + (x + 20) + ' 790 L' + (x + 230) + ' 790 L' + (x + 260) + ' 900 L' + (x + 40) + ' 900Z" fill="' + cols[(i + 3) % 6] + '"/>'; }
  fields += '<path d="M0 690 H1600 M0 790 H1600" stroke="#4d7f3a" stroke-width="4"/>';
  for (let i = 0; i < 14; i++) { const x = i * 116 + fr() * 50; fields += '<circle cx="' + f(x) + '" cy="' + f(780 + fr() * 14) + '" r="' + f(10 + fr() * 8) + '" fill="#3f7a35"/>'; }
  fields += '<path d="M0 860 C200 820 400 900 600 850 S1000 820 1200 860 S1500 880 1600 860" stroke="#8fd0f4" stroke-width="18" fill="none"/>';
  s += scroll(fields, 60);
  // other balloons, far off
  const small = (x, y, sc, a, b, d) => '<g transform="translate(' + x + ' ' + y + ') scale(' + sc + ')"><g' + an('bob', 7, -d, 'ease-in-out', '--b:-20px') + '><path d="M0 -60 C36 -60 44 -20 8 14 L-8 14 C-44 -20 -36 -60 0 -60Z" fill="' + a + '"/><path d="M0 -60 C14 -60 16 -20 3 14 L-3 14 C-16 -20 -14 -60 0 -60Z" fill="' + b + '"/><rect x="-7" y="20" width="14" height="10" fill="#8a6545"/><path d="M-6 14 L-6 20 M6 14 L6 20" stroke="#6b4b33" stroke-width="1.4"/></g></g>';
  s += '<g' + an('cross', 90, -20, 'linear', '--from:0px;--to:-700px') + '>' + small(1500, 300, .9, '#3a7bd5', '#f0f4fa', 1) + small(1700, 480, .6, '#2fbf8f', '#f6e27a', 3) + '</g>';
  s += '<g' + an('cross', 120, -50, 'linear', '--from:0px;--to:-900px') + '>' + small(1250, 560, .45, '#a98bff', '#fff', 2) + '</g>';
  s += '<g' + an('cross', 40, -6, 'linear', '--from:200px;--to:-1900px') + '>' + flier(1600, 220, .8, '#3d4a5a', .6) + flier(1640, 240, .7, '#3d4a5a', .55) + flier(1670, 210, .6, '#3d4a5a', .65) + '</g>';
  // our balloon: big, on the left, bobbing, its burner roaring now and then
  const stripes = ['#e2582c', '#f0b44c', '#e2582c', '#f6efe4', '#e2582c', '#f0b44c', '#e2582c'];
  s += '<g transform="translate(260 330)"><g' + an('bob', 8, 0, 'ease-in-out', '--b:-26px') + '><g class="balloon"' + an('sway', 9, 0, 'ease-in-out', '--s:1.6deg') + '>'
    + '<path d="M0 -270 C190 -270 230 -40 40 140 L-40 140 C-230 -40 -190 -270 0 -270Z" fill="#e2582c"/>'
    + stripes.map((c, k) => { const t = (k - 3) / 3.5; return '<path d="M0 -270 C' + f(190 * t + 24) + ' -270 ' + f(230 * t + 30) + ' -40 ' + f(40 * t + 6) + ' 140 L' + f(40 * t - 6) + ' 140 C' + f(230 * t - 30) + ' -40 ' + f(190 * t - 24) + ' -270 0 -270Z" fill="' + c + '"/>'; }).join('')
    + '<path d="M-40 140 L-30 210 M40 140 L30 210 M-14 140 L-12 210 M14 140 L12 210" stroke="#6b4b33" stroke-width="3"/>'
    + '<rect x="-46" y="210" width="92" height="60" rx="8" fill="#8a6545"/><path d="M-46 228 H46 M-46 248 H46" stroke="#6b4b33" stroke-width="3"/>'
    + '<g transform="translate(0 176)"><g class="burner"' + an('burn', 5, 0, 'ease-out') + '><circle r="60" fill="url(#w-bal-flame)"/><path d="M-14 20 Q-16 -10 0 -40 Q16 -10 14 20Z" fill="#fff2b0"/></g></g>'
    + '</g></g></g>';
  return { defs, body: s };
};

/* ---- The manor at midnight: candles, bats and thunder ---- */
WORLDS.manor = () => {
  const defs = grad('w-man-sky', [[0, '#120d26'], [.6, '#33265a'], [1, '#4a3a72']]) + radial('w-man-moon', [[0, '#fff0c8', .55], [1, '#fff0c8', 0]]) + radial('w-man-win', [[0, '#ffcf6a', .9], [1, '#ffcf6a', 0]]) + radial('w-man-fog', [[0, '#cfc8ee', .9], [1, '#cfc8ee', 0]]);
  let s = rect('url(#w-man-sky)') + stars(51, 70, 460);
  s += '<circle cx="1240" cy="190" r="260" fill="url(#w-man-moon)"/><circle cx="1240" cy="190" r="92" fill="#fff0c8"/>';
  const cl = (seed, y, op) => { const r = rng(seed); let c = ''; for (let i = 0; i < 5; i++) { const x = i * 330 + r() * 120, w = 160 + r() * 140; c += '<ellipse cx="' + f(x) + '" cy="' + f(y + r() * 70) + '" rx="' + f(w) + '" ry="' + f(w * .18) + '" fill="#1a1433" opacity="' + op + '"/>'; } return c; };
  s += scroll(cl(4, 150, .75), 60) + scroll(cl(5, 260, .6), 90);
  s += '<g class="fx"' + an('lightning', 13, -6, 'linear') + '><rect width="1600" height="900" fill="#d8d0ff" opacity=".22"/></g>';
  // hills, the manor and its windows
  s += '<path d="M0 760 Q300 690 600 720 T1100 640 T1600 660 V900 H0Z" fill="#100b1e"/>';
  s += '<path d="M1010 760 V420 L1060 340 L1110 420 V380 L1180 250 L1250 380 V420 H1320 L1370 300 L1420 420 V450 L1470 390 L1520 450 V760Z" fill="#0d0919"/><path d="M1180 250 V200 M1370 300 V262" stroke="#0d0919" stroke-width="6"/>'
    + '<rect x="1290" y="356" width="18" height="40" fill="#0d0919"/><rect x="1440" y="410" width="16" height="30" fill="#0d0919"/>';
  const wins = [[1040, 460], [1080, 460], [1150, 430], [1200, 430], [1150, 520], [1200, 520], [1290, 480], [1350, 470], [1400, 470], [1350, 560], [1460, 500], [1480, 600], [1040, 600], [1250, 640]];
  s += wins.map(([x, y], k) => { const lit = k % 3 !== 1; return '<g transform="translate(' + x + ' ' + y + ')"><rect x="-10" y="-22" width="20" height="36" rx="10" fill="#3a2d5a"/>'
    + (lit ? '<g' + an(k % 4 === 0 ? 'room' : 'flicker', k % 4 === 0 ? 12 : 2 + (k % 5) * .4, k % 4 === 0 ? -k * 1.5 : -k * .3, 'linear') + '>' + (k % 4 === 0 ? '<circle r="30" fill="url(#w-man-win)" opacity=".7"/>' : '') + '<rect x="-10" y="-22" width="20" height="36" rx="10" fill="#ffcf6a"/></g>' : '') + '</g>'; }).join('');
  // a bare tree with an owl, swaying
  s += '<g transform="translate(220 780)"><g class="tree"' + an('sway', 7, 0, 'ease-in-out', '--s:1.4deg') + '><path d="M0 0 C-10 -120 10 -220 -10 -330 M-6 -170 C-60 -210 -90 -260 -150 -270 M-4 -240 C40 -280 90 -300 140 -290 M-10 -300 C-40 -340 -60 -380 -50 -420 M-110 -250 L-130 -300 M80 -292 L110 -340" stroke="#0d0919" stroke-width="16" fill="none" stroke-linecap="round"/>'
    + '<g transform="translate(70 -320)"><ellipse cx="0" cy="0" rx="26" ry="32" fill="#2a2140"/><path d="M-22 -24 L-14 -40 L-6 -26 M22 -24 L14 -40 L6 -26" fill="#2a2140"/>'
    + '<g class="eyes"' + an('owl', 5, -1, 'linear') + '><circle cx="-10" cy="-8" r="8" fill="#ffd27a"/><circle cx="10" cy="-8" r="8" fill="#ffd27a"/><circle cx="-10" cy="-8" r="3.5" fill="#120d22"/><circle cx="10" cy="-8" r="3.5" fill="#120d22"/></g></g></g></g>';
  // bats crossing
  s += [[180, 22, 0], [260, 28, 9], [120, 34, 17], [330, 26, 5]].map(([y, d, del], k) => '<g transform="translate(0 ' + y + ')"><g' + an('batpath', d, -del, 'linear', '--from:' + (k % 2 ? '-200' : '1800') + 'px;--to:' + (k % 2 ? '1800' : '-200') + 'px') + '>' + flier(0, 0, .9 + (k % 3) * .2, '#0b0816', .22 + k * .03, true) + '</g></g>').join('');
  // fog along the ground, and the iron railings
  s += '<rect x="0" y="820" width="1600" height="80" fill="#0b0816"/>' + '<path d="' + range(10, 1590, 30).map(x => 'M' + x + ' 820 V770 l-6 -10 h12 l-6 10').join(' ') + '" stroke="#0b0816" stroke-width="5" fill="#0b0816"/><path d="M0 786 H1600 M0 808 H1600" stroke="#0b0816" stroke-width="5"/>';
  s += scroll('<g opacity=".28">' + range(0, 1500, 400).map(x => '<ellipse cx="' + (x + 200) + '" cy="870" rx="360" ry="70" fill="url(#w-man-fog)"/>').join('') + '</g>', 32);
  return { defs, body: s };
};

/* ---- The big top: a circus tent at dusk, searchlights and fireworks ---- */
WORLDS.bigtop = () => {
  const defs = grad('w-bt-sky', [[0, '#141842'], [.65, '#2a2f66'], [1, '#6a3a6a']]) + grad('w-bt-beam', [[0, '#fff6d0', 0], [1, '#fff6d0', .28]]) + radial('w-bt-door', [[0, '#ffcf6a', .8], [1, '#ffcf6a', 0]]);
  let s = rect('url(#w-bt-sky)') + stars(61, 60, 420);
  s += [[620, -18, 0], [980, 18, 3]].map(([x, a, d]) => '<g transform="translate(' + x + ' 700)"><g class="beam"' + an('sweep', 8, -d, 'ease-in-out', '--a:' + a + 'deg') + '><path d="M-14 0 L-140 -760 L140 -760 L14 0Z" fill="url(#w-bt-beam)"/></g></g>').join('');
  // fireworks, bursting in turn
  const burst = (x, y, c, d, n) => '<g transform="translate(' + x + ' ' + y + ')" class="fx"><g' + an('burst', 5.5, -d, 'ease-out') + '>' + range(0, n - 1, 1).map(k => { const a = k / n * Math.PI * 2; return '<circle cx="' + f(Math.cos(a) * 90) + '" cy="' + f(Math.sin(a) * 90) + '" r="6" fill="' + c + '"/><path d="M' + f(Math.cos(a) * 40) + ' ' + f(Math.sin(a) * 40) + ' L' + f(Math.cos(a) * 76) + ' ' + f(Math.sin(a) * 76) + '" stroke="' + c + '" stroke-width="3" opacity=".6"/>'; }).join('') + '</g></g>';
  s += burst(260, 170, '#ffd96a', 0, 14) + burst(1340, 140, '#ef7aa0', 1.8, 16) + burst(1500, 330, '#56b4e9', 3.6, 12) + burst(130, 360, '#2fbf8f', 2.7, 12);
  // side tents, the big top, its door and pennant
  const tent = (cx, base, w, h, a, b, n) => range(0, n - 1, 1).map(k => { const x1 = cx - w / 2 + k * w / n, x2 = x1 + w / n; return '<path d="M' + cx + ' ' + (base - h) + ' L' + f(x1) + ' ' + base + ' L' + f(x2) + ' ' + base + 'Z" fill="' + (k % 2 ? b : a) + '"/>'; }).join('');
  s += tent(170, 760, 300, 260, '#2f6fb0', '#f6efe4', 6) + tent(1440, 760, 320, 280, '#2f8f6a', '#f6efe4', 6);
  s += '<path d="M800 200 V140" stroke="#e8d7b0" stroke-width="6"/><g transform="translate(803 142)"><g class="flag"' + an('wave', 1.2, 0, 'ease-in-out') + '><path d="M0 0 L70 14 L0 30Z" fill="#f0b44c"/></g></g>';
  s += tent(800, 780, 1120, 580, '#c8322c', '#f6efe4', 14);
  s += '<path d="' + range(0, 13, 1).map(k => { const x = 240 + k * 80; return 'M' + x + ' 560 q40 34 80 0'; }).join(' ') + '" stroke="#f0b44c" stroke-width="10" fill="none"/>';
  s += '<path d="M700 780 L800 610 L900 780Z" fill="#2a1410"/><ellipse cx="800" cy="760" rx="120" ry="80" fill="url(#w-bt-door)"' + an('glow', 2.6, 0, 'ease-in-out', '--g:.5') + '/>';
  // strings of lights from the peak, chasing
  const bulbs = (x1, y1, x2, y2, n, sag, off) => { let b = '<path d="M' + x1 + ' ' + y1 + ' Q' + ((x1 + x2) / 2) + ' ' + ((y1 + y2) / 2 + sag) + ' ' + x2 + ' ' + y2 + '" stroke="#3a2a1a" stroke-width="2.5" fill="none"/>';
    for (let k = 1; k < n; k++) { const t = k / n, x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * ((x1 + x2) / 2) + t * t * x2, y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ((y1 + y2) / 2 + sag) + t * t * y2;
      b += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="7" fill="' + ['#ffd96a', '#ff7a6a', '#7fd0ff'][k % 3] + '"' + an('chase', 1.5, -((k + off) % 6) * .25, 'steps(1,end)') + '/>'; } return b; };
  s += bulbs(800, 205, 40, 780, 18, 80, 0) + bulbs(800, 205, 1560, 780, 18, 80, 3);
  s += '<rect x="0" y="780" width="1600" height="120" fill="#1d2a1a"/><path d="M0 780 H1600" stroke="#2f3f28" stroke-width="6"/>';
  // bunting along the top, swinging
  s += [0, 1].map(row => '<g' + (row ? an('sway', 5, -2, 'ease-in-out', '--s:.8deg') : '') + ' class="bunting"><path d="M-20 ' + (24 + row * 50) + ' Q800 ' + (120 + row * 50) + ' 1620 ' + (24 + row * 50) + '" stroke="#e8d7b0" stroke-width="3" fill="none"/>'
    + range(0, 19, 1).map(k => { const t = (k + .5) / 20, x = -20 + t * 1640, y = (24 + row * 50) + 4 * t * (1 - t) * 96; return '<path d="M' + f(x - 18) + ' ' + f(y) + ' L' + f(x + 18) + ' ' + f(y) + ' L' + f(x) + ' ' + f(y + 38) + 'Z" fill="' + ['#c8322c', '#f0b44c', '#2f6fb0', '#2f8f6a', '#f6efe4'][(k + row * 2) % 5] + '"/>'; }).join('') + '</g>').join('');
  return { defs, body: s };
};

/* ---- Smoke City: art deco towers, searchlights and an airship ---- */
WORLDS.city = () => {
  const defs = grad('w-city-sky', [[0, '#141634'], [.55, '#2a2550'], [1, '#6a3d5e']]) + grad('w-city-beam', [[0, '#fff6d0', 0], [1, '#fff6d0', .24]]) + radial('w-city-fog', [[0, '#c9b8d6', .9], [1, '#c9b8d6', 0]]);
  let s = rect('url(#w-city-sky)') + stars(71, 40, 300);
  s += [[260, -24, 0, 9], [760, 14, 2, 11], [1320, -10, 4, 10]].map(([x, a, d, dur]) => '<g transform="translate(' + x + ' 760)"><g class="beam"' + an('sweep', dur, -d, 'ease-in-out', '--a:' + a + 'deg') + '><path d="M-12 0 L-120 -860 L120 -860 L12 0Z" fill="url(#w-city-beam)"/></g></g>').join('');
  // the airship, crossing slowly, its light blinking
  s += '<g transform="translate(0 150)"><g' + an('cross', 80, -25, 'linear', '--from:1900px;--to:-700px') + '>'
    + '<ellipse cx="0" cy="0" rx="230" ry="62" fill="#8f94b3"/><path d="M-230 0 H230" stroke="#6f7493" stroke-width="3"/><path d="M-190 -40 Q0 -70 190 -40" stroke="#a7acc8" stroke-width="3" fill="none"/>'
    + '<path d="M210 -10 L270 -50 L270 50 L210 10Z" fill="#6f7493"/><rect x="-60" y="56" width="110" height="26" rx="8" fill="#4a4e6a"/>' + range(-50, 40, 18).map(x => '<rect x="' + x + '" y="62" width="10" height="12" fill="#ffd27a"/>').join('')
    + '<circle cx="-226" cy="0" r="7" fill="#ff4d4d"' + an('blink', 1.4, 0, 'steps(1,end)') + '/></g></g>';
  // three rows of towers; some windows blink on and off
  const r = rng(77);
  const towers = (n, colour, base, hmin, hmax, wmin, wmax, lit) => { let t = '', x = -20; for (let i = 0; i < n && x < 1620; i++) { const w = wmin + r() * (wmax - wmin), h = hmin + r() * (hmax - hmin), top = base - h, deco = r();
      t += '<path d="M' + f(x) + ' ' + base + ' V' + f(top + 40) + ' H' + f(x + w * .15) + ' V' + f(top + 20) + ' H' + f(x + w * .3) + ' V' + f(top) + ' H' + f(x + w * .7) + ' V' + f(top + 20) + ' H' + f(x + w * .85) + ' V' + f(top + 40) + ' H' + f(x + w) + ' V' + base + 'Z" fill="' + colour + '"/>';
      if (deco > .55) t += '<path d="M' + f(x + w / 2) + ' ' + f(top) + ' V' + f(top - 40 - r() * 50) + '" stroke="' + colour + '" stroke-width="5"/>';
      if (lit) for (let row = top + 60; row < base - 20; row += 34) for (let c = x + 12; c < x + w - 14; c += 22) if (r() < .42) { const blink = r() < .08;
        t += '<rect x="' + f(c) + '" y="' + f(row) + '" width="10" height="14" fill="#ffd27a" opacity="' + f(.55 + r() * .45) + '"' + (blink ? an('room', 10 + r() * 12, -r() * 20, 'linear') : '') + '/>'; }
      x += w + 6 + r() * 30; } return t; };
  s += towers(16, '#1b1d3c', 760, 260, 480, 80, 140, false) + towers(14, '#22264a', 790, 200, 400, 90, 150, true) + towers(12, '#2b3058', 820, 120, 300, 110, 170, true);
  // factory stacks on the left, smoke rolling away
  s += '<path d="M40 820 V600 H80 V820Z M110 820 V560 H150 V820Z" fill="#1a1a2e"/>' + '<g class="fx">' + risers(19, 10, 60, 600, 20, { r: [26, 40], fill: 'url(#w-city-fog)', dur: [5, 8], dx: 260, rise: 380, op: .6, sc: 2.6, wob: 60 }) + risers(23, 10, 130, 560, 20, { r: [26, 40], fill: 'url(#w-city-fog)', dur: [5, 8], dx: 260, rise: 380, op: .6, sc: 2.6, wob: 60 }) + '</g>';
  // the elevated railway, a lit train rattling across
  s += '<rect x="0" y="815" width="1600" height="85" fill="#101122"/><rect x="0" y="826" width="1600" height="14" fill="#1d1f38"/>' + range(40, 1560, 120).map(x => '<rect x="' + x + '" y="840" width="12" height="60" fill="#14152a"/>').join('');
  s += '<g transform="translate(0 800)"><g' + an('race', 14, -3, 'linear', '--from:-900px;--to:2400px') + '>' + range(0, 3, 1).map(k => '<g transform="translate(' + (k * 150) + ' 0)"><rect width="140" height="26" rx="6" fill="#3a3f68"/>' + range(10, 120, 20).map(x => '<rect x="' + x + '" y="6" width="12" height="10" fill="#ffd27a"/>').join('') + '</g>').join('') + '</g></g>';
  s += scroll('<g opacity=".3">' + range(0, 1500, 300).map(x => '<ellipse cx="' + (x + 150) + '" cy="880" rx="320" ry="70" fill="url(#w-city-fog)"/>').join('') + '</g>', 40);
  return { defs, body: s };
};

/* ===================================================================== the motion */
const CSS = `
.tlw{display:block;width:100%;height:100%}
.tlw *{transform-box:fill-box}
.tlw .kelp,.tlw .tree{transform-origin:50% 100%}
.tlw .flag{transform-origin:0% 50%}
.tlw .wheel,.tlw .ship,.tlw .prop,.tlw .plane,.tlw .burner,.tlw .ping,.tlw .eyes{transform-origin:50% 50%}
.tlw .flame{transform-origin:50% 100%}
.tlw .balloon{transform-origin:50% 0%}
.tlw .beam{transform-origin:50% 100%}
.tlw .shaft{transform-origin:50% 0%}
.tlw .sail{transform-origin:50% 50%}
.tlw .bunting{transform-origin:50% 0%}
@keyframes tlw-scroll{to{transform:translateX(-1600px)}}
@keyframes tlw-tw{50%{opacity:.15}}
@keyframes tlw-glow{50%{opacity:var(--g,.5)}}
@keyframes tlw-bob{50%{transform:translateY(var(--b,-12px))}}
@keyframes tlw-sway{0%,100%{transform:rotate(calc(var(--s,4deg) * -1))}50%{transform:rotate(var(--s,4deg))}}
@keyframes tlw-spin{to{transform:rotate(360deg)}}
@keyframes tlw-prop{50%{transform:scaleY(.15)}}
@keyframes tlw-wave{0%,100%{transform:skewY(-8deg) scaleX(.94)}50%{transform:skewY(8deg) scaleX(1.04)}}
@keyframes tlw-cross{from{transform:translateX(var(--from,0px))}to{transform:translateX(var(--to,-1600px))}}
@keyframes tlw-race{0%{transform:translateX(var(--from))}60%,100%{transform:translateX(var(--to))}}
@keyframes tlw-batpath{0%{transform:translate(var(--from),0)}25%{transform:translate(calc(var(--from) * .75 + var(--to) * .25),-40px)}50%{transform:translate(calc((var(--from) + var(--to)) * .5),10px)}75%{transform:translate(calc(var(--from) * .25 + var(--to) * .75),-30px)}100%{transform:translate(var(--to),0)}}
@keyframes tlw-flap{50%{transform:scaleY(.35)}}
@keyframes tlw-rise{0%{transform:translate(0,0) scale(.6);opacity:0}12%{opacity:var(--o,.8)}100%{transform:translate(var(--dx,0px),var(--dy,-300px)) scale(var(--sc,1.6));opacity:0}}
@keyframes tlw-ping{0%{transform:scale(.05);opacity:.8}100%{transform:scale(1);opacity:0}}
@keyframes tlw-pitch{0%,100%{transform:rotate(-1.2deg)}50%{transform:rotate(1.6deg)}}
@keyframes tlw-blink{0%{opacity:1}50%{opacity:.1}}
@keyframes tlw-shoot{0%,88%{transform:translate(0,0);opacity:0}89%{opacity:1}96%{transform:translate(-260px,100px);opacity:0}100%{opacity:0}}
@keyframes tlw-rock{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes tlw-billow{50%{transform:scale(1.04,.98)}}
@keyframes tlw-lightning{0%,86%,88.5%,91%,100%{opacity:0}87%{opacity:1}90%{opacity:.7}}
@keyframes tlw-rain{from{transform:translate(0,0)}to{transform:translate(-315px,900px)}}
@keyframes tlw-snow{from{transform:translate(0,0)}to{transform:translate(-60px,900px)}}
@keyframes tlw-drip{0%,60%{transform:translateY(0);opacity:0}62%{opacity:.9}100%{transform:translateY(var(--dy));opacity:0}}
@keyframes tlw-flicker{0%,100%{opacity:1}12%{opacity:.82}20%{opacity:.95}33%{opacity:.76}47%{opacity:1}61%{opacity:.86}78%{opacity:.97}88%{opacity:.8}}
@keyframes tlw-flick{0%,100%{transform:scale(1,1)}25%{transform:scale(.93,1.08)}50%{transform:scale(1.06,.92)}75%{transform:scale(.96,1.05)}}
@keyframes tlw-burn{0%,62%,100%{transform:scale(0);opacity:0}66%{transform:scale(1.15);opacity:1}82%{transform:scale(.9);opacity:.9}92%{transform:scale(.3);opacity:0}}
@keyframes tlw-room{0%,30%,100%{opacity:1}36%,64%{opacity:0}70%{opacity:1}}
@keyframes tlw-owl{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes tlw-sweep{0%,100%{transform:rotate(calc(var(--a,20deg) * -1))}50%{transform:rotate(var(--a,20deg))}}
@keyframes tlw-burst{0%,8%{transform:scale(0);opacity:0}10%{opacity:1}35%{transform:scale(1);opacity:.9}55%,100%{transform:scale(1.15);opacity:0}}
@keyframes tlw-chase{0%{opacity:1}33%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.tlw *{animation:none!important}.tlw .fx{display:none}}
`;
let styled = false;
function ensureStyle(){ if (styled || typeof document === 'undefined') return; styled = true; const st = document.createElement('style'); st.id = 'tlw-style'; st.textContent = CSS; document.head.appendChild(st); }
function scene(id){ ensureStyle(); const w = (WORLDS[id] || WORLDS.rome)();
  return '<svg class="tlw tlw-' + id + '" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>' + w.defs + '</defs>' + w.body + '</svg>'; }

window.TL_WORLDS = { scene, ids: Object.keys(WORLDS) };
})();
