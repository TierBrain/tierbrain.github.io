/* Ten Lanterns: the game inside each world.
   Every world plays its own way, built from a few shared pieces the page provides (c): a question for one
   player, an open question anyone may claim, a choice, and a pause. Each round returns who earned the lantern:
   in Solo, Daily Dial and Together, whether it was lit; in Teams and Versus, either the round's top scorer
   (with a minimum) or a named winner. Content is invented: no real people, brands or landmarks drawn. */
(function(){
'use strict';

const pick = (a, r) => a[Math.floor(r() * a.length)];
const LAST = {};   /* the last mystery and countryside, for checking */
function shuffle(a, r){ a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

/* ======================================================================= the classic round (Simple quiz) */
const classic = {
  title: 'Three questions',
  rule: c => c.multi ? 'Three questions. A miss can be stolen. The most points in the round takes the lantern.' : 'Three questions. Two right lights the lantern.',
  async play(c){ let right = 0;
    for (let k = 0; k < 3; k++) { c.count('Question ' + (k + 1) + ' of 3');
      const r = await c.question(c.drawQ(), { who: c.me, pts: 10, steal: true });
      if (r.right && !r.stolen) right++;
      await c.next(k < 2 ? 'Next question' : 'See the lantern', r.right ? 'right' : 'miss', r); }
    return { lit: right >= 2, line: right + ' of 3 right', need: 'two lights it', min: 1 }; }
};

/* ======================================================================= Smoke City: the lift race */
const ROOF = 4;
function liftStage(c, lifts, labels){
  const cols = lifts.map((f, k) => '<div class="rs-shaft"><div class="rs-floors">' + [4, 3, 2, 1, 0].map(n => '<i class="' + (n === ROOF ? 'roof' : '') + '">' + (n === ROOF ? 'Roof' : n === 0 ? 'G' : n) + '</i>').join('')
    + '<div class="rs-car" style="--f:' + f + ';--c:' + labels[k].colour + '">' + labels[k].badge + '</div></div><b>' + esc(labels[k].name) + '</b></div>').join('');
  return '<div class="rs-lifts" style="--n:' + lifts.length + '">' + cols + '</div>'; }
const city = {
  title: 'The lift race',
  rule: c => c.multi ? 'Every question is open: tap your name to answer. Right takes your lift up a floor, wrong takes it down. First to the roof wins.' : 'Right answers take your lift up a floor, wrong ones down. Reach the roof before the night porter, who sets off after three questions and rises every second one.',
  async play(c){
    const multi = c.multi, who = multi ? c.order() : [0], lifts = who.map(() => 0);
    const labels = who.map(i => ({ name: c.name(i), colour: c.colour(i), badge: c.symbol(i) }));
    if (!multi) { lifts.push(0); labels.push({ name: 'Night porter', colour: '#9aa3c7', badge: '<span class="rs-porter">NP</span>' }); }
    const paint = () => c.stage(liftStage(c, lifts, labels));
    paint();
    const cap = 10; let winner = -1;
    for (let k = 0; k < cap && winner < 0; k++) {
      c.count('Question ' + (k + 1));
      const r = await c.question(c.drawQ(), { open: multi, players: who, pts: 0, steal: false, noAward: true, label: 'Right: up a floor. Wrong: down a floor.',
        onWrong: by => { const s = who.indexOf(by); if (s >= 0 && lifts[s] > 0) { lifts[s]--; paint(); c.sfx('down'); } } });
      if (r.right) { const s = multi ? who.indexOf(r.by) : 0; lifts[s]++; c.sfx('up'); if (lifts[s] >= ROOF) winner = s; }
      if (!multi && k >= 3 && k % 2 === 1 && winner < 0) { lifts[1]++; if (lifts[1] >= ROOF) winner = 1; }
      paint();
      c.status(winner >= 0 ? labels[winner].name + ' reached the roof!' : r.right ? labels[multi ? who.indexOf(r.by) : 0].name + ' went up a floor.' : 'Going down.');
      await c.next(winner >= 0 || k === cap - 1 ? 'See the lantern' : 'Next question', r.right ? 'right' : 'miss', r);
    }
    // points: 5 a floor, and 15 for the roof
    who.forEach((i, s) => { const p = lifts[s] * 5 + (lifts[s] >= ROOF ? 15 : 0); if (p) c.award(i, p); });
    if (multi) { if (winner >= 0) return { taker: who[winner], line: c.name(who[winner]) + ' reached the roof' };
      const top = Math.max(...lifts); return { min: 10, line: top ? 'Nobody reached the roof' : 'Nobody left the ground floor' }; }
    const mine = lifts[0];
    return { lit: winner === 0, line: winner === 0 ? 'Up to the roof, ahead of the night porter' : winner === 1 ? 'The night porter got there first' : 'Stopped at floor ' + mine, need: 'beat the night porter to the roof to light it' };
  }
};

/* ======================================================================= The mountain railway: a mystery in the carriages */
const SUSPECTS = ['Major Thistlewood', 'Lady Pembury', 'Dr Okafor', 'Miss Larkspur', 'Mr Quayle', 'Signora Bellini', 'Professor Hale', 'Mrs Dunmore', 'Captain Ruddock', 'Miss Achterberg'];
const DIMS = [
  { key: 'place', pairs: [['the dining car', 'the sleeping car'], ['the observation car', 'the luggage van']], clue: v => 'The thief was in ' + v + '.' },
  { key: 'wear', pairs: [['a bowler hat', 'a red scarf'], ['round spectacles', 'a feathered hat']], clue: v => 'The thief wore ' + v + '.' },
  { key: 'carry', pairs: [['an umbrella', 'a violin case'], ['a hatbox', 'a newspaper']], clue: v => 'The thief carried ' + v + '.' }
];
/* four suspects whose three either-or details are arranged so any one clue leaves two, and any two leave one */
function makeMystery(r){
  const combos = shuffle([[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]], r), names = shuffle(SUSPECTS, r).slice(0, 4), dims = DIMS.map(d => pick(d.pairs, r));
  const people = names.map((n, k) => ({ name: n, v: combos[k], text: dims.map((p, d) => p[combos[k][d]]), hue: Math.floor(r() * 360) }));
  const thief = Math.floor(r() * 4), order = shuffle([0, 1, 2], r);
  return { people, thief, clues: order.map(d => DIMS[d].clue(dims[d][people[thief].v[d]])) };
}
function portrait(p){
  const wear = p.text[1], hat = wear === 'a bowler hat' ? '<path d="M-17 -20 h34 M-11 -20 q0 -16 11 -16 q11 0 11 16" fill="#1d1d24" stroke="#1d1d24" stroke-width="4"/>'
    : wear === 'a feathered hat' ? '<path d="M-18 -19 h36 q-4 -14 -18 -14 q-14 0 -18 14z" fill="#6a2c5a"/><path d="M10 -30 q14 -14 22 -8" stroke="#e8a33c" stroke-width="4" fill="none"/>'
    : wear === 'round spectacles' ? '<circle cx="-6" cy="-12" r="5" fill="none" stroke="#1d1d24" stroke-width="2.4"/><circle cx="6" cy="-12" r="5" fill="none" stroke="#1d1d24" stroke-width="2.4"/>'
    : '<path d="M-15 4 q15 10 30 0 v8 q-15 8 -30 0z" fill="#c8322c"/>';
  return '<svg viewBox="-30 -42 60 64" aria-hidden="true"><path d="M-24 22 q0 -22 24 -22 q24 0 24 22z" fill="hsl(' + p.hue + ' 30% 38%)"/><circle cy="-12" r="15" fill="#e8c8a8"/>' + hat + '</svg>'; }
function mysteryStage(m, seen, lost, out){
  return '<div class="rs-mys"><div class="rs-sus">' + m.people.map((p, k) => '<div class="rs-card' + (out.includes(k) ? ' out' : '') + '" data-k="' + k + '">' + portrait(p) + '<b>' + esc(p.name) + '</b><small>' + p.text.map(esc).join('<br>') + '</small></div>').join('') + '</div>'
    + '<ol class="rs-clues">' + [0, 1, 2].map(k => '<li class="' + (k < seen.length ? (lost.includes(k) ? 'lost' : 'got') : '') + '"><span>Carriage ' + (k + 1) + '</span>' + (k < seen.length ? (lost.includes(k) ? 'The clue was lost in the smoke.' : esc(m.clues[k])) : 'Not yet searched') + '</li>').join('') + '</ol></div>'; }
const railway = {
  title: 'A mystery in the carriages',
  rule: c => 'The conductor\'s gold watch has gone. Each right answer turns up a clue. Name the thief early for more points: two clues are enough to be sure.',
  async play(c){
    const m = makeMystery(c.rng), seen = [], lost = [], out = [], me = c.me; LAST.mystery = m;
    const paint = () => c.stage(mysteryStage(m, seen, lost, out));
    paint(); const VALUE = [30, 20, 10];
    for (let k = 0; k < 3; k++) {
      c.count('Carriage ' + (k + 1) + ' of 3');
      const r = await c.question(c.drawQ(), { who: me, pts: 5, steal: true, stealPts: 5 });
      seen.push(k); if (!r.right) lost.push(k); paint();
      c.status(r.right ? 'A clue: ' + m.clues[k] : 'No clue from this carriage.');
      const got = seen.length - lost.length, last = k === 2;
      if (!last) { await c.next('Search on', r.right ? 'right' : 'miss', r);
        if (!got) continue;
        const w = await c.choose({ who: c.multi ? me : -1, title: 'Name the thief now for ' + VALUE[k] * c.mult + ' points, or search the next carriage?', options: ['Name the thief now', 'Search the next carriage'] });
        if (w === 1) continue; }
      else await c.next('Name the thief', r.right ? 'right' : 'miss', r);
      // the accusation
      const value = VALUE[k];
      const guess = await c.choose({ who: c.multi ? me : -1, title: 'Who took the gold watch?', options: m.people.map(p => p.name) });
      if (guess === m.thief) { c.sfx('right'); c.award(c.multi ? me : 0, value); out.push(...[0, 1, 2, 3].filter(x => x !== m.thief)); paint(); c.status('Right: ' + m.people[m.thief].name + ' took it.');
        await c.next('See the lantern', 'right'); return c.multi ? { taker: me, line: c.name(me) + ' caught the thief' } : { lit: true, line: 'You caught the thief' }; }
      c.sfx('wrong'); out.push(guess); paint();
      if (c.multi) { const others = c.order().filter(x => x !== me);
        const who = await c.buzz({ players: others, label: 'Not ' + m.people[guess].name + '. Does anyone else know? Tap your name.', none: 'Nobody' });
        if (who >= 0) { const g2 = await c.choose({ who, title: c.name(who) + ': who took the gold watch?', options: m.people.map(p => p.name), disabled: out });
          if (g2 === m.thief) { c.sfx('steal'); c.award(who, value); c.status('Right: ' + m.people[m.thief].name + ' took it.'); out.push(...[0, 1, 2, 3].filter(x => x !== m.thief && !out.includes(x))); paint();
            await c.next('See the lantern', 'right'); return { taker: who, line: c.name(who) + ' caught the thief' }; }
          out.push(g2); paint(); } }
      c.status('The thief was ' + m.people[m.thief].name + '.'); await c.next('See the lantern', 'miss');
      return c.multi ? { taker: -1, line: 'The thief got away' } : { lit: false, line: 'The thief got away', need: 'name the thief to light it' };
    }
  }
};

/* ======================================================================= The manor at midnight: the last candle */
function candleStage(c, list){
  return '<div class="rs-candles">' + list.map(x => '<div class="rs-candle' + (x.lit ? '' : ' out') + (x.now ? ' now' : '') + '"><div class="rs-wax" style="--c:' + x.colour + '"><i class="rs-flame"></i><i class="rs-smoke"></i></div><b>' + x.badge + esc(x.name) + '</b></div>').join('') + '</div>'; }
const manor = {
  title: 'The last candle',
  rule: c => c.multi ? 'Questions go round in turn. A wrong answer snuffs your candle. The last flame burning takes the lantern.' : 'Three candles. Six questions. Each wrong answer snuffs a candle. Keep one burning to light the lantern.',
  async play(c){
    if (!c.multi) {
      let lit = 3, right = 0; const paint = () => c.stage(candleStage(c, [0, 1, 2].map(k => ({ lit: k < lit, colour: '#f3e6c8', badge: '', name: '' }))));
      paint();
      for (let k = 0; k < 6 && lit > 0; k++) { c.count('Question ' + (k + 1) + ' of 6');
        const r = await c.question(c.drawQ(), { who: 0, pts: 5, steal: false });
        if (r.right) right++; else { lit--; c.sfx('snuff'); }
        paint(); await c.next(k < 5 && lit > 0 ? 'Next question' : 'See the lantern', r.right ? 'right' : 'miss', r); }
      if (lit > 0) c.award(0, 15);
      return { lit: lit > 0, line: lit > 0 ? plural(lit, 'candle') + ' still burning' : 'Every candle snuffed', need: 'keep one burning to light it' };
    }
    const order = c.order(), alive = order.slice(), cap = Math.max(8, order.length + 4);
    const paint = now => c.stage(candleStage(c, order.map(i => ({ lit: alive.includes(i), now: i === now, colour: c.colour(i), badge: c.symbol(i), name: c.name(i) }))));
    let q = 0, turn = 0;
    while (alive.length > 1 && q < cap) {
      const who = alive[turn % alive.length]; paint(who); c.count('Question ' + (q + 1));
      const r = await c.question(c.drawQ(), { who, pts: 5, steal: false });
      if (!r.right) { alive.splice(alive.indexOf(who), 1); c.sfx('snuff'); c.status(c.name(who) + '\'s candle went out.'); } else turn++;
      q++; paint(-1); await c.next(alive.length > 1 && q < cap ? 'Next question' : 'See the lantern', r.right ? 'right' : 'miss', r);
    }
    if (alive.length === 1) { c.award(alive[0], 15); return { taker: alive[0], line: c.name(alive[0]) + ' had the last flame' }; }
    return { min: 5, among: alive, line: alive.length ? 'Still burning: ' + alive.map(i => c.name(i)).join(', ') : 'Every candle went out' };
  }
};

/* ======================================================================= The night flight: where are we? */
const PLACES = [
  ['France', 'Europe', ['Its longest river, the Loire, flows into the Atlantic.', 'It shares the Pyrenees with Spain.', 'Its capital is Paris.', 'It hosts the Tour de France cycle race.']],
  ['Italy', 'Europe', ['Two tiny independent countries lie inside its borders.', 'The River Po crosses its north.', 'Its capital is Rome.', 'On a map it looks like a boot.']],
  ['Spain', 'Europe', ['Two of its cities are on the north coast of Africa.', 'Its highest mountain, Teide, is on the Canary Islands.', 'Its capital is Madrid.', 'Flamenco comes from its south.']],
  ['Norway', 'Europe', ['It stays out of the European Union, though two of its three neighbours are members.', 'In its far north the summer sun does not set.', 'Its capital is Oslo.', 'Its coast is cut by long, deep inlets called fjords.']],
  ['Greece', 'Europe', ['Its alphabet gave us the words alpha and beta.', 'It has around six thousand islands.', 'Its capital is Athens.', 'The ancient Olympic Games were held here.']],
  ['The Netherlands', 'Europe', ['About a quarter of its land lies below sea level.', 'Its king lives and works in The Hague.', 'Its capital is Amsterdam.', 'It is famous for tulips and windmills.']],
  ['Iceland', 'Europe', ['It sits where two plates of the Earth\'s crust are pulling apart.', 'Its parliament is one of the oldest in the world.', 'Its capital is Reykjavik.', 'This island nation is known for geysers and volcanoes.']],
  ['Germany', 'Europe', ['It shares borders with nine countries.', 'Both the Rhine and the Danube flow through it.', 'Its capital is Berlin.', 'Its famous wall fell in 1989.']],
  ['Portugal', 'Europe', ['It is the westernmost country of mainland Europe.', 'Madeira and the Azores belong to it.', 'Its capital is Lisbon.', 'Its only land neighbour is Spain.']],
  ['Ireland', 'Europe', ['A harp is its national symbol.', 'The River Shannon is its longest river.', 'Its capital is Dublin.', 'It is called the Emerald Isle.']],
  ['Japan', 'Asia', ['It is made of four main islands and thousands of small ones.', 'Its highest mountain is a volcano called Fuji.', 'Its capital is Tokyo.', 'It is called the Land of the Rising Sun.']],
  ['India', 'Asia', ['It has more people than any other country.', 'The River Ganges flows across its north.', 'Its capital is New Delhi.', 'Its money is the rupee, and cricket is its best-loved sport.']],
  ['China', 'Asia', ['It runs on one time zone, though it is wide enough for five.', 'The Yangtze, Asia\'s longest river, flows across it.', 'Its capital is Beijing.', 'Giant pandas live wild only here.']],
  ['Thailand', 'Asia', ['It is the only country in South-East Asia never ruled by a European power.', 'The Chao Phraya river flows through its capital.', 'Its capital is Bangkok.', 'It used to be called Siam.']],
  ['Nepal', 'Asia', ['Its flag is the only national flag that is not a rectangle.', 'Eight of the world\'s ten highest mountains are within or on its borders.', 'Its capital is Kathmandu.', 'Mount Everest stands on its border with China.']],
  ['Indonesia', 'Asia', ['It is made of more than seventeen thousand islands.', 'Komodo dragons live wild on some of its islands.', 'Its largest city is Jakarta.', 'Bali is one of its islands.']],
  ['South Korea', 'Asia', ['Its alphabet, Hangul, was created in the 1440s.', 'It shares a peninsula with its northern neighbour.', 'Its capital is Seoul.', 'It hosted the 2018 Winter Olympics.']],
  ['Egypt', 'Africa', ['Most of its people live within a few miles of one great river.', 'The Suez Canal crosses its land.', 'Its capital is Cairo.', 'The Great Pyramid of Giza is here.']],
  ['Kenya', 'Africa', ['The Equator runs through it.', 'Its highest mountain shares its name.', 'Its capital is Nairobi.', 'Its runners are famous for winning long-distance races.']],
  ['Morocco', 'Africa', ['At its closest it is about eight miles from Spain.', 'The Atlas Mountains run through it.', 'Its capital is Rabat.', 'Marrakesh and Casablanca are two of its cities.']],
  ['South Africa', 'Africa', ['It has three capital cities.', 'It completely surrounds another country, Lesotho.', 'Table Mountain overlooks one of its cities.', 'Nelson Mandela was its first president chosen by all its people.']],
  ['Madagascar', 'Africa', ['Most of its plants and animals are found nowhere else on Earth.', 'It is the fourth largest island in the world.', 'Its capital is Antananarivo.', 'Lemurs live wild only here.']],
  ['Nigeria', 'Africa', ['It has more people than any other African country.', 'The River Niger gives it its name.', 'Its capital is Abuja.', 'Its film industry is nicknamed Nollywood.']],
  ['Canada', 'Americas', ['It has the longest coastline of any country.', 'Its two official languages are English and French.', 'Its capital is Ottawa.', 'A maple leaf is on its flag.']],
  ['Mexico', 'Americas', ['More people speak Spanish here than in any other country.', 'Maize was first farmed here, thousands of years ago.', 'Its capital is the largest city in North America.', 'The United States is its neighbour to the north.']],
  ['Brazil', 'Americas', ['It is the only country in South America where Portuguese is the main language.', 'Most of the Amazon rainforest is within its borders.', 'Its capital is Brasilia.', 'Its carnival in Rio de Janeiro is world famous.']],
  ['Peru', 'Americas', ['Lake Titicaca lies on its border with Bolivia.', 'The Andes run its whole length.', 'Its capital is Lima.', 'The Inca city of Machu Picchu is here.']],
  ['Argentina', 'Americas', ['The highest mountain outside Asia, Aconcagua, is here.', 'It reaches almost to Antarctica, at Tierra del Fuego.', 'Its capital is Buenos Aires.', 'The tango was born here.']],
  ['Chile', 'Americas', ['It is over two and a half thousand miles long and very narrow.', 'The Atacama, one of the driest deserts on Earth, is in its north.', 'Its capital is Santiago.', 'Easter Island belongs to it.']],
  ['Jamaica', 'Americas', ['It is the third largest island in the Caribbean.', 'Its Blue Mountains grow famous coffee.', 'Its capital is Kingston.', 'Reggae music was born here.']],
  ['Australia', 'Oceania', ['It is the only country that covers a whole continent.', 'The Great Barrier Reef lies off its north-east coast.', 'Its capital is Canberra.', 'Kangaroos and koalas live wild here.']],
  ['New Zealand', 'Oceania', ['In 1893 it became the first country where women could vote in national elections.', 'It has two main islands, North and South.', 'Its capital is Wellington.', 'Its rugby team is the All Blacks.']]
];
function flightStage(place, shown, value){
  return '<div class="rs-fly"><div class="rs-window"><span class="rs-plane">✈</span><b>Where are we?</b><small>' + value + ' points if you land now</small></div><ol class="rs-hints">' + place[2].map((h, k) => '<li class="' + (k < shown ? 'on' : '') + '">' + (k < shown ? esc(h) : 'Clue ' + (k + 1)) + '</li>').join('') + '</ol></div>'; }
const flight = {
  title: 'Where are we?',
  rule: c => 'Two legs of the journey. Clues appear out of the window one by one. Land on the right country early for more points.' + (c.multi ? ' A wrong landing can be stolen.' : ''),
  async play(c){
    const VALUE = [20, 15, 10, 5], me = c.me, legs = shuffle(PLACES, c.rng).slice(0, 2); let right = 0; LAST.legs = legs;
    for (let leg = 0; leg < 2; leg++) {
      const place = legs[leg], same = PLACES.filter(p => p[1] === place[1] && p !== place), rest = PLACES.filter(p => p[1] !== place[1]);
      const opts = shuffle([place[0]].concat(shuffle(same, c.rng).slice(0, 3).map(p => p[0]), shuffle(rest, c.rng).map(p => p[0])).slice(0, 4), c.rng);
      let shown = 1, done = false; LAST.place = place;
      while (!done) {
        c.count('Leg ' + (leg + 1) + ' of 2: clue ' + shown + ' of 4');
        c.stage(flightStage(place, shown, VALUE[shown - 1] * c.mult));
        const can = shown < 4, w = await c.choose({ who: c.multi ? me : -1, title: 'Where are we?', options: opts.concat(can ? ['Fly on for another clue'] : []), keyed: true });
        if (w === 4) { shown++; c.sfx('nudge'); continue; }
        done = true;
        if (opts[w] === place[0]) { right++; c.award(c.multi ? me : 0, VALUE[shown - 1]); c.sfx('right'); c.status('Yes: ' + place[0] + '.'); await c.next(leg ? 'See the lantern' : 'On to the next leg', 'right'); }
        else { c.sfx('wrong');
          if (c.multi) { const who = await c.buzz({ players: c.order().filter(x => x !== me), label: 'Not ' + opts[w] + '. Does anyone else know? Tap your name.', none: 'Nobody' });
            if (who >= 0) { const g = await c.choose({ who, title: c.name(who) + ': where are we?', options: opts, disabled: [w] });
              if (opts[g] === place[0]) { c.sfx('steal'); c.award(who, 5); c.status('Stolen: ' + place[0] + '.'); await c.next(leg ? 'See the lantern' : 'On to the next leg', 'right'); continue; } } }
          c.status('We were over ' + place[0] + '.'); await c.next(leg ? 'See the lantern' : 'On to the next leg', 'miss'); }
      }
    }
    return { lit: right === 2, min: 15, line: right + ' of 2 countries found', need: 'find both to light it' };
  }
};

/* ======================================================================= Ancient Rome: the chariot duel */
function trackStage(c, a, b, labels){
  const lane = (pos, l) => '<div class="rs-lane"><div class="rs-marks"><i></i><i></i><i></i></div><div class="rs-chariot" style="--p:' + pos + ';--c:' + l.colour + '">' + l.badge + '<span>🐎</span></div><b>' + esc(l.name) + '</b></div>';
  return '<div class="rs-track">' + lane(a, labels[0]) + lane(b, labels[1]) + '</div>'; }
const rome = {
  title: 'The chariot duel',
  rule: c => c.multi ? 'Two chariots, one track. Each question is open to both drivers: tap your name to answer. Three right answers win the race.' : 'Race the Blues round the track. Every right answer pulls you ahead; every miss lets the Blues gain. First to three wins.',
  async play(c){
    const me = c.me; let rival = -1;
    if (c.multi) { const others = c.order().filter(x => x !== me);
      rival = others.length === 1 ? others[0] : others[await c.choose({ who: me, title: c.name(me) + ', who will you race?', options: others.map(i => c.name(i)) })]; }
    const pos = [0, 0], labels = [{ name: c.name(me), colour: c.colour(me), badge: c.symbol(me) }, c.multi ? { name: c.name(rival), colour: c.colour(rival), badge: c.symbol(rival) } : { name: 'The Blues', colour: '#56b4e9', badge: '' }];
    const paint = () => c.stage(trackStage(c, pos[0], pos[1], labels)); paint();
    for (let k = 0; k < 7 && pos[0] < 3 && pos[1] < 3; k++) {
      c.count('Lap ' + (k + 1));
      const r = await c.question(c.drawQ(), c.multi ? { open: true, players: [me, rival], pts: 10, steal: false } : { who: 0, pts: 10, steal: false });
      if (r.right) pos[c.multi ? (r.by === me ? 0 : 1) : 0]++; else if (!c.multi) pos[1]++;
      c.sfx(r.right ? 'gallop' : 'wrong'); paint();
      await c.next(pos[0] >= 3 || pos[1] >= 3 ? 'See the lantern' : 'Next lap', r.right ? 'right' : 'miss', r);
    }
    const won = pos[0] > pos[1] ? 0 : pos[1] > pos[0] ? 1 : -1;
    if (c.multi) return won < 0 ? { taker: -1, line: 'A dead heat' } : { taker: won ? rival : me, line: labels[won].name + ' won the race' };
    return { lit: won === 0, line: won === 0 ? 'You beat the Blues' : won === 1 ? 'The Blues won the race' : 'A dead heat', need: 'win the race to light it' };
  }
};

/* ======================================================================= The submarine: how deep dare you go? */
const POT = [8, 18, 30, 45, 62];
function depthStage(depth, pot, flooded, creaked){
  return '<div class="rs-depth"><div class="rs-gauge">' + POT.map((v, k) => '<i class="' + (k < depth ? 'done' : '') + (k === depth ? ' next' : '') + '"><span>' + ((k + 1) * 100) + ' m</span><b>' + v + '</b></i>').join('') + '</div>'
    + '<div class="rs-pot">In the hold: <b>' + pot + '</b><small class="rs-hull' + (flooded ? ' gone' : creaked ? ' creak' : '') + '">' + (flooded ? 'Flooded' : creaked ? 'Hull creaking' : 'Hull sound') + '</small></div></div>'; }
const submarine = {
  title: 'How deep dare you go?',
  rule: c => 'Each right answer takes the boat deeper and fills the hold with more points. Surface whenever you like to keep them. The first wrong answer makes the hull creak; a second floods the hold and loses the lot.',
  async play(c){
    const me = c.multi ? c.me : 0; let depth = 0, pot = 0, creaked = false, tries = 0;
    const paint = f => c.stage(depthStage(depth, pot, f, creaked)); paint();
    while (depth < POT.length && tries < 8) {
      tries++; c.count('Dive ' + (depth + 1) + ': ' + ((depth + 1) * 100) + ' metres');
      const r = await c.question(c.drawQ(), { who: me, pts: 0, steal: false, noAward: true, label: 'For ' + POT[depth] * c.mult + ' in the hold' });
      if (!r.right && !creaked) { creaked = true; paint(); c.sfx('creak'); c.status('The hull creaks. One more wrong answer and it gives way.');
        await c.next('Decide', 'miss', r);
        if (pot) { const w = await c.choose({ who: c.multi ? me : -1, title: 'The hull is creaking. You have ' + pot * c.mult + ' in the hold. Try again for ' + POT[depth] * c.mult + ', or surface?', options: ['Try again', 'Surface now'] });
          if (w === 1) { c.status('Surfaced safely.'); break; } }
        continue; }
      if (!r.right) { pot = 0; paint(true); c.sfx('flood'); c.status('The hull gave way. The hold is lost.'); await c.next('See the lantern', 'miss', r); break; }
      pot = POT[depth]; depth++; paint(); c.sfx('dive');
      if (depth === POT.length) { c.status('The deepest trench! Surfacing with ' + pot * c.mult + '.'); await c.next('See the lantern', 'right', r); break; }
      await c.next('Decide', 'right', r);
      const w = await c.choose({ who: c.multi ? me : -1, title: 'You have ' + pot * c.mult + ' in the hold. Dive to ' + ((depth + 1) * 100) + ' metres for ' + POT[depth] * c.mult + ', or surface?', options: ['Dive deeper', 'Surface now'] });
      if (w === 1) { c.status('Surfaced safely.'); break; }
    }
    if (pot) c.award(me, pot);
    const ok = pot >= 18;
    if (c.multi) return { taker: ok ? me : -1, line: pot ? 'Surfaced with ' + pot * c.mult : 'Came up empty' };
    return { lit: ok, line: pot ? 'Surfaced with ' + pot * c.mult + ' points' : 'Came up empty', need: 'surface with 18 or more to light it' };
  }
};

/* ======================================================================= The galleon: the treasure and the storm */
function chestStage(gold, note){ return '<div class="rs-chest"><div class="rs-box"><i></i><span>' + gold + '</span></div><p>' + esc(note) + '</p></div>'; }
const galleon = {
  title: 'Treasure in the storm',
  rule: c => c.multi ? 'Fill the chest with three questions. Then a pirate decides: share it, or try to steal the lot with one question.' : 'Fill the chest with three questions. Then ride out the storm to double it, or make for harbour and keep it.',
  async play(c){
    const me = c.multi ? c.me : 0; let gold = 0;
    c.stage(chestStage(0, 'The chest is empty.'));
    for (let k = 0; k < 3; k++) { c.count('Treasure ' + (k + 1) + ' of 3');
      const r = await c.question(c.drawQ(), { who: me, pts: 0, steal: false, noAward: true, label: '10 gold for the chest' });
      if (r.right) { gold += 10; c.sfx('coins'); }
      c.stage(chestStage(gold * c.mult, gold ? 'Gold in the chest.' : 'The chest is empty.'));
      await c.next(k < 2 ? 'Next question' : 'The storm', r.right ? 'right' : 'miss', r); }
    if (!gold) { c.status('Nothing to fight over.'); return c.multi ? { taker: -1, line: 'The chest stayed empty' } : { lit: false, line: 'The chest stayed empty', need: 'bring home 20 or more to light it' }; }
    if (!c.multi) {
      const w = await c.choose({ who: -1, title: gold * c.mult + ' gold in the chest. Ride out the storm to double it (one question), or make for harbour?', options: ['Ride out the storm', 'Make for harbour'] });
      if (w === 0) { c.count('The storm'); const r = await c.question(c.drawQ(), { who: 0, pts: 0, steal: false, noAward: true, label: 'Double or half' });
        gold = r.right ? gold * 2 : Math.floor(gold / 2); c.stage(chestStage(gold * c.mult, r.right ? 'Doubled!' : 'Half washed overboard.')); await c.next('See the lantern', r.right ? 'right' : 'miss', r); }
      c.award(0, gold); return { lit: gold >= 20, line: 'Home with ' + gold * c.mult + ' gold', need: 'bring home 20 or more to light it' }; }
    // the pirate: the other team, or the lowest scorer who did not spin
    const others = c.order().filter(x => x !== me), pirate = others.slice().sort((a, b) => c.pts(a) - c.pts(b))[0];
    const w = await c.choose({ who: pirate, title: c.name(pirate) + ', you are the pirate. Share the ' + gold * c.mult + ' gold, or try to steal it all with one question?', options: ['Share it', 'Steal it all'] });
    if (w === 0) { const half = Math.ceil(gold / 2); c.award(me, half); c.award(pirate, gold - half); c.status('Shared.'); c.stage(chestStage(gold * c.mult, 'Shared between ' + c.name(me) + ' and ' + c.name(pirate) + '.')); await c.next('See the lantern', 'right');
      return { min: 10, line: 'The treasure was shared' }; }
    c.count('The steal'); const r = await c.question(c.drawQ(), { who: pirate, pts: 0, steal: false, noAward: true, label: 'Everything, or nothing' });
    if (r.right) { c.award(pirate, gold); c.stage(chestStage(gold * c.mult, c.name(pirate) + ' stole the lot.')); await c.next('See the lantern', 'right', r); return { taker: gold >= 20 ? pirate : -1, line: c.name(pirate) + ' stole the treasure' }; }
    c.award(me, gold + 10); c.stage(chestStage((gold + 10) * c.mult, c.name(me) + ' kept it, with 10 more for holding firm.')); await c.next('See the lantern', 'miss', r);
    return { taker: gold >= 20 ? me : -1, line: c.name(me) + ' kept the treasure' };
  }
};

/* ======================================================================= The Ice Age cave: by torchlight */
const cave = {
  title: 'By torchlight',
  rule: c => 'The torch reveals each question a word at a time. Answer early for more points: ' + (c.multi ? 'tap your name as soon as you know it.' : 'up to 15 a question.'),
  async play(c){ let right = 0;
    c.stage('<div class="rs-torch"><span>🔥</span><small>The torch moves along the wall…</small></div>');
    for (let k = 0; k < 3; k++) { c.count('Painting ' + (k + 1) + ' of 3');
      const r = await c.question(c.drawQ(), { open: c.multi, players: c.order(), who: 0, reveal: 'words', ptsFrom: 15, ptsTo: 5, steal: false });
      if (r.right) right++;
      await c.next(k < 2 ? 'Next painting' : 'See the lantern', r.right ? 'right' : 'miss', r); }
    return { lit: right >= 2, min: 15, line: right + ' of 3 right', need: 'two right lights it' }; }
};

/* ======================================================================= The hot air balloon: what did you see? */
const THINGS = {
  barn: { one: 'barn', colours: ['red', 'blue', 'green', 'yellow'] }, tractor: { one: 'tractor', colours: ['red', 'blue', 'green', 'yellow'] },
  cow: { one: 'cow', count: [1, 5] }, sheep: { one: 'sheep', many: 'sheep', count: [2, 6] }, duck: { one: 'duck', count: [2, 5] }, haystack: { one: 'haystack', count: [1, 4] },
  windmill: { one: 'windmill' }, church: { one: 'church' }, scarecrow: { one: 'scarecrow' }, lighthouse: { one: 'lighthouse' }, well: { one: 'well' }, bridge: { one: 'bridge' }
};
const PAINT = { red: '#c8322c', blue: '#2f6fb0', green: '#3f8f4f', yellow: '#e2b33c' };
function drawThing(t){
  const s = (b, w) => '<svg viewBox="0 0 ' + (w || 80) + ' 80" aria-hidden="true">' + b + '</svg>';
  const one = { cow: '<g><ellipse cx="30" cy="48" rx="20" ry="12" fill="#fff" stroke="#333" stroke-width="2"/><circle cx="24" cy="46" r="5" fill="#333"/><circle cx="52" cy="40" r="8" fill="#fff" stroke="#333" stroke-width="2"/><path d="M16 58v12M24 58v12M36 58v12M44 58v12" stroke="#333" stroke-width="3"/></g>',
    sheep: '<g><circle cx="22" cy="46" r="9" fill="#f4f1ea"/><circle cx="32" cy="42" r="10" fill="#f4f1ea"/><circle cx="40" cy="48" r="9" fill="#f4f1ea"/><ellipse cx="50" cy="44" rx="6" ry="7" fill="#333"/><path d="M24 56v10M38 56v10" stroke="#333" stroke-width="3"/></g>',
    duck: '<g><ellipse cx="30" cy="54" rx="14" ry="9" fill="#e8c34a"/><circle cx="42" cy="44" r="6" fill="#e8c34a"/><path d="M47 44l7 2-7 2z" fill="#e8742c"/><path d="M8 64h44" stroke="#5fb6ea" stroke-width="4"/></g>',
    haystack: '<path d="M10 70q4-40 30-44q26 4 30 44z" fill="#e2c15c" stroke="#b8963a" stroke-width="2"/>' };
  if (t.kind in one) return '<span class="rs-thing">' + Array.from({ length: t.n }, () => s(one[t.kind], 64)).join('') + '</span>';
  const b = {
    barn: '<path d="M10 72V36l30-18 30 18v36z" fill="' + PAINT[t.colour] + '"/><path d="M30 72V50h20v22" fill="#fff" opacity=".85"/><path d="M30 50l20 22M50 50L30 72" stroke="' + PAINT[t.colour] + '" stroke-width="3"/>',
    tractor: '<rect x="14" y="36" width="34" height="20" rx="3" fill="' + PAINT[t.colour] + '"/><rect x="40" y="24" width="18" height="22" fill="' + PAINT[t.colour] + '"/><circle cx="22" cy="60" r="12" fill="#333"/><circle cx="56" cy="62" r="8" fill="#333"/>',
    windmill: '<path d="M32 74l4-40h8l4 40z" fill="#c9b49a"/><g transform="translate(40 34)"><path d="M0 0L-4-30h8zM0 0L30-4v8zM0 0L4 30h-8zM0 0L-30 4v-8z" fill="#efe6d2" stroke="#8a6545"/></g>',
    church: '<path d="M14 74V42l16-12 16 12v32z" fill="#d9d2c4"/><path d="M46 74V30l8-16 8 16v44z" fill="#cfc6b5"/><path d="M54 6v10M50 10h8" stroke="#8a7b62" stroke-width="2.5"/><path d="M24 74V58a6 6 0 0 1 12 0v16" fill="#6b5d48"/>',
    scarecrow: '<path d="M40 30v44M18 40h44" stroke="#8a6545" stroke-width="5"/><circle cx="40" cy="24" r="9" fill="#e2c15c"/><path d="M28 18h24l-4-8h-16z" fill="#6b4b33"/><path d="M26 40h28l-4 18h-20z" fill="#3f6f9a"/>',
    lighthouse: '<path d="M30 74l4-50h12l4 50z" fill="#f4f1ea"/><path d="M32 54h16M33 40h14" stroke="#c8322c" stroke-width="7"/><rect x="33" y="16" width="14" height="10" fill="#ffd27a"/><path d="M30 16h20l-10-8z" fill="#c8322c"/>',
    well: '<rect x="22" y="48" width="36" height="24" fill="#a39a8a"/><path d="M24 48V26M56 48V26M18 26h44l-22-12z" stroke="#6b4b33" stroke-width="4" fill="#8a6545"/>',
    bridge: '<path d="M4 50q36-26 72 0v24h-12v-14q-24-16-48 0v14H4z" fill="#a39a8a"/>' }[t.kind];
  return '<span class="rs-thing">' + s(b) + '</span>';
}
function makeCountryside(r){
  const kinds = shuffle(Object.keys(THINGS), r).slice(0, 7);
  return kinds.map(k => { const d = THINGS[k], t = { kind: k }; if (d.colours) t.colour = pick(d.colours, r); if (d.count) t.n = d.count[0] + Math.floor(r() * (d.count[1] - d.count[0] + 1)); return t; }); }
function memoryQuestions(scene, r){
  const qs = [], seen = scene.map(t => t.kind), unseen = Object.keys(THINGS).filter(k => !seen.includes(k)), name = k => THINGS[k].one;
  const counted = shuffle(scene.filter(t => t.n), r), coloured = shuffle(scene.filter(t => t.colour), r);
  if (counted.length) { const t = counted[0], d = THINGS[t.kind], opts = shuffle([t.n, t.n + 1, t.n - 1, t.n + 2].filter(x => x >= 1).concat([t.n + 3]), r).slice(0, 4);
    if (!opts.includes(t.n)) opts[0] = t.n; qs.push({ q: 'How many ' + (d.many || d.one + 's') + ' did you see?', correct: String(t.n), opts: shuffle(opts, r).map(String) }); }
  if (coloured.length) { const t = coloured[0]; qs.push({ q: 'What colour was the ' + name(t.kind) + '?', correct: t.colour, opts: shuffle(THINGS[t.kind].colours, r) }); }
  { const wrong = shuffle(unseen, r)[0], opts = shuffle(shuffle(seen, r).slice(0, 3).concat(wrong), r); qs.push({ q: 'Which of these did you NOT see?', correct: 'a ' + name(wrong), opts: opts.map(k => 'a ' + name(k)) }); }
  { const four = shuffle(seen.slice(0, 7), r).slice(0, 4), first = seen.find(k => four.includes(k)); qs.push({ q: 'Which of these did you pass first?', correct: 'the ' + name(first), opts: four.map(k => 'the ' + name(k)) }); }
  return shuffle(qs, r).slice(0, 3);
}
const balloon = {
  title: 'What did you see?',
  rule: c => 'The countryside drifts by below. Look hard: then three questions about what you saw.' + (c.multi ? ' A miss can be stolen.' : ''),
  async play(c){
    const scene = makeCountryside(c.rng), qs = memoryQuestions(scene, c.rng); let right = 0; LAST.scene = scene; LAST.qs = qs;
    c.count('Look closely');
    c.stage('<div class="rs-land"><div class="rs-strip">' + scene.map(drawThing).join('') + '</div></div>');
    await c.watch(12000, 'I\'m ready');
    c.stage('<div class="rs-land gone"><p>The countryside has drifted out of sight.</p></div>');
    for (let k = 0; k < qs.length; k++) { c.count('Question ' + (k + 1) + ' of ' + qs.length);
      const r = await c.question(qs[k], { who: c.me, pts: 10, steal: true });
      if (r.right && !r.stolen) right++;
      await c.next(k < qs.length - 1 ? 'Next question' : 'See the lantern', r.right ? 'right' : 'miss', r); }
    c.stage('<div class="rs-land"><div class="rs-strip still">' + scene.map(drawThing).join('') + '</div></div>');
    return { lit: right >= 2, min: 1, line: right + ' of ' + qs.length + ' remembered', need: 'two right lights it' };
  }
};

/* ======================================================================= The big top: spinning plates */
function platesStage(n, max){ return '<div class="rs-plates">' + Array.from({ length: max }, (_, k) => '<div class="rs-pole' + (k < n ? ' up' : '') + '"><i></i></div>').join('') + '</div>'; }
const bigtop = {
  title: 'Spinning plates',
  rule: c => 'Six quick questions. Two plates are spinning. Every right answer adds a plate; every miss smashes one. Six points for each plate still spinning at the end.',
  async play(c){
    const me = c.multi ? c.me : 0; let plates = 2; const MAX = 8;
    c.stage(platesStage(plates, MAX));
    for (let k = 0; k < 6; k++) { c.count('Plate question ' + (k + 1) + ' of 6');
      const r = await c.question(c.drawQ(), { who: me, pts: 0, steal: false, noAward: true, time: 12000, label: plural(plates, 'plate') + ' spinning' });
      plates = r.right ? Math.min(MAX, plates + 1) : Math.max(0, plates - 1); c.sfx(r.right ? 'plate' : 'smash');
      c.stage(platesStage(plates, MAX)); await c.next(k < 5 ? 'Next question' : 'See the lantern', r.right ? 'right' : 'miss', r); }
    if (plates) c.award(me, plates * 6);
    const ok = plates >= 4;
    if (c.multi) return { taker: ok ? me : -1, line: plural(plates, 'plate') + ' still spinning' };
    return { lit: ok, line: plural(plates, 'plate') + ' still spinning', need: 'keep four spinning to light it' };
  }
};

const TYPES = { classic, city, railway, manor, flight, rome, submarine, galleon, cave, balloon, bigtop };

const CSS = `
#rStage{width:min(980px,calc(100% - 28px));margin:clamp(10px,2vh,20px) auto 0;color:#fff}
#rStage:empty{display:none}
#rRule{width:min(980px,calc(100% - 28px));margin:8px auto 0;text-align:center;font-weight:800;color:#fbeed0;text-shadow:0 2px 10px rgba(0,0,0,.7);font-size:clamp(15px,1.3vw,19px)}
.rs-lifts{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:8px;background:rgba(10,12,34,.78);border:1px solid rgba(243,217,143,.3);border-radius:18px;padding:12px}
.rs-shaft{position:relative;display:flex;flex-direction:column;align-items:center;min-width:0}
.rs-floors{position:relative;display:flex;flex-direction:column;width:100%;border-left:2px solid #5a5f86;border-right:2px solid #5a5f86}
.rs-floors i{height:24px;font-style:normal;font-size:11px;color:#9aa3c7;border-bottom:1px dashed rgba(154,163,199,.4);padding-left:4px}
.rs-floors i.roof{color:#f3d98f;font-weight:900}
.rs-car{position:absolute;left:50%;width:min(44px,80%);height:22px;border-radius:5px;background:var(--c);display:flex;align-items:center;justify-content:center;transform:translateX(-50%);bottom:calc(var(--f) * 24px + 1px);transition:bottom .7s cubic-bezier(.3,1.4,.5,1);box-shadow:0 0 12px var(--c)}
.rs-car .sym{width:16px;height:16px}
.rs-porter{font-size:10px;font-weight:900;color:#0b0f2a}
.rs-shaft b{font-size:12px;margin-top:4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-mys{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:10px}
.rs-sus{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.rs-card{background:#fbf4e6;color:#21160c;border-radius:14px;padding:8px;text-align:center;transition:opacity .4s,filter .4s}
.rs-card svg{width:56px;height:60px}
.rs-card b{display:block;font-family:var(--head);font-size:clamp(14px,1.2vw,18px);line-height:1.05}
.rs-card small{display:block;font-size:12px;line-height:1.25;color:#5a4630;margin-top:4px;font-weight:700}
.rs-card.out{opacity:.35;filter:grayscale(1)}
.rs-clues{list-style:none;margin:0;padding:10px;background:rgba(10,12,34,.82);border-radius:14px;font-weight:800;font-size:14px;display:flex;flex-direction:column;gap:6px}
.rs-clues span{display:block;font-size:11px;color:#f3d98f;text-transform:uppercase;letter-spacing:.5px}
.rs-clues li{color:#7d84a8}.rs-clues li.got{color:#fff}.rs-clues li.lost{color:#ff9a8a}
.rs-candles{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(8px,2vw,22px);background:rgba(10,8,20,.7);border-radius:18px;padding:16px 12px 10px}
.rs-candle{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:56px}
.rs-wax{position:relative;width:clamp(16px,1.4vw,22px);height:clamp(56px,8vh,84px);border-radius:3px;background:linear-gradient(90deg,#efe6d2,#cfc3a8);box-shadow:inset 0 -6px 0 var(--c)}
.rs-flame{position:absolute;left:50%;top:-26px;width:14px;height:24px;margin-left:-7px;border-radius:50% 50% 40% 40%;background:radial-gradient(circle at 50% 70%,#fff2b0,#ffb347 55%,rgba(255,120,40,0) 75%);animation:rsFlick .3s ease-in-out infinite alternate;transform-origin:50% 100%}
.rs-smoke{position:absolute;left:50%;top:-20px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:#bbb;opacity:0}
.rs-candle.out .rs-flame{display:none}
.rs-candle.out .rs-smoke{animation:rsSmoke 1.6s ease-out 1}
.rs-candle.now .rs-wax{outline:3px solid #f3d98f;outline-offset:6px;border-radius:4px}
.rs-candle b{display:flex;align-items:center;gap:4px;font-size:13px}
@keyframes rsFlick{to{transform:scale(.9,1.08) rotate(3deg)}}
@keyframes rsSmoke{from{opacity:.8;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(-40px) scale(3)}}
.rs-fly{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.6fr);gap:10px}
.rs-window{background:radial-gradient(circle at 50% 40%,#2b3f78,#0b1740);border:6px solid #b9c5da;border-radius:40px;padding:14px;text-align:center;display:flex;flex-direction:column;justify-content:center}
.rs-plane{font-size:30px;animation:rsBob 3s ease-in-out infinite}
.rs-window b{font-family:var(--head);font-size:clamp(20px,2vw,28px)}
.rs-window small{color:#f3d98f;font-weight:800}
.rs-hints{margin:0;padding:10px 12px 10px 30px;background:rgba(10,12,34,.85);border-radius:16px;font-weight:800;display:flex;flex-direction:column;gap:6px;font-size:clamp(15px,1.3vw,19px)}
.rs-hints li{color:#5a6088}.rs-hints li.on{color:#fff;animation:rise .5s both}
@keyframes rsBob{50%{transform:translateY(-4px)}}
.rs-track{background:linear-gradient(#e8c48c,#c99a62);border-radius:18px;padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.rs-lane{position:relative;height:46px;border-bottom:3px dashed rgba(90,48,32,.35)}
.rs-marks{position:absolute;inset:0 60px 0 0;display:flex;justify-content:space-around}
.rs-marks i{width:3px;background:rgba(90,48,32,.35)}
.rs-chariot{position:absolute;top:4px;left:calc(var(--p) / 3 * (100% - 120px));display:flex;align-items:center;gap:4px;font-size:28px;transition:left .8s cubic-bezier(.3,1.2,.5,1)}
.rs-chariot .sym{width:24px;height:24px}
.rs-lane b{position:absolute;right:0;top:12px;color:#3a2416;font-size:14px}
.rs-depth{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;background:linear-gradient(#0b2c4d,#04121f);border-radius:18px;padding:12px}
.rs-gauge{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.rs-gauge i{font-style:normal;text-align:center;padding:6px 2px;border-radius:10px;background:rgba(255,255,255,.06);font-size:12px;color:#8fb6d8}
.rs-gauge i b{display:block;font-family:var(--head);font-size:20px;color:#fff}
.rs-gauge i.done{background:rgba(95,208,138,.25)}.rs-gauge i.next{box-shadow:inset 0 0 0 2px #8fe3ff}
.rs-pot{font-weight:800;font-size:18px;text-align:center}.rs-pot b{display:block;font-family:var(--head);font-size:34px;color:#f3d98f}
.rs-hull{display:block;margin-top:4px;font-size:13px;color:#5fd08a}.rs-hull.creak{color:#f0b44c;animation:rsShake .5s ease 2}.rs-hull.gone{color:#ff7a6a}
@keyframes rsShake{25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.rs-chest{display:flex;align-items:center;gap:16px;background:rgba(10,24,30,.8);border-radius:18px;padding:12px 16px}
.rs-box{position:relative;width:96px;height:66px;border-radius:12px 12px 6px 6px;background:linear-gradient(#8a5a2c,#5a3a1c);box-shadow:inset 0 0 0 4px #c9a24a;display:flex;align-items:center;justify-content:center}
.rs-box span{font-family:var(--head);font-size:30px;color:#ffd96a;text-shadow:0 2px 0 #5a3a1c}
.rs-chest p{margin:0;font-weight:800;font-size:clamp(16px,1.4vw,20px)}
.rs-torch{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:800;color:#ffcf6a}
.rs-torch span{font-size:26px;animation:rsFlick .35s ease-in-out infinite alternate}
.qtorch .w{transition:opacity .35s,filter .35s,color .35s;opacity:.08;filter:blur(3px)}
.qtorch .w.lit{opacity:1;filter:none}
.rs-land{background:linear-gradient(#bfe6fb,#7cb85e 55%);border-radius:18px;padding:10px 0;overflow:hidden;min-height:96px;display:flex;align-items:center}
.rs-land.gone{justify-content:center;color:#21160c;font-weight:900}
.rs-strip{display:flex;gap:36px;padding-left:100%;white-space:nowrap;animation:rsDrift 12s linear forwards}
.rs-strip.still{animation:none;padding-left:16px;flex-wrap:wrap;gap:16px;white-space:normal}
.rs-thing{display:inline-flex;gap:2px;flex:none}
.rs-thing svg{width:clamp(48px,5.5vw,80px);height:clamp(48px,5.5vw,80px)}
@keyframes rsDrift{to{transform:translateX(-100%)}}
.rs-plates{display:flex;justify-content:center;gap:clamp(14px,3vw,40px);background:rgba(20,10,30,.8);border:1px solid rgba(243,217,143,.3);border-radius:18px;padding:26px 16px 12px}
.rs-pole{position:relative;width:7px;height:clamp(60px,8vh,90px);background:linear-gradient(90deg,#f3e6c8,#c9b48a);border-radius:3px;opacity:.25}
.rs-pole i{position:absolute;left:50%;top:-10px;width:clamp(44px,4.4vw,64px);height:16px;transform-origin:50% 50%;margin-left:calc(clamp(44px,4.4vw,64px) / -2);border-radius:50%;background:radial-gradient(#fff 20%,#ef7aa0 22%,#ef7aa0 40%,#fff 42%,#f0b44c 70%);box-shadow:0 2px 8px rgba(0,0,0,.4);display:none}
.rs-pole.up{opacity:1}.rs-pole.up i{display:block;animation:rsSpin .5s linear infinite}
@keyframes rsSpin{0%{transform:scaleX(1) rotate(-6deg)}50%{transform:scaleX(.55) rotate(6deg)}100%{transform:scaleX(1) rotate(-6deg)}}
@media (max-width:700px){.rs-mys,.rs-fly{grid-template-columns:minmax(0,1fr)}.rs-sus{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){.rs-flame,.rs-plane,.rs-torch span,.rs-pole.up i,.rs-hints li.on{animation:none}.rs-strip{animation:none;padding-left:16px;flex-wrap:wrap;white-space:normal;gap:16px}.rs-car,.rs-chariot{transition:none}}
`;
let styled = false;
function ensureStyle(){ if (styled) return; styled = true; const st = document.createElement('style'); st.id = 'tlr-style'; st.textContent = CSS; document.head.appendChild(st); }

window.TL_ROUNDS = { types: TYPES, ensureStyle, PLACES, makeMystery, makeCountryside, memoryQuestions, last: LAST };
})();
