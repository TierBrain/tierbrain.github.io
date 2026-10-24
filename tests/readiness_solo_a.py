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
        page.locator('#opts button').filter(has=page.locator('.txt', has_text=re.compile('^'+re.escape(str(answer))+'$'))).click()
        if name == 'call-your-shot.html':
            page.locator('#ringHunch').click()


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
        page.clock.fast_forward(probe(page)['limit']-100)
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
