"""Six repaired score editions: actual gameplay, save controls and database RLS.

Only read-only closure probes are added to three inline engines. Game handlers,
scoring, finish callbacks, request bodies and backend responses stay unchanged.
Playwright's clock shortens local solo reveals/timers; these pages use native
public-score requests and do not create Auth sessions or invoke room RPCs.
"""
import json
import re
from urllib.parse import urlsplit
from uuid import uuid4

PROJECT = 'cgrbwtcydgfkbqhseeap.supabase.co'


def add_probe(source, kind):
    changed = 0
    def script(match):
        nonlocal changed
        body = match.group(2)
        target = ('var N=5, FREE=0' in body if kind == 'claim' else
                  'function startGame(){' in body and ('const PAY=' in body if kind == 'shot' else 'const ROUNDS=12' in body))
        if not target:
            return match.group(0)
        end = body.rfind('})();')
        if end < 0:
            raise AssertionError('Score engine closure not found: '+kind)
        fields = ('running:running,counts:G&&counts(G),' if kind == 'claim' else
                  'playing:playing,answered:answered,correct:correct,level:level,current:current,')
        probe = """
window.__readinessScore=function(){return JSON.parse(JSON.stringify({FIELDS
 last:lastRun&&{correct:lastRun.correct,level:lastRun.level,time_left:Math.round(lastRun.timeLeft)}
}));};
""".replace('FIELDS',fields)
        changed += 1
        return '<script'+match.group(1)+'>'+body[:end]+probe+body[end:]+'</script>'
    result = re.sub(r'<script\b([^>]*)>([\s\S]*?)</script>',script,source,flags=re.I)
    if changed != 1:
        raise AssertionError('Expected one score engine, observed '+str(changed)+': '+kind)
    return result


def probe(page):
    return page.evaluate('__readinessScore()')


def is_score_response(response, method):
    url = urlsplit(response.url)
    return url.hostname == PROJECT and url.path == '/rest/v1/scores' and response.request.method == method


def observe_posts(page):
    posts = []
    def observed(request):
        url = urlsplit(request.url)
        if url.hostname == PROJECT and url.path == '/rest/v1/scores' and request.method == 'POST':
            posts.append(json.loads(request.post_data or 'null'))
    page.on('request',observed)
    return posts


def save(env, page, label, qid, group, expected, posts, smudged=False):
    """Observe real PostgREST responses and the game's own confirmation UI."""
    nickname = 'Score Check'
    page.locator('#nameIn' if smudged else '#boardName').fill(nickname)
    button = '#saveBtn' if smudged else '#boardSave'
    hidden = '#saveRow' if smudged else '#saveArea'
    before_requests = env.report['backend_requests']
    with page.expect_response(lambda response:is_score_response(response,'POST')) as written:
        with page.expect_response(lambda response:is_score_response(response,'GET')) as fetched:
            page.locator(button).click()
    posted, loaded = written.value, fetched.value
    env.check(label+': native save receives successful database response',200 <= posted.status < 300,
              {'status':posted.status})
    env.check(label+': native board refresh succeeds',200 <= loaded.status < 300,
              {'status':loaded.status})
    row = dict(quiz_id=qid,group_code=group,name=nickname,**expected)
    env.check(label+': actual request preserves score units and scope',posts == [[row]],
              {'correct':expected['correct'],'level':expected['level'],'time_left':expected['time_left']})
    rows = loaded.json()
    matches = [entry for entry in rows if entry.get('name') == nickname]
    env.check(label+': database readback contains exactly the saved result',
              len(matches) == 1 and all(matches[0].get(key) == value for key,value in expected.items()))
    page.locator(hidden).wait_for(state='hidden')
    if smudged:
        env.check(label+': confirmed result leaves no active save control',page.locator(button).is_disabled())
        # A retained reference to the old control must not submit again even
        # when its native click method is invoked after confirmation.
        page.locator(button).evaluate('(button)=>button.click()')
        page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    page.wait_for_function("document.querySelector('#boardList').textContent.includes('Score Check')")
    env.check(label+': confirmed save is visible and no duplicate POST occurred',
              page.locator('#boardList').is_visible() and len(posts) == 1
              and env.report['backend_requests'] >= before_requests+2)
    env.note(label+': real game controls, native request payload, actual isolated PostgREST/RLS acceptance and board readback; no hosted contacts')


def claim(env, suffix):
    env.transform_source('claim.html',lambda source:add_probe(source,'claim'))
    page = env.new_page('/claim.html','Claim actual loss and score',mobile=True)
    posts = observe_posts(page)
    group = 'CLM'+suffix
    page.locator('#nameIn').fill('Claim Rider')
    page.locator('#codeIn').fill(group)
    page.locator('#tierRow .chip').nth(3).click()
    page.clock.install()
    page.locator('#startBtn').click()
    # Let the actual Rustler interval fill the board. With no claims by the
    # player this is a genuine losing run, previously rejected for level=0.
    for _ in range(200):
        if page.locator('#result').is_visible():
            break
        page.clock.run_for(2000)
    env.check('Claim: actual Rustler turns complete a losing board',
              page.locator('#result').is_visible() and not probe(page)['running'])
    result = probe(page)['last']
    env.check('Claim: completed loss uses zero win flag',result['level'] == 0 and 0 <= result['correct'] <= 12)
    page.locator('#boardEmpty').wait_for(state='visible')
    save(env,page,'Claim loss','qc_claim',group,result,posts)
    page.context.close()


def shot(env, suffix, negative=False):
    label = 'Call Your Shot negative' if negative else 'Call Your Shot positive'
    page = env.new_page('/call-your-shot.html',label,mobile=True)
    posts = observe_posts(page)
    group = ('CYSM' if negative else 'CYSP')+suffix
    page.locator('#groupInput').fill(group)
    page.clock.install()
    page.locator('#startBtn').click()
    for index in range(4 if negative else 20):
        state = probe(page)
        env.check(label+': answer '+str(index+1)+' follows the native sequence',state['playing'] and state['answered'] == index)
        answer = state['current']['wrong'][0] if negative else state['current']['correct']
        page.locator('#opts button').filter(has=page.locator('.txt',has_text=re.compile('^'+re.escape(str(answer))+'$'))).click()
        page.locator('#ringCertain').click()
        page.clock.fast_forward(2000)
    ended = '#outScreen' if negative else '#doneScreen'
    env.check(label+': actual certain throws finish the run',page.locator(ended).is_visible())
    result = probe(page)['last']
    env.check(label+': weighted score exercises the repaired bounds',result['correct'] == (-12 if negative else 60))
    page.locator(ended+' .endboard').click()
    page.locator('#boardEmpty').wait_for(state='visible')
    save(env,page,label,'qc_call-your-shot',group,result,posts)
    page.context.close()


def clues(env, suffix, bible=False):
    filename = 'five-clues-bible.html' if bible else 'five-clues.html'
    label = 'Five Clues Bible' if bible else 'Five Clues general'
    env.transform_source(filename,lambda source:add_probe(source,'clues'))
    page = env.new_page('/'+filename,label+' actual score',mobile=True)
    posts = observe_posts(page)
    group = ('FCB' if bible else 'FCG')+suffix
    page.locator('#groupInput').fill(group)
    page.clock.install()
    page.locator('#startBtn').click()
    for index in range(12):
        state = probe(page)
        env.check(label+': riddle '+str(index+1)+' follows the native sequence',state['playing'] and state['answered'] == index)
        page.locator('#guessInput').fill(state['current']['answer'])
        page.locator('#guessBtn').click()
        page.clock.fast_forward(1100)
    env.check(label+': twelve actual first-clue solves finish the game',page.locator('#doneScreen').is_visible())
    result = probe(page)['last']
    env.check(label+': actual points exceed ordinary twenty-answer count',result['correct'] == 60)
    page.locator('#doneScreen .endboard').click()
    page.locator('#boardEmpty').wait_for(state='visible')
    save(env,page,label,'qc_five-clues-bible' if bible else 'qc_five-clues',group,result,posts)
    page.context.close()


def smudged_state(page):
    # G and RUN are actual page globals; reading copies exposes no setter and
    # does not replace any handler or scoring/finish implementation.
    return page.evaluate("({state:G&&G.state,over:G&&G.over,phrase:G&&G.phrase.text,solved:G&&G.solved,pts:G&&G.pts,run:RUN&&{correct:RUN.pts,level:RUN.solved,time_left:RUN.left}})")


def smudged(env, suffix, bible=False):
    filename = 'smudged-bible.html' if bible else 'wheel.html'
    label = 'Smudged Bible' if bible else 'Smudged general'
    page = env.new_page('/'+filename,label+' actual score',mobile=True)
    posts = observe_posts(page)
    group = ('SMB' if bible else 'SMG')+suffix
    page.locator('#groupCode').fill(group)
    page.locator('#groupCode').press('Tab')
    page.clock.install()
    page.locator('#goBtn').click()
    for index in range(20):
        state = smudged_state(page)
        env.check(label+': message '+str(index+1)+' follows the native sequence',
                  state['state'] == 'spin' and not state['over'] and state['solved'] == index)
        page.locator('#solveBtn').click()
        page.locator('#solveIn').fill(state['phrase'])
        page.locator('#solveGo').click()
        page.clock.fast_forward(2300)
    env.check(label+': twenty actual solve actions finish normally',page.locator('#end').is_visible())
    result = smudged_state(page)['run']
    env.check(label+': actual message score uses expanded points/solved units',result['level'] == 20 and result['correct'] > 20)
    page.wait_for_function("document.querySelector('#boardList').children.length>0")
    save(env,page,label,'qc_smudged-bible' if bible else 'qc_smudged',group,result,posts,smudged=True)
    page.context.close()


def run(env):
    suffix = uuid4().hex[:8].upper()
    claim(env,suffix)
    env.transform_source('call-your-shot.html',lambda source:add_probe(source,'shot'))
    shot(env,suffix)
    shot(env,suffix,negative=True)
    clues(env,suffix)
    clues(env,suffix,bible=True)
    smudged(env,suffix)
    smudged(env,suffix,bible=True)
    env.check('score UI checks use actual backend requests',env.report['backend_requests'] >= 21)
    env.note('Six repaired editions exercised; Call Your Shot covers both signed losses and full weighted wins. No Auth users, room RPCs, schema changes or production requests were made by this browser suite.')
