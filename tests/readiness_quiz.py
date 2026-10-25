"""Topic-quiz playthroughs, with blocked network and synthetic score fixtures.

The 25 published topic pages inline-copy their quiz engine. The browser entry
point is run(env), and --unit exercises those actual function blocks in Node.
Playwright's clock advances solo deadlines and answer reveals; this suite does
not claim native 90/120/180-second wall-clock coverage.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def topic_pages():
    spec = importlib.util.spec_from_file_location("readiness_catalogue", ROOT / "sync-catalogue.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return [name for name in module.read_catalogue(ROOT) if name.endswith("-quiz.html")]


def _engine(source):
    start = source.index("  let level,answered")
    end = source.index("  // ============ screen helpers", start)
    return source[start:end]


UNIT_SETUP = r"""
const vm=require('node:vm'),assert=require('node:assert/strict');
function fixture(source){
  let now=0,screen='',nextTimer=0,timers=new Map();
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.textContent='';this._html='';this.parentElement={classList:{add(){},remove(){}}};this.lastElementChild={outerHTML:''};this.classList={add(){},remove(){}};}
    set innerHTML(value){this._html=String(value);this.children=[];const match=this._html.match(/class="txt">([^<]*)/);this.label=match?match[1]:'';}
    get innerHTML(){return this._html;}
    appendChild(child){this.children.push(child);return child;}
    addEventListener(){}
    querySelector(selector){if(selector==='.txt')return {textContent:this.label};throw Error(selector);}
  }
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:tag=>new Element(tag),querySelector:()=>new Element()};
  const BANK={};for(let tier=1;tier<=4;tier++)BANK[tier]=Array.from({length:24},(_,i)=>({q:'T'+tier+' question '+i,correct:'Right '+i,wrong:['Wrong A '+i,'Wrong B '+i,'Wrong C '+i]}));
  const context=vm.createContext({document,BANK,LVL_NAMES:{1:'1',2:'2',3:'3',4:'4'},LVL_COLOR:{1:'a',2:'b',3:'c',4:'d'},KEYS:['A','B','C','D'],CHECK:'right',CROSS:'wrong',performance:{now:()=>now},Math,
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(){return 1;},clearInterval(){},sRight(){},sWrong(){},sUp(){},sDown(){},sOut(){},sDone(){},hideAllScreens(){},show(id){screen=id;},console});
  vm.runInContext('let lastRun=null;'+source+`;globalThis.inspect=()=>({answered,correct,totalWrong,level,playing:typeof playing==='undefined'?null:playing,question:current.q,ptr:ptr[1],lastRun});globalThis.click=right=>{const button=document.getElementById('opts').children.find(b=>(b.label===current.correct)===right);answer(button.label,button);};globalThis.expire=()=>{endTimeUp();};`,context);
  return {context,get screen(){return screen;},elapse(ms){now+=ms;},start(){context.startGame();},click(right){context.click(right);},snapshot(){return context.inspect();},callbacks(){return [...timers.values()].map(t=>t.fn);},advance(){const entry=[...timers.entries()].find(([,t])=>t.delay===780||t.delay===1050);assert.ok(entry,'an answer schedules its ordinary reveal');timers.delete(entry[0]);entry[1].fn();}};
}
"""


UNIT_CASES = r"""
if(typeof fixture(source).context.remainingMs==='function'){
  const game=fixture(source);game.start();game.elapse(120001);game.click(true);
  assert.equal(game.screen,'timeupScreen','late answer between timer polls was accepted');
  assert.equal(game.snapshot().answered,0,'late answer changed the result');
}
for(const right of [true,false]){
  const game=fixture(source);game.start();game.click(right);const stale=game.callbacks();game.context.expire();game.start();const before=game.snapshot();
  for(const callback of stale)callback();
  assert.equal(game.snapshot().question,before.question,'old answer callback changed fresh first question');
  assert.equal(game.snapshot().ptr,1,'old answer callback consumed a fresh question');
  assert.equal(game.snapshot().answered,0,'fresh run inherited answered count');
}
{
  const game=fixture(source);game.start();game.context.expire();const before=game.snapshot();game.click(true);
  assert.equal(game.snapshot().answered,before.answered,'answer was accepted after game over');
  assert.equal(game.snapshot().correct,before.correct,'ended run gained a correct answer');
}
{
  const game=fixture(source);game.start();for(let i=0;i<20;i++){game.click(true);game.advance();}
  assert.equal(game.screen,'doneScreen');assert.equal(game.snapshot().lastRun.correct,20);assert.equal(game.snapshot().lastRun.level,4);
  game.start();for(let i=0;i<4;i++){game.click(false);game.advance();}
  assert.equal(game.screen,'outScreen');assert.equal(game.snapshot().answered,4);assert.equal(game.snapshot().correct,0);
}
"""


def unit_checks(baseline=False):
    names = topic_pages() + ["quiz-engine.js", "quiz-climb.html"]
    failures = []
    for name in names:
        source = subprocess.check_output(["git", "show", "HEAD:" + name], cwd=ROOT, text=True) if baseline else (ROOT / name).read_text()
        cases = UNIT_CASES
        if name == "quiz-climb.html":
            # Quiz Climb counts elapsed time. It shares answer generation guards
            # but has no countdown-expiry case or fourth difficulty tier.
            cases = cases.replace("game.context.expire()", "game.context.endOut()")
            cases = cases.replace("assert.equal(game.snapshot().lastRun.correct,20);assert.equal(game.snapshot().lastRun.level,4);", "assert.equal(game.snapshot().correct,20);assert.equal(game.snapshot().level,3);")
        result = subprocess.run(["node", "-"], input=UNIT_SETUP + "\nconst source=" + json.dumps(_engine(source)) + ";\n" + cases,
                                text=True, capture_output=True, timeout=15)
        if result.returncode:
            failures.append({"file":name, "error":result.stderr[-1200:]})
    if baseline:
        if len(failures) != len(names):
            raise AssertionError("Baseline must reproduce the same genuine race in every copied engine: " + json.dumps(failures))
        print(f"Baseline reproduction: all {len(names)} actual engines reject the stale-answer test")
    elif failures:
        raise AssertionError(json.dumps(failures, indent=2))
    else:
        print(f"Quiz engine checks passed for {len(topic_pages())} published topic pages, Quiz Climb and the unused shared template")


def _bank(name):
    source = (ROOT / name).read_text()
    start = re.search(r"(?m)^  (?:const|var) BANK(?:_LOCAL)?=", source).start()
    end = source.index("  const LVL_NAMES=", start)
    setup = source[start:end]
    output = subprocess.run(["node", "-"], input="const window={};require('node:vm').runInNewContext(require('node:fs').readFileSync('questions.js','utf8'),{window},{timeout:3000});\n" + setup + "\nprocess.stdout.write(JSON.stringify(BANK));",
                            text=True, capture_output=True, cwd=ROOT, timeout=15)
    if output.returncode:
        raise AssertionError(output.stderr)
    values = json.loads(output.stdout)
    answers = {}
    for questions in values.values():
        for question in questions:
            answers.setdefault(" ".join(question["q"].split()), []).append(question)
    return answers


def _answer(page, bank, right=True, keyboard=False):
    question = " ".join(page.locator("#qtext").inner_text().split())
    texts = page.locator("#opts .txt").all_text_contents()
    record = next(row for row in bank[question]
                  if {" ".join(text.split()) for text in [row["correct"], *row["wrong"]]} == set(texts))
    index = next(i for i, text in enumerate(texts) if (text == " ".join(record["correct"].split())) == right)
    if keyboard:
        page.keyboard.press(str(index+1))
    else:
        page.locator("#opts .opt").nth(index).click()


def run(env):
    names = topic_pages()
    env.check("topic catalogue contains 25 published pages", len(names) == 25)
    for index,name in enumerate(names):
        page = env.new_page("/"+name, "topic-smoke-"+name, mobile=True)
        page.set_viewport_size({"width":320,"height":740})
        page.locator("#startBtn").click()
        page.locator("#opts .opt").first.wait_for()
        env.check(name+": start displays four answer choices", page.locator("#opts .opt").count()==4)
        env.check(name+": form controls have accessible names", page.locator("#groupInput").get_attribute("aria-label") == "Group code (optional)" and page.locator("#boardName").get_attribute("aria-label") == "Name on leaderboard")
        env.check(name+": game has no horizontal page overflow at 320px", page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
        _answer(page,_bank(name),keyboard=True)
        page.wait_for_function("document.querySelector('#qcount').textContent==='QUESTION 2 OF 20'")
        env.check(name+": keyboard answer advances exactly one question", page.locator("#qcount").inner_text() == "QUESTION 2 OF 20")
        page.context.close()

    # Representative full wins, losses, local saves and two distinct restart
    # races use the real controls. Only the local browser clock is advanced.
    for name in ("general-knowledge-quiz.html","crypto-quiz.html","wrestling-quiz.html"):
        page = env.new_page("/"+name, "topic-full-"+name)
        page.clock.install()
        bank = _bank(name)
        page.locator("#startBtn").click()
        for number in range(20):
            _answer(page,bank,keyboard=number%2==0)
            page.clock.fast_forward(1200)
        page.locator("#doneScreen").wait_for(state="visible")
        env.check(name+": full twenty-question win", page.locator("#doneCorr").inner_text()=="20" and page.locator("#doneLvl").inner_text()=="LEVEL 4")
        page.locator("#doneScreen .endboard").click()
        page.locator("#boardName").fill("QA <Casey>")
        page.locator("#boardSave").click()
        env.check(name+": local score renders name as text", "QA <Casey>" in page.locator("#boardList").inner_text() and page.locator("#boardList .bnm casey").count()==0)
        page.locator("#boardPlay").click()
        for _ in range(4):
            _answer(page,bank,right=False)
            page.clock.fast_forward(1200)
        page.locator("#outScreen").wait_for(state="visible")
        env.check(name+": four wrong answers end normally", page.locator("#outAns").inner_text()=="4" and page.locator("#outCorr").inner_text()=="0")

        for right in (True,False):
            page.locator("#outRetry" if page.locator("#outScreen").is_visible() else "#tuRetry").click()
            # Jump close to the selected ordinary 120-second clock, answer,
            # expire before the 780/1050ms reveal, and immediately retry.
            page.clock.fast_forward(119500)
            _answer(page,bank,right=right)
            page.clock.fast_forward(600)
            page.locator("#timeupScreen").wait_for(state="visible")
            env.check(name+": last answer was accepted before the deadline", page.locator("#tuAns").inner_text()=="1")
            page.locator("#tuRetry").click()
            first = page.locator("#qtext").inner_text()
            page.clock.fast_forward(1200)
            env.check(name+": stale "+("right" if right else "wrong")+" reveal cannot skip a restarted first question", page.locator("#qtext").inner_text()==first and page.locator("#qcount").inner_text()=="QUESTION 1 OF 20")
            page.clock.fast_forward(121000)
            page.locator("#timeupScreen").wait_for(state="visible")
        page.locator("#tuMenu").click()
        choices = page.locator("#timeRow button")
        for index in range(3):
            choices.nth(index).click()
            env.check(name+": selected clock announced "+str(index), choices.nth(index).get_attribute("aria-pressed")=="true" and page.locator('#timeRow button[aria-pressed="true"]').count()==1)
        page.context.close()
    climb = env.new_page("/quiz-climb.html", "quiz-climb-full", mobile=True)
    climb.clock.install()
    bank = _bank("quiz-climb.html")
    climb.locator("#startBtn").click()
    for number in range(20):
        _answer(climb,bank,keyboard=number%2==0)
        climb.clock.fast_forward(1200)
    climb.locator("#doneScreen").wait_for(state="visible")
    env.check("Quiz Climb: completes twenty-question elapsed-time climb", climb.locator("#doneCorr").inner_text()=="20" and climb.locator("#doneLvl").inner_text()=="LEVEL 3")
    climb.locator("#nameInput").fill("QA <Casey>")
    climb.locator("#saveBtn").click()
    env.check("Quiz Climb: local best time escapes displayed name", "QA <Casey>" in climb.locator("#doneBoard").inner_text() and climb.locator("#doneBoard casey").count()==0)
    climb.locator("#doneAgain").click()
    for _ in range(4):
        _answer(climb,bank,right=False,keyboard=True)
        climb.clock.fast_forward(1200)
    climb.locator("#outScreen").wait_for(state="visible")
    env.check("Quiz Climb: ordinary four-strike loss and fresh retry", climb.locator("#outAns").inner_text()=="4" and climb.locator("#outCorr").inner_text()=="0")
    climb.locator("#outRetry").click()
    env.check("Quiz Climb: retry starts from first question", climb.locator("#qcount").inner_text()=="QUESTION 1 OF 20")
    climb.context.close()
    env.note("Topic suite: all25 published entry points start and accept keyboard answers at320px; three representative engines complete20-question wins,4-strike losses, local escaped-name saves, two stale-reveal retries and clock selection. Playwright clock shortened solo deadlines and reveal waits; production backend requests remained blocked.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unit", action="store_true")
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    if not (args.unit or args.baseline):
        parser.error("Use --unit or --baseline; browser entry point is run(env)")
    unit_checks(args.baseline)
