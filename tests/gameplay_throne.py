"""Real UI acceptance for both Hold The Throne editions.

The shared runner supplies isolated GoTrue/PostgREST and the actual SDK/SQL.
All scores are produced by phone clicks and ordinary host polling. The host's
private answer index is only the test oracle; deadlines and APIs are unchanged.
Each edition completes a three-phone finale and a two-phone straight win, then
checks a queued departure and an abandoned run without inventing a champion.
"""
from urllib.parse import urlsplit


INIT = """
localStorage.setItem('tb-cutscenes-throne','0');
localStorage.setItem('tb-sound-throne','0');
"""


def state(host):
    return host.evaluate("""()=>({phase:G.phase,run:G.runId,qid:G.qId,
      index:G.qIndex,total:G.qTotal,mode:G.mode,champ:G.champ,chal:G.chal,
      queue:G.queue,correct:G.q&&G.q.correctIdx,streak:G.streak,
      best:G.bestStreak,corrects:G.totalCorrect,blemished:G.blemished,
      finalists:G.finalists,points:G.finaleScore,winner:G.winner,
      summary:G.summary,buzzOpenAt:G.buzzOpenAt,ansWin:G.ansWin})""")


def question(host, previous=None):
    host.wait_for_function(
        "old=>typeof G!=='undefined'&&G.phase==='live'&&!!G.qId&&G.qId!==old&&!starting",
        arg=previous, timeout=25000)
    return state(host)


def phone_question(page, qid, phase='live'):
    page.wait_for_function(
        "v=>typeof joined!=='undefined'&&joined&&lastState&&lastState.qId===v.qid&&lastState.phase===v.phase",
        arg={'qid': qid, 'phase': phase}, timeout=15000)


def reveal(host, qid):
    host.wait_for_function(
        "id=>G.qId===id&&G.phase==='reveal'", arg=qid, timeout=15000)
    return state(host)


def join(page, phone_path, room_code, name):
    # Navigating the same page keeps this phone's real anonymous Auth identity.
    origin = urlsplit(page.url)
    page.goto(f'{origin.scheme}://{origin.netloc}/{phone_path}?c={room_code}')
    page.locator('#nameIn').fill(name)
    page.locator('#joinBtn').click()
    page.wait_for_function("typeof joined!=='undefined'&&joined&&!!myId&&!!lastState", timeout=20000)
    return page.evaluate('myId')


def setup(host, answer_seconds=7):
    host.wait_for_function("typeof G!=='undefined'&&!!G.code&&!roomOpening&&G.phase==='lobby'", timeout=25000)
    # Exercise the actual controls, including the regression-prone 20/25 step.
    host.locator('#qPlus').click()
    assert host.locator('#qTot').inner_text() == '25'
    host.locator('#qMinus').click()
    assert host.locator('#qTot').inner_text() == '20'
    for _ in range(17):
        host.locator('#qMinus').click()
    assert host.locator('#qTot').inner_text() == '3'
    for _ in range(max(0, answer_seconds - 4)):
        host.locator('#tPlus').click()
    if answer_seconds == 3:
        host.locator('#tMinus').click()
    assert host.locator('#tTot').inner_text() == str(answer_seconds) + 's'
    return host.evaluate('G.code')


def start(host, count):
    host.wait_for_function('n=>livePlayers().length===n', arg=count, timeout=15000)
    host.locator('#startBtn').click()
    return question(host)


def buzz(page, qid):
    phone_question(page, qid)
    # This waits for the real server's three-second unlock; Date is never faked.
    page.locator('#bz').click(timeout=12000)
    page.locator('#grid .pbtn').first.wait_for(state='visible', timeout=12000)


def answer(page, index):
    page.locator('#grid .pbtn').nth(index).click()


def correct(host, phones, q, winner):
    buzz(phones[winner], q['qid'])
    answer(phones[winner], q['correct'])
    return reveal(host, q['qid'])


def leave(page):
    if page.locator('#leaveBtn').count():
        page.locator('#leaveBtn').click()
        page.wait_for_function('!joined&&!leaving', timeout=15000)


def new_room(host, pages):
    for page in pages:
        leave(page)
    old = host.evaluate('G.code')
    host.wait_for_function(
        "!tickBusy&&!engineBusy&&!finalizing&&!G.grading&&!access.busy()&&!openingBusy",
        timeout=15000)
    host.once('dialog', lambda dialog: dialog.accept())
    host.locator('#newBtn').click()
    # Reload can expose the new document before its gameplay script declares G.
    host.wait_for_function(
        "old=>typeof G!=='undefined'&&G.code&&G.code!==old&&!roomOpening&&G.phase==='lobby'",
        arg=old, timeout=25000)
    return host.evaluate('G.code')


def run_edition(env, edition):
    host_path = 'throne-bible.html' if edition == 'bible' else 'throne.html'
    phone_path = host_path.replace('.html', '-play.html')
    prefix = 'Throne ' + edition + ': '
    host = env.new_page(host_path, edition + '-host', init_script=INIT)
    host.set_default_timeout(15000)
    room_code = setup(host)
    names = ['A&B', '<Casey>', "D'Angelo"]
    pages = [env.new_page(phone_path + '?c=' + room_code,
                          edition + '-phone-' + str(i + 1), mobile=True)
             for i in range(3)]
    phones = {}
    for page, name in zip(pages, names):
        # The page is already on the correct URL; avoid a redundant bootstrap.
        page.locator('#nameIn').fill(name)
        page.locator('#joinBtn').click()
        page.wait_for_function("typeof joined!=='undefined'&&joined&&!!myId&&!!lastState", timeout=20000)
        phones[page.evaluate('myId')] = page
    env.check(prefix + 'three independent phones joined', len(phones) == 3)
    q1 = start(host, 3)
    env.check(prefix + 'three-question controls lock during play',
              q1['total'] == 3 and host.locator('#qMinus').is_disabled()
              and host.locator('#tPlus').is_disabled())
    env.check(prefix + 'native buzz countdown begins locked',
              host.evaluate('G.buzzOpenAt>gameNow()'))
    winner = q1['champ']['id']
    first = q1['chal']['id']
    queued = q1['queue'][0]['id']
    queued_page = phones[queued]
    phone_question(queued_page, q1['qid'])
    env.check(prefix + 'queue sees question but no answering control',
              'In the queue' in queued_page.locator('#playCard').inner_text()
              and queued_page.locator('#bz, #grid .pbtn').count() == 0)
    queued_page.reload()
    phone_question(queued_page, q1['qid'])
    env.check(prefix + 'queued reload restores canonical membership',
              queued_page.evaluate('myId') == queued)
    buzz(phones[first], q1['qid'])
    answer(phones[first], (q1['correct'] + 1) % 4)
    phones[winner].locator('#grid .pbtn').first.wait_for(state='visible')
    host.wait_for_function('id=>G.answerer&&G.answerer.id===id', arg=winner)
    env.check(prefix + 'wrong-first answer hands over without another buzz',
              phones[winner].evaluate("!submission('buzz',curQid)")
              and host.evaluate('G.lockedOut.includes(' + repr(first) + ')')
              and state(host)['streak'] == 0)
    answer(phones[winner], q1['correct'])
    r1 = reveal(host, q1['qid'])
    env.check(prefix + 'first win awards one honest point and streak',
              r1['streak'] == 1 and r1['corrects'].get(winner) == 1
              and first in r1['blemished'])
    phone_question(phones[winner], q1['qid'], 'reveal')
    env.check(prefix + 'reveal renders names as text on the phone',
              q1['champ']['name'] + ' takes it!' in phones[winner].locator('#playCard').inner_text()
              and phones[winner].locator('#playCard casey').count() == 0)
    host.wait_for_function("G.phase==='between'", timeout=10000)
    phone_question(phones[winner], q1['qid'], 'between')
    env.check(prefix + 'between-round names are not HTML entities',
              q1['champ']['name'] + ' holds, streak 1' in phones[winner].locator('#playCard').inner_text())
    q2 = question(host, q1['qid'])
    env.check(prefix + 'winner stays and queued challenger advances',
              q2['champ']['id'] == winner and q2['chal']['id'] == queued
              and [p['id'] for p in q2['queue']] == [first])
    buzz(phones[winner], q2['qid'])
    phones[winner].reload()
    phone_question(phones[winner], q2['qid'])
    phones[winner].locator('#grid .pbtn').first.wait_for(state='visible')
    env.check(prefix + 'active reload restores accepted buzz without duplicating membership',
              phones[winner].evaluate('myId') == winner
              and phones[winner].evaluate("submission('buzz',curQid).status==='confirmed'")
              and host.evaluate('G.players.length') == 3)
    answer(phones[winner], q2['correct'])
    r2 = reveal(host, q2['qid'])
    env.check(prefix + 'consecutive win increments streak once',
              r2['streak'] == 2 and r2['best'].get(winner) == 2
              and r2['corrects'].get(winner) == 2)
    q3 = question(host, q2['qid'])
    closer = q3['chal']['id']
    r3 = correct(host, phones, q3, closer)
    env.check(prefix + 'dethroning starts a new streak and keeps the longest streak',
              r3['streak'] == 1 and r3['best'].get(winner) == 2
              and r3['best'].get(closer) == 1 and r3['corrects'].get(closer) == 1)
    host.wait_for_function("G.phase==='finintro'", timeout=15000)
    finalists = state(host)['finalists']
    env.check(prefix + 'last winner meets streak leader in the finale',
              finalists['closer']['id'] == closer and finalists['king']['id'] == winner)
    finale_names = [finalists['closer']['name'], finalists['king']['name']]
    for page in pages:
        phone_question(page, q3['qid'], 'finintro')
        env.check(prefix + 'finale names render literally on phone ' + page.evaluate('myName'),
                  all(name in page.locator('#playCard').inner_text() for name in finale_names))
    env.check(prefix + 'finale names render literally on the host',
              all(name in host.locator('#banner').inner_text() for name in finale_names))
    f1 = question(host, q3['qid'])
    env.check(prefix + 'canonical finale seats and fresh question',
              f1['mode'] == 'finale' and f1['champ']['id'] == closer
              and f1['chal']['id'] == winner and not f1['queue'])
    f1_result = correct(host, phones, f1, closer)
    env.check(prefix + 'first finale point is separate from main-game score',
              f1_result['points'].get(closer) == 1
              and f1_result['corrects'].get(closer) == 1)
    f2 = question(host, f1['qid'])
    env.check(prefix + 'finale scoreboard renders unescaped names',
              all(name in host.locator('#best').inner_text() for name in finale_names))
    correct(host, phones, f2, closer)
    host.wait_for_function("G.phase==='gameover'&&!finalizing", timeout=15000)
    final = state(host)
    env.check(prefix + 'complete three-phone finale records the actual two-point winner',
              final['winner']['id'] == closer and final['points'].get(closer) == 2
              and final['summary']['recorded'] and not final['summary']['flawless'])
    host.wait_for_function('hofLocalRead().length===1')
    env.check(prefix + 'one confirmed result appears in Hall of Fame',
              host.evaluate('hofLocalRead()[0].run_id===G.runId')
              and host.locator('#banShare').count() == 1)
    for member_id, page in phones.items():
        phone_question(page, f2['qid'], 'gameover')
        env.check(prefix + 'phone receives the confirmed champion ' + member_id[:8],
                  page.evaluate('lastState.winner.id') == closer
                  and ('You win the crown!' if member_id == closer else 'takes the crown')
                  in page.locator('#playCard').inner_text())

    # Exercise the advertised replay path: New room, new code and clean run.
    previous_run = final['run']
    new_room(host, pages)
    replay_code = setup(host, answer_seconds=3)
    phones = {join(page, phone_path, replay_code, name): page
              for page, name in zip(pages[:2], names[:2])}
    replay = start(host, 2)
    env.check(prefix + 'new-room replay resets the run and scores',
              replay['run'] != previous_run and replay['streak'] == 0
              and replay['corrects'] == {} and replay['index'] == 1)
    replay_winner = replay['champ']['id']
    timeout_id = replay['chal']['id']
    buzz(phones[timeout_id], replay['qid'])
    deadline = state(host)['ansWin']
    phones[replay_winner].locator('#grid .pbtn').first.wait_for(state='visible', timeout=10000)
    env.check(prefix + 'native answer timeout hands over without a second buzz',
              host.evaluate('gameNow()') >= deadline
              and phones[replay_winner].evaluate("!submission('buzz',curQid)"))
    answer(phones[replay_winner], replay['correct'])
    reveal(host, replay['qid'])
    for _ in range(2):
        replay = question(host, replay['qid'])
        correct(host, phones, replay, replay_winner)
    host.wait_for_function("G.phase==='gameover'&&!finalizing", timeout=15000)
    replay_final = state(host)
    env.check(prefix + 'complete two-phone replay crowns the three-win champion without a finale',
              replay_final['winner']['id'] == replay_winner
              and replay_final['streak'] == 3
              and replay_final['corrects'].get(replay_winner) == 3
              and replay_final['summary']['flawless']
              and replay_final['summary']['finalists'] is None)
    host.wait_for_function('hofLocalRead().length===2')

    # An unfinished run must not share or persist an invented champion.
    new_room(host, pages)
    departure_code = setup(host, answer_seconds=3)
    phones = {join(page, phone_path, departure_code, name): page
              for page, name in zip(pages, names)}
    departure = start(host, 3)
    advancing_id = departure['queue'][0]['id']
    leaving_id = departure['chal']['id']
    correct(host, phones, departure, departure['champ']['id'])
    leave(phones[leaving_id])
    departure_next = question(host, departure['qid'])
    env.check(prefix + 'departure does not strand the queued replacement',
              departure_next['chal']['id'] == advancing_id
              and leaving_id not in [p['id'] for p in departure_next['queue']]
              and leaving_id != departure_next['champ']['id'])
    survivor_id = departure_next['champ']['id']
    leave(phones[departure_next['chal']['id']])
    # Leave the buzz window unanswered and let the real deadline resolve it.
    host.wait_for_function("G.phase==='gameover'&&!engineBusy", timeout=30000)
    aborted = state(host)
    env.check(prefix + 'insufficient players end without a winner or fabricated record',
              aborted['winner'] is None and not aborted['summary']['recorded']
              and host.evaluate('hofLocalRead().length') == 2
              and host.locator('#banShare').count() == 0
              and 'Added to the Hall of Fame' not in host.locator('#banner').inner_text())
    phones[survivor_id].wait_for_function("lastState&&lastState.phase==='gameover'", timeout=15000)
    env.check(prefix + 'remaining phone sees an honest ended-run message',
              'No champion was recorded' in phones[survivor_id].locator('#playCard').inner_text())
    env.note(prefix + 'completed real 3-phone 3-question + 2-point finale; real 2-phone 3-question replay; native countdown, timeout, reload, queue departure and abort.')
    for page in [host, *pages]:
        page.context.close()


def run(env):
    for edition in ('general', 'bible'):
        run_edition(env, edition)
