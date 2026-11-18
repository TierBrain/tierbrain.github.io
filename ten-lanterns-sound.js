/* Ten Lanterns: the sound of each world.
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

  WORLDS[id]({ ac, bed, drone, tone, burst, bell, every, now_and_then, t0 });
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
    a.every(16, 5, at => riff.forEach(([d, m, l]) => a.tone(at + d, hz(m), 0, l, .03, 'sawtooth', 1300))); }
};

window.TL_SOUND = { start, ids: Object.keys(WORLDS) };
})();
