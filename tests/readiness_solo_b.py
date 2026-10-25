"""Actual solo input/transition regressions and isolated browser acceptance.

run(env) is invoked by the readiness browser harness. --unit reproduces the
same transition failures with extracted production functions and a small DOM.
It does not replace real-browser acceptance.
"""
import argparse
import importlib.util
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def _function(source, name):
    source=re.sub(r'(?m)^[ \t]+(?=(?:async )?function )','',source)
    spec = importlib.util.spec_from_file_location('owned_function_fixture', ROOT/'tests/test_party_creak_standing.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.function(source, name)


DOM = r"""
const assert=require('node:assert/strict');
const timers=[];
function setTimeout(fn,ms){timers.push({fn,ms});return timers.length;}
function flush(ms){const due=timers.filter(t=>t.ms===ms);for(const t of due){timers.splice(timers.indexOf(t),1);t.fn();}}
class E {
  constructor(){this.children=[];this.disabled=false;this.style={};this.dataset={};this.listeners={};this.textContent='';this.className='';
    this.classList={add(){},remove(){},toggle(){},contains(){return false;}};this.parentElement=this;this.lastElementChild={outerHTML:''};}
  set innerHTML(v){this.children=[];this._html=v;}get innerHTML(){return this._html||'';}
  appendChild(e){this.children.push(e);return e;}addEventListener(k,fn){this.listeners[k]=fn;}
  querySelector(){return new E();}querySelectorAll(){return [];}setAttribute(){}
  click(){if(!this.disabled&&this.listeners.click)this.listeners.click();}
}
const els=new Map();const $=id=>{if(!els.has(id))els.set(id,new E());return els.get(id);};
const document={getElementById:$,createElement:()=>new E(),querySelectorAll:()=>[],querySelector:()=>new E()};
const window={};const performance={now:()=>1000};
function click(){}function thunk(){}function renderDigits(){}function renderChoice(){}function renderMessage(){}function renderSignal(){}
function renderCode(){}function renderChoose(){}function drawNotches(){}function renderTurns(){}function renderLocks(){}
function stopTimer(){}function runTimer(){}function sOut(){}function sDone(){}function sRight(){}function sWrong(){}
function sUp(){}function sDown(){}function toast(){}function setPrompt(){}function renderMatch(){}function renderStrikes(){}
function hideAllScreens(){}function show(){}function remainingMs(){return 1000;}function fmt(){return '0:01';}
"""


def unit_checks(source_loader=None):
    get = source_loader or (lambda path:(ROOT/path).read_text())
    def node(label, body):
        result = subprocess.run(['node','-'],input=DOM+body,text=True,capture_output=True,timeout=20)
        if result.returncode:
            raise AssertionError(label+'\n'+result.stderr+result.stdout)
        print(label+': passed')
    source = get('quiet-line.html')
    helpers = '\n'.join(_function(source,name) for name in ('renderPad','check','press','reveal','loseLife'))
    if 'function roundTask(' in source:helpers += '\n'+_function(source,'roundTask')
    node('Quiet Line grades/reveals once and isolates delayed retries', r"""
const LETTERS={2:'ABC',3:'DEF',4:'GHI',5:'JKL',6:'MNO',7:'PQRS',8:'TUV',9:'WXYZ'};
let runEpoch=0,roundEpoch=1,runActive=true,roundLocked=false,armed=null;
let round={a:'Cat',code:'228'},entered=['C','A','T'],attempts=0,decoded=0,cleanFirstTry=0,log=[],ptr=0,lives=3,arrived=0,lostDigits=[];
let loads=0;function loadRound(){loads++;roundEpoch++;roundLocked=false;}function endRun(){runActive=false;}
"""+helpers+r"""
check();check();assert.equal(decoded,1);assert.equal(log.length,1);
assert($('pad').children.every(button=>button.disabled),'feedback disables every keypad action');
$('pad').children[8].click();press('T');assert.equal(decoded,1);assert.equal(entered.length,3);
flush(1400);assert.equal(ptr,1);assert.equal(loads,1);
roundEpoch++;roundLocked=false;entered=[];reveal();reveal();assert.equal(lives,2);assert.equal(log.length,2);
runEpoch++;roundEpoch++;ptr=0;entered=['N'];roundLocked=false;flush(1700);assert.equal(ptr,0);assert.deepEqual(entered,['N']);
entered=['X','Y','Z'];check();assert(roundLocked);flush(1000);assert.equal(roundLocked,false);assert.deepEqual(entered,[]);
""")
    source = get('quiet-line-vault.html')
    helpers = '\n'.join(_function(source,name) for name in ('renderKeys','judge','put'))
    if 'function wordTask(' in source:helpers += '\n'+_function(source,'wordTask')
    node('Vault accepts one word once and protects the next run', r"""
const LETTERS={2:'ABC',3:'DEF',4:'GHI',5:'JKL',6:'MNO',7:'PQRS',8:'TUV',9:'WXYZ'};
let runEpoch=0,wordEpoch=1,runActive=true,wordLocked=false,held=null;
let round={a:'Cat',code:'228'},entered=['C','A','T'],ptr=0,wordsDone=0,triesLeft=3;
let loads=0;function loadWord(){loads++;wordEpoch++;wordLocked=false;}function finish(){runActive=false;}
"""+helpers+r"""
judge();judge();assert.equal(wordsDone,1);assert.equal(ptr,1);
assert($('keys').children.every(button=>button.disabled));
$('keys').children[8].click();put('T');assert.equal(wordsDone,1);assert.equal(entered.length,3);
flush(1100);assert.equal(loads,1);assert.equal(wordLocked,false);
entered=['X','Y','Z'];judge();assert(wordLocked);assert.equal(triesLeft,2);
runEpoch++;wordEpoch++;entered=['N'];wordLocked=false;flush(950);assert.deepEqual(entered,['N']);
""")
    common = r"""
let level=1,answered=0,correct=0,totalWrong=0,streakC=0,streakW=0,locked=false,pendingMove=null;
let playing=true,runEpoch=0,startT=0,lastRun=null;
const BANK={1:[{}],2:[{}],3:[{}],4:[{}]},PAIRS=BANK;
const shuffle=a=>a.slice();const LVL_COLOR={1:'green',2:'blue'},CHECK='',CROSS='';
let queues,ptr,pairsQ,pptr,selLeft=null,busy=false,current={correct:'yes'},opts=[],uSolved=false,uGuess=[],uLetters=[],sequence=[0],inputPos=0,accepting=true,pausedMs=0,pauseAt=0;
let board={pairs:[{},{}],leftOrder:[0,1],rightOrder:[0,1],matched:{},flash:null};
let nexts=0,replays=0;function nextQuestion(){nexts++;locked=false;}
function newBoard(){nexts++;board={pairs:[{},{}],leftOrder:[0,1],rightOrder:[0,1],matched:{},flash:'fresh'};}
function boardCleared(){return false;}function startRound(){nexts++;}function playSeq(){replays++;}
function pauseClock(){}function resumeClock(){}
"""
    for path, action, delay in (
        ('matchup.html','attemptMatch',460),('unscramble.html','resolve',820),
        ('odd-one-out.html','answer',780),('spot-the-lie.html','answer',1680),
        ('recall.html','padTap',950)):
        source = get(path)
        helpers = '\n'.join(_function(source,name) for name in (action,'startGame','endTimeUp'))
        if 'function inRun(' in source:helpers += '\n'+_function(source,'inRun')
        call = {'attemptMatch':'attemptMatch(0,0)','resolve':'resolve(true)',
                'answer':"answer('yes',new E())",'padTap':'padTap(1)'}[action]
        check = 'assert.equal(replays,0);' if action=='padTap' else 'assert.equal(nexts,1);'
        if action=='attemptMatch':check += "assert.equal(board.flash,'fresh');"
        node(path+' old feedback cannot advance a new run', common+helpers+'\n'+call+
             ';endTimeUp();startGame();assert.equal(nexts,1);flush('+str(delay)+');'+check)


def _engine_export(path, source):
    """Expose test observations inside the existing private engine closure."""
    def instrument(match):
        script=match.group(1)
        if 'function startGame()' not in script or 'function endTimeUp()' not in script:
            return match.group(0)
        position=script.rfind('})();')
        if position < 0:
            raise AssertionError('Solo engine closure not found: '+path)
        fields="playing,answered,correct,totalWrong,level,runEpoch"
        extra=""
        if path=='matchup.html':
            fields+=",busy,board:JSON.parse(JSON.stringify(board))"
        elif path=='recall.html':
            fields+=",accepting,inputPos,sequence:sequence.slice(),flashes:window.__readinessFlashes"
            extra="window.__readinessFlashes=0;const savedLight=lightPad;lightPad=function(n){window.__readinessFlashes++;return savedLight(n);};"
        elif path=='unscramble.html':
            fields+=",locked,uSolved,uGuess:uGuess.slice(),word:current.word,drawIndex:ptr[level],words:Object.values(BANK).flat().map(q=>q.word.toUpperCase())"
        else:
            fields+=",locked,answer:current.correct,drawIndex:ptr[level]"
        expiry="startT=performance.now()-TIME_LIMIT-1;"
        if path=='recall.html':expiry="pauseAt=0;startT=performance.now()-TIME_LIMIT-pausedMs-1;"
        debug=extra+"window.__readinessSolo={snapshot:()=>({"+fields+"}),expire:()=>{"+expiry+"tickTimer();}};\n"
        script=script[:position]+debug+script[position:]
        return '<script>'+script+'</script>'
    return re.sub(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>',instrument,source)


def _snapshot(page):
    return page.evaluate('__readinessSolo.snapshot()')


def _page(env, path):
    if path not in ('quiet-line.html','quiet-line-vault.html'):
        env.transform_source(path,lambda source:_engine_export(path,source))
    page=env.new_page('/'+path,'solo-b-'+path,mobile=True,
                      init_script="localStorage.setItem('quietline_muted','1');localStorage.setItem('vault_muted','1');")
    # Install before the document under test is loaded. These local solo pages
    # do not create Auth sessions. Room/HTTP tests retain native clocks.
    page.clock.install()
    page.reload()
    return page


def _key_word(page, word):
    letters={char:str(digit) for digit,group in ((2,'ABC'),(3,'DEF'),(4,'GHI'),(5,'JKL'),(6,'MNO'),(7,'PQRS'),(8,'TUV'),(9,'WXYZ')) for char in group}
    for char in re.sub('[^A-Z]','',word.upper()):
        page.keyboard.press(letters[char])
        page.keyboard.press(char)


def _quiet_line(env):
    page=_page(env,'quiet-line.html')
    page.locator('#beginBtn').click()
    word=page.evaluate("round.a.replace(/[^A-Za-z]/g,'').toUpperCase()")
    wrong=next(letter for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if letter != word[0])+word[1:]
    # Letter keys use their own real keypad group; the completed wrong word
    # still takes the normal grading path.
    _key_word(page,wrong)
    env.check('Quiet Line: wrong feedback locks input and costs one bar',page.evaluate('roundLocked && lives===2 && attempts===1'))
    page.keyboard.press('Backspace')
    env.check('Quiet Line: Backspace cannot edit feedback',page.evaluate('entered.length===round.code.length'))
    page.clock.run_for(1100)
    env.check('Quiet Line: wrong feedback returns to the same word',page.evaluate('!roundLocked && ptr===0 && entered.length===0'))
    _key_word(page,word)
    before=page.evaluate('({decoded,cleanFirstTry,ptr})')
    page.keyboard.press('Backspace')
    _key_word(page,word[-1])
    env.check('Quiet Line: accepted word counts once with keyboard feedback locked',page.evaluate('decoded')==1 and page.locator('#pad button:enabled').count()==0 and page.evaluate('({decoded,cleanFirstTry,ptr})')==before)
    page.clock.run_for(1500)
    env.check('Quiet Line: one answer advances one letter',page.evaluate('ptr===1 && decoded===1 && !roundLocked'))
    turns=1
    while page.evaluate('runActive') and turns < 80:
        _key_word(page,page.evaluate('round.a'))
        page.clock.run_for(1500)
        turns+=1
    env.check('Quiet Line: whole transmission completes normally',page.evaluate("!runActive && decoded===queue.length && !$('endScreen').classList.contains('hide') && $('endTitle').textContent==='Message received'"))
    page.locator('#againBtn').click()
    page.get_by_role('button',name='SHOW THE WORD',exact=True).click()
    env.check('Quiet Line: reveal consumes one life and locks repeat actions',page.evaluate('lives===2 && roundLocked && log.length===1') and page.locator('#pad button:enabled').count()==0)
    page.keyboard.press('Backspace')
    page.clock.run_for(1800)
    page.get_by_role('button',name='SHOW THE WORD',exact=True).click()
    page.clock.run_for(1800)
    page.get_by_role('button',name='SHOW THE WORD',exact=True).click()
    page.clock.run_for(1000)
    env.check('Quiet Line: three normal reveals end a failed transmission',page.evaluate("!runActive && lives===0 && $('endTitle').textContent==='The line went dead'"))
    page.locator('#againBtn').click()
    env.check('Quiet Line: retry resets the run and one incoming receiver',page.evaluate('runActive && !roundLocked && ptr===0 && decoded===0 && lives===3 && entered.length===0'))
    env.note('Quiet Line completed an entire transmission and a three-reveal loss. Local browser clock advanced presentation delays; inputs and grading were actual handlers.')


def _vault(env):
    page=_page(env,'quiet-line-vault.html')
    page.locator('#enterBtn').click()
    word=page.evaluate("round.a.replace(/[^A-Za-z]/g,'').toUpperCase()")
    wrong=next(letter for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if letter != word[0])+word[1:]
    _key_word(page,wrong)
    env.check('Vault: wrong word costs one try and locks input',page.evaluate('wordLocked && triesLeft===2'))
    page.clock.run_for(1000)
    _key_word(page,word)
    before=page.evaluate('({wordsDone,ptr})')
    page.keyboard.press('Backspace')
    _key_word(page,word[-1])
    env.check('Vault: accepted word cannot count twice',page.evaluate('({wordsDone,ptr})')==before and page.locator('#keys button:enabled').count()==0)
    page.clock.run_for(1200)
    if page.evaluate('wordLocked && runActive'):page.clock.run_for(1400)
    attempts=0
    while page.evaluate('runActive') and attempts<150:
        if page.evaluate('wordLocked'):
            page.clock.run_for(1400)
            continue
        _key_word(page,page.evaluate('round.a'))
        page.clock.run_for(1200)
        if page.evaluate('wordLocked && runActive'):page.clock.run_for(1400)
        attempts+=1
    env.check('Vault: all doors open through real answers',page.evaluate("!runActive && doorIx===DOORS.length && $('closeTitle').textContent==='THE LAST DOOR OPENS'"))
    page.locator('#againBtn').click()
    for _ in range(3):
        word=page.evaluate("round.a.replace(/[^A-Za-z]/g,'').toUpperCase()")
        wrong=next(letter for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if letter != word[0])+word[1:]
        _key_word(page,wrong)
        page.clock.run_for(1200)
    env.check('Vault: three wrong words close the lock honestly',page.evaluate("!runActive && triesLeft===0 && wordsDone===0 && $('closeTitle').textContent==='THE LOCK HOLDS'"))
    page.locator('#againBtn').click()
    env.check('Vault: retry restores the first door without old advances',page.evaluate('runActive && !wordLocked && doorIx===0 && ptr===0 && wordsDone===0 && triesLeft===3'))
    env.note('Vault completed every door through keypad/keyboard answers and a normal three-error loss; local clock advanced feedback and door-opening presentation.')


def _answer_option(page, right):
    value=_snapshot(page)['answer']
    choices=page.locator('#opts .opt')
    for index in range(choices.count()):
        option=choices.nth(index)
        if (option.locator('.txt').inner_text()==value)==right:
            option.click()
            return
    raise AssertionError('Answer choice not found')


def _option_game(env,path):
    page=_page(env,path)
    page.locator('#startBtn').click()
    _answer_option(page,True)
    page.evaluate('__readinessSolo.expire()')
    page.locator('#tuRetry').click()
    before=_snapshot(page)
    page.clock.run_for(2100)
    after=_snapshot(page)
    env.check(path+': pending old answer cannot skip the new first question',after['playing'] and after['answered']==0 and after['drawIndex']==before['drawIndex'] and after['answer']==before['answer'])
    for _ in range(4):
        _answer_option(page,False)
        page.clock.run_for(2100)
    env.check(path+': four actual mistakes end the run',not _snapshot(page)['playing'] and _snapshot(page)['totalWrong']==4 and page.locator('#outScreen').is_visible())
    page.locator('#outRetry').click()
    for _ in range(20):
        _answer_option(page,True)
        page.clock.run_for(2100)
    result=_snapshot(page)
    env.check(path+': complete twenty-answer win is scored normally',not result['playing'] and result['answered']==20 and result['correct']==20 and page.locator('#doneScreen').is_visible())
    page.locator('#doneAgain').click()
    env.check(path+': replay resets counters',_snapshot(page)['playing'] and _snapshot(page)['answered']==0 and _snapshot(page)['correct']==0)


def _match(page, right):
    board=_snapshot(page)['board']
    left=next(i for i,key in enumerate(board['leftOrder']) if str(key) not in board['matched'])
    target=board['leftOrder'][left]
    r=next(i for i,key in enumerate(board['rightOrder']) if (key==target)==right and str(key) not in board['matched'])
    page.locator('#muLeft .mutile').nth(left).click()
    page.locator('#muRight .mutile').nth(r).click()


def _matchup(env):
    page=_page(env,'matchup.html')
    page.locator('#startBtn').click()
    _match(page,True)
    page.evaluate('__readinessSolo.expire()')
    page.locator('#tuRetry').click()
    _match(page,False)
    page.clock.run_for(500)
    env.check('Matchup: old answer does not unlock new feedback',_snapshot(page)['busy'] and page.locator('.mutile.bad').count()==2)
    page.clock.run_for(350)
    for _ in range(3):
        _match(page,False)
        page.clock.run_for(850)
    env.check('Matchup: four wrong pairs end a real run',not _snapshot(page)['playing'] and _snapshot(page)['totalWrong']==4)
    page.locator('#outRetry').click()
    for _ in range(20):
        _match(page,True)
        page.clock.run_for(1300)
    env.check('Matchup: twenty selected pairs complete normally',not _snapshot(page)['playing'] and _snapshot(page)['correct']==20 and page.locator('#doneScreen').is_visible())
    page.locator('#doneAgain').click()
    env.check('Matchup: replay has no old matched pairs',_snapshot(page)['playing'] and _snapshot(page)['correct']==0 and not _snapshot(page)['board']['matched'])


def _word_tiles(page,word):
    for letter in word.upper():page.keyboard.press(letter)


def _unscramble(env):
    page=_page(env,'unscramble.html')
    page.locator('#startBtn').click()
    state=_snapshot(page)
    word=state['word'].upper()
    wrong=None
    for index in range(1,len(word)):
        candidate=word[index:]+word[:index]
        if candidate not in state['words']:
            wrong=candidate;break
    if wrong is None:raise AssertionError('Need a different spelling for the normal wrong-word test')
    _word_tiles(page,wrong)
    page.evaluate('__readinessSolo.expire()')
    page.locator('#tuRetry').click()
    new=_snapshot(page)['word'][0].upper()
    page.keyboard.press(new)
    page.clock.run_for(700)
    env.check('Unscramble: old wrong-word clear cannot erase a new guess',len(_snapshot(page)['uGuess'])==1)
    page.locator('#uClear').click()
    _word_tiles(page,_snapshot(page)['word'])
    page.evaluate('__readinessSolo.expire()')
    page.locator('#tuRetry').click()
    before=_snapshot(page)
    page.clock.run_for(1300)
    env.check('Unscramble: old successful answer cannot advance a new run',_snapshot(page)['drawIndex']==before['drawIndex'] and _snapshot(page)['answered']==0)
    for _ in range(4):
        page.locator('#uSkip').click()
        page.clock.run_for(1300)
    env.check('Unscramble: four skipped words end normally',not _snapshot(page)['playing'] and _snapshot(page)['totalWrong']==4)
    page.locator('#outRetry').click()
    for _ in range(20):
        _word_tiles(page,_snapshot(page)['word'])
        page.clock.run_for(1300)
    env.check('Unscramble: twenty actual words finish a complete game',not _snapshot(page)['playing'] and _snapshot(page)['correct']==20 and page.locator('#doneScreen').is_visible())
    page.locator('#doneAgain').click()
    env.check('Unscramble: replay clears previous word and score',_snapshot(page)['playing'] and _snapshot(page)['correct']==0 and not _snapshot(page)['uGuess'])


def _watch_pattern(page):
    count=len(_snapshot(page)['sequence'])
    page.clock.run_for(800+count*750)
    if not _snapshot(page)['accepting']:
        raise AssertionError('Recall pattern did not complete its native playback')


def _recall(env):
    page=_page(env,'recall.html')
    page.locator('#startBtn').click()
    _watch_pattern(page)
    state=_snapshot(page)
    page.locator('#pad'+str((state['sequence'][0]+1)%4)).click()
    page.evaluate('__readinessSolo.expire()')
    page.locator('#tuRetry').click()
    baseline=_snapshot(page)['flashes']
    _watch_pattern(page)
    env.check('Recall: old mistake replay cannot overlap a new first pattern',_snapshot(page)['flashes']-baseline==1 and len(_snapshot(page)['sequence'])==1)
    for _ in range(4):
        state=_snapshot(page)
        page.locator('#pad'+str((state['sequence'][0]+1)%4)).click()
        page.clock.run_for(2200)
    env.check('Recall: four genuine pattern mistakes end normally',not _snapshot(page)['playing'] and _snapshot(page)['totalWrong']==4)
    page.locator('#outRetry').click()
    _watch_pattern(page)
    for _ in range(20):
        for item in _snapshot(page)['sequence']:page.locator('#pad'+str(item)).click()
        page.clock.run_for(750)
        if _snapshot(page)['playing']:_watch_pattern(page)
    env.check('Recall: all twenty actual sequences finish a game',not _snapshot(page)['playing'] and _snapshot(page)['correct']==20 and page.locator('#doneScreen').is_visible())
    page.locator('#doneAgain').click()
    _watch_pattern(page)
    env.check('Recall: replay starts a single fresh sequence',_snapshot(page)['playing'] and _snapshot(page)['correct']==0 and len(_snapshot(page)['sequence'])==1)


def run(env):
    _quiet_line(env)
    _vault(env)
    _matchup(env)
    _unscramble(env)
    _option_game(env,'odd-one-out.html')
    _option_game(env,'spot-the-lie.html')
    _recall(env)
    env.note('Seven solo engines used normal UI answers and finishes. Read-only engine snapshots supplied test oracles; a named normal timeout helper and local-only browser clock exercised expiry/retry without production backend activity.')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--unit',action='store_true')
    args=parser.parse_args()
    if args.unit:unit_checks()

# The following room checks retain native browser/server clocks. These source
# exports reveal observations only: every answer, start, retry and leave uses UI.
def _race_export(path, source):
    def instrument(match):
        script=match.group(1)
        if path=='tug-of-war.html':
            if 'function startTug()' not in script:return match.group(0)
            fields="phase,activeRun,room:packet&&packet.room,member:race&&race.member(),host:race&&race.isHost(),busy:race&&race.busy(),locked,side,correct:myCorrect,wrong:myWrong,mishaps:myMis,answer:current&&current[1],qi,players:lastPlayers"
        else:
            if 'function beginGame(tier,rng)' not in script:return match.group(0)
            fields="activeRun,mpOn,room:racePacket&&racePacket.room,member:race&&race.member(),host:race&&race.isHost(),busy:race&&race.busy(),pos:S&&S.pos,depth:S&&S.map.nodes[S.pos].row,lives:S&&S.lives,done:S&&S.done,netBusy:S&&!!S.netBusy,pending:S&&S.pending&&{node:S.pending.node.id,locked:!!S.pending.locked},answer:S&&S.cur&&S.cur.opts.find(o=>o.ok).text,next:S&&S.map.nodes[S.pos].out.map(id=>({id,type:S.map.nodes[id].type})),map:S&&Object.values(S.map.nodes).map(n=>({id:n.id,row:n.row,type:n.type,out:n.out}))"
        position=script.rfind('})();')
        if position<0:raise AssertionError('Race engine closure not found: '+path)
        script=script[:position]+"window.__readinessRace={snapshot:()=>JSON.parse(JSON.stringify({"+fields+"}))};\n"+script[position:]
        return '<script>'+script+'</script>'
    return re.sub(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>',instrument,source)


def _race_wait(page, expression, arg=None):
    page.wait_for_function(expression,arg=arg,timeout=30000)


def _race_state(page):
    return page.evaluate('__readinessRace.snapshot()')


def _world_enter(page, name, code):
    page.get_by_role('button',name='Race a friend',exact=True).click()
    page.locator('#nameIn').fill(name)
    page.locator('#codeIn').fill(code)
    page.locator('#startBtn').click()
    _race_wait(page,"__readinessRace.snapshot().member && document.querySelector('#lobby').offsetParent!==null && document.querySelector('#startRaceBtn').hidden===!__readinessRace.snapshot().host")


def _world_node(page):
    page.locator('.node.reachable').first.click()
    _race_wait(page,"__readinessRace.snapshot().pending || __readinessRace.snapshot().done || document.querySelector('#result').offsetParent!==null")
    count=0
    while _race_state(page)['pending']:
        _race_wait(page,"!__readinessRace.snapshot().pending || !__readinessRace.snapshot().pending.locked")
        state=_race_state(page)
        if not state['pending']:break
        page.locator('#obOpts .opt').get_by_text(state['answer'],exact=True).click()
        count+=1
        if count>3:raise AssertionError('Adventure obstacle did not clear through correct answers')
        page.wait_for_timeout(760)
    return count


def _world_race(env,path):
    import uuid
    family='castle' if path=='castle.html' else path.removesuffix('.html')
    env.transform_source(path,lambda source:_race_export(path,source))
    host=env.new_page('/'+path,family+'-race-host')
    guest=env.new_page('/'+path,family+'-race-phone',mobile=True)
    code='W'+uuid.uuid4().hex[:9].upper()
    _world_enter(host,'Pilot',code)
    _world_enter(guest,'Scout',code)
    _race_wait(host,"document.querySelectorAll('#lobbyList li').length===2")
    env.check(family+': canonical host owns start and separate guests own separate IDs',_race_state(host)['host'] and not _race_state(guest)['host'] and _race_state(host)['member']['id']!=_race_state(guest)['member']['id'] and guest.locator('#startRaceBtn').is_hidden())
    host.locator('#startRaceBtn').click()
    _race_wait(host,"__readinessRace.snapshot().mpOn && !!document.querySelector('.node.reachable')")
    _race_wait(guest,"__readinessRace.snapshot().mpOn && !!document.querySelector('.node.reachable')")
    first=_race_state(host)
    env.check(family+': phones receive the same server-seeded adventure map',first['map']==_race_state(guest)['map'] and first['activeRun']==_race_state(guest)['activeRun'])
    calls=len(env.rpc_calls(host,'race_submit'))
    env.interrupt_next_rpc(host,'race_submit')
    _world_node(host)
    _race_wait(host,"document.querySelector('#raceNotice').dataset.state==='failed' && !document.querySelector('#raceNotice').classList.contains('hidden')")
    env.check(family+': lost progress acknowledgement locks advancement',_race_state(host)['netBusy'])
    host.locator('#raceRetry').click()
    _race_wait(host,"!__readinessRace.snapshot().netBusy && !__readinessRace.snapshot().busy")
    requests=env.rpc_calls(host,'race_submit')[calls:]
    env.check(family+': progress retry preserves its receipt UUID',len(requests)==2 and requests[0]['request_id']==requests[1]['request_id'])
    confirmed=_race_state(host)
    env.reload_page(host)
    _race_wait(host,"__readinessRace.snapshot().mpOn && !!document.querySelector('.node.reachable')")
    resumed=_race_state(host)
    env.check(family+': stable checkpoint resumes exact member, run, position and lives',resumed['member']['id']==confirmed['member']['id'] and resumed['activeRun']==confirmed['activeRun'] and resumed['pos']==confirmed['pos'] and resumed['lives']==confirmed['lives'])
    guest.locator('.node.reachable').first.click()
    _race_wait(guest,"!!__readinessRace.snapshot().pending")
    env.reload_page(guest)
    _race_wait(guest,"/interrupted position/.test(document.querySelector('#lobbyStatus').textContent)")
    env.check(family+': interrupted obstacle reload shows read-only recovery',not _race_state(guest)['mpOn'] and _race_state(guest)['member']['last_correct']==0 and guest.locator('#startRaceBtn').is_hidden())
    turns=0
    while host.locator('#result').is_hidden() and turns<12:
        state=_race_state(host)
        if state['done']:break
        if state['next'] and state['next'][0]['type']=='core':
            host.locator('.node.reachable').first.click()
            break
        _world_node(host)
        _race_wait(host,"!__readinessRace.snapshot().netBusy && !__readinessRace.snapshot().busy")
        turns+=1
    host.locator('#result').wait_for(timeout=30000)
    # The progress receipt updates the member before the separate standings
    # request renders resStats. Wait for both observations of the same finish.
    _race_wait(host,"__readinessRace.snapshot().member.last_time===1 && !__readinessRace.snapshot().netBusy && !__readinessRace.snapshot().busy && document.querySelector('#resStats').textContent.includes('You won the race')")
    finished=_race_state(host)
    result_text=host.locator('#resStats').inner_text()
    env.check(family+': a complete UI race records the canonical finish',finished['member']['last_correct']>=6 and 'You won the race' in result_text,
              {'canonical_progress':{key:finished['member'].get(key) for key in ('last_correct','last_level','last_time')},'depth':finished['depth'],'result':result_text})
    host.locator('#raceNewRound').click()
    _race_wait(host,"__readinessRace.snapshot().room.phase==='lobby' && document.querySelector('#lobby').offsetParent!==null")
    _race_wait(guest,"__readinessRace.snapshot().room.phase==='lobby'")
    reset=_race_state(host)['room']['run_id']
    env.check(family+': host rematch gets a fresh run identity',reset!=first['activeRun'])
    host.locator('#startRaceBtn').click()
    _race_wait(host,"__readinessRace.snapshot().mpOn && !__readinessRace.snapshot().done && !!document.querySelector('.node.reachable')")
    _race_wait(guest,"__readinessRace.snapshot().mpOn && !!document.querySelector('.node.reachable')")
    host.locator('.node.reachable').first.click()
    for _ in range(3):
        _race_wait(host,"__readinessRace.snapshot().pending && !__readinessRace.snapshot().pending.locked")
        answer=_race_state(host)['answer']
        choices=host.locator('#obOpts .opt')
        wrong=next(choices.nth(i) for i in range(choices.count()) if choices.nth(i).inner_text()!=answer)
        wrong.click()
        host.wait_for_timeout(1100)
    host.locator('#result').wait_for(timeout=30000)
    _race_wait(host,"__readinessRace.snapshot().member.last_time===2")
    env.check(family+': three normal wrong answers record an owned loss',_race_state(host)['member']['last_level']==0 and _race_state(host)['member']['last_time']==2)
    env.interrupt_next_rpc(guest,'race_submit')
    _world_node(guest)
    _race_wait(guest,"document.querySelector('#raceNotice').dataset.state==='failed' && !document.querySelector('#raceNotice').classList.contains('hidden')")
    guest.locator('#raceLeave').click()
    guest.locator('#menu').wait_for()
    env.check(family+': leave remains available during an unresolved acknowledgement',guest.locator('#raceNotice').is_hidden())
    host.locator('#menuBtn2').click()
    host.locator('#menu').wait_for()
    env.note(family+' used actual host/phone controls for an entire win, three-error loss, rematch, exact stable-checkpoint reload, interrupted-obstacle recovery and lost-ack retry. No Auth or server clock was replaced.')


def _tug_enter(page,name,code):
    page.locator('#nameIn').fill(name)
    page.locator('#codeIn').fill(code)
    page.locator('#joinBtn').click()
    _race_wait(page,"__readinessRace.snapshot().member && __readinessRace.snapshot().phase==='lobby'")


def _tug_answer(page):
    _race_wait(page,"__readinessRace.snapshot().phase==='tug' && !__readinessRace.snapshot().locked && !__readinessRace.snapshot().busy")
    page.locator('#opts .opt[data-a="1"]').click()


def _tug_race(env):
    import uuid
    path='tug-of-war.html'
    env.transform_source(path,lambda source:_race_export(path,source))
    host=env.new_page('/'+path,'tug-race-host')
    guest=env.new_page('/'+path,'tug-race-phone',mobile=True)
    code='T'+uuid.uuid4().hex[:9].upper()
    _tug_enter(host,'BlueFox',code)
    _tug_enter(guest,'RedFox',code)
    host.locator('#joinBlue').click()
    _race_wait(host,"__readinessRace.snapshot().side===1")
    guest.locator('#joinRed').click()
    _race_wait(guest,"__readinessRace.snapshot().side===2")
    _race_wait(host,"!document.querySelector('#goBtn').disabled")
    env.check('Tug: only the canonical host can start the selected teams',_race_state(host)['host'] and not _race_state(guest)['host'] and guest.locator('#goBtn').is_hidden())
    host.locator('#goBtn').click()
    _race_wait(host,"__readinessRace.snapshot().phase==='tug'")
    _race_wait(guest,"__readinessRace.snapshot().phase==='tug'")
    run=_race_state(host)['activeRun']
    calls=len(env.rpc_calls(host,'race_submit'))
    env.interrupt_next_rpc(host,'race_submit')
    _tug_answer(host)
    _race_wait(host,"document.querySelector('#raceNotice').dataset.state==='failed' && !document.querySelector('#raceNotice').classList.contains('hidden')")
    env.check('Tug: unresolved answer acknowledgement keeps answer controls locked',_race_state(host)['locked'] and host.locator('#opts .opt:enabled').count()==0)
    host.locator('#raceRetry').click()
    _race_wait(host,"__readinessRace.snapshot().correct===1 && !__readinessRace.snapshot().busy")
    requests=env.rpc_calls(host,'race_submit')[calls:]
    env.check('Tug: lost answer retries the same receipt once',len(requests)==2 and requests[0]['request_id']==requests[1]['request_id'])
    _tug_answer(guest)
    _race_wait(guest,"__readinessRace.snapshot().member.last_correct===1")
    env.reload_page(guest)
    _race_wait(guest,"__readinessRace.snapshot().phase==='tug'")
    env.check('Tug: reloading restores canonical counters and the same run',_race_state(guest)['activeRun']==run and _race_state(guest)['correct']==1 and _race_state(guest)['member']['last_correct']==1)
    answers=0
    while _race_state(host)['phase']=='tug' and answers<30:
        _tug_answer(host)
        host.wait_for_timeout(480)
        answers+=1
    host.locator('#resultScreen').wait_for(timeout=30000)
    guest.locator('#resultScreen').wait_for(timeout=30000)
    env.check('Tug: server-derived ending agrees on both team screens','Blue wins!' in host.locator('#winBanner').inner_text() and 'Blue wins!' in guest.locator('#winBanner').inner_text())
    host.locator('#againBtn').click()
    _race_wait(host,"__readinessRace.snapshot().phase==='lobby' && __readinessRace.snapshot().room.phase==='lobby'")
    _race_wait(guest,"__readinessRace.snapshot().phase==='lobby' && __readinessRace.snapshot().room.phase==='lobby'")
    env.check('Tug: owned rematch resets all counters and changes run',_race_state(host)['room']['run_id']!=run and _race_state(host)['correct']==0 and _race_state(guest)['correct']==0 and _race_state(host)['wrong']==0)
    host.locator('#leaveBtn').click()
    host.locator('#menuScreen').wait_for()
    _race_wait(guest,"__readinessRace.snapshot().host")
    env.check('Tug: active guest receives host ownership after host leaves',_race_state(guest)['host'])
    guest.locator('#leaveBtn').click()
    guest.locator('#menuScreen').wait_for()
    env.note('Tug completed two actual team clients, acknowledged answers, a lost-ack retry, reload with canonical counters, a whole server-ended match, host rematch and host-transfer leave. Native browser, SDK Auth and database clocks remained unchanged.')


def run_races(env):
    for path in ('castle.html','core.html','labyrinth.html'):_world_race(env,path)
    _tug_race(env)
