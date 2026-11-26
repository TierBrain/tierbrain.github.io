/* Twelve Lamps: the sound of each world (the ten original worlds, plus the twelve biblical ones at the end).
   Everything is made in the browser as it plays, so there are no sound files to download and nothing borrowed.
   Each world has a quiet bed (wind, rain, a hum) and things that happen now and then. Where the picture shows an
   event on a fixed beat (lightning, the sonar ring, the balloon's burner, the fireworks, a chariot passing), the
   sound is timed to land with it. The page passes its own audio context and output, so the site-wide sound
   switch applies, and turns the level down while a question is up so voices carry over it. */
(function(){
'use strict';

function start(id, ac, out){
  if (!ac || !out || !WORLDS[id]) return null;
  const bus = ac.createGain(), t0 = ac.currentTime + .05, nodes = [], timers = [];
  bus.gain.setValueAtTime(0, ac.currentTime); bus.gain.linearRampToValueAtTime(.5, t0 + 1.5); bus.connect(out);
  let noiseBuf = null;
  const noiseBuffer = () => { if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; };
  const keep = n => { nodes.push(n); return n; };

  /* a steady bed of filtered noise, gently breathing */
  function bed(type, freq, q, gain, lfoHz, lfoDepth, freqLfo){
    const s = keep(ac.createBufferSource()), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(); s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q || .7; g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(bus); s.start(t0);
    if (lfoHz) { const l = keep(ac.createOscillator()), d = ac.createGain(); l.frequency.value = lfoHz; d.gain.value = freqLfo ? freqLfo : gain * (lfoDepth || .5); l.connect(d); d.connect(freqLfo ? f.frequency : g.gain); l.start(t0); }
    return g; }
  /* a held note (a drone or a hum) */
  function drone(type, freq, gain, lp, amHz, amDepth){
    const o = keep(ac.createOscillator()), f = ac.createBiquadFilter(), g = ac.createGain(); o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = lp || 800; g.gain.value = gain;
    o.connect(f); f.connect(g); g.connect(bus); o.start(t0);
    if (amHz) { const l = keep(ac.createOscillator()), d = ac.createGain(); l.frequency.value = amHz; d.gain.value = gain * (amDepth || .5); l.connect(d); d.connect(g.gain); l.start(t0); } }
  /* one-off sounds at an exact time */
  function tone(at, f1, f2, dur, v, type, lp){ if (at < ac.currentTime) return; const o = ac.createOscillator(), g = ac.createGain(); let last = g; o.type = type || 'sine'; o.frequency.setValueAtTime(f1, at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(v, at + Math.min(.02, dur / 4)); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    if (lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; g.connect(fl); last = fl; } o.connect(g); last.connect(bus); o.start(at); o.stop(at + dur + .05); }
  function burst(at, type, f1, f2, dur, v, attack){ if (at < ac.currentTime) return; const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuffer(); f.type = type; f.frequency.setValueAtTime(f1, at); if (f2) f.frequency.exponentialRampToValueAtTime(f2, at + dur); f.Q.value = .8;
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(v, at + (attack || .01)); g.gain.exponentialRampToValueAtTime(.0001, at + dur); s.connect(f); f.connect(g); g.connect(bus); s.start(at, Math.random(), dur + .05); }
  const bell = (at, f, v) => { tone(at, f, 0, 1.2, v); tone(at, f * 2.76, 0, .5, v * .3); };
  /* events: every `period` seconds from `first` (scene time), or at random gaps */
  function every(period, first, fn){ let n = 0; const tick = () => { const now = ac.currentTime - t0; while (first + n * period < now + 1.2) { const at = t0 + first + n * period; if (at > ac.currentTime - .02) fn(Math.max(at, ac.currentTime)); n++; } }; tick(); timers.push(setInterval(tick, 400)); }
  function now_and_then(min, max, fn){ let next = ac.currentTime + min * Math.random(); const tick = () => { while (next < ac.currentTime + 1.2) { fn(Math.max(next, ac.currentTime)); next += min + Math.random() * (max - min); } }; tick(); timers.push(setInterval(tick, 400)); }

  /* follows the lightning on screen: calls fn(at) just after each flash begins, so thunder arrives with the light, not on a separate clock.
     If no flash can be found on the page after 1.5 s, falls back to a steady period. */
  function onFlash(sel, pct, fn, fallback){ let last = null, found = false;
    const poll = () => { const el = document.querySelector(sel); if (!el || !el.getAnimations) return; const an = el.getAnimations().find(x => x.animationName === 'tlb-flash'); if (!an || !an.effect) return; found = true;
      const p = an.effect.getComputedTiming().progress; if (p == null) return; if (last !== null && last < pct && p >= pct) fn(ac.currentTime); last = p; };
    timers.push(setInterval(poll, 50));
    if (fallback) timers.push(setTimeout(() => { if (!found) every(fallback, 0, fn); }, 1500)); }

  WORLDS[id]({ ac, bed, drone, tone, burst, bell, every, now_and_then, onFlash, t0 });
  return {
    level(v, secs){ try { bus.gain.cancelScheduledValues(ac.currentTime); bus.gain.setTargetAtTime(v, ac.currentTime, (secs || .6) / 3); } catch (e) {} },
    stop(){ timers.forEach(clearInterval); try { bus.gain.cancelScheduledValues(ac.currentTime); bus.gain.setTargetAtTime(0, ac.currentTime, .15); } catch (e) {}
      setTimeout(() => { nodes.forEach(n => { try { n.stop(); } catch (e) {} }); try { bus.disconnect(); } catch (e) {} }, 900); }
  };
}

const WORLDS = {
  /* chariots thunder past (the picture sends one at about 2.7 s and another at 7.2 s in every 9) */
  rome(a){ a.bed('bandpass', 650, .5, .05, .15, .5);
    const pass = at => { a.burst(at - .6, 'bandpass', 500, 900, 2.4, .1, 1); for (let k = 0; k < 14; k++) a.tone(at - .5 + k * .11, 95, 60, .07, .14, 'sine'); };
    a.every(9, 2.7, pass); a.every(9, 7.2, pass); },
  /* the hull hums, bubbles rise, and the sonar pings with each ring */
  submarine(a){ a.drone('triangle', 55, .05, 300); a.drone('triangle', 110, .02, 300, .1, .6); a.bed('lowpass', 220, .7, .04, .07, .5);
    a.every(4.2, 0, at => { a.tone(at, 1400, 1380, 1.4, .07); a.tone(at + .35, 1400, 1380, 1, .025); a.tone(at + .7, 1400, 1380, .8, .01); });
    a.now_and_then(.3, 1.1, at => a.tone(at, 300 + Math.random() * 300, 900 + Math.random() * 600, .07, .03));
    a.now_and_then(9, 15, at => a.tone(at, 80, 58, 1.6, .05, 'sawtooth', 300)); },
  /* propellers drone, wind past the cabin */
  flight(a){ a.drone('sawtooth', 92, .035, 380, 17, .6); a.drone('sawtooth', 46, .03, 220, 8.5, .4); a.bed('bandpass', 1400, .4, .03, .09, .6); },
  /* the engine chuffs, the wheels click over the rail joints, and now and then a whistle */
  railway(a){ a.bed('lowpass', 300, .7, .025, .2, .4);
    a.every(.36, 0, at => a.burst(at, 'bandpass', 900, 500, .14, .07));
    a.every(1.25, .2, at => { a.burst(at, 'highpass', 3200, 0, .025, .06); a.burst(at + .13, 'highpass', 3200, 0, .025, .05); });
    a.every(15, 4, at => { a.tone(at, 740, 0, 1.3, .045, 'sine'); a.tone(at, 880, 0, 1.3, .035, 'sine'); }); },
  /* rain and waves; thunder follows the lightning (a flash at 5.8 s in every 9) */
  galleon(a){ a.bed('highpass', 2200, .5, .05, .3, .3); a.bed('lowpass', 420, .6, .07, .12, .7);
    a.every(9, 6.1, at => { a.burst(at, 'lowpass', 160, 60, 2.8, .26, .05); a.burst(at + .4, 'lowpass', 120, 50, 2, .14, .2); });
    a.now_and_then(5, 10, at => a.tone(at, 140, 110, 1.1, .03, 'sawtooth', 400)); },
  /* the fire crackles, wind at the cave mouth, a drip lands in the pool (every 3.8 s) */
  cave(a){ a.bed('lowpass', 320, .7, .05, .5, .5); a.bed('bandpass', 500, 1.2, .015, .05, 0, 200);
    a.now_and_then(.05, .3, at => a.burst(at, 'highpass', 2500 + Math.random() * 3000, 0, .012 + Math.random() * .02, .03 + Math.random() * .05));
    a.every(3.8, 3.8, at => { a.tone(at, 1800, 1100, .12, .05); a.tone(at + .25, 1700, 1100, .1, .015); }); },
  /* a breeze, birdsong, and the burner's roar with each flare (3.2 s in every 5) */
  balloon(a){ a.bed('bandpass', 500, .5, .025, .1, .6);
    a.every(5, 3.1, at => a.burst(at, 'lowpass', 700, 1100, .9, .12, .15));
    a.now_and_then(1.5, 4.5, at => { const b = 2600 + Math.random() * 1400; for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) a.tone(at + k * .11, b, b * (1.1 + Math.random() * .3), .08, .02); }); },
  /* wind round the eaves, a clock, an owl, and thunder after the lightning (5.3 s in every 13) */
  manor(a){ a.bed('bandpass', 380, 1.4, .045, .07, 0, 220);
    a.every(1, .5, (at) => a.burst(at, 'highpass', 4200, 0, .02, .025));
    a.now_and_then(8, 14, at => { a.tone(at, 390, 360, .45, .04); a.tone(at + .6, 390, 350, .7, .04); });
    a.every(13, 5.8, at => a.burst(at, 'lowpass', 150, 55, 3, .2, .08)); },
  /* a little fairground-organ waltz, the crowd, and fireworks popping with the bursts */
  bigtop(a){ a.bed('bandpass', 700, .5, .025, .2, .5);
    const tune = [72, 76, 79, 76, 77, 81, 79, 77, 76, 79, 84, 79, 77, 74, 71, 74, 72, 76, 79, 81, 79, 76, 74, 72];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12), beat = .42;
    a.every(tune.length * beat, .3, at => tune.forEach((m, k) => { a.tone(at + k * beat, hz(m), 0, beat * .9, .018, 'square', 1800); if (k % 3 === 0) a.tone(at + k * beat, hz(m - 24), 0, beat * .8, .03, 'triangle'); else a.tone(at + k * beat, hz(m - 12), 0, beat * .5, .012, 'triangle'); }));
    [.55, 4.25, 2.45, 3.35].forEach(first => a.every(5.5, first, at => { a.burst(at - .5, 'bandpass', 600, 2400, .45, .03); a.burst(at, 'lowpass', 300, 120, .5, .12); for (let k = 0; k < 6; k++) a.burst(at + .15 + Math.random() * .6, 'highpass', 3000, 0, .02, .04); })); },
  /* traffic, a horn, the tram's bell as it crosses, and a short swing phrase from somewhere */
  city(a){ a.bed('lowpass', 160, .7, .045, .1, .4); a.bed('bandpass', 520, .5, .02, .17, .5);
    a.now_and_then(7, 14, at => { a.tone(at, 415, 0, .22, .025, 'square', 1200); a.tone(at + .26, 370, 0, .3, .025, 'square', 1200); });
    a.every(14, 8.2, at => { a.bell(at, 1500, .05); a.bell(at + .32, 1500, .045); });
    const hz = m => 440 * Math.pow(2, (m - 69) / 12), riff = [[0, 67, .25], [.33, 70, .2], [.5, 72, .45], [1, 75, .22], [1.33, 72, .2], [1.5, 70, .6]];
    a.every(16, 5, at => riff.forEach(([d, m, l]) => a.tone(at + d, hz(m), 0, l, .03, 'sawtooth', 1300))); },
  /* ===== Twelve Lamps: the twelve biblical worlds ===== */
  /* the Red Sea: walls of water roar either side, spray hisses, and a low horn calls now and then */
  redsea(a){ a.bed('lowpass', 420, .7, .09, .12, .35); a.bed('bandpass', 2600, .5, .02, .2, .6); a.drone('sine', 46, .045, 160, .06, .5);
    a.every(21, 6, at => { a.tone(at, 196, 188, 2.6, .05, 'sawtooth', 520); a.tone(at, 294, 282, 2.6, .02, 'sawtooth', 520); });
    a.now_and_then(.3, 1.1, at => a.burst(at, 'highpass', 3500, 0, .05, .025)); },
  /* Jonah: deep water, bubbles rising, a whale's long song, the storm muffled far above */
  jonah(a){ a.drone('sine', 41, .05, 160); a.bed('lowpass', 170, .7, .05, .07, .5); a.bed('lowpass', 110, .7, .03, .05, .6);
    a.now_and_then(.25, 1, at => a.tone(at, 400 + Math.random() * 400, 1100 + Math.random() * 600, .08, .025));
    a.now_and_then(11, 19, at => { a.tone(at, 260, 640, 2.2, .05, 'sine', 900); a.tone(at + 2.3, 640, 330, 2.6, .045, 'sine', 900); a.tone(at + 5, 330, 420, 1.6, .03, 'sine', 900); }); },
  /* Paul's journeys: waves along the hull, creaking timber, gulls, a harbour bell far off */
  paul(a){ a.bed('lowpass', 520, .6, .06, .11, .5); a.bed('bandpass', 900, .4, .022, .08, .6);
    a.now_and_then(5, 9, at => a.tone(at, 130, 108, .7, .03, 'sawtooth', 320));
    a.now_and_then(6, 12, at => { a.tone(at, 1900, 1500, .22, .02, 'triangle'); a.tone(at + .28, 1700, 1300, .3, .018, 'triangle'); });
    a.every(14, 3, at => { a.bell(at, 660, .03); a.bell(at + .9, 660, .02); }); },
  /* Joseph's cup: a desert night, crickets, a campfire, a camel's bell, a shimmer from the silver */
  joseph(a){ a.bed('bandpass', 500, .5, .03, .06, .6); a.bed('lowpass', 200, .6, .02);
    a.now_and_then(.15, .45, at => { a.tone(at, 4300, 4300, .035, .007); a.tone(at + .07, 4300, 4300, .035, .007); });
    a.now_and_then(.15, .7, at => a.burst(at, 'highpass', 2600, 0, .035, .035));
    a.every(2.6, 0, at => a.tone(at, 520 + Math.random() * 20, 0, .5, .012));
    a.every(11, 5, at => { a.tone(at, 2093, 0, 1.4, .018); a.tone(at + .15, 2637, 0, 1.2, .012); }); },
  /* the storm on Galilee: rain, wind, swell, thunder and creaking wood */
  galilee(a){ a.bed('bandpass', 3000, .5, .06, .3, .4); a.bed('bandpass', 600, .5, .06, .2, .6); a.bed('lowpass', 260, .7, .07, .15, .5);
    /* thunder follows each lightning flash in the scene: a crack, then a long roll */
    a.onFlash('.tlw-galilee [style*="tlb-flash"]', .91, at => { const d = .35 + Math.random() * .4; a.burst(at + d, 'highpass', 2400, 0, .1, .08, .01); a.burst(at + d + .05, 'lowpass', 160, 50, 3.4, .17, .2); a.burst(at + d + .6, 'lowpass', 120, 45, 2.2, .1, .3); }, 7);
    a.now_and_then(2, 5, at => a.tone(at, 110, 90, .8, .04, 'sawtooth', 300)); },
  /* the scroll cave: drips, a hollow hum, the torch, and a scroll rustling now and then */
  scroll(a){ a.drone('triangle', 70, .04, 200); a.bed('lowpass', 300, .7, .02);
    a.now_and_then(1.2, 3.5, at => { a.tone(at, 1800, 900, .12, .03); a.tone(at + .22, 1800, 900, .12, .01); });
    a.now_and_then(.2, .8, at => a.burst(at, 'highpass', 2800, 0, .04, .035));
    a.every(11, 4, at => a.burst(at, 'bandpass', 4000, 0, .45, .02, .12)); },
  /* Noah's Ark: water lapping, drips off the eaves, a creaking hull, a dove cooing, a hopeful hum */
  ark(a){ a.bed('lowpass', 420, .6, .04, .1, .5); a.bed('highpass', 5000, .4, .008, .13, .5); a.drone('sine', 131, .02, 600, .07, .5); a.drone('sine', 196, .014, 600, .05, .5);
    a.now_and_then(6, 12, at => a.tone(at, 105, 90, .9, .03, 'sawtooth', 280));
    a.now_and_then(8, 16, at => { a.tone(at, 430, 380, .35, .03, 'sine', 900); a.tone(at + .5, 430, 370, .45, .03, 'sine', 900); a.tone(at + 1.1, 400, 360, .5, .025, 'sine', 900); }); },
  /* the ten lamps: a hush at midnight, flames, and a slow tune on soft bells from the wedding house */
  lamps(a){ a.drone('sine', 98, .02, 400); a.bed('bandpass', 400, .5, .02, .06, .6);
    a.now_and_then(.4, 1.4, at => a.burst(at, 'bandpass', 1200, 0, .08, .02));
    const pent = [392, 440, 523, 587, 659]; a.every(7, 1, at => [0, 1.1, 2.3, 3.2].forEach(d => a.bell(at + d, pent[Math.floor(Math.random() * pent.length)], .022))); },
  /* Nehemiah's wall: mallet on stone, chisels, the wind over the hill, a trumpet at the call to arms */
  nehemiah(a){ a.bed('bandpass', 500, .5, .03, .08, .6);
    a.every(1.6, 0, at => { a.burst(at, 'bandpass', 2400, 0, .06, .05); a.tone(at, 820, 600, .08, .03, 'triangle'); a.burst(at + .8, 'bandpass', 2000, 0, .05, .035); });
    a.now_and_then(.2, 1, at => a.burst(at, 'highpass', 3000, 0, .03, .02));
    a.every(26, 12, at => { a.tone(at, 392, 0, .5, .04, 'sawtooth', 900); a.tone(at + .55, 523, 0, .9, .045, 'sawtooth', 900); }); },
  /* Jacob's ladder: a pad of shimmering held notes, wind, and chimes as angels pass */
  jacob(a){ [196, 294, 392].forEach((f, k) => a.drone('sine', f, .02, 900, .06 + k * .02, .6)); a.bed('bandpass', 700, .4, .012, .07, .6);
    const pent = [784, 988, 1175, 1568]; a.now_and_then(2, 5, at => a.bell(at, pent[Math.floor(Math.random() * pent.length)], .02)); },
  /* Mount Sinai: rolling thunder, a rising horn, crackling fire, wind */
  sinai(a){ a.bed('lowpass', 140, .7, .09, .1, .4); a.bed('bandpass', 900, .5, .04, .09, .6); a.drone('sine', 44, .04, 150);
    /* thunder follows each flash of lightning on the mountain, and a lower rumble rolls between */
    a.onFlash('.tlw-sinai [style*="tlb-flash"]', .91, at => { const d = .3 + Math.random() * .35; a.burst(at + d, 'highpass', 2200, 0, .12, .09, .01); a.burst(at + d + .05, 'lowpass', 150, 48, 3.8, .18, .25); a.burst(at + d + .7, 'lowpass', 110, 42, 2.6, .1, .35); }, 8);
    a.now_and_then(9, 16, at => a.burst(at, 'lowpass', 100, 45, 3, .06, .5));
    a.every(22, 4, at => { a.tone(at, 180, 186, 4.6, .05, 'sawtooth', 600); a.tone(at, 270, 279, 4.6, .02, 'sawtooth', 600); });
    a.now_and_then(.2, .6, at => a.burst(at, 'highpass', 3000, 0, .03, .03)); },
  /* the lions' den: a deep hush, slow breathing, a drip, a rare growl, and a soft bell from the light above */
  daniel(a){ a.drone('triangle', 55, .04, 200); a.bed('lowpass', 210, .7, .05, .22, .8); a.drone('sine', 262, .01, 500, .05, .7);
    a.now_and_then(14, 24, at => a.tone(at, 72, 54, 2.3, .05, 'sawtooth', 200));
    a.now_and_then(3, 7, at => a.tone(at, 1500, 700, .1, .02));
    a.every(17, 6, at => a.bell(at, 523, .015)); }

};

window.TL_SOUND = { start, ids: Object.keys(WORLDS) };
})();
