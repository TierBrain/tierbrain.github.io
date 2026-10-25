/* First Finger: answers first, question last, draw when you dare.
   The four answers go up, the question is stamped on a wanted poster a word at a time, and you draw
   whenever you think you know it. The earlier you draw, the more a right answer is worth. Finish the
   question before its giveaway word and you've called it, for double. A wrong answer is a shot in the foot.

   Played on your own against the clock, or in a room with friends on their own phones. In a room, every
   phone runs the same timeline from the start signal's server time, so the words land together; each
   player's draws and answers go up as rows, and every phone adds up the same scores from them.

   Needs window.FF_SETS (ff-sets.js or ff-sets-bible.js) loaded first.
   <script src="first-finger.js?v=1" data-edition="gen"></script>  (gen or bib) */
(function(){
'use strict';
var S0 = document.currentScript || document.querySelector('script[src*="first-finger.js"]');
var EDITION = (S0 && S0.getAttribute('data-edition')) || 'gen';
var SETS = window.FF_SETS || [];
var $ = function(id){ return document.getElementById(id); };
var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

var SB_URL = 'https://cgrbwtcydgfkbqhseeap.supabase.co', SB_KEY = 'sb_publishable_YHNDjX8gcSYJYJVWo_TmMw_8z6BBVAU';
var access = RaceAccess.create(SB_URL, SB_KEY, {family:'firstfinger', edition:EDITION === 'bib' ? 'bible' : 'general'});
var roomEpoch=0, activeRun='', joining=false,leaving=false,pollBusy=false, netBox=null;
var GO = '__GO__', ROUNDS = 9, STUDY = 2600, GRACE = 3000, ANSWER = 11000, REVEAL = 6000, COUNT = 4000, POLL = 1200, HB = 2600;
var SPEED = { 900:'Mosey', 650:'Trot', 450:'Gallop' };

/* ---------------- small helpers ---------------- */
function words(s){ return s.split(/\s+/); }
function norm(w){ return w.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function prefixLen(a, b){ var n = 0; while(n < a.length && n < b.length && norm(a[n]) === norm(b[n])) n++; return n; }
/* the giveaway word: the first word that rules out every other question in the set (1-based) */
function giveaway(set, qi){ var w = words(set.q[qi][0]), g = 0;
  set.q.forEach(function(o, j){ if(j !== qi) g = Math.max(g, prefixLen(w, words(o[0]))); }); return Math.min(w.length, g + 1); }
function hstr(s){ var h = 2166136261 >>> 0; for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(a){ return function(){ a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
function shuffle(arr, r){ r = r || Math.random; var a = arr.slice(); for(var i = a.length - 1; i > 0; i--){ var j = Math.floor(r()*(i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
function store(k, v){ try{ if(v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }catch(e){ return null; } }
function ts(r){ var c = String(r && r.created_at || ''); if(/^\d+(\.\d+)?$/.test(c)) return parseFloat(c)*1000; var x = Date.parse(c); return isNaN(x) ? 0 : x; }
function valueAt(k, n){ return Math.max(50, Math.round((50 + 350*(1 - k/n))/10)*10); }
function show(id){ ['menuScreen', 'lobbyScreen', 'countScreen', 'gameScreen', 'endScreen'].forEach(function(s){ $(s).classList.toggle('hidden', s !== id); }); }

/* ---------------- sound, through the site's shared sound switch ---------------- */
var ac = null;
function tone(f, d, type, g, to){ try{ if(!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); var o = ac.createOscillator(), v = ac.createGain(), n = ac.currentTime;
  o.type = type || 'sine'; o.frequency.setValueAtTime(f, n); if(to) o.frequency.exponentialRampToValueAtTime(to, n + d); o.connect(v); v.connect(ac.destination);
  v.gain.setValueAtTime(g || .08, n); v.gain.exponentialRampToValueAtTime(.0001, n + d); o.start(n); o.stop(n + d + .02); }catch(e){} }
function bang(g){ try{ if(!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); var n = ac.currentTime, len = Math.floor(ac.sampleRate*.35), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
  for(var i = 0; i < len; i++) d[i] = (Math.random()*2 - 1)*Math.pow(1 - i/len, 3); var s = ac.createBufferSource(); s.buffer = b; var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
  var v = ac.createGain(); v.gain.value = g || .35; s.connect(f); f.connect(v); v.connect(ac.destination); s.start(n); }catch(e){} }
var SND = { tick:function(){ tone(1400, .04, 'square', .025); }, draw:function(){ bang(.4); }, rival:function(){ bang(.12); }, count:function(){ tone(440, .12, 'square', .08); }, go:function(){ tone(880, .3, 'square', .09); },
  right:function(){ tone(660, .12, 'triangle', .09); setTimeout(function(){ tone(990, .2, 'triangle', .09); }, 110); },
  wrong:function(){ tone(300, .4, 'sawtooth', .06, 90); }, called:function(){ [523, 659, 784, 1046].forEach(function(f, i){ setTimeout(function(){ tone(f, .22, 'triangle', .08); }, i*90); }); },
  bell:function(){ [0, 700, 1400].forEach(function(t){ setTimeout(function(){ tone(880, 1.1, 'sine', .07); tone(1320, .8, 'sine', .03); }, t); }); } };

/* ---------------- the street at high noon ---------------- */
var scene = { puffs:[], noon:false, flashAt:-9, starAt:-9 };
function clock(){ return performance.now()/1000; }
function fit(cv){ var w = cv.clientWidth || 360, h = cv.clientHeight || 110, app = $('app'), z = app ? (parseFloat(app.style.zoom) || 1) : 1, d = Math.min(3.5, (window.devicePixelRatio || 1)*z);
  if(cv.width !== Math.round(w*d) || cv.height !== Math.round(h*d)){ cv.width = Math.round(w*d); cv.height = Math.round(h*d); } var X = cv.getContext('2d'); X.setTransform(d, 0, 0, d, 0, 0); return { X:X, w:w, h:h }; }
function drawStreet(cv, t){
  // Reduced motion freezes the scenery's clock, but transient effects still
  // expire against the same real clock used when puff() creates them.
  var effectTime = RM ? clock() : t;
  var F = fit(cv), X = F.X, w = F.w, h = F.h, hz = h*.62;
  var g = X.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, scene.noon ? '#f6b04f' : '#8fc4e8'); g.addColorStop(1, scene.noon ? '#fde3a6' : '#f6e2b8'); X.fillStyle = g; X.fillRect(0, 0, w, hz);
  var sx = w*.5, sy = h*.16, sg = X.createRadialGradient(sx, sy, 0, sx, sy, h*.6); sg.addColorStop(0, 'rgba(255,250,225,.95)'); sg.addColorStop(.18, 'rgba(255,240,190,.6)'); sg.addColorStop(1, 'rgba(255,230,160,0)');
  X.fillStyle = sg; X.fillRect(0, 0, w, hz); X.fillStyle = '#fffbe8'; X.beginPath(); X.arc(sx, sy, h*.09, 0, 7); X.fill();
  X.fillStyle = scene.noon ? '#c77a45' : '#c98a5a'; X.beginPath(); X.moveTo(0, hz); X.lineTo(w*.06, hz - h*.16); X.lineTo(w*.2, hz - h*.16); X.lineTo(w*.25, hz - h*.05); X.lineTo(w*.62, hz - h*.05); X.lineTo(w*.66, hz - h*.2); X.lineTo(w*.83, hz - h*.2); X.lineTo(w*.88, hz); X.closePath(); X.fill();
  X.fillStyle = 'rgba(120,60,30,.25)'; X.fillRect(0, hz - h*.03, w, h*.03);
  var gg = X.createLinearGradient(0, hz, 0, h); gg.addColorStop(0, '#d9a56b'); gg.addColorStop(1, '#b07a45'); X.fillStyle = gg; X.fillRect(0, hz, w, h - hz);
  X.strokeStyle = 'rgba(110,70,35,.35)'; X.lineWidth = 1; for(var r = 0; r < 4; r++){ X.beginPath(); X.moveTo(0, hz + 6 + r*9); X.lineTo(w, hz + 8 + r*10); X.stroke(); }
  function front(x, y, fw, fh, col, roof, sign){ X.fillStyle = col; X.fillRect(x, y, fw, fh); X.fillStyle = 'rgba(0,0,0,.18)'; for(var i = 0; i < fw; i += 6) X.fillRect(x + i, y, 1, fh);
    X.fillStyle = roof; X.fillRect(x - 3, y - 4, fw + 6, 6); X.fillStyle = '#2b1a0f'; X.fillRect(x + fw*.3, y + fh*.45, fw*.4, fh*.55);
    X.fillStyle = '#f1e2c2'; X.fillRect(x + fw*.12, y + fh*.08, fw*.76, fh*.22); X.fillStyle = '#2b1a0f'; X.font = Math.round(fh*.17) + "px Rye, Georgia, serif"; X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillText(sign, x + fw/2, y + fh*.2); }
  front(w*.02, hz - h*.42, w*.3, h*.5, '#8a5a35', '#5e3a20', 'SALOON');
  var sw = Math.sin(t*2)*.15 + (effectTime - scene.flashAt < .6 ? Math.sin(t*30)*.4 : 0); X.save(); X.translate(w*.02 + w*.3*.3, hz - h*.42 + h*.5*.62); X.fillStyle = '#b07a45';
  X.save(); X.scale(Math.cos(sw), 1); X.fillRect(0, 0, w*.3*.2, h*.2); X.restore(); X.translate(w*.3*.4, 0); X.save(); X.scale(-Math.cos(sw), 1); X.fillRect(0, 0, w*.3*.2, h*.2); X.restore(); X.restore();
  front(w*.7, hz - h*.36, w*.28, h*.44, '#7b6a55', '#5b4a3a', 'GENERAL');
  var cx = w*.5, cy = hz - h*.3, cr = h*.13; X.fillStyle = '#5e3a20'; X.fillRect(cx - 2, cy, 4, h*.4); X.fillStyle = '#f1e2c2'; X.beginPath(); X.arc(cx, cy, cr, 0, 7); X.fill();
  X.strokeStyle = '#2b1a0f'; X.lineWidth = 2; X.stroke(); var ang = scene.noon ? -Math.PI/2 : -Math.PI/2 - .5 + (t*.02 % .4);
  X.beginPath(); X.moveTo(cx, cy); X.lineTo(cx + Math.cos(ang)*cr*.75, cy + Math.sin(ang)*cr*.75); X.stroke(); X.beginPath(); X.moveTo(cx, cy); X.lineTo(cx, cy - cr*.55); X.stroke();
  var tx = ((t*38) % (w + 120)) - 60, ty = h - h*.18 - Math.abs(Math.sin(t*4))*h*.06; X.save(); X.translate(tx, ty); X.rotate(t*5); X.strokeStyle = '#8a6a3a'; X.lineWidth = 1.2;
  for(var k = 0; k < 7; k++){ X.beginPath(); X.ellipse(0, 0, h*.07, h*.035, k*.45, 0, 7); X.stroke(); } X.restore();
  scene.puffs = scene.puffs.filter(function(p){ var a = effectTime - p.at; if(a > 1.6) return false;
    if(a < .12){ X.fillStyle = 'rgba(255,230,140,' + (1 - a/.12) + ')'; X.beginPath(); X.arc(p.x, p.y, 10, 0, 7); X.fill(); }
    for(var i = 0; i < 4; i++){ X.fillStyle = 'rgba(235,235,235,' + (.55*(1 - a/1.6)) + ')'; X.beginPath(); X.arc(p.x + i*6 + a*20, p.y - a*16 - i*2, 5 + a*10, 0, 7); X.fill(); }
    if(a < .7){ X.font = '15px Rye, Georgia, serif'; X.textAlign = 'center'; X.lineWidth = 3; X.strokeStyle = '#2b1a0f'; X.strokeText(p.txt, p.x, p.y - 16 - a*10); X.fillStyle = '#ffd36b'; X.fillText(p.txt, p.x, p.y - 16 - a*10); }
    return true; });
  var sa = effectTime - scene.starAt; if(sa < 1.4){ X.save(); X.translate(w/2, h*.45); var k2 = Math.min(1, sa*4); X.scale(k2, k2); X.rotate(sa*.6); X.fillStyle = '#ffd36b'; X.strokeStyle = '#8a6420'; X.lineWidth = 2; X.beginPath();
    for(var s = 0; s < 12; s++){ var rr = s % 2 ? h*.12 : h*.28, an = s*Math.PI/6 - Math.PI/2; X.lineTo(Math.cos(an)*rr, Math.sin(an)*rr); } X.closePath(); X.globalAlpha = Math.min(1, (1.4 - sa)*3); X.fill(); X.stroke(); X.restore(); }
  if(scene.noon){ X.fillStyle = 'rgba(255,120,40,' + (.08 + .05*Math.sin(t*3)) + ')'; X.fillRect(0, 0, w, h); }
}
function puff(txt){ var cv = $('street'); scene.puffs.push({ x:30 + Math.random()*((cv.clientWidth || 300) - 60), y:(cv.clientHeight || 110)*.72, at:clock(), txt:txt || 'BANG' }); scene.flashAt = clock(); }
(function loop(){ var t = clock(); ['street0', 'street1', 'street', 'street2'].forEach(function(id){ var cv = $(id); if(cv && cv.offsetParent) drawStreet(cv, RM ? 3 : t); }); requestAnimationFrame(loop); })();

/* ---------------- authenticated, owned race rooms ---------------- */
var F_RIGHT = 1, F_CALLED = 2, F_WRONG = 4, F_NODRAW = 8, F_FROZE = 16;
var offset = 0, bestRtt = 1e9;
function serverNow(){ return Date.now() + offset; }
function syncClock(packet,began){if(!packet)return packet;var ended=Date.now(),at=Date.parse(packet.server_time||'');
  if(Number.isFinite(at)){ var rtt=ended-began; if(rtt<bestRtt||Math.abs(at-(began+ended)/2-offset)>4000){bestRtt=rtt;offset=at-(began+ended)/2;} } return packet; }
function netIssue(issue){
  if(issue&&(issue.code==='race_left'||issue.error&&issue.error.code==='race_left'))return;
  if(issue&&(issue.state==='confirmed'||issue.recovered)){if(netBox)netBox.hidden=true;return;}
  if(!netBox){netBox=document.createElement('div');netBox.id='raceConnection';netBox.setAttribute('role','alert');netBox.style.cssText='position:fixed;z-index:10000;top:12px;left:4%;width:92%;box-sizing:border-box;padding:14px;border:2px solid #d7a34c;border-radius:12px;background:#251b17;color:#fff';
    var message=document.createElement('div');message.id='raceConnectionMessage';netBox.appendChild(message);
    var retry=document.createElement('button');retry.id='raceConnectionRetry';retry.textContent='Retry connection';retry.onclick=function(){retry.disabled=true;Promise.resolve(access.pending()?access.retry():poll()).then(function(){netBox.hidden=true;}).catch(netIssue).finally(function(){retry.disabled=false;});};netBox.appendChild(retry);var quit=document.createElement('button');quit.id='raceConnectionLeave';quit.textContent='Leave room';quit.onclick=leaveRoom;netBox.appendChild(quit);document.body.appendChild(netBox);}
  netBox.hidden=false;$('raceConnectionMessage').textContent=issue&&issue.message||access.message(issue);$('raceConnectionRetry').hidden=!!(issue&&issue.canRetry===false);
}
access.onIssue(netIssue);
function read(){var began=Date.now();return access.state().then(function(packet){syncClock(packet,began);return packet&&packet.rows||[];});}
function post(name,correct,level,flags){
  if(name!==R.me)return Promise.reject(new Error('Only your own gunslinger can publish.'));
  var kind=level>=2000?'answer':'draw',payload=kind==='draw'?{round:level-1000,words:correct}:{round:level-2000,points:correct,flags:flags};
  return access.submit(kind,payload);
}

/* ---------------- state ---------------- */
var R = { code:'', me:'', speed:650, solo:true, phase:'menu', rows:[], roster:[], present:[], pollT:0, hbT:0 };
var G = null;
function speedButtons(){ [].forEach.call(document.querySelectorAll('.spd'), function(b){ b.setAttribute('aria-pressed', String(+b.dataset.ms === R.speed));
  b.onclick = function(){ R.speed = +b.dataset.ms; speedButtons(); showBest(); }; }); }
function bestKey(){ return 'ff2_best_' + EDITION + '_' + R.speed; }
function showBest(){ var b = store(bestKey()), el = $('bestNote'); if(el) el.textContent = b ? 'Your best on your own at ' + SPEED[R.speed] + ': ' + b + '.' : ''; }
function stopGame(){if(G){G.over=true;clearInterval(G.tick);}G=null;scene.noon=false;}
function readName(){ return ($('nameIn').value || '').trim().slice(0, 14); }
$('soloBtn').onclick = function(){if(joining||leaving||access.busy())return;stopGame();roomEpoch++;tone(1,.01);R.solo=true;R.me=readName()||'You';R.code='';startGame(Math.floor(Math.random()*2147483647),R.speed,Date.now()+COUNT,[R.me]);};
$('joinBtn').onclick = enterRoom;
$('codeIn').addEventListener('keydown', function(e){ if(e.key === 'Enter') enterRoom(); });
function enterRoom(){
  if(joining||leaving||access.busy())return;var n=readName(),c=($('codeIn').value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!n){$('menuErr').textContent='Enter a nickname first.';return;}
  if(c.length<4||c.length>12){$('menuErr').textContent='Enter a room code of 4 to 12 letters or numbers.';return;}
  joining=true;var epoch=roomEpoch;$('joinBtn').disabled=true;$('soloBtn').disabled=true;$('menuErr').textContent='Connecting…';var began=Date.now();
  access.enter(c,n).then(function(packet){if(epoch!==roomEpoch||leaving)return;syncClock(packet,began);stopGame();roomEpoch++;R.solo=false;R.me=packet.member.name;R.code=packet.room.code;activeRun='';R.rows=[];R.present=[];
    $('lobbyCode').textContent=R.code;R.phase='lobby';show('lobbyScreen');$('menuErr').textContent='';
    clearInterval(R.pollT);R.pollT=setInterval(poll,POLL);clearInterval(R.hbT);R.hbT=setInterval(function(){if(!leaving&&!R.solo&&R.phase!=='menu'&&!access.busy()){var heartbeatEpoch=roomEpoch;access.heartbeat().catch(function(error){if(heartbeatEpoch===roomEpoch&&!leaving)netIssue(error);});}},HB);return poll();
  }).catch(function(error){if(error.code!=='race_left'&&epoch===roomEpoch&&!leaving)$('menuErr').textContent=access.message(error);}).finally(function(){joining=false;$('joinBtn').disabled=false;$('soloBtn').disabled=false;});
}
function leaveRoom(){
  if(leaving||(access.busy()&&!access.pending()))return;leaving=true;roomEpoch++;clearInterval(R.pollT);clearInterval(R.hbT);stopGame();
  var leavingRequest=R.solo&&!access.pending()?Promise.resolve():access.leave();leavingRequest.then(function(){activeRun='';R.phase='menu';show('menuScreen');showBest();if(netBox)netBox.hidden=true;}).catch(function(error){leaving=false;netIssue(error);}).finally(function(){leaving=false;});
}
$('leaveBtn').onclick=leaveRoom;$('homeBtn').onclick=leaveRoom;
function poll(){
  if(pollBusy||leaving||R.solo||R.phase==='menu')return Promise.resolve();pollBusy=true;var epoch=roomEpoch;
  return read().then(function(rows){if(epoch!==roomEpoch||leaving||R.phase==='menu')return;var packet=access.current();if(!packet)return;var room=packet.room;R.rows=rows;
    R.present=(packet.members||[]).filter(function(member){return serverNow()-Date.parse(member.last_seen)<30000;}).map(function(member){return member.name;});
    if(room.phase==='lobby'){if(R.phase!=='lobby'){stopGame();activeRun='';R.phase='lobby';show('lobbyScreen');}renderLobby();return;}
    if(!(room.roster||[]).some(function(member){return member.id===access.member().id;})){showWaiting(packet);return;}
    if(room.run_id!==activeRun){adoptRun(packet);}else if(G){ingest(rows);}
  }).catch(function(error){if(epoch===roomEpoch&&!leaving)netIssue(error);}).finally(function(){pollBusy=false;});
}
function showWaiting(packet){stopGame();activeRun='';R.phase='waiting';show('lobbyScreen');renderLobby();$('goBtn').disabled=true;$('lobbyNote').textContent='You were not in this showdown’s starting line-up. Wait for the host’s next showdown or leave the room.';}
function adoptRun(packet){
  if(!packet||leaving)return;if(!(packet.room.roster||[]).some(function(member){return member.id===access.member().id;})){showWaiting(packet);return;}
  var room=packet.room;if(!room.started_at||!room.play_at)return;stopGame();activeRun=room.run_id;access.useRun(activeRun);
  var roster=(room.roster||[]).map(function(member){return member.name;});
  if(!roster.length)roster=(packet.members||[]).map(function(member){return member.name;});
  startGame(room.seed,room.options.speed,Date.parse(room.play_at)-offset,roster,Date.parse(room.started_at));ingest(packet.rows||[]);tick();
}
function renderLobby(){
  var box=$('players');box.innerHTML='';R.present.slice().sort().forEach(function(n){var d=document.createElement('div');if(n===R.me)d.className='me';d.textContent=n+(n===R.me?' (you)':'');box.appendChild(d);});
  $('lobbyCount').textContent=R.present.length+(R.present.length===1?' gunslinger in the saloon':' gunslingers in the saloon');
  $('goBtn').disabled=R.present.length<2||!access.isHost()||access.busy();$('goBtn').textContent=access.isHost()?'Start the showdown':'Waiting for the host';
  $('lobbyNote').textContent=R.present.length<2?'Waiting for at least one more player. Share the room code.':access.isHost()?'Ready. Choose the pace and start.':'The host chooses the pace and starts.';
}
$('goBtn').onclick=function(){
  if(R.phase!=='lobby'||!access.isHost()||access.busy())return;$('goBtn').disabled=true;
  var seed=access.current().room.seed,rounds=makeRounds(seed),began=Date.now(),epoch=roomEpoch;
  access.start({speed:R.speed,rounds:rounds.map(function(rd){return {words:rd.n,noon:rd.noon};})}).then(function(packet){if(epoch!==roomEpoch||leaving)return null;syncClock(packet,began);return access.state();}).then(function(packet){if(packet&&epoch===roomEpoch&&!leaving)adoptRun(packet);}).catch(function(error){if(epoch===roomEpoch&&!leaving)netIssue(error);});
};
function makeRounds(seed){var r=rng(seed>>>0),picks=shuffle(SETS.map(function(_,i){return i;}),r).slice(0,ROUNDS);
  return picks.map(function(si,i){var set=SETS[si],qi=Math.floor(r()*set.q.length),q=set.q[qi];return {set:set,q:q,W:words(q[0]),n:words(q[0]).length,g:giveaway(set,qi),answers:shuffle(set.a,r),noon:i===ROUNDS-1};});}

/* ---------------- a game ----------------
   Every phone builds the same nine rounds from the seed, and runs them from the same start time.
   Times below are on this phone's clock (the server's start time minus the measured offset). */
function startGame(seed, speed, startLocal, roster, goAt){
  stopGame();
  G = { seed:seed, speed:speed, start:startLocal, roster:roster.slice(), goAt:goAt||0, run:activeRun, over:false, rounds:makeRounds(seed),
    my:[],seenDraw:Object.create(null),skipTo:Object.create(null), view:{ r:-1, ph:'' }, score:Object.create(null),endShown:false };
  R.phase = 'game'; scene.noon = false;
  $('rivals').classList.toggle('hidden', R.solo);
  show('countScreen');
  if(!R.solo)ingest(access.current().rows||[]);
  if(G.tick)clearInterval(G.tick);G.tick=setInterval(tick,90);tick();
}
/* the round timetable: each round waits for its answers, then the reveal, then the next */
function timeline(){
  var packet=!R.solo&&access.current(),windows=packet&&packet.round_windows;
  if(windows&&windows.length===ROUNDS)return windows.map(function(w){return {start:Date.parse(w.start_at)-offset,studyEnd:Date.parse(w.study_at)-offset,lastWord:Date.parse(w.answer_until)-offset-ANSWER,drawEnd:Date.parse(w.draw_until)-offset,answerEnd:Date.parse(w.answer_until)-offset,revealAt:Date.parse(w.reveal_at)-offset,end:Date.parse(w.end_at)-offset};});
  var t = G.start, out = [];
  for(var i = 0; i < ROUNDS; i++){ var rd = G.rounds[i], w = G.speed, studyEnd = t + STUDY, lastWord = studyEnd + (rd.n - 1)*w;
    var drawEnd = rd.noon ? lastWord : lastWord + GRACE, answerEnd = lastWord + ANSWER, revealAt = answerEnd;
    var done = allAnswered(i); if(done) revealAt = Math.min(answerEnd, Math.max(done, studyEnd));
    if(G.skipTo[i]) revealAt = Math.min(revealAt, G.skipTo[i]);
    var end = revealAt + REVEAL; if(G.skipTo['n' + i]) end = Math.min(end, G.skipTo['n' + i]);
    out.push({ start:t, studyEnd:studyEnd, lastWord:lastWord, drawEnd:drawEnd, answerEnd:answerEnd, revealAt:revealAt, end:end }); t = end; }
  return out;
}
/* when everyone's answer for a round is in, the reveal comes straight away (local time of the last one) */
function allAnswered(i){ var last = 0;
  for(var k = 0; k < G.roster.length; k++){ var a = answerOf(G.roster[k], i); if(!a) return 0; last = Math.max(last, a.at); } return last; }
function answerOf(name, i){
  if(name === R.me || R.solo) return G.my[i] && G.my[i].answered ? { pts:G.my[i].pts, flags:G.my[i].flags, at:G.my[i].answeredAt } : null;
  var a = G.answers && G.answers[name + '#' + i]; return a || null;
}
function drawOf(name, i){ if(name === R.me || R.solo) return G.my[i] && G.my[i].drawn ? G.my[i].drawn : null; return G.draws && G.draws[name + '#' + i] || null; }
/* rows from the others: draws (live, with a bang) and answers */
function ingest(rows){
  if(!G)return;G.draws=G.draws||Object.create(null);G.answers=G.answers||Object.create(null);
  rows.forEach(function(row){if(row.run_id!==activeRun||G.roster.indexOf(row.name)<0)return;var at=ts(row),i;
    if(row.kind==='draw'){i=row.level-1000;if(i<0||i>=ROUNDS)return;G.draws[row.name+'#'+i]={k:row.correct,at:at-offset,srv:at};
      if(row.member_id===access.member().id){var own=G.my[i]||(G.my[i]={});own.drawn=G.draws[row.name+'#'+i];own.drawing=false;}}
    if(row.kind==='answer'){i=row.level-2000;if(i<0||i>=ROUNDS)return;G.answers[row.name+'#'+i]={pts:row.correct,flags:row.time_left,at:at-offset};
      if(row.member_id===access.member().id){var mine=G.my[i]||(G.my[i]={});mine.answered=true;mine.settling=false;mine.pts=row.correct;mine.flags=row.time_left;mine.answeredAt=at-offset;}}
  });
}

function tick(){
  if(!G || G.over) return;
  var now = Date.now(), T = timeline(), i = 0;
  if(now < G.start){ countdown(G.start - now); return; }
  while(i < ROUNDS && now >= T[i].end) i++;
  if(i >= ROUNDS){ endGame(T); return; }
  var t = T[i], rd = G.rounds[i], ph = now < t.studyEnd ? 'study' : now < t.revealAt ? 'play' : 'reveal';
  if(G.view.r !== i){ G.view = { r:i, ph:'' }; beginRound(i); }
  if(G.view.ph !== ph){ G.view.ph = ph; if(ph === 'play') beginWords(i); if(ph === 'reveal') reveal(i, T); }
  if(ph === 'play') playing(i, t, now);
  if(ph === 'reveal') revealTick(i, t, now);
  liveDraws(i);
}
function countdown(left){
  if($('countScreen').classList.contains('hidden')) show('countScreen');
  var n = Math.ceil(left/1000) - 1, txt = n >= 1 ? String(n) : 'Draw!';
  if(G.view.c !== txt){ G.view.c = txt; $('countNum').textContent = txt; if(n >= 1) SND.count(); else SND.go(); }
  $('countSpeed').textContent = SPEED[G.speed] + ' pace · ' + ROUNDS + ' rounds' + (R.solo ? '' : ' · ' + G.roster.length + ' players');
}

/* ---------------- a round, on screen ---------------- */
function beginRound(i){
  show('gameScreen'); var rd = G.rounds[i];
  G.my[i] = G.my[i] || {};
  scene.noon = rd.noon; if(rd.noon) SND.bell();
  $('roundLab').textContent = rd.noon ? 'HIGH NOON' : 'ROUND ' + (i + 1) + ' OF ' + ROUNDS; $('roundLab').classList.toggle('noon', rd.noon);
  $('scoreLab').textContent = totals(i - 1)[R.me] || 0;
  $('ticker').textContent = rd.noon ? 'Double stakes. Draw before the question ends.' : '';
  ['verdict', 'board', 'timer', 'waitNote', 'nextBtn'].forEach(function(id){ $(id).classList.add('hidden'); });
  $('drawBtn').classList.remove('hidden'); $('drawBtn').disabled = true; $('drawVal').textContent = 'study';
  $('posterLab').textContent = 'STUDY THE ANSWERS'; $('posterBody').innerHTML = '<div class="study">The question is on its way…</div>';
  var box = $('answers'); box.innerHTML = ''; box.className = 'answers';
  rd.answers.forEach(function(a, k){ var b = document.createElement('button'); b.className = 'ans'; b.disabled = true; b.dataset.a = a;
    b.innerHTML = '<span class="k">' + 'ABCD'[k] + '</span>'; b.appendChild(document.createTextNode(a)); b.onclick = function(){ pick(i, a, b); }; box.appendChild(b); });
  renderRivals(i);
}
function beginWords(i){var rd=G.rounds[i];$('posterLab').textContent=rd.noon?'HIGH NOON':'THE QUESTION';G.view.shown=0;if(G.my[i].drawn&&!G.my[i].answered)showDraw(i);}
function shownAt(i, t, now){ var rd = G.rounds[i]; return Math.max(0, Math.min(rd.n, Math.floor((now - t.studyEnd)/G.speed) + 1)); }
function playing(i, t, now){
  var rd = G.rounds[i], my = G.my[i], k = shownAt(i, t, now);
  if(my.drawing||my.settling)return;
  if(!my.drawn){
    if(k !== G.view.shown){ G.view.shown = k; renderQuestion(i, k); SND.tick(); }
    var open = now < t.drawEnd;
    $('drawBtn').disabled = !open; $('drawVal').textContent = open ? valueAt(k, rd.n) : (rd.noon ? 'too late' : 'holstered');
    if(!open && !my.answered){ settle(i, 0, F_NODRAW, now); }
  } else if(!my.answered){
    var left = Math.min(my.drawn.at + 10000, t.answerEnd) - now;
    if(left <= 0){ settle(i, 0, F_FROZE, now); lockAnswers(); }
  }
}
function renderQuestion(i, upto, final){
  var rd = G.rounds[i], html = '';
  for(var j = 0; j < rd.n; j++){
    if(j < upto) html += '<span class="w' + (final && j === rd.g - 1 ? ' key' : '') + (!final && j === upto - 1 ? ' new' : '') + '">' + esc(rd.W[j]) + '</span> ';
    else if(final) html += '<span class="w ghost">' + esc(rd.W[j]) + '</span> '; }
  if(!final && upto < rd.n && !(G.my[i] && G.my[i].drawn)) html += '<span class="caret"></span>';
  $('posterBody').innerHTML = '<div class="q">' + html + '</div>';
}
$('drawBtn').onclick = function(){
  if(!G || G.over) return; var i = G.view.r, T = timeline(), t = T[i], now = Date.now(); if(i < 0 || !t || now < t.studyEnd || now >= t.drawEnd) return;
  // Presence updates share the transport queue; they must not discard a tap.
  // An unresolved failed acknowledgement still blocks new gameplay actions.
  var my = G.my[i]; if(my.drawn||my.drawing||my.settling||(!R.solo&&access.pending()))return; var rd = G.rounds[i], k = shownAt(i, t, now); if(k < 1) return;
  var game=G;
  function revealDraw(receipt){if(G!==game||game.run!==activeRun||G.my[i]!==my)return;my.drawing=false;my.drawn={k:receipt?receipt.correct:k,at:receipt?ts(receipt)-offset:now,srv:receipt?ts(receipt):0};
    SND.draw();puff('BANG');try{if(navigator.vibrate)navigator.vibrate(30);}catch(e){}if(G.view.r===i&&G.view.ph==='play')showDraw(i);}
  if(R.solo)revealDraw();else{my.drawing=true;$('drawBtn').disabled=true;post(R.me,k,1000+i,0).then(revealDraw).catch(netIssue);}
};
function showDraw(i){var rd=G.rounds[i],my=G.my[i],k=my.drawn.k,t=timeline()[i],now=Date.now();
  $('drawBtn').disabled=true;$('drawVal').textContent=valueAt(k,rd.n);$('ticker').textContent='You drew at word '+k+'.';renderQuestion(i,k);
  var cands=rd.set.q.filter(function(o){return prefixLen(words(o[0]),rd.W)>=k;});
  if(cands.length>1&&k<rd.g&&!my.end)finishStep(i,cands,k);else openAnswers();
  var bar=$('timerBar'),dur=Math.max(0,Math.min(my.drawn.at+10000,t.answerEnd)-now);$('timer').classList.remove('hidden');bar.style.transition='none';bar.style.transform='scaleX(1)';void bar.offsetWidth;
  bar.style.transition='transform '+dur+'ms linear';bar.style.transform='scaleX(0)';
}

function finishStep(i, cands, k){
  var my = G.my[i], box = document.createElement('div'); box.className = 'finish';
  shuffle(cands).forEach(function(o){ var w = words(o[0]), b = document.createElement('button'); b.className = 'end';
    b.innerHTML = '<span class="seen">… </span>' + esc(w.slice(k).join(' '));
    b.onclick = function(){if(!G||G.my[i]!==my||G.view.r!==i||G.view.ph!=='play'||my.answered||my.settling)return;my.end=o[0]; tone(880, .05, 'square', .03); yourCall(i, o[0], k); openAnswers(); }; box.appendChild(b); });
  var sk = document.createElement('button'); sk.className = 'skip'; sk.textContent = 'Skip: just answer'; sk.onclick = function(){if(!G||G.my[i]!==my||G.view.r!==i||G.view.ph!=='play'||my.answered||my.settling)return;my.end=''; renderQuestion(i, k); openAnswers(); };
  box.appendChild(sk); $('posterLab').textContent = 'HOW DOES IT END?'; $('posterBody').innerHTML = ''; $('posterBody').appendChild(box); $('answers').classList.add('hidden');
}
function yourCall(i, text, k){ var html = ''; words(text).forEach(function(x, j){ html += '<span class="w"' + (j >= k ? ' style="color:#7a4b25;font-style:italic"' : '') + '>' + esc(x) + '</span> '; });
  $('posterLab').textContent = 'YOUR CALL'; $('posterBody').innerHTML = '<div class="q">' + html + '</div>'; }
function openAnswers(){ var box = $('answers'); box.classList.remove('hidden'); box.classList.add('live'); [].forEach.call(box.children, function(b){ b.disabled = false; }); }
function lockAnswers(){ var box = $('answers'); box.classList.remove('live', 'hidden'); [].forEach.call(box.children, function(b){ b.disabled = true; }); $('timer').classList.add('hidden'); }
function pick(i,a,btn){
  if(!G||G.over)return;var my=G.my[i]; if(!my||!my.drawn||my.answered||my.settling||G.view.r!==i||G.view.ph!=='play'||(!R.solo&&access.pending()))return;
  var windowNow=timeline()[i],now=Date.now();if(now>=Math.min(my.drawn.at+10000,windowNow.answerEnd)){settle(i,0,F_FROZE,now);lockAnswers();return;}
  var rd = G.rounds[i], mult = rd.noon ? 2 : 1, val = valueAt(my.drawn.k, rd.n), pts, flags;
  if(a === rd.q[1]){ var called = my.end === rd.q[0] && my.drawn.k < rd.g; pts = (called ? val*2 : val)*mult; flags = F_RIGHT | (called ? F_CALLED : 0); }
  else { pts = -100*mult; flags = F_WRONG; }
  my.choice = a; btn.style.outline = '3px solid var(--brass)'; lockAnswers(); settle(i, pts, flags, Date.now());
  if(!R.solo){ $('waitNote').textContent = 'Holstered. Waiting for the others…'; $('waitNote').classList.remove('hidden'); }
}
function settle(i,pts,flags,now){var game=G,my=game.my[i];if(my.answered||my.settling||my.drawing)return;
  if(R.solo){my.answered=true;my.pts=pts;my.flags=flags;my.answeredAt=now;return;}
  my.settling=true;post(R.me,pts,2000+i,flags).then(function(row){if(G!==game||game.run!==activeRun)return;my.settling=false;my.answered=true;my.pts=row.correct;my.flags=row.time_left;my.answeredAt=ts(row)-offset;if(game.endShown){game.endShown=false;endGame(timeline());}return poll();}).catch(netIssue);
}

/* other players drawing, live */
function liveDraws(i){
  if(R.solo || !G.draws) return;
  G.roster.forEach(function(n){ if(n === R.me) return; var d = G.draws[n + '#' + i], key = n + '#' + i;
    if(d && !G.seenDraw[key]){ G.seenDraw[key] = 1; if(G.view.ph === 'play'){ $('ticker').textContent = n + ' drew at word ' + d.k + '!'; SND.rival(); puff('BANG'); } renderRivals(i); var el = $('rv_' + hstr(n)); if(el) el.classList.add('flash'); } });
}
function renderRivals(i){
  if(R.solo) return; var box = $('rivals'), tot = totals(G.view.ph === 'reveal' ? i : i - 1); box.innerHTML = '';
  G.roster.forEach(function(n){ if(n === R.me) return; var d = drawOf(n, i), a = G.view.ph === 'reveal' ? answerOf(n, i) : null, el = document.createElement('div');
    el.className = 'rival' + (d ? ' drew' : ''); el.id = 'rv_' + hstr(n);
    el.innerHTML = '<div class="n"><span>' + esc(n) + '</span><span>' + (tot[n] || 0) + '</span></div><div class="s">' + esc(a ? verdictShort(a) : d ? 'drew at word ' + d.k : 'holding…') + '</div>'; box.appendChild(el); });
}
function verdictShort(a){ var f = a.flags; return f & F_CALLED ? 'called it +' + a.pts : f & F_RIGHT ? 'right +' + a.pts : f & F_WRONG ? 'shot foot ' + a.pts : f & F_FROZE ? 'froze' : 'didn’t draw'; }

/* scores: everyone's points, plus the fastest gun of each round (first right draw, two or more players) */
function totals(upTo){
  var tot=Object.create(null),last = upTo == null ? ROUNDS - 1 : upTo; G.roster.forEach(function(n){ tot[n] = 0; });
  for(var i = 0; i <= last; i++){ var best = null;
    G.roster.forEach(function(n){ var a = answerOf(n, i); if(!a) return; tot[n] += a.pts; var d = drawOf(n, i);
      if(a.flags & F_RIGHT && d && (!best || srvOf(d) < best.at)) best = { n:n, at:srvOf(d) }; });
    if(best && G.roster.length > 1) tot[best.n] += 50*(G.rounds[i].noon ? 2 : 1); }
  return tot;
}
function srvOf(d){ return d.srv || d.at + offset; }
function fastestGun(i){ var best = null; G.roster.forEach(function(n){ var a = answerOf(n, i), d = drawOf(n, i); if(a && a.flags & F_RIGHT && d && (!best || srvOf(d) < best.at)) best = { n:n, at:srvOf(d) }; }); return G.roster.length > 1 && best ? best.n : null; }

/* ---------------- the reveal ---------------- */
function reveal(i, T){
  var rd = G.rounds[i], my = G.my[i];
  if(!my.answered)settle(i,0,my.drawn?F_FROZE:F_NODRAW,Date.now());
  if(!R.solo&&!my.answered){lockAnswers();$('drawBtn').classList.add('hidden');$('verdict').classList.remove('hidden');$('verdict').textContent='Confirming your round with the room…';G.view.verdictConfirmed=false;return;}
  G.view.verdictConfirmed=true;
  lockAnswers(); $('drawBtn').classList.add('hidden'); $('waitNote').classList.add('hidden');
  renderQuestion(i, rd.n, true); $('posterLab').textContent = 'THE QUESTION WAS';
  [].forEach.call($('answers').children, function(b){ if(b.dataset.a === rd.q[1]) b.classList.add('right'); else if(b.dataset.a === my.choice) b.classList.add('wrong'); else b.classList.add('dim'); });
  var f = my.flags, title, cls = '', small = '';
  if(f & F_CALLED){ title = 'Called it!'; cls = 'gold'; scene.starAt = clock(); SND.called(); small = 'You drew at word ' + my.drawn.k + ' of ' + rd.n + ', before the giveaway word.'; }
  else if(f & F_RIGHT){ title = 'Right!'; cls = 'good'; SND.right(); small = 'You drew at word ' + my.drawn.k + ' of ' + rd.n + '.' + (my.end && my.end !== rd.q[0] ? ' Right answer, but the question was different.' : ''); }
  else if(f & F_WRONG){ title = 'Shot yourself in the foot'; cls = 'bad'; SND.wrong(); small = 'The answer was ' + rd.q[1] + '.'; }
  else if(f & F_FROZE){ title = 'You froze'; cls = 'bad'; small = 'No answer in time. The answer was ' + rd.q[1] + '.'; }
  else { title = rd.noon ? 'Too slow at High Noon' : 'You kept your gun holstered'; small = 'The answer was ' + rd.q[1] + '.'; }
  var v = $('verdict'); v.classList.remove('hidden');
  v.innerHTML = '<div class="big ' + cls + '">' + title + (my.pts ? ' ' + (my.pts > 0 ? '+' : '') + my.pts : '') + '</div><div class="small">' + esc(small) + ' The giveaway word is underlined.</div>';
  $('ticker').textContent = '';
  $('nextBtn').textContent = i + 1 < ROUNDS ? (i + 2 === ROUNDS ? 'On to High Noon' : 'Next round') : 'See how you did';
  $('nextBtn').classList.toggle('hidden', !R.solo);
  G.view.boardSig = '';
}
function revealTick(i,t,now){
  if(!G.view.verdictConfirmed&&G.my[i].answered)reveal(i,timeline());
  /* the board fills in as the others' answers arrive */
  var sig = G.roster.map(function(n){ var a = answerOf(n, i); return a ? a.flags + ':' + a.pts : '-'; }).join('|');
  if(sig !== G.view.boardSig){ G.view.boardSig = sig; renderRivals(i); $('scoreLab').textContent = totals(i)[R.me] || 0; if(!R.solo) roundBoard(i); }
}
function roundBoard(i){
  var b = $('board'), gun = fastestGun(i), tot = totals(i); b.classList.remove('hidden'); b.innerHTML = '';
  G.roster.slice().sort(function(x, y){ return (tot[y] || 0) - (tot[x] || 0); }).forEach(function(n){ var a = answerOf(n, i), d = document.createElement('div');
    if(n === R.me) d.className = 'me'; if(!a) d.className += ' pend';
    d.innerHTML = '<span>' + esc(n === R.me ? 'You' : n) + ' · ' + esc(a ? verdictShort(a) : 'thinking…') + (gun === n ? ' · fastest gun +' + 50*(G.rounds[i].noon ? 2 : 1) : '') + '</span><span>' + (tot[n] || 0) + '</span>'; b.appendChild(d); });
}
$('nextBtn').onclick = function(){ if(!G || !R.solo) return; var i = G.view.r; G.skipTo['n' + i] = Date.now(); tick(); };

/* ---------------- the end ---------------- */
function endGame(T){
  if(G.endShown) return; G.endShown = true; clearInterval(G.tick); scene.noon = false; show('endScreen');
  var tot = totals(), mine = tot[R.me] || 0, called = G.my.filter(function(m){ return m && m.flags & F_CALLED; }).length;
  var order = G.roster.slice().sort(function(a, b){ return (tot[b] || 0) - (tot[a] || 0); });
  var best = parseInt(store(bestKey()) || '0', 10), newBest = false;
  if(R.solo && mine > best){ store(bestKey(), String(mine)); best = mine; newBest = true; }
  $('endTitle').textContent = R.solo ? 'Sundown' : order[0] === R.me ? 'Fastest in the West' : order[0] + ' rules the town';
  $('endVerdict').innerHTML = '<div class="big gold">' + mine + ' points</div><div class="small">You called ' + called + ' question' + (called === 1 ? '' : 's') + ' before the giveaway word.' +
    (R.solo ? (newBest ? ' A new best at ' + SPEED[G.speed] + '!' : ' Your best at ' + SPEED[G.speed] + ': ' + best + '.') : '') + '</div>';
  var b = $('endBoard'); b.innerHTML = '';
  if(R.solo) G.rounds.forEach(function(rd, k){ var m = G.my[k] || {}, d = document.createElement('div');
    d.innerHTML = '<span>' + (k === ROUNDS - 1 ? 'High Noon' : 'Round ' + (k + 1)) + ' · ' + esc(rd.q[1]) + '</span><span>' + esc(m.flags ? verdictShort({ flags:m.flags, pts:m.pts }) : '') + '</span>'; b.appendChild(d); });
  if(!R.solo) order.forEach(function(n, k){ var d = document.createElement('div'); if(n === R.me) d.className = 'me'; d.innerHTML = '<span>' + (k + 1) + '. ' + esc(n === R.me ? n + ' (you)' : n) + '</span><span>' + (tot[n] || 0) + '</span>'; b.appendChild(d); });
  $('againBtn').textContent=R.solo?'Ride again':access.isHost()?'Back to the saloon':'Waiting for the host’s next showdown';$('againBtn').disabled=!R.solo&&(!access.isHost()||access.busy());
}
$('againBtn').onclick=function(){
  if(R.solo){$('soloBtn').onclick();return;}if(!access.isHost()||access.busy())return;
  access.reset().then(function(){stopGame();roomEpoch++;activeRun='';R.phase='lobby';show('lobbyScreen');return poll();}).catch(netIssue);
};

/* ---------------- big screens and keys ---------------- */
function tv(){ var app = $('app'); if(!app) return;
  function go(){ var z = 1; if(innerWidth >= 900 && innerHeight >= 640) z = Math.max(1, Math.min(1.6, Math.min(innerHeight/880, innerWidth/700)));
    if(z > 1.04){ app.style.zoom = z; app.style.height = (innerHeight/z) + 'px'; app.style.maxHeight = 'none'; } else { app.style.zoom = ''; app.style.height = ''; app.style.maxHeight = ''; } }
  window.addEventListener('resize', go); go(); }
tv();
document.addEventListener('keydown', function(e){
  if(!G || G.over || $('gameScreen').classList.contains('hidden') || /input/i.test((e.target || {}).tagName || '')) return;
  if(e.key === ' ' || e.key === 'Enter'){ if(!$('drawBtn').disabled && !$('drawBtn').classList.contains('hidden')){ e.preventDefault(); $('drawBtn').click(); } return; }
  var n = parseInt(e.key, 10); if(n >= 1 && n <= 5){ var ends = document.querySelectorAll('#posterBody .end'); if(ends.length && ends[n - 1]){ ends[n - 1].click(); return; }
    var a = $('answers').children[n - 1]; if(a && !a.disabled) a.click(); }
});
speedButtons(); showBest();
})();
