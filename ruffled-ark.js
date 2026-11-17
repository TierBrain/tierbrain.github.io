/* Ruffled Feathers: The Ark.
   A Bible scene for the same tournament: ten birds named in the King James Bible, their calls,
   the flood scenery, and the Bible questions that live outside bible-bank.js.
   Used by ruffled-feathers.html (the TV) and ruffled-play.html (the phones). */
(function(){
'use strict';

/* each player's bird, in player order; the scarf keeps the player's colour from the table */
const BIRDS = [
  { name: 'Dove', ref: 'Genesis 8:11', line: 'and, lo, in her mouth was an olive leaf pluckt off',
    body: ['#efece7', '#cbc5bd'], breast: ['#f4e6e1', '#e2cdc5', '#cdb4aa'], belly: '#f7f4ef', wing: '#d3cdc5', wl: '#8f8880', tail: ['#bdb6ad', '#a39b92'], beak: ['#c98a80', '#7a5550'], legs: '#d77b78', bars: '#77706a', ring: '#e48a5a' },
  { name: 'Raven', ref: 'Genesis 8:7', line: 'he sent forth a raven, which went forth to and fro',
    body: ['#2f3542', '#14171e'], breast: ['#3c4456', '#262b37', '#191d26'], belly: '#20242d', wing: '#1b1f28', wl: '#3f4a64', tail: ['#1a1d25', '#101218'], beak: ['#15171c', '#0b0c0f'], legs: '#2a2a2e', beakShape: 'stout', sheen: true, brow: '#9aa3b8' },
  { name: 'Sparrow', ref: 'Psalm 84:3', line: 'Yea, the sparrow hath found an house',
    body: ['#a57b4f', '#7a5634'], breast: ['#cfc8bd', '#b4ab9f', '#9a9185'], belly: '#e6e0d6', wing: '#8a5f38', wl: '#3a2818', tail: ['#6e5236', '#5c432c'], beak: ['#3a2e26', '#241a14'], legs: '#b98d6c', beakShape: 'stout', cap: '#8e8a86', wingbar: true, cheek: true },
  { name: 'Swallow', ref: 'Psalm 84:3', line: 'and the swallow a nest for herself',
    body: ['#2a3c6c', '#152043'], breast: ['#f4e9d6', '#eadcc4', '#dccbb0'], belly: '#f6eedf', wing: '#1a2648', wl: '#33467a', tail: ['#1a2648', '#121b36'], beak: ['#1b1b20', '#0e0e12'], legs: '#4a3f3a', throat: '#b8322a', tailShape: 'fork' },
  { name: 'Eagle', ref: 'Isaiah 40:31', line: 'they shall mount up with wings as eagles',
    body: ['#6e4c2e', '#3f2a19'], breast: ['#8c6440', '#6c4a2c', '#553820'], belly: '#5a3d24', wing: '#4b321e', wl: '#2c1d10', tail: ['#4b321e', '#36230f'], beak: ['#f2c230', '#2a2018'], legs: '#f2c230', beakShape: 'hook', nape: '#d9a44a' },
  { name: 'Stork', ref: 'Jeremiah 8:7', line: 'the stork in the heaven knoweth her appointed times',
    body: ['#fbfaf7', '#e2ded6'], breast: ['#fdfcfa', '#f1eee8', '#e3dfd6'], belly: '#ffffff', wing: '#1f2026', wl: '#4a4c55', tail: ['#f4f2ee', '#dcd8d0'], beak: ['#e04a2c', '#b8361e'], legs: '#e04a2c', beakShape: 'long' },
  { name: 'Pelican', ref: 'Psalm 102:6', line: 'I am like a pelican of the wilderness',
    body: ['#f6f3ee', '#dcd6cc'], breast: ['#fbf3e2', '#f0e2c6', '#e2cfa8'], belly: '#fbf8f2', wing: '#c9c3b9', wl: '#2a2a30', tail: ['#d6d0c6', '#bdb6aa'], beak: ['#f0b03c', '#e8892c'], legs: '#9a9aa2', beakShape: 'pouch', wingtips: '#2a2a30' },
  { name: 'Owl', ref: 'Psalm 102:6', line: 'I am like an owl of the desert',
    body: ['#b07a42', '#7c5228'], breast: ['#e8cfa0', '#d6b47c', '#c39a5e'], belly: '#ead6ae', wing: '#8d5d30', wl: '#4e3218', tail: ['#7c5228', '#5f3e1e'], beak: ['#5b5550', '#3a3430'], legs: '#d8c49e', beakShape: 'tiny', owl: true },
  { name: 'Peacock', ref: '1 Kings 10:22', line: 'bringing gold, and silver, ivory, and apes, and peacocks',
    body: ['#2a6fd0', '#143f8a'], breast: ['#3a86e6', '#2464c4', '#174a9a'], belly: '#1d58b0', wing: '#2b8a64', wl: '#155a3e', tail: ['#2f8f5f', '#1f6e48'], beak: ['#8a8a90', '#5f5f66'], legs: '#8a8a90', crest: true, tailShape: 'train' },
  { name: 'Quail', ref: 'Exodus 16:13', line: 'at even the quails came up, and covered the camp',
    body: ['#a07c52', '#6e5236'], breast: ['#e2c493', '#cfa774', '#b88d58'], belly: '#ead7b2', wing: '#7e5c3a', wl: '#3e2a18', tail: ['#6e5236', '#5c432c'], beak: ['#4a3a2c', '#2e231a'], legs: '#d9b48a', beakShape: 'stout', speckle: true }];

const CROWN = '<g class="r-crown"><path d="M104 42 L110 12 L125 31 L137 6 L149 31 L164 12 L168 43 Z" fill="#f6c93a" stroke="#b8860b" stroke-width="3" stroke-linejoin="round"/><circle cx="137" cy="12" r="4" fill="#e2582c"/><circle cx="111" cy="17" r="3" fill="#3b82f6"/><circle cx="163" cy="17" r="3" fill="#22a36a"/></g>';
const LEAF = '<g class="r-leaf"><path d="M176 92 Q186 104 192 118" stroke="#4b6b2e" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M182 100 Q200 90 210 103 Q196 111 182 100 Z" fill="#7a9a3e"/><path d="M189 111 Q206 111 208 128 Q195 124 189 111 Z" fill="#5f8a34"/></g>';

let n = 0;
/* the same parts as the robin (body, tail, wing, eye, jaw, scarf, crown), so every animation still applies */
function bird(i, scarf, opts){
  opts = opts || {}; const s = BIRDS[((i % BIRDS.length) + BIRDS.length) % BIRDS.length];
  const id = 'ark' + (++n), d = (-(n * 0.77) % 5).toFixed(2);
  let tail = '<g class="r-tail"><path d="M46 116 Q6 108 2 136 Q30 140 54 132 Z" fill="' + s.tail[0] + '"/><path d="M52 124 Q18 130 12 152 Q40 148 60 136 Z" fill="' + s.tail[1] + '"/></g>';
  if (s.tailShape === 'fork') tail = '<g class="r-tail"><path d="M48 116 L-4 104 L22 126 L-2 150 L56 134 Z" fill="' + s.tail[0] + '"/><path d="M50 122 L14 128" stroke="' + s.wl + '" stroke-width="2"/></g>';
  if (s.tailShape === 'train') { let eyes = ''; [[14, 130], [2, 152], [26, 160], [8, 176], [34, 182]].forEach(([x, y]) => { eyes += '<ellipse cx="' + x + '" cy="' + y + '" rx="9" ry="7" fill="#2b9a5c"/><ellipse cx="' + x + '" cy="' + y + '" rx="5.5" ry="4.5" fill="#d9a23a"/><ellipse cx="' + x + '" cy="' + y + '" rx="3" ry="2.6" fill="#173f8f"/>'; });
    tail = '<g class="r-tail"><path d="M52 112 Q-10 120 -6 186 Q20 200 48 194 Q70 160 64 132 Z" fill="' + s.tail[1] + '"/><path d="M52 118 Q8 136 0 180 M56 126 Q26 150 18 192 M60 132 Q44 160 40 194" stroke="#174f36" stroke-width="2.5" fill="none"/>' + eyes + '</g>'; }
  const legs = '<path d="M92 160 L86 193 M112 160 L116 193 M76 194 L97 194 M107 194 L128 194" stroke="' + s.legs + '" stroke-width="5" stroke-linecap="round" fill="none"/>';
  let beak = '<path d="M162 81 L186 87 L162 89 Z" fill="' + s.beak[0] + '"/><path class="r-jaw" d="M162 88 L182 89 L162 95 Z" fill="' + s.beak[1] + '"/>';
  if (s.beakShape === 'stout') beak = '<path d="M160 78 Q178 82 188 89 L160 91 Z" fill="' + s.beak[0] + '"/><path class="r-jaw" d="M160 90 L184 90 Q172 98 160 98 Z" fill="' + s.beak[1] + '"/>';
  if (s.beakShape === 'hook') beak = '<path d="M158 74 Q182 72 192 86 Q194 96 186 98 Q186 90 176 88 L158 92 Z" fill="' + s.beak[0] + '"/><path d="M186 98 Q194 96 192 86" stroke="' + s.beak[1] + '" stroke-width="4" fill="none"/><path class="r-jaw" d="M160 92 L180 92 L160 100 Z" fill="#d9a72a"/>';
  if (s.beakShape === 'long') beak = '<path d="M160 80 L216 90 L160 90 Z" fill="' + s.beak[0] + '"/><path class="r-jaw" d="M160 90 L214 91 L160 97 Z" fill="' + s.beak[1] + '"/>';
  if (s.beakShape === 'pouch') beak = '<path d="M158 78 L216 85 L214 91 L158 90 Z" fill="' + s.beak[0] + '"/><path class="r-jaw" d="M158 90 L214 91 Q198 126 174 122 Q158 116 158 104 Z" fill="' + s.beak[1] + '" opacity=".92"/><path d="M212 85 L218 91 L210 91 Z" fill="#c0402a"/>';
  if (s.beakShape === 'tiny') beak = '<path d="M150 88 Q160 90 156 104 Q150 98 148 92 Z" fill="' + s.beak[0] + '"/><path class="r-jaw" d="M150 98 Q154 100 155 104 Q151 102 150 98 Z" fill="' + s.beak[1] + '"/>';
  let inside = '', above = '';
  if (s.cap) inside += '<path d="M100 56 Q130 34 162 62 Q146 54 128 58 Q112 62 100 56 Z" fill="' + s.cap + '"/>';
  if (s.cheek) inside += '<path d="M110 70 Q130 92 158 92" stroke="#efe9de" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>';
  if (s.throat) inside += '<path d="M160 90 Q166 104 154 112 Q142 110 144 96 Z" fill="' + s.throat + '"/><path d="M136 118 Q152 116 162 106" stroke="#1d2b55" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M156 74 Q162 76 163 84 Q158 82 155 78 Z" fill="' + s.throat + '"/>';
  if (s.nape) inside += '<path d="M96 60 Q130 40 160 60 Q150 74 126 74 Q104 74 96 60 Z" fill="' + s.nape + '" opacity=".85"/>';
  if (s.sheen) inside += '<path d="M76 70 Q110 52 150 64" stroke="#5a6a96" stroke-width="4" fill="none" opacity=".55" stroke-linecap="round"/>';
  if (s.owl) { inside += '<ellipse cx="138" cy="82" rx="30" ry="28" fill="#f0dfbf"/><path d="M110 80 Q138 52 166 82" stroke="#8d5d30" stroke-width="4" fill="none"/>'; above += '<path d="M104 52 L96 20 L122 46 Z M150 50 L166 22 L166 56 Z" fill="' + s.body[1] + '"/>'; }
  if (s.speckle) { [[120, 110], [136, 120], [150, 106], [126, 130], [144, 136], [112, 126], [158, 122]].forEach(([x, y]) => { inside += '<path d="M' + x + ' ' + y + ' q3 4 0 8" stroke="#6e5236" stroke-width="3" fill="none" stroke-linecap="round"/>'; });
    inside += '<path d="M112 60 Q140 50 166 72" stroke="#f1e3c4" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M118 52 Q140 40 160 54" stroke="#3e2a18" stroke-width="7" fill="none" stroke-linecap="round"/>'; }
  if (s.crest) { [[124, 6], [136, 0], [148, 4]].forEach(([x, y]) => { above += '<path d="M138 48 L' + x + ' ' + (y + 10) + '" stroke="#1d4f9e" stroke-width="2.5"/><ellipse cx="' + x + '" cy="' + (y + 8) + '" rx="5" ry="6" fill="#2f8f5f"/><circle cx="' + x + '" cy="' + (y + 8) + '" r="2.4" fill="#173f8f"/>'; });
    inside += '<path d="M126 70 Q140 64 156 72" stroke="#fff" stroke-width="3.5" fill="none" opacity=".9"/>'; }
  const wing = '<g class="r-wing"><path d="M58 96 Q86 86 106 112 Q94 142 58 138 Q44 116 58 96 Z" fill="' + s.wing + '"/><path d="M64 110 Q84 110 97 123 M62 121 Q78 122 89 131" stroke="' + s.wl + '" stroke-width="3" fill="none" stroke-linecap="round"/>'
    + (s.bars ? '<path d="M70 104 l8 4 M82 106 l7 5 M68 118 l8 3" stroke="' + s.bars + '" stroke-width="4" stroke-linecap="round"/>' : '')
    + (s.wingbar ? '<path d="M62 106 Q82 100 100 114" stroke="#f4efe6" stroke-width="4" fill="none" stroke-linecap="round"/>' : '')
    + (s.wingtips ? '<path d="M58 124 Q66 136 86 138 Q70 140 56 134 Z" fill="' + s.wingtips + '"/>' : '') + '</g>';
  const eye = s.owl ? '<g class="r-eye"><circle cx="140" cy="80" r="13" fill="#f2a81c"/><circle cx="140" cy="80" r="8" fill="#1d130e"/><circle cx="143" cy="76.5" r="3" fill="#fff"/></g>'
    : '<g class="r-eye"><circle cx="138" cy="76" r="9.5" fill="#1d130e"/>' + (s.ring ? '<circle cx="138" cy="76" r="11.5" fill="none" stroke="' + s.ring + '" stroke-width="2.5"/>' : '') + '<circle cx="141.5" cy="72.5" r="3.2" fill="#fff"/></g>';
  const brow = opts.cross ? '<path d="M122 64 L147 72" stroke="' + (s.brow || '#2a1a12') + '" stroke-width="5.5" stroke-linecap="round"/>' : '';
  return '<svg class="rb ark-bird" data-bird="' + s.name + '" style="--d:' + d + 's;overflow:visible" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>'
   + '<radialGradient id="' + id + 'a" cx=".66" cy=".34" r=".8"><stop offset="0" stop-color="' + s.breast[0] + '"/><stop offset=".6" stop-color="' + s.breast[1] + '"/><stop offset="1" stop-color="' + s.breast[2] + '"/></radialGradient>'
   + '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.body[0] + '"/><stop offset="1" stop-color="' + s.body[1] + '"/></linearGradient>'
   + '<clipPath id="' + id + 'c"><ellipse cx="102" cy="108" rx="66" ry="60"/></clipPath></defs>'
   + tail + legs
   + '<g class="r-body"><ellipse cx="102" cy="108" rx="66" ry="60" fill="url(#' + id + 'b)"/>'
   + '<g clip-path="url(#' + id + 'c)"><ellipse cx="134" cy="102" rx="48" ry="50" fill="url(#' + id + 'a)"/><ellipse cx="108" cy="162" rx="56" ry="28" fill="' + s.belly + '"/><ellipse cx="84" cy="66" rx="40" ry="18" fill="#fff" opacity=".1"/>' + inside + '</g>'
   + above + wing + eye + brow + beak
   + '<path d="M74 132 Q104 150 152 128 L156 142 Q106 166 72 146 Z" fill="' + scarf + '"/><path d="M74 132 Q104 150 152 128" stroke="rgba(255,255,255,.35)" stroke-width="2.5" fill="none"/>'
   + '<g class="r-scarf"><path d="M84 142 L78 178 L93 178 L97 146 Z" fill="' + scarf + '"/><path d="M80 168 L94 168 M80.5 173 L93.5 173" stroke="rgba(0,0,0,.28)" stroke-width="2"/></g>'
   + (opts.crown ? CROWN + LEAF : '') + '</g></svg>';
}

/* each bird's own call, built from the game's sound helpers: h = { tone, syll, flutter } */
const CALLS = [
  (h, t, v) => { h.tone(520, t, .2, v * 1.3, 'triangle', 610); h.tone(610, t + .24, .34, v * 1.5, 'triangle', 470); h.tone(470, t + .64, .26, v * 1.1, 'triangle', 430); },   // dove: coo-COO-coo
  (h, t, v) => { h.tone(330, t, .2, v * .45, 'sawtooth', 250); h.tone(310, t + .28, .22, v * .45, 'sawtooth', 230); },                                                      // raven: kraa, kraa
  (h, t, v) => { h.syll(t, 3000, 3600, .07, v); h.syll(t + .12, 3150, 3750, .07, v); h.syll(t + .24, 2900, 3500, .08, v); },                                                  // sparrow: cheep-cheep-cheep
  (h, t, v) => { [0, .05, .1, .15, .2, .25].forEach((x, k) => h.syll(t + x, k % 2 ? 4400 : 3800, k % 2 ? 4000 : 4500, .04, v * .9)); },                                      // swallow: twitter
  (h, t, v) => { h.syll(t, 3400, 2300, .34, v); h.syll(t + .4, 3200, 2200, .24, v * .8); },                                                                                  // eagle: a falling scream
  (h, t, v) => { h.flutter(t, 7); h.flutter(t + .62, 5); },                                                                                                                   // stork: bill-clatter
  (h, t, v) => { h.tone(230, t, .26, v * .9, 'triangle', 170); h.tone(210, t + .32, .3, v * .9, 'triangle', 160); },                                                       // pelican: a low grunt
  (h, t, v) => { h.tone(430, t, .32, v * 1.4, 'sine', 400); h.tone(430, t + .46, .14, v * 1.1, 'sine', 415); h.tone(415, t + .66, .38, v * 1.4, 'sine', 380); },            // owl: hoo, hoo-hoo
  (h, t, v) => { h.syll(t, 900, 1550, .18, v * 1.1); h.syll(t + .22, 1550, 1050, .34, v * 1.1); },                                                                            // peacock: may-AWE
  (h, t, v) => { h.syll(t, 2200, 2650, .06, v); h.syll(t + .17, 2450, 2950, .06, v); h.syll(t + .27, 2450, 2950, .06, v); }];                                                 // quail: wet-my-lips
function call(i, h, t, v){ CALLS[((i % CALLS.length) + CALLS.length) % CALLS.length](h, t || 0, v || .2); }

/* the scenery behind the game: Ararat, the waters and the ark at sunset (viewBox 0 0 1600 340).
   Layers: the land (hidden by the flood), the sea behind the ark, the ark, the waves in front.
   The two water layers go down as the round goes on: the olive tree's top breaks the surface first
   ("the tops of the mountains seen", Genesis 8:5), and at the end the waters drain to a strip of shore
   and the ark rests on dry ground. */
const WAVES = (y, step) => { let p = 'M0 ' + y; for (let x = 0; x < 1700; x += step * 2) p += ' Q' + (x + step / 2) + ' ' + (y - 10) + ' ' + (x + step) + ' ' + y + ' T' + (x + step * 2) + ' ' + y; return p; };
const OLIVE = (x, y, k) => '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')">'
  + '<path d="M-4 0 Q-7 -18 -2 -30 Q0 -20 6 -34 Q4 -16 4 0 Z" fill="#5b4330"/>'
  + '<ellipse cx="0" cy="-42" rx="28" ry="15" fill="#5f7f34"/><ellipse cx="-18" cy="-34" rx="16" ry="10" fill="#6d8f3a"/><ellipse cx="18" cy="-35" rx="17" ry="10" fill="#6d8f3a"/>'
  + '<ellipse cx="4" cy="-50" rx="18" ry="9" fill="#7a9a44"/>'
  + '<path d="M-20 -38 l6 -2 M-6 -46 l7 -1 M10 -42 l6 -2 M20 -33 l5 -2 M-12 -30 l6 -1" stroke="#c3cfa8" stroke-width="3" stroke-linecap="round" opacity=".8"/></g>';
const LANDTOP = 'M0 262 Q200 244 380 252 Q520 258 640 246 Q760 234 850 230 L1290 230 Q1400 238 1500 252 Q1560 260 1600 256';
const SCENERY = '<defs><linearGradient id="arkSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f4f86"/><stop offset="1" stop-color="#1d2752"/></linearGradient>'
  + '<linearGradient id="arkGlint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".75"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></linearGradient>'
  + '<linearGradient id="arkGrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f8c45"/><stop offset="1" stop-color="#3f5a2c"/></linearGradient></defs>'
  + '<path d="M60 210 L250 70 L330 130 L400 90 L620 210 Z" fill="#5a4a74" opacity=".75"/><path d="M250 70 L285 96 L262 100 L240 88 Z M400 90 L425 106 L404 110 Z" fill="#e8dbe6" opacity=".8"/>'
  + '<g id="arkLand"><path d="' + LANDTOP + ' V340 H0 Z" fill="url(#arkGrass)"/>'
  + '<path d="' + LANDTOP + '" stroke="#9cb866" stroke-width="3" fill="none" opacity=".7"/>'
  + '<path d="M0 292 Q180 278 360 286 Q560 296 760 282 Q980 268 1200 280 Q1420 292 1600 282 V340 H0 Z" fill="#4a6833"/>'
  + OLIVE(470, 256, 1) + OLIVE(1430, 246, .8) + OLIVE(640, 248, .55)
  + [[300, 276, '#f3d36b'], [338, 284, '#f6a5a0'], [560, 270, '#f3d36b'], [700, 262, '#fff1c9'], [1340, 262, '#f6a5a0'], [1500, 270, '#f3d36b'], [1050, 300, '#fff1c9'], [180, 300, '#f6a5a0']]
      .map(([x, y, c]) => '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + c + '"/>').join('') + '</g>'
  + '<g id="arkWaters" class="tide"><path d="' + WAVES(196, 100) + ' V420 H0 Z" fill="url(#arkSea)"/></g>'
  + '<g id="arkBoat" transform="translate(860 112)"><path d="M0 74 Q20 112 70 116 L330 116 Q380 112 400 70 L360 78 L40 78 Z" fill="#4a2f1e"/>'
  + '<path d="M10 84 L392 84 M18 96 L384 96 M34 106 L366 106" stroke="#35200f" stroke-width="3"/>'
  + '<rect x="90" y="30" width="220" height="48" fill="#5e3d27"/><path d="M76 34 L200 0 L324 34 Z" fill="#3b2516"/>'
  + [112, 160, 216, 264].map(x => '<rect class="glow" x="' + x + '" y="44" width="22" height="16" rx="2" fill="#ffc96a"/>').join('') + '</g>'
  + '<g id="arkFront" class="tide"><path d="' + WAVES(224, 80) + ' V420 H0 Z" fill="#2b386a"/>'
  + '<g class="glint"><path d="M1180 200 L1400 200 L1360 330 L1220 330 Z" fill="url(#arkGlint)" opacity=".5"/>'
  + '<path d="M1200 214 h60 M1290 236 h80 M1230 262 h50 M1320 284 h70 M1250 306 h40" stroke="#ffd9a0" stroke-width="4" stroke-linecap="round" opacity=".7"/></g>'
  + '<path d="' + WAVES(262, 60) + ' V420 H0 Z" fill="#1f2a56"/>'
  + '<path d="' + WAVES(262, 60) + '" stroke="#8ea0d8" stroke-width="3" fill="none" opacity=".35"/></g>';
/* "I do set my bow in the cloud" (Genesis 9:13): drawn over the whole sky (viewBox 0 0 1600 900) */
const BOW = ['#e8545a', '#f39a3c', '#f6d24a', '#5cbf6a', '#4a8fe0', '#6a5ad0', '#9a5ac8'].map((c, i) => { const R = 760 - i * 22;
  return '<path d="M' + (800 - R) + ' 1000 A' + R + ' ' + R + ' 0 0 1 ' + (800 + R) + ' 1000" stroke="' + c + '" stroke-width="22" fill="none"/>'; }).join('');

/* questions: every Bible question on TierBrain that is not already in bible-bank.js.
   First Finger Bible's sets (ff-sets-bible.js) give four answers and several questions each, so each
   question becomes a four-option question as it stands; fix a fact there and it is fixed here too. */
const MORE = [
  [1, 'Christianity is based on the life and teachings of whom?', 'Jesus', ['Muhammad', 'Moses', 'the Buddha']],                 // religion-quiz.html
  [1, 'What is the main holy book of Christianity?', 'The Bible', ['The Quran', 'The Torah', 'The Tripitaka']],                  // religion-quiz.html
  [1, 'Christmas celebrates the birth of whom?', 'Jesus', ['Moses', 'Muhammad', 'Abraham']],                                    // religion-quiz.html
  [1, 'Easter celebrates the resurrection of whom?', 'Jesus', ['Mary', 'Peter', 'Paul']],                                       // religion-quiz.html
  [2, "Passover commemorates the Israelites' escape from slavery in which land?", 'Egypt', ['Babylon', 'Persia', 'Rome']],       // religion-quiz.html
  [3, 'Who was the first person recorded as filled with the Spirit for craftsmanship?', 'Bezalel', ['Oholiab', 'Hiram', 'Aaron']], // throne-bible.html
  [2, 'Guess it: David longed to build me but could not. His son completed the work. Gold and cedar filled my rooms.', 'The Temple', ['The Tabernacle', 'The Synagogue', "Solomon's Palace"]]]; // throne-bible.html
const key = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let merged = null;
/* bible-bank.js, plus First Finger Bible (Medium) and the seven above, without repeats */
function bible(){
  if (merged) return merged;
  const base = window.TB_BIBLE || {}, out = {}, have = new Set();
  Object.keys(base).forEach(t => { out[t] = (base[t] || []).slice(); out[t].forEach(q => have.add(key(q.q))); });
  const add = (t, q) => { if (!q || have.has(key(q.q))) return; have.add(key(q.q)); (out[t] = out[t] || []).push(q); };
  (window.FF_SETS || []).forEach(set => (set.q || []).forEach(([q, a]) => { if ((set.a || []).length === 4 && set.a.includes(a)) add('2', { q, correct: a, wrong: set.a.filter(x => x !== a) }); }));
  MORE.forEach(([t, q, correct, wrong]) => add(String(t), { q, correct, wrong }));
  if (window.TB_BIBLE) merged = out;
  return out;
}

window.RF_ARK = { BIRDS, bird, call, SCENERY, BOW, bible };
})();
