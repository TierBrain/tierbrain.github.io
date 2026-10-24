"""Bounded rendered catalogue checks, separate from complete gameplay suites.

Every published card is loaded with actual scripts at phone widths. Selected
solo engines then receive real Tab/Enter input. This is entry-point and first
interaction coverage, not 69 complete game playthroughs or physical-device QA.
No production destination is contacted: BrowserEnv owns every HTTP/WebSocket
transport, including anonymous Auth used by existing host lobby pages.
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

# A disabled start button is a valid initial state for a host awaiting players.
# Those host lobbies are played through by their existing multiplayer suites.
PRIMARY = {
    'full-circuit.html': '#enterBtn',
    'full-circuit-bible.html': '#enterBtn',
    'creak.html': '#roll',
    'throne.html': '#copyBtn',
    'throne-bible.html': '#copyBtn',
    'show-gen.html': '#startShow',
    'show.html': '#startShow',
    'full-circuit-host.html': '#startBtn',
    'full-circuit-bible-host.html': '#startBtn',
    'standing-room-multi.html': '#startBtn',
    'creak-multi.html': '#startBtn',
    'finish-line.html': '#joinBtn',
    'tug-of-war.html': '#joinBtn',
    'first-finger.html': '#soloBtn',
    'first-finger-bible.html': '#soloBtn',
    'spines.html': '#goBtn',
    'spines-bible.html': '#goBtn',
    'gaslight.html': '#caseList button',
    'standing-room.html': '#startBtn',
    'quiet-line.html': '#beginBtn',
    'quiet-line-vault.html': '#enterBtn',
    'core.html': '#startBtn',
    'castle.html': '#startBtn',
    'labyrinth.html': '#startBtn',
    'claim.html': '#startBtn',
    'jigsaw.html': '#tierList .tier',
    'piece-by-piece.html': '#deckFlags',
    'daily.html': '#dGo',
    'wheel.html': '#goBtn',
    'smudged-bible.html': '#goBtn',
    'brain-coaster.html': '#cats .cat-btn',
    'wall.html': '#scope',
    'five-clues.html': '#startBtn',
    'five-clues-bible.html': '#startBtn',
    'snap-sort.html': '#startBtn',
    'call-your-shot.html': '#startBtn',
    'matchup.html': '#startBtn',
    'higher-lower.html': '#startBtn',
    'odd-one-out.html': '#startBtn',
    'guess-the-year.html': '#startBtn',
    'fact-fiction.html': '#startBtn',
    'spot-the-lie.html': '#startBtn',
    'recall.html': '#startBtn',
    'unscramble.html': '#startBtn',
}


def _keyboard_enter(env, page, selector, label):
    """Find the actual control through browser tab order, then activate it."""
    control = page.locator(selector).first
    control.wait_for(state='visible', timeout=6000)
    reached = False
    for _ in range(100):
        page.keyboard.press('Tab')
        if control.evaluate('(element) => element === document.activeElement'):
            reached = True
            break
    env.check(label + ': primary control is reachable with Tab', reached)
    env.check(label + ': primary control has a visible text or accessible name',
              bool(control.inner_text().strip() or control.get_attribute('aria-label')))
    page.keyboard.press('Enter')


def _layout(env, page, label, width):
    page.set_viewport_size({'width': width, 'height': 844})
    # Animation-frame layout, rather than a fixed sleep, observes the resize.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    dimensions = page.evaluate('''() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      overflowing: [...document.querySelectorAll('button,input,select,a')].filter(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        if (!r.width || !r.height || s.display === 'none' || s.visibility === 'hidden') return false;
        // A deliberately scrollable game board may contain off-screen nodes.
        // The initial page still must not require horizontal document scrolling.
        for (let p=el.parentElement;p && p!==document.body;p=p.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return false;
        }
        return r.left < -1 || r.right > innerWidth + 1;
      }).slice(0,8).map(el => ({tag:el.tagName,id:el.id,text:el.textContent.trim().slice(0,60)}))
    })''')
    env.check(label + ': initial page fits ' + str(width) + 'px',
              dimensions['document'] <= width + 1 and not dimensions['overflowing'], dimensions)


def _first_interaction(env, page, name):
    """Exercise remaining solo entry flows through rendered controls only."""
    if name in ('full-circuit.html', 'full-circuit-bible.html'):
        _keyboard_enter(env, page, '#enterBtn', name)
        page.locator('#hall').wait_for(state='visible', timeout=6000)
        env.check(name + ': solo opening reaches a house with doors', page.locator('#doors button').count() >= 4)
    elif name == 'creak.html':
        # Choosing a climber is deterministic and does not shorten dice motion.
        _keyboard_enter(env, page, '#climberBtn', name)
        page.locator('#climberOv').wait_for(state='visible')
        _keyboard_enter(env, page, '#climberDone', name + ' climber dialog')
        env.check(name + ': climber dialog closes through its real button', not page.locator('#climberOv').is_visible())
    elif name == 'gaslight.html':
        _keyboard_enter(env, page, '#caseList button', name + ' case selection')
        page.locator('#startScr').wait_for(state='visible')
        _keyboard_enter(env, page, '#startBtn', name + ' case opening')
        page.locator('#storyView').wait_for(state='visible', timeout=6000)
        env.check(name + ': selected case opens readable story and a decision',
                  bool(page.locator('#fileText').inner_text().strip()) and page.locator('#qwrap button').count() > 0)
    elif name == 'standing-room.html':
        _keyboard_enter(env, page, '#startBtn', name)
        page.locator('#opts button').first.wait_for(state='visible')
        env.check(name + ': first question and board appear',
                  page.locator('#opts button').count() >= 2 and page.locator('#board').locator(':scope > *').count() > 0)
    elif name in ('core.html', 'castle.html', 'labyrinth.html', 'claim.html'):
        _keyboard_enter(env, page, '#startBtn', name)
        page.locator('#game').wait_for(state='visible')
        board = '#board' if name == 'claim.html' else '#mapInner'
        env.check(name + ': default solo start renders a nonempty board', page.locator(board).locator(':scope > *').count() > 0)
    elif name == 'jigsaw.html':
        _keyboard_enter(env, page, '#tierList .tier', name)
        page.locator('#game.on').wait_for(state='visible')
        env.check(name + ': keyboard selection creates the twelve-piece puzzle',
                  page.locator('#hPieces').inner_text() == '0/12' and page.locator('#cv').evaluate('canvas => canvas.width > 0 && canvas.height > 0'))
        _keyboard_enter(env, page, '#menuBtn', name + ' return')
        env.check(name + ': Menu returns to difficulty selection', page.locator('#menu.on').is_visible())
    elif name == 'piece-by-piece.html':
        _keyboard_enter(env, page, '#deckFlags', name)
        page.locator('#game.on').wait_for(state='visible')
        env.check(name + ': selected deck renders answer options and a canvas',
                  page.locator('#opts button').count() >= 2 and page.locator('#cvWrap canvas').count() == 1)
    elif name in ('wheel.html', 'smudged-bible.html'):
        _keyboard_enter(env, page, '#goBtn', name)
        page.locator('#start').wait_for(state='hidden')
        env.check(name + ': bottle opens to the actual spin and solve controls',
                  page.locator('#spinBtn').is_visible() and page.locator('#solveBtn').is_visible())
        _keyboard_enter(env, page, '#solveBtn', name + ' solve')
        page.locator('#solveIn').wait_for(state='visible')
        env.check(name + ': whole-message input is labelled', page.locator('#solveIn').get_attribute('aria-label') == 'Your answer')
        _keyboard_enter(env, page, '#solveBack', name + ' solve cancel')
        env.check(name + ': cancelling a solve returns to the helm', page.locator('#spinBtn').is_visible() and not page.locator('#solveIn').count())
    elif name == 'brain-coaster.html':
        _keyboard_enter(env, page, '#cats .cat-btn', name)
        page.locator('#startScr').wait_for(state='hidden')
        page.locator('#opts button').first.wait_for(state='visible')
        env.check(name + ': selected topic renders four quiz answers', page.locator('#opts button').count() == 4)
    elif name in ('five-clues.html', 'five-clues-bible.html'):
        _keyboard_enter(env, page, '#startBtn', name)
        page.locator('#guessInput').wait_for(state='visible')
        before = page.locator('#clueArea').inner_text()
        _keyboard_enter(env, page, '#nextClueBtn', name + ' clue reveal')
        env.check(name + ': Next clue reveals another clue without answering',
                  page.locator('#clueArea').inner_text() != before and page.locator('#qcount').inner_text() == 'ROUND 1 OF 12')
    elif name == 'snap-sort.html':
        _keyboard_enter(env, page, '#startBtn', name)
        page.locator('#itemCard').wait_for(state='visible')
        env.check(name + ': sort begins with an item and two named choices',
                  bool(page.locator('#itemCard').inner_text().strip()) and page.locator('#leftBtn').is_visible() and page.locator('#rightBtn').is_visible())


def _daily_resume(env):
    """A complete six-question daily run with a real reload after three answers."""
    page = env.new_page('/daily.html', 'catalogue-daily-resume', mobile=True)
    _keyboard_enter(env, page, '#dGo', 'Daily Ascent')
    for index in range(6):
        if index == 3:
            page.reload(wait_until='domcontentloaded')
            _keyboard_enter(env, page, '#dGo', 'Daily Ascent resume')
            env.check('Daily Ascent: reload resumes the fourth question', 'Question 4 of 6' in page.locator('.dtier').inner_text())
        question = page.locator('#dQ').inner_text()
        # The public question bank is an observation oracle. The application
        # selects, grades, saves and advances using its unmodified handlers.
        correct = page.evaluate('''question => {
          const rows = Object.values(window.TB.bank('gk')).flat();
          const row = rows.find(item => item.q === question);
          if (!row) throw new Error('Question absent from the actual bank');
          return row.correct;
        }''', question)
        control = page.get_by_role('button', name=correct, exact=True)
        control.focus()
        page.keyboard.press('Enter')
        page.locator('#dNextBtn').wait_for(state='visible')
        env.check('Daily Ascent: question ' + str(index + 1) + ' accepts one answer',
                  page.locator('.dopt:enabled').count() == 0)
        _keyboard_enter(env, page, '#dNextBtn', 'Daily Ascent advance ' + str(index + 1))
    page.locator('#dShare').wait_for(state='visible')
    stored = page.evaluate('''() => {
      const state = JSON.parse(localStorage.getItem('tb_daily_v1'));
      return Object.values(state.days).find(day => day.done);
    }''')
    env.check('Daily Ascent: full correct daily run persists six graded answers',
              bool(stored) and stored['ok'] == 6 and len(stored['answers']) == 6)
    page.reload(wait_until='domcontentloaded')
    page.locator('#dShare').wait_for(state='visible')
    env.check('Daily Ascent: completed result survives a second reload', page.locator('#dGo').count() == 0)
    page.context.close()


def run(env):
    catalogue = json.loads((ROOT / 'docs/readiness-catalogue.json').read_text())['entries']
    env.check('catalogue inventory has 69 distinct destinations',
              len(catalogue) == 69 and len({row['href'] for row in catalogue}) == 69)
    home = env.new_page('/index.html', 'catalogue-rendered-home', mobile=True)
    home.locator('a[data-title]').first.wait_for(state='visible')
    rendered = home.locator('a[data-title]').evaluate_all('(links) => links.map(link => link.getAttribute("href"))')
    rendered = [urlsplit(path).path.removeprefix('./') for path in rendered]
    env.check('rendered home card destinations equal the reviewed inventory',
              sorted(rendered) == sorted(row['href'] for row in catalogue))
    _layout(env, home, 'home catalogue', 320)
    _layout(env, home, 'home catalogue', 390)
    home.context.close()

    failures = []
    for row in catalogue:
        name = row['href']
        page = None
        try:
            env.check(name + ': local destination exists', (ROOT / name).is_file())
            page = env.new_page('/' + name, 'catalogue-entry-' + name, mobile=True)
            missing = []
            page.on('response', lambda response, missing=missing: missing.append(
                {'path':urlsplit(response.url).path, 'status':response.status})
                if urlsplit(response.url).hostname == 'tierbrain.test' and response.status >= 400 else None)
            # Observe all actual local asset responses, including the document.
            response = page.reload(wait_until='load', timeout=20000)
            env.check(name + ': document and requested local assets load',
                      response is not None and response.status == 200 and not missing, missing)
            selector = '#startBtn' if row['entry_type'] == 'topic_quiz_inline_copy' else PRIMARY[name]
            page.locator(selector).first.wait_for(state='visible', timeout=6000)
            env.check(name + ': actual entry UI contains readable content',
                      len(page.locator('body').inner_text().strip()) > 40 and bool(page.title().strip()))
            _layout(env, page, name, 390)
            _layout(env, page, name, 320)
            _first_interaction(env, page, name)
            env.check(name + ': entry and first interaction request no missing local assets',
                      not missing, missing)
        except Exception as error:
            failures.append({'page':name, 'error':str(error)[:1200]})
            env.note(name + ': catalogue case failed: ' + str(error)[:300])
        finally:
            if page is not None:
                page.context.close()
    env.check('all 69 bounded catalogue entry checks pass', not failures, failures)
    _daily_resume(env)
    env.note('Catalogue scope: 69 real entry pages and their requested local assets loaded; initial layouts checked at320px and390px. Selected remaining solo games exercised actual Tab/Enter start or first interaction; Daily Ascent completed6 questions with mid-run and completed-result reloads. Existing topic, solo-regression and multiplayer suites provide their own deeper coverage. These checks do not establish complete playthroughs for every card, question accuracy, physical iPhone Safari behaviour, or prize-grade score integrity.')
