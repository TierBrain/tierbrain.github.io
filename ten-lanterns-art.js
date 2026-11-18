/* Ten Lanterns: the ten districts and their miniature worlds.
   Each miniature is drawn in a 120 x 120 box centred on 0,0 (-60..60), so the same drawing fills a lantern
   window on the dial and, scaled up, the backdrop of that district's round. Invented places only: no real
   cities or landmarks, except Ancient Rome. */
(function(){
'use strict';

const DISTRICTS = [
  { id: 'rome', name: 'Ancient Rome', line: 'The chariot track under a hot sky', sky: ['#f7b56a', '#b8452c'] },
  { id: 'submarine', name: 'The submarine', line: 'Running deep, the sonar pinging', sky: ['#1d5a86', '#081b33'] },
  { id: 'flight', name: 'The night flight', line: 'A 1930s airliner above the clouds', sky: ['#1a3570', '#0a1330'] },
  { id: 'railway', name: 'The mountain railway', line: 'A steam train through the peaks at night', sky: ['#4a3a7e', '#17132f'] },
  { id: 'galleon', name: 'The galleon', line: 'A sailing ship in a storm', sky: ['#3d6670', '#0e2329'] },
  { id: 'cave', name: 'The Ice Age cave', line: 'Firelight on a painted wall', sky: ['#5a3a26', '#1c120c'] },
  { id: 'balloon', name: 'The hot air balloon', line: 'Drifting over fields and rivers', sky: ['#8fd0f4', '#e8f6ff'] },
  { id: 'manor', name: 'The manor at midnight', line: 'Candles, portraits and thunder', sky: ['#33265a', '#0d0a1c'] },
  { id: 'bigtop', name: 'The big top', line: 'A 1900s circus tent at dusk', sky: ['#2a2f66', '#11143a'] },
  { id: 'city', name: 'Smoke City', line: 'Art deco towers and searchlights', sky: ['#1c1f44', '#4a2f52'] }];

/* gradients for one svg; p keeps ids apart when several drawings share a page */
function defs(p){
  return DISTRICTS.map(d => '<linearGradient id="' + p + '-sky-' + d.id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + d.sky[0] + '"/><stop offset="1" stop-color="' + d.sky[1] + '"/></linearGradient>').join('')
    + '<radialGradient id="' + p + '-fire" cx=".5" cy=".85" r=".7"><stop offset="0" stop-color="#ffb347" stop-opacity=".95"/><stop offset=".45" stop-color="#d9622b" stop-opacity=".55"/><stop offset="1" stop-color="#2a170d" stop-opacity="0"/></radialGradient>';
}
const sky = (p, id) => '<rect x="-60" y="-60" width="120" height="120" fill="url(#' + p + '-sky-' + id + ')"/>';
const range = (a, b, s) => { const out = []; for (let x = a; x <= b; x += s) out.push(x); return out; };

const ART = {
  rome: p => sky(p, 'rome')
    + '<circle cx="26" cy="-28" r="12" fill="#ffe3a3" opacity=".9"/>'
    + '<rect x="-60" y="-10" width="120" height="70" fill="#e6c18a"/><rect x="-60" y="-12" width="120" height="4" fill="#c99d68"/>'
    + range(-52, 52, 14).map(x => '<path d="M' + (x - 5) + ' 10 V2 a5 5 0 0 1 10 0 V10Z" fill="#9a6a46"/>').join('')
    + '<rect x="-60" y="12" width="120" height="3" fill="#c99d68"/>'
    + range(-48, 48, 24).map(x => '<path d="M' + (x - 8) + ' 60 V32 a8 8 0 0 1 16 0 V60Z" fill="#7c4f33"/>').join('')
    + '<path d="M-60 50 H60" stroke="#c99d68" stroke-width="2"/>',
  submarine: p => sky(p, 'submarine')
    + '<path d="M-30 -60 L-10 -60 L10 60 L-20 60Z" fill="#fff" opacity=".06"/><path d="M14 -60 L26 -60 L40 60 L20 60Z" fill="#fff" opacity=".05"/>'
    + '<ellipse cx="0" cy="10" rx="44" ry="13" fill="#3b4b5a"/><rect x="-12" y="-12" width="22" height="16" rx="5" fill="#3b4b5a"/>'
    + '<path d="M4 -12 V-26 H12" stroke="#3b4b5a" stroke-width="3" fill="none" stroke-linecap="round"/>'
    + range(-26, 22, 12).map(x => '<circle cx="' + x + '" cy="10" r="3.2" fill="#ffd27a"/>').join('')
    + '<path d="M43 10 l9 -7 v14z" fill="#2c3842"/>'
    + [[-48, -8, 2.5], [-43, -20, 2], [-38, -31, 1.6], [-50, -36, 1.3]].map(([x, y, r]) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="#a8dcff" stroke-width="1"/>').join(''),
  flight: p => sky(p, 'flight')
    + [[-44, -40], [-20, -48], [8, -38], [-34, -18], [44, -10], [22, -50]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="1.1" fill="#fff" opacity=".8"/>').join('')
    + '<circle cx="34" cy="-32" r="10" fill="#fff2c4"/><circle cx="39" cy="-35" r="9" fill="#14285a"/>'
    + '<ellipse cx="-20" cy="46" rx="40" ry="10" fill="#fff" opacity=".18"/><ellipse cx="30" cy="50" rx="36" ry="9" fill="#fff" opacity=".14"/>'
    + '<path d="M-6 3 L16 3 L-4 26 L-15 26Z" fill="#a9b5cc"/><path d="M-40 -5 L-49 -21 L-37 -21 L-30 -5Z" fill="#a9b5cc"/>'
    + '<path d="M-46 0 Q-50 -5 -40 -6 L34 -6 Q47 -6 51 0 Q47 6 34 6 L-40 6 Q-50 5 -46 0Z" fill="#cdd6e8"/>'
    + range(-30, 30, 8).map(x => '<rect x="' + x + '" y="-3" width="4" height="3" rx="1" fill="#ffd27a"/>').join(''),
  railway: p => sky(p, 'railway')
    + '<circle cx="-34" cy="-34" r="7" fill="#f4ecd0" opacity=".85"/>'
    + '<path d="M-60 32 L-32 -18 L-12 10 L18 -30 L60 22 V60 H-60Z" fill="#2a2452"/>'
    + '<path d="M-32 -18 L-26 -8 L-38 -8Z M18 -30 L26 -18 L10 -18Z" fill="#e8e6f4" opacity=".85"/>'
    + '<rect x="-60" y="38" width="120" height="22" fill="#5a4a3c"/><rect x="-60" y="35" width="120" height="4" fill="#6e5c4a"/>'
    + range(-50, 50, 20).map(x => '<path d="M' + (x - 7) + ' 60 V50 a7 7 0 0 1 14 0 V60Z" fill="#17132f"/>').join('')
    + '<rect x="-40" y="22" width="24" height="13" rx="2" fill="#262626"/><rect x="-37" y="14" width="5" height="9" fill="#262626"/><rect x="-24" y="16" width="8" height="19" fill="#303030"/>'
    + '<rect x="-12" y="24" width="22" height="11" rx="1.5" fill="#7a2f2f"/><rect x="13" y="24" width="22" height="11" rx="1.5" fill="#7a2f2f"/>'
    + [-9, -3, 3, 16, 22, 28].map(x => '<rect x="' + x + '" y="27" width="4" height="4" fill="#ffd27a"/>').join('')
    + [[-35, 6, 5], [-29, -2, 6], [-19, -8, 7]].map(([x, y, r]) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#e9e6f2" opacity=".55"/>').join(''),
  galleon: p => sky(p, 'galleon')
    + '<ellipse cx="-24" cy="-44" rx="30" ry="10" fill="#5d7c84" opacity=".7"/><ellipse cx="24" cy="-50" rx="34" ry="11" fill="#4d6a72" opacity=".7"/>'
    + '<path d="M-42 -40 L-34 -40 L-39 -30 L-33 -30 L-44 -14 L-40 -27 L-46 -27Z" fill="#ffe27a" opacity=".85"/>'
    + '<path d="M-2 -38 V18 M14 -30 V18 M-18 -26 V18" stroke="#3a2614" stroke-width="2"/>'
    + '<path d="M-14 -34 Q-6 -28 -14 -22 H6 Q-2 -28 6 -34Z M-14 -18 Q-6 -10 -14 -2 H8 Q0 -10 8 -18Z" fill="#efe6d2"/>'
    + '<path d="M4 -26 Q12 -20 4 -14 H22 Q14 -20 22 -26Z M4 -10 Q12 -2 4 6 H24 Q16 -2 24 -10Z" fill="#e5dcc6"/>'
    + '<path d="M-28 -20 Q-22 -14 -28 -8 H-10 Q-16 -14 -10 -20Z" fill="#e5dcc6"/><path d="M-2 -38 l9 3 l-9 3Z" fill="#c4442c"/>'
    + '<path d="M-36 18 L38 18 L28 32 L-28 32Z" fill="#5a3a22"/><path d="M-30 23 H32" stroke="#3d2716" stroke-width="1.5"/>'
    + '<path d="M-60 34 Q-48 26 -36 34 T-12 34 T12 34 T36 34 T60 34 V60 H-60Z" fill="#12343f"/>'
    + '<path d="M-60 44 Q-46 38 -32 44 T-4 44 T24 44 T52 44 T80 44" stroke="#9ec9d2" stroke-width="1.5" fill="none" opacity=".5"/>',
  cave: p => sky(p, 'cave')
    + '<rect x="-60" y="-60" width="120" height="120" fill="url(#' + p + '-fire)"/>'
    + '<path d="M-60 -60 H60 V-46 L50 -36 L42 -48 L32 -32 L22 -50 L10 -40 L-2 -54 L-14 -38 L-26 -50 L-38 -34 L-48 -48 L-60 -40Z" fill="#1c120c"/>'
    + '<path d="M-38 -16 Q-36 -26 -24 -26 Q-16 -30 -8 -24 Q0 -24 0 -16 L-2 -4 L-6 -4 L-6 -12 L-14 -12 L-14 -4 L-18 -4 L-18 -12 L-28 -12 L-28 -4 L-32 -4 L-32 -12 Q-40 -12 -38 -16Z M-38 -16 Q-46 -12 -44 -2" fill="none" stroke="#d27a3e" stroke-width="2.4" stroke-linejoin="round"/>'
    + '<path d="M22 -20 l2 -9 l2 9 l2 -8 l1 9 l3 -6 l-1 10 q-4 5 -9 0Z" fill="#c75f2e" opacity=".85"/>'
    + '<path d="M-14 50 Q-10 30 0 20 Q4 34 10 26 Q14 40 14 50Z" fill="#ffb347"/><path d="M-6 50 Q-4 38 2 32 Q6 42 8 50Z" fill="#ffe28a"/>'
    + '<path d="M-22 52 L22 52 M-18 56 L20 48" stroke="#3a2416" stroke-width="3" stroke-linecap="round"/>',
  balloon: p => sky(p, 'balloon')
    + '<ellipse cx="-30" cy="-36" rx="16" ry="5" fill="#fff" opacity=".8"/><ellipse cx="36" cy="-18" rx="14" ry="4" fill="#fff" opacity=".7"/>'
    + '<path d="M-60 40 Q-30 28 0 38 T60 34 V60 H-60Z" fill="#7cb85e"/><path d="M-60 50 Q-24 40 10 50 T60 46 V60 H-60Z" fill="#5f9c48"/>'
    + '<path d="M-60 46 Q-20 54 20 44" stroke="#8fd0f4" stroke-width="3" fill="none"/>'
    + '<path d="M0 -50 C30 -50 36 -16 6 12 L-6 12 C-36 -16 -30 -50 0 -50Z" fill="#e2582c"/>'
    + '<path d="M0 -50 C12 -50 14 -16 3 12 L-3 12 C-14 -16 -12 -50 0 -50Z" fill="#f0b44c"/>'
    + '<path d="M-5 12 L-6 22 M5 12 L6 22" stroke="#6b4b33" stroke-width="1.2"/><rect x="-8" y="22" width="16" height="10" rx="2" fill="#8a6545"/>',
  manor: p => sky(p, 'manor')
    + '<circle cx="28" cy="-30" r="16" fill="#fff0c8"/>'
    + '<path d="M-60 60 V40 Q-40 34 -20 40 T20 40 T60 38 V60Z" fill="#0b0816"/>'
    + '<path d="M-46 44 V2 L-36 -14 L-26 2 V-4 L-14 -30 L-2 -4 V2 H10 L20 -20 L30 2 V8 L40 -4 L50 8 V44Z" fill="#120d22"/>'
    + '<path d="M-14 -30 V-38" stroke="#120d22" stroke-width="2"/>'
    + [[-38, 10], [-18, 4], [-10, 4], [-18, 18], [16, 14], [36, 20]].map(([x, y], k) => '<rect x="' + x + '" y="' + y + '" width="5" height="8" rx="2.5" fill="' + (k % 3 ? '#4a3a6a' : '#ffcf6a') + '"/>').join('')
    + '<path d="M-56 44 Q-54 20 -48 10 M-54 26 L-60 18 M-52 18 L-46 12" stroke="#0b0816" stroke-width="2" fill="none" stroke-linecap="round"/>'
    + '<path d="M34 -50 q4 -3 8 0 q4 -3 8 0 q-4 1 -8 4 q-4 -3 -8 -4Z" fill="#0b0816"/>',
  bigtop: p => sky(p, 'bigtop')
    + [[-46, -44], [-30, -50], [40, -46], [50, -30]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="1.1" fill="#fff" opacity=".8"/>').join('')
    + range(0, 7, 1).map(k => { const a = -46 + k * 11.5, b = a + 11.5; return '<path d="M0 -34 L' + a + ' 40 L' + b + ' 40Z" fill="' + (k % 2 ? '#f6efe4' : '#c8322c') + '"/>'; }).join('')
    + '<path d="M-10 40 L0 18 L10 40Z" fill="#2a1410"/><path d="M0 -34 V-48" stroke="#e8d7b0" stroke-width="1.5"/><path d="M0 -48 l11 4 l-11 4Z" fill="#f0b44c"/>'
    + range(-40, 40, 10).map(x => '<circle cx="' + x + '" cy="' + (44 - Math.abs(x) * 0.12) + '" r="1.8" fill="#ffd96a"/>').join('')
    + '<rect x="-60" y="46" width="120" height="14" fill="#2b2014"/>',
  city: p => sky(p, 'city')
    + '<path d="M-30 60 L-58 -60 L-46 -60Z" fill="#fff" opacity=".1"/><path d="M28 60 L52 -60 L62 -60Z" fill="#fff" opacity=".08"/>'
    + '<path d="M-60 60 V20 H-50 V6 H-42 V22 H-34 V60Z M34 60 V14 H40 V2 H46 V-8 H50 V2 H56 V14 H60 V60Z" fill="#14162e"/>'
    + '<path d="M-30 60 V-4 H-26 V-14 H-22 V-4 H-18 V60Z M14 60 V8 H20 V-2 H28 V8 H32 V60Z" fill="#1d2040"/>'
    + '<path d="M-10 60 V-8 H-7 V-20 H-4 V-34 H-1 V-46 H1 V-34 H4 V-20 H7 V-8 H10 V60Z" fill="#24284c"/>'
    + [[-56, 28], [-46, 14], [-38, 30], [-28, 6], [-22, 22], [-7, -2], [3, 10], [-3, 26], [18, 16], [26, 30], [38, 20], [52, 26], [44, 6]].map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="2.6" height="2.6" fill="#ffd27a"/>').join('')
    + '<ellipse cx="-20" cy="56" rx="30" ry="8" fill="#c9b8d6" opacity=".22"/><ellipse cx="26" cy="58" rx="34" ry="8" fill="#c9b8d6" opacity=".18"/>'
};
function mini(id, p){ return (ART[id] || ART.rome)(p || 'tl'); }

/* player symbols, so colours are never the only difference: drawn in a 20 x 20 box centred on 0,0 */
const SYMBOLS = [
  'M0 -9 L2.6 -2.8 L9 -2.8 L3.8 1.2 L5.8 8 L0 4 L-5.8 8 L-3.8 1.2 L-9 -2.8 L-2.6 -2.8Z',      // star
  'M0 -8 A8 8 0 1 1 -0.01 -8Z',                                                       // circle
  'M0 -9 L8.5 7 L-8.5 7Z',                                                            // triangle
  'M0 -9 L8 0 L0 9 L-8 0Z',                                                           // diamond
  'M-7 -7 H7 V7 H-7Z',                                                                // square
  'M-2.6 -8 H2.6 V-2.6 H8 V2.6 H2.6 V8 H-2.6 V2.6 H-8 V-2.6 H-2.6Z',                  // cross
  'M0 -9 L7.8 -4.5 L7.8 4.5 L0 9 L-7.8 4.5 L-7.8 -4.5Z',                              // hexagon
  'M3 -8.5 A8.5 8.5 0 1 0 8 4 A6.5 6.5 0 1 1 3 -8.5Z',                                // moon
  'M0 8 L-7 1 A4 4 0 0 1 0 -5 A4 4 0 0 1 7 1Z',                                       // heart
  'M2 -9 L-6 2 H-0.5 L-2 9 L6 -2 H0.5Z'];                                             // bolt
const SYMBOL_NAMES = ['star', 'circle', 'triangle', 'diamond', 'square', 'cross', 'hexagon', 'moon', 'heart', 'bolt'];
function symbol(i, fill, stroke){ return '<path d="' + SYMBOLS[((i % 10) + 10) % 10] + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"' : '') + '/>'; }

window.TL_ART = { DISTRICTS, defs, mini, symbol, SYMBOL_NAMES };
})();
