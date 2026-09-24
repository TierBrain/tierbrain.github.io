(function(){
  // ============ QUESTION BANK (stable, settled facts) ============
  const BANK=window.QUIZ.bank;
  const LVL_NAMES={1:"LEVEL 1 · EASY",2:"LEVEL 2 · MEDIUM",3:"LEVEL 3 · HARD",4:"LEVEL 4 · LEGENDS"};
  const LVL_COLOR={1:getCSS('--l1'),2:getCSS('--l2'),3:getCSS('--l3'),4:getCSS('--l4')};
  function getCSS(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
  const KEYS=['A','B','C','D'];
  const CHECK='<svg class="mark" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#33c98a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CROSS='<svg class="mark" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#ff5d7a" stroke-width="3" stroke-linecap="round"/></svg>';

  // ============ audio ============
  let actx=null;
  function ensureAudio(){if(!actx){try{actx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}}}
  function beep(f,d=0.12,type='sine',vol=0.16){if(!actx)return;const o=actx.createOscillator(),g=actx.createGain();
    o.type=type;o.frequency.value=f;o.connect(g);g.connect(actx.destination);const t=actx.currentTime;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+0.02);g.gain.exponentialRampToValueAtTime(0.001,t+d);
    o.start(t);o.stop(t+d+0.02);}
  const sRight=()=>{beep(660,0.09,'sine',0.16);setTimeout(()=>beep(990,0.11,'sine',0.14),80);};
  const sWrong=()=>{beep(200,0.22,'sawtooth',0.15);};
  const sUp=()=>{[523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,0.12,'triangle',0.15),i*70));};
  const sDown=()=>{[523,415,330].forEach((f,i)=>setTimeout(()=>beep(f,0.13,'triangle',0.14),i*80));};
  const sDone=()=>{[523,659,784,1047,1319].forEach((f,i)=>setTimeout(()=>beep(f,0.14,'sine',0.16),i*90));};
  const sOut=()=>{[330,262,196].forEach((f,i)=>setTimeout(()=>beep(f,0.22,'triangle',0.15),i*130));};

  // ============ state ============
  let level,answered,correct,totalWrong,streakC,streakW,current,opts,locked,pendingMove;
  let startT=0,timerId=null;

  const $=id=>document.getElementById(id);
  function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  let queues,ptr;

  function startGame(){
    level=1;answered=0;correct=0;totalWrong=0;streakC=0;streakW=0;locked=false;pendingMove=null;
    queues={1:shuffle(BANK[1]),2:shuffle(BANK[2]),3:shuffle(BANK[3]),4:shuffle(BANK[4])}; ptr={1:0,2:0,3:0,4:0};
    hideAllScreens();
    playing=true; startT=performance.now(); runTimer();
    renderStrikes(); nextQuestion();
  }

  let TIME_LIMIT=120000;   // countdown length, set by the clock selector
  let playing=false;
  function remainingMs(){ return Math.max(0, TIME_LIMIT-(performance.now()-startT)); }
  function tickTimer(){
    const rem=remainingMs();
    const el=$('timer'); el.textContent=fmt(rem);
    const w=el.parentElement;
    if(rem<=15000) w.classList.add('low'); else w.classList.remove('low');
    if(rem<=0 && playing){ stopTimer(); endTimeUp(); }
  }
  function runTimer(){ clearInterval(timerId); tickTimer(); timerId=setInterval(tickTimer,150); }
  function stopTimer(){ clearInterval(timerId); }
  function fmt(ms){const s=Math.ceil(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

  function drawQuestion(){
    const pool=queues[level];
    if(ptr[level]>=pool.length){ queues[level]=shuffle(BANK[level]); ptr[level]=0; }
    return queues[level][ptr[level]++];
  }

  function nextQuestion(){
    current=drawQuestion();
    opts=shuffle([current.correct,...current.wrong]);
    // HUD
    $('lvlPill').textContent=LVL_NAMES[level];
    $('lvlPill').style.background=LVL_COLOR[level];
    $('qcount').textContent='QUESTION '+(answered+1)+' OF 20';
    $('progbar').style.width=(answered/20*100)+'%';
    $('qtext').textContent=current.q;
    const box=$('opts'); box.className='opts'; box.innerHTML='';
    opts.forEach((o,i)=>{
      const b=document.createElement('button'); b.className='opt';
      b.innerHTML='<span class="key">'+KEYS[i]+'</span><span class="txt">'+o+'</span><span style="width:24px;flex:none"></span>';
      b.addEventListener('click',()=>answer(o,b));
      box.appendChild(b);
    });
    locked=false;
  }

  function renderStrikes(){
    const el=$('strikes'); el.innerHTML='';
    for(let i=0;i<4;i++){const s=document.createElement('span');s.className='strike'+(i<totalWrong?' used':'');el.appendChild(s);}
  }

  function toast(msg,color){
    const t=$('toast'); t.textContent=msg; t.style.background=color; t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),1100);
  }

  function answer(choice,btn){
    if(locked) return; locked=true;
    const right=(choice===current.correct);
    answered++;
    const box=$('opts'); box.classList.add('locked');
    // reveal
    [...box.children].forEach(c=>{
      const label=c.querySelector('.txt').textContent;
      const mark=c.lastElementChild;
      if(label===current.correct){ c.classList.add('correct'); mark.outerHTML=CHECK; }
      else if(c===btn){ c.classList.add('wrong'); mark.outerHTML=CROSS; }
      else c.classList.add('dim');
    });

    if(right){
      correct++; sRight(); streakW=0; streakC++;
      if(streakC>=2 && level<4){ level++; streakC=0; pendingMove='up'; }
    } else {
      totalWrong++; sWrong(); streakC=0; streakW++;
      renderStrikes();
      if(totalWrong<4 && streakW>=2 && level>1){ level--; streakW=0; pendingMove='down'; }
    }
    $('progbar').style.width=(answered/20*100)+'%';

    setTimeout(()=>{
      if(!playing) return;
      if(totalWrong>=4){ endOut(); return; }
      if(answered>=20){ endDone(); return; }
      if(pendingMove==='up'){ toast('Level Up!',LVL_COLOR[level]); sUp(); }
      else if(pendingMove==='down'){ toast('Level Down',LVL_COLOR[level]); sDown(); }
      pendingMove=null;
      nextQuestion();
    }, right?780:1050);
  }

  function endOut(){
    playing=false; stopTimer(); sOut();
    $('outAns').textContent=answered; $('outCorr').textContent=correct;
    lastRun={correct:correct,level:level,timeLeft:remainingMs()};
    show('outScreen');
  }
  function endDone(){
    playing=false; stopTimer(); sDone();
    $('doneTime').textContent=fmt(remainingMs());
    $('doneCorr').textContent=correct;
    $('doneLvl').textContent='LEVEL '+level;
    $('doneAns').textContent=answered;
    lastRun={correct:correct,level:level,timeLeft:remainingMs()};
    show('doneScreen');
  }
  function endTimeUp(){
    playing=false; stopTimer(); sOut();
    $('tuAns').textContent=answered; $('tuCorr').textContent=correct;
    lastRun={correct:correct,level:level,timeLeft:remainingMs()};
    show('timeupScreen');
  }

  // ============ screen helpers ============
  const SCREENS=['startScreen','outScreen','doneScreen','timeupScreen','boardScreen'];
  function hideAllScreens(){SCREENS.forEach(s=>$(s).classList.add('hidden'));}
  function show(id){hideAllScreens();$(id).classList.remove('hidden');}

  // ============ wiring ============
  function toMenu(){ ensureAudio(); playing=false; stopTimer(); show('startScreen'); }
  $('startBtn').addEventListener('click',()=>{ensureAudio();startGame();});
  $('doneAgain').addEventListener('click',()=>{ensureAudio();startGame();});
  $('outRetry').addEventListener('click',()=>{ensureAudio();startGame();});
  $('tuRetry').addEventListener('click',()=>{ensureAudio();startGame();});
  $('doneMenu').addEventListener('click',toMenu);
  $('outMenu').addEventListener('click',toMenu);
  $('tuMenu').addEventListener('click',toMenu);
  // keyboard 1-4 to answer
  window.addEventListener('keydown',e=>{
    if(e.target&&e.target.tagName==='INPUT')return;
    if(playing){
      const n=parseInt(e.key,10);
      if(n>=1&&n<=4){const b=$('opts').children[n-1]; if(b)b.click();}
    }
  });

  // start on menu
  renderStrikes();
  // ---- clock selector ----
  const TIME_OPTS=[{n:'Chill',ms:180000,l:'3:00'},{n:'Classic',ms:120000,l:'2:00'},{n:'Hard',ms:90000,l:'1:30'}];
  (function(){ const row=$('timeRow'); if(!row) return;
    TIME_OPTS.forEach(o=>{ const b=document.createElement('button');
      b.className='timeopt'+(o.ms===TIME_LIMIT?' sel':''); b.textContent=o.n+' · '+o.l;
      b.addEventListener('click',()=>{ ensureAudio(); TIME_LIMIT=o.ms;
        [...row.children].forEach(c=>c.classList.remove('sel')); b.classList.add('sel'); beep(560,0.06,'sine',0.12); });
      row.appendChild(b); });
  })();
  // ============ local leaderboard (per device) ============
  const QUIZ_ID=window.QUIZ.id;
  const NAME_KEY='qc_name';
  let lastRun=null, BOARD=[];
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function loadBoard(){ try{ BOARD=JSON.parse(lsGet(QUIZ_ID))||[]; }catch(e){ BOARD=[]; } if(!Array.isArray(BOARD)) BOARD=[]; }
  function cmpRun(a,b){ return (b.correct-a.correct)||(b.level-a.level)||(b.timeLeft-a.timeLeft)||(a.t-b.t); }
  function fmtScore(r){ return r.correct+'/20 \u00b7 L'+r.level+' \u00b7 '+fmt(r.timeLeft)+' left'; }
  loadBoard();
  function renderBoard(hi){
    const list=$('boardList'); list.innerHTML='';
    BOARD.slice(0,10).forEach(function(r,i){
      const li=document.createElement('li');
      li.className='brow'+(hi&&r.t===hi?' me':'');
      li.innerHTML='<span class="brk">'+(i+1)+'</span><span class="bnm">'+escapeHtml(r.name)+'</span>'+
        '<span class="bsc">'+r.correct+'/20<br><span class="bmeta">L'+r.level+' \u00b7 '+fmt(r.timeLeft)+'</span></span>';
      list.appendChild(li);
    });
    $('boardEmpty').classList.toggle('hidden', BOARD.length>0);
  }
  function openBoard(showSave){
    ensureAudio();
    const sa=$('saveArea');
    if(showSave && lastRun){
      sa.classList.remove('hidden');
      $('saveSummary').textContent=fmtScore(lastRun);
      const nm=lsGet(NAME_KEY); if(nm) $('boardName').value=nm;
    } else { sa.classList.add('hidden'); }
    renderBoard();
    show('boardScreen');
  }
  function saveScore(){
    if(!lastRun) return;
    let name=($('boardName').value||'').trim().slice(0,14); if(!name) name='Player';
    lsSet(NAME_KEY,name);
    const entry={name:name,correct:lastRun.correct,level:lastRun.level,timeLeft:Math.round(lastRun.timeLeft),t:Date.now()};
    BOARD.push(entry); BOARD.sort(cmpRun); BOARD=BOARD.slice(0,10);
    lsSet(QUIZ_ID, JSON.stringify(BOARD));
    lastRun=null; $('saveArea').classList.add('hidden');
    beep(660,0.08,'sine',0.12); renderBoard(entry.t);
  }
  $('startBoard').addEventListener('click',function(){openBoard(false);});
  document.querySelectorAll('.endboard').forEach(function(b){b.addEventListener('click',function(){openBoard(true);});});
  $('boardSave').addEventListener('click',saveScore);
  $('boardBack').addEventListener('click',toMenu);
  $('boardPlay').addEventListener('click',function(){ensureAudio();startGame();});
  $('boardName').addEventListener('keydown',function(e){ if(e.key==='Enter'){e.preventDefault();saveScore();} });

})();
