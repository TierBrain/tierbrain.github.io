"""Solo deadline/retry acceptance through actual page controls.

The browser probe exposes read-only closure state as an answer oracle. Native
clock callbacks remain the game's own; Playwright's local clock shortens waits.
No backend adapter or production data is used by these scenarios.
"""
from pathlib import Path
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
GAMES = ('fact-fiction.html', 'higher-lower.html', 'guess-the-year.html', 'call-your-shot.html')


def expose_solo(source):
    def script(match):
        body = match.group(2)
        if 'function startGame(){' not in body or 'function endTimeUp(){' not in body:
            return match.group(0)
        end = body.rfind('})();')
        if end < 0:
            raise AssertionError('Solo gameplay closure not found')
        probe = """
window.__readinessSolo = function(){ return {
  playing:playing, answered:answered, correct:correct, level:level,
  locked:locked, current:current, remaining:remainingMs(), limit:TIME_LIMIT,
  prompt:document.getElementById('qtext').textContent
}; };
"""
        return '<script' + match.group(1) + '>' + body[:end] + probe + body[end:] + '</script>'
    return re.sub(r'<script\b([^>]*)>([\s\S]*?)</script>', script, source, flags=re.I)


def probe(page):
    return page.evaluate('__readinessSolo()')


def choose(page, name, right=True):
    value = probe(page)['current']
    if name == 'guess-the-year.html':
        slider = page.locator('#yrSlider')
        bounds = [int(slider.get_attribute(key)) for key in ('min','max')]
        year = value['year'] if right else max(bounds,key=lambda number:abs(number-value['year']))
        page.locator('#yrSlider').fill(str(year))
        page.locator('#yrLock').click()
    else:
        answer = value['correct'] if right else value['wrong'][0]
        # Options contain visual key/mark children; match their text span exactly.
        option=page.locator('#opts button').filter(has=page.locator('.txt', has_text=re.compile('^'+re.escape(str(answer))+'$')))
        if name == 'call-your-shot.html':
            option.focus()
            page.keyboard.press('Enter')
        else:
            option.click()
        if name == 'call-your-shot.html':
            page.locator('#ringHunch').focus()
            page.keyboard.press('Enter')


def run(env):
    for name in GAMES:
        env.transform_source(name, expose_solo)
        page = env.new_page('/'+name, 'solo-a-'+name, mobile=True)
        page.wait_for_function("typeof __readinessSolo==='function'")
        page.clock.install()
        page.locator('#startBtn').click()
        env.check(name+': normal start has first question', probe(page)['answered'] == 0 and probe(page)['playing'])

        # Keep one focused answer control across native timer expiry. Pressing
        # Enter afterwards must not change the finished game's score.
        focus = '#yrLock' if name == 'guess-the-year.html' else '#opts button:first-child'
        page.locator(focus).focus()
        page.clock.fast_forward(probe(page)['limit']+200)
        env.check(name+': native timeout displays results', page.locator('#timeupScreen').is_visible())
        ended = probe(page)
        page.keyboard.press('Enter')
        env.check(name+': retained keyboard focus cannot grade after timeout', probe(page)['answered'] == ended['answered'] == 0 and not probe(page)['playing'])

        # Accept an answer close to the deadline, let the ordinary clock end
        # the run during its reveal, then restart before that reveal completes.
        page.locator('#tuRetry').click()
        page.clock.fast_forward(probe(page)['limit']-500)
        choose(page, name)
        page.clock.fast_forward(probe(page)['remaining']+200)
        env.check(name+': timeout can occur during feedback', page.locator('#timeupScreen').is_visible() and probe(page)['answered'] == 1)
        page.locator('#tuRetry').click()
        first = probe(page)
        page.clock.fast_forward(2500)
        current = probe(page)
        env.check(name+': old feedback cannot skip a new question', current['answered'] == 0 and current['playing'] and current['prompt'] == first['prompt'])

        # Complete a fresh game with twenty actual answer/lock/throw actions.
        for question in range(20):
            env.check(name+': question '+str(question+1)+' is sequential', probe(page)['answered'] == question)
            choose(page, name)
            page.clock.fast_forward(2200)
        env.check(name+': full correct run ends normally', page.locator('#doneScreen').is_visible() and probe(page)['answered'] == 20 and probe(page)['correct'] == 20 and not probe(page)['playing'])

        page.locator('#doneAgain').click()
        for _ in range(4):
            choose(page, name, right=False)
            page.clock.fast_forward(2200)
        env.check(name+': four actual mistakes end a retry', page.locator('#outScreen').is_visible() and probe(page)['answered'] == 4 and not probe(page)['playing'])
        page.locator('#outRetry').click()
        env.check(name+': loss retry starts cleanly', probe(page)['answered'] == 0 and probe(page)['correct'] == 0 and probe(page)['playing'])
        env.note(name+': real answer controls, twenty-answer finish, four-mistake finish, native timeout callback and interrupted-reveal retry; local Playwright clock shortened waiting only')
        page.context.close()


def unit_checks():
    # Reuse the existing balanced-brace extractor; execute actual functions, not
    # a second implementation of the score/feedback/retry logic.
    from test_party_creak_standing import function
    fixture = r"""
const assert=require('node:assert/strict');
let level,answered,correct,totalWrong,streakC,streakW,current,opts,locked,pendingMove;
let startT=0,timerId=null,runId=0,queues,ptr,playing=false,picked=null,phase=1;
let guess=1950,roundLevel=1,draws=0;const callbacks=[];
const BANK={1:[1],2:[1],3:[1],4:[1]},LVL_COLOR={1:'one',2:'two',3:'three',4:'four'};
const TOL={1:30,2:15,3:8,4:3},CHECK='yes',CROSS='no';
const PAY={1:{r:1,w:0,name:'Hunch'},2:{r:2,w:-1,name:'Fair'},3:{r:3,w:-3,name:'Certain'}};
const RINGID={1:'ringHunch',2:'ringFair',3:'ringCertain'},RINGTOP={1:'9%',2:'27%',3:'50%'};
const performance={now:()=>1000},window={};
const elements=new Map();function $(id){if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',className:'',disabled:false,style:{},classList:{add(){},remove(){}},children:[],parentElement:{classList:{add(){},remove(){}}}});return elements.get(id);}
function shuffle(a){return a.slice();}function hideAllScreens(){}function runTimer(){}function stopTimer(){}function renderStrikes(){}function remainingMs(){return 0;}function fmt(){return '0:00';}function show(){}function toast(){}
function sRight(){}function sWrong(){}function sOut(){}function sUp(){}function sDown(){}function sDone(){}function beep(){}
function escapeHtml(s){return s;}let lastRun;
function setTimeout(fn,delay){callbacks.push({fn,delay});return callbacks.length;}
function fresh(){draws++;current={q:'Question '+draws,correct:'Yes',wrong:['No'],year:1950};locked=false;phase=1;picked=null;opts=['Yes','No'];$('opts').children=opts.map(value=>({querySelector:()=>({textContent:value}),lastElementChild:{outerHTML:''},classList:{add(){}}}));}
function nextQuestion(){fresh();}function newQuestion(){fresh();}
"""
    for name in GAMES:
        source = re.sub(r'(?m)^  ', '', (ROOT/name).read_text())
        names = ['startGame','endTimeUp','endOut','endDone']
        names += ['pickAnswer','throwDart'] if name == 'call-your-shot.html' else ['evaluate' if name == 'guess-the-year.html' else 'answer']
        actual = '\n'.join(function(source,n) for n in names)
        action = "pickAnswer(current.correct,$('opts').children[0]);throwDart(1);" if name == 'call-your-shot.html' else "evaluate();" if name == 'guess-the-year.html' else "answer(current.correct,$('opts').children[0]);"
        checks = """
startGame();endTimeUp();const ended=answered;
ACTION
assert.equal(answered,ended,'input after timeout must not grade');
callbacks.length=0;draws=0;startGame();
ACTION
assert.equal(answered,1);const accepted=callbacks.slice();endTimeUp();startGame();const first=draws;
accepted.forEach(c=>c.fn());assert.equal(draws,first,'old feedback must not advance restarted run');assert.equal(answered,0);
""".replace('ACTION',action)
        result = subprocess.run(['node','-'],input=fixture+'\n'+actual+'\n'+checks,text=True,capture_output=True,timeout=20)
        if result.returncode:
            raise AssertionError(name+'\n'+result.stdout+result.stderr)
        print(name+': ended input and stale feedback guards passed',flush=True)


if __name__ == '__main__':
    unit_checks()


# Races use real time, guest Auth, owned RPCs and SQL in the disposable stack.
# These probes expose existing state only; they do not change grading or clocks.
def expose_finish(source):
    marker = '  // ---- wiring ----'
    assert source.count(marker) == 1
    oracle = """
window.__readinessRace=function(){return JSON.parse(JSON.stringify({
 phase:phase,progress:progress,locked:locked,current:current,activeRun:activeRun,
 room:access.current()&&access.current().room,member:access.member(),busy:access.busy(),
 rows:access.current()&&access.current().rows,players:players
}));};
"""
    return source.replace(marker, oracle + marker)


def expose_finger(source):
    end = source.rfind('})();')
    assert end > 0
    oracle = """
window.__readinessRace=function(){return JSON.parse(JSON.stringify({
 phase:R.phase,solo:R.solo,activeRun:activeRun,busy:access.busy(),room:access.current()&&access.current().room,
 member:access.member(),rows:access.current()&&access.current().rows,
 view:G&&G.view,my:G&&G.my,rounds:G&&G.rounds.map(function(r){return {answer:r.q[1],words:r.n};}),
 totals:G&&totals(),roster:G&&G.roster,pending:access.pending(),error:access.error(),
 now:Date.now(),timeline:G&&timeline(),drawDisabled:$('drawBtn').disabled
}));};
"""
    return source[:end] + oracle + source[end:]


def race_probe(page):
    return page.evaluate('__readinessRace()')


def race_wait(page, expression, arg=None, timeout=30000):
    try:
        page.wait_for_function(expression, arg=arg, timeout=timeout)
    except Exception:
        state=race_probe(page)
        schedule=state.get('timeline') or []
        window=schedule[arg] if isinstance(arg,int) and 0<=arg<len(schedule) else None
        print('Race wait failed: '+json.dumps({'url':page.url,'arg':arg,'phase':state.get('phase'),
              'view':state.get('view'),'busy':state.get('busy'),'my':state.get('my'),
              'pending':state.get('pending'),'error':state.get('error'),'now':state.get('now'),
              'window':window,'drawDisabled':state.get('drawDisabled'),
              'rows':len(state.get('rows') or [])},default=str),flush=True)
        raise


def race_join(page, name, code):
    page.locator('#nameIn').fill(name)
    page.locator('#codeIn').fill(code)
    page.locator('#joinBtn').click()
    race_wait(page, "__readinessRace().member&&!__readinessRace().busy")


def finish_race(env):
    env.transform_source('finish-line.html', expose_finish)
    host = env.new_page('/finish-line.html', 'Finish race host', mobile=True)
    guest = env.new_page('/finish-line.html', 'Finish race guest', mobile=True)
    race_join(host,'constructor','FINA1')
    race_join(guest,'toString','FINA1')
    race_wait(host, "document.querySelectorAll('#players .prow').length===2&&!document.querySelector('#goBtn').disabled")
    env.check('Finish: only the authenticated host can start', guest.locator('#goBtn').is_disabled())
    host.locator('#goBtn').click()
    for page in (host, guest):
        race_wait(page, "__readinessRace().phase==='race'&&__readinessRace().current&&!__readinessRace().busy&&document.querySelectorAll('#opts button').length===4")
    first = race_probe(host)
    env.check('Finish: clients adopt one server run and seeded question order',
              first['room']['run_id'] == race_probe(guest)['room']['run_id']
              and first['current'][0] == race_probe(guest)['current'][0])
    env.interrupt_next_rpc(host, 'race_submit')
    host.locator('#opts button[data-a="1"]').click()
    host.locator('#raceConnectionRetry').wait_for(state='visible')
    env.check('Finish: lost acknowledgement locks the accepted question', race_probe(host)['locked'])
    host.locator('#raceConnectionRetry').click()
    race_wait(host, "__readinessRace().progress===1&&!__readinessRace().busy&&!__readinessRace().locked")
    calls = env.rpc_calls(host, 'race_submit')
    env.check('Finish: acknowledgement retry retains its request UUID',
              len(calls) >= 2 and calls[-1]['request_id'] == calls[-2]['request_id'])
    for target in range(2, 4):
        host.locator('#opts button[data-a="1"]').click()
        race_wait(host, "n=>__readinessRace().progress===n&&!__readinessRace().busy&&!__readinessRace().locked", target)
    identity = race_probe(host)['member']['id']
    run = race_probe(host)['activeRun']
    host.reload()
    race_join(host,'constructor','FINA1')
    race_wait(host, "__readinessRace().phase==='race'&&__readinessRace().progress===3")
    env.check('Finish: refresh restores canonical member, run and accepted progress',
              race_probe(host)['member']['id'] == identity and race_probe(host)['activeRun'] == run)
    finished_presence = None
    for page in (host, guest):
        while race_probe(page)['progress'] < 12:
            race_wait(page, "__readinessRace().phase==='race'&&!__readinessRace().busy&&!__readinessRace().locked")
            before = race_probe(page)['progress']
            page.locator('#opts button[data-a="1"]').click()
            race_wait(page, "old=>__readinessRace().progress>old&&!__readinessRace().busy", before)
        page.locator('#resultScreen').wait_for(state='visible')
        if page == host:
            finished_presence = race_probe(host)['member']['last_seen']
    race_wait(host, "stamp=>__readinessRace().member.last_seen!==stamp", finished_presence, timeout=6000)
    env.check('Finish: a finisher stays present for the next host rematch',race_probe(host)['member']['last_seen'] != finished_presence)
    race_wait(host, "Object.values(__readinessRace().players).filter(p=>p.finished).length===2")
    env.check('Finish: both twelve-answer runs publish unique canonical finishes',
              all(sum(row.get('kind') == 'progress' and row.get('level') == 1 and row.get('member_id') == race_probe(page)['member']['id'] for row in race_probe(host)['rows']) == 1
                  for page in (host, guest)))
    env.check('Finish: guest rematch waits for the host', guest.locator('#againBtn').is_disabled())
    host.locator('#againBtn').click()
    for page in (host, guest):
        race_wait(page, "__readinessRace().phase==='lobby'&&!__readinessRace().busy")
    env.check('Finish: deliberate host reset isolates the next run',
              race_probe(host)['room']['run_id'] != run and race_probe(host)['progress'] == 0)
    for page in (host, guest):
        env.check('Finish: reset remains in the lobby until the next explicit start',
                  race_probe(page)['phase'] == 'lobby' and not any(row.get('kind') == 'start' for row in race_probe(page)['rows']))
    host.locator('#goBtn').click()
    for page in (host, guest):
        race_wait(page, "__readinessRace().phase==='race'&&!__readinessRace().busy")
        env.check('Finish: second start puts every racer on a clean grid',
                  race_probe(page)['activeRun'] != run and race_probe(page)['progress'] == 0
                  and all(player['progress'] == 0 and not player['finished'] for player in race_probe(page)['players'].values()))
    for page in (host, guest):
        page.context.close()
    env.note('Finish: actual answers and twelve-answer finishes, two real guest sessions, lost committed acknowledgement, refresh and deliberate rematch; no production contacts or clock substitutes')


def finger_race(env, bible=False):
    filename = 'first-finger-bible.html' if bible else 'first-finger.html'
    label = 'First Finger Bible' if bible else 'First Finger General'
    code = 'FFBA1' if bible else 'FFGA1'
    host = env.new_page('/'+filename, label+' host', mobile=True)
    guest = env.new_page('/'+filename, label+' guest', mobile=True)
    host.locator('#menuScreen .spd[data-ms="450"]').click()
    race_join(host, 'Calamity', code)
    race_join(guest, 'Sundance', code)
    race_wait(host, "!document.querySelector('#goBtn').disabled")
    env.check(label+': guest start is unavailable', guest.locator('#goBtn').is_disabled())
    host.locator('#goBtn').click()
    for page in (host, guest):
        race_wait(page, "__readinessRace().activeRun&&__readinessRace().rounds&&!__readinessRace().busy")
    run = race_probe(host)['activeRun']
    env.check(label+': both clients use the server seed and nine matching rounds',
              race_probe(host)['rounds'] == race_probe(guest)['rounds'] and len(race_probe(host)['rounds']) == 9)
    for index in range(9):
        for page in (host, guest):
            race_wait(page, "i=>{const s=__readinessRace();return s.view&&s.view.r===i&&s.view.ph==='play'&&!document.querySelector('#drawBtn').disabled&&!s.busy;}", index, timeout=60000)
        if index == 0:
            env.interrupt_next_rpc(host, 'race_submit')
        for page in (host, guest):
            page.locator('#drawBtn').click()
            if index == 0 and page == host:
                host.locator('#raceConnectionRetry').wait_for(state='visible')
                host.locator('#raceConnectionRetry').click()
            race_wait(page, "i=>{const s=__readinessRace();return s.my[i]&&s.my[i].drawn&&!s.busy;}", index)
            skip = page.locator('#posterBody .skip')
            if skip.is_visible():
                skip.click()
            answer = race_probe(page)['rounds'][index]['answer']
            answer_index=page.evaluate("answer=>Array.from(document.querySelectorAll('#answers button')).findIndex(b=>b.dataset.a===answer)",answer)
            page.locator('#answers button').nth(answer_index).click()
            race_wait(page, "i=>{const s=__readinessRace();return s.my[i]&&s.my[i].answered&&!s.busy;}", index)
        if index == 0:
            calls = env.rpc_calls(host, 'race_submit')
            env.check(label+': draw acknowledgement retry retains its UUID', len(calls) >= 2 and calls[0]['request_id'] == calls[1]['request_id'])
        if index == 2:
            member = race_probe(guest)['member']['id']
            guest.reload()
            race_join(guest, 'Sundance', code)
            race_wait(guest, "__readinessRace().my&&__readinessRace().my[2]&&__readinessRace().my[2].answered")
            env.check(label+': refresh reconstructs accepted draws and answers without resubmission',
                      race_probe(guest)['member']['id'] == member and race_probe(guest)['activeRun'] == run)
    for page in (host, guest):
        page.locator('#endScreen').wait_for(state='visible', timeout=30000)
    race_wait(host, "__readinessRace().rows.filter(r=>r.kind==='answer').length===18")
    rows = race_probe(host)['rows']
    env.check(label+': all nine real rounds have exactly one draw and answer per participant',
              all(sum(row.get('kind') == kind and row.get('member_id') == race_probe(page)['member']['id'] and row.get('level') == base+index for row in rows) == 1
                  for page in (host, guest) for kind,base in (('draw',1000),('answer',2000)) for index in range(9)))
    env.check(label+': clients agree on positive canonical totals',
              race_probe(host)['totals'] == race_probe(guest)['totals'] and all(value > 0 for value in race_probe(host)['totals'].values()))
    env.check(label+': only host offers the next showdown', guest.locator('#againBtn').is_disabled())
    host.locator('#againBtn').click()
    for page in (host, guest):
        race_wait(page, "__readinessRace().phase==='lobby'&&!__readinessRace().busy")
    env.check(label+': rematch has a new server run', race_probe(host)['room']['run_id'] != run)
    for page in (host, guest):
        env.check(label+': reset waits in the lobby without replaying the old start',
                  race_probe(page)['phase'] == 'lobby' and not any(row.get('kind') == 'start' for row in race_probe(page)['rows']))
    host.locator('#goBtn').click()
    for page in (host, guest):
        race_wait(page, "__readinessRace().phase==='game'&&!__readinessRace().busy")
        env.check(label+': next explicit start clears prior answers and scores',
                  race_probe(page)['activeRun'] != run and not any(row.get('kind') == 'answer' for row in race_probe(page)['rows'])
                  and all(value == 0 for value in race_probe(page)['totals'].values()))
    for page in (host, guest):
        page.context.close()
    env.note(label+': full nine-round actual draw/answer UI, real server timing, lost acknowledgement, refresh, standings and host rematch; no Auth/RPC clock manipulation')


def run_races(env):
    finish_race(env)
    env.transform_source('first-finger.js', expose_finger)
    finger_race(env)
    finger_race(env, bible=True)
