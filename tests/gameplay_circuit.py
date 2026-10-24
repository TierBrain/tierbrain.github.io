"""Full Circuit: real browser pages + isolated Auth/PostgREST/SQL.

Two full five-room wins use normal input handlers, scoring, typed streams and
finale receipts. Presentation narration is skipped; Glasshouse fall speed is
quadrupled, keeping the real pail collision calculation. Explicit timer expiry
uses the normal timer callbacks. No transport adapter, state publication or
forced game-over substitutes for gameplay.
"""
from __future__ import annotations

ORDER = ['switchboard', 'glasshouse', 'orrery', 'strongroom', 'darkroom']
STATE = {'switchboard': 'SB', 'glasshouse': 'GH', 'orrery': 'OR',
         'strongroom': 'SR', 'darkroom': 'DR'}
INIT = "localStorage.setItem('fc_simple','1');localStorage.setItem('fc_host_arrived','1');"


def wait(page, expression, arg=None, timeout=20000):
    page.wait_for_function(expression, arg=arg, timeout=timeout)


def fast_story(host):
    # Named visual presentation helper only; all transitions still use real RPCs.
    host.evaluate("() => { window.playStory=function(kind,options,done){done();}; }")


def hall(host):
    wait(host, "G.phase==='hall'&&!G.transitioning&&!access.busy()")


def assign(host, phone, room):
    hall(host)
    pid = phone.evaluate('TM.me.id')
    host.locator('#doors > button').nth(ORDER.index(room)).click()
    rank = host.evaluate("id=>G.players.slice().sort((a,b)=>(G.playedBy[a.id]||0)-(G.playedBy[b.id]||0)).findIndex(p=>p.id===id)", pid)
    host.locator('#whos button').nth(rank).click()
    wait(host, "G.phase==='room'&&!G.transitioning&&!access.busy()")
    wait(phone, "k=>TM.running&&TM.room===k&&TM.lastQ&&window[%s].st.live" % repr(STATE[room]), room)
    return host.evaluate("({run:access.currentRoom().run_id,window:access.currentRoom().action.id})")


def answer(phone, room, correct=True, timeout=False):
    state = STATE[room]
    wait(phone, f"TM.running&&{state}.st&&{state}.st.live")
    before = phone.evaluate(f"({{r:{state}.st.tally.right,w:{state}.st.tally.wrong,fuse:H.fuse}})")
    if timeout:
        expression = {
            'switchboard': 'SB.st.callStart=performance.now()-SB.st.CALL_MS-1;sbTick(performance.now())',
            'orrery': 'OR.st.qStart=performance.now()-OR.st.Q_MS-1;orTick(performance.now())',
            'strongroom': 'SR.st.qStart=performance.now()-SR.st.Q_MS-1;srTick(performance.now())',
            'darkroom': 'DR.st.qStart=performance.now()-DR.st.Q_MS-1;drTick(performance.now())',
        }[room]
        phone.evaluate('()=>{' + expression + '}')
    elif room == 'switchboard':
        index = phone.evaluate('SB.st.ans' if correct else '(SB.st.ans+1)%4')
        phone.locator('.socket').nth(index).click()
    elif room == 'glasshouse':
        # Accelerate visual falling only; the real lane/pail collision grades it.
        lane = phone.evaluate("right=>{GH.st.speed*=4;return GH.st.drops.find(d=>d.right===right).lane;}", correct)
        phone.locator('#ghSky .drop').nth(lane).dispatch_event('click')
    elif room == 'orrery':
        index = phone.evaluate('OR.st.opts.indexOf(OR.st.q.correct)' if correct else '(OR.st.opts.indexOf(OR.st.q.correct)+1)%4')
        phone.locator('.planet').nth(index).dispatch_event('click')
    elif room == 'strongroom':
        index = phone.evaluate('SR.st.opts.indexOf(SR.st.q.correct)' if correct else '(SR.st.opts.indexOf(SR.st.q.correct)+1)%4')
        phone.locator('#plates .plate-btn').nth(index).click()
    else:
        index = phone.evaluate('DR.st.opts.indexOf(DR.st.q.correct)' if correct else '(DR.st.opts.indexOf(DR.st.q.correct)+1)%4')
        phone.locator('#drWall button.note').nth(index).click()
    wait(phone, f"old=>{state}.st.tally.right!==old.r||{state}.st.tally.wrong!==old.w||H.fuse!==old.fuse", before)


def finish_room(env, prefix, host, phone, room, token, won=True):
    wait(host, "k=>G.phase==='after'&&G.done[k]&&!G.transitioning&&!access.busy()", room)
    env.check(prefix + room + ' result', host.evaluate('k=>G.done[k]', room) == ('won' if won else 'lost'))
    rows = host.evaluate("async x=>await access.actions(G.code,x.run,x.window)", token)
    events = [r.get('event') for r in rows if r.get('event')]
    env.check(prefix + room + ' canonical typed question/answer/completion stream',
              {'q', 'a', 'done'}.issubset({e.get('t') for e in events}),
              {'types': [e.get('t') for e in events], 'receipt_count': len(rows)})
    env.check(prefix + room + ' result is unique', sum(e.get('t') == 'done' for e in events) == 1)
    host.locator('#aBtn').click()
    hall(host)
    return events


def stairs(phone, mistakes=1):
    for i in range(3):
        wait(phone, "!document.querySelector('#stairs').hidden&&Array.from(document.querySelectorAll('#stairOpts .opt')).some(b=>!b.disabled)")
        index = phone.evaluate("wrong=>{const a=Array.from(document.querySelectorAll('#stairOpts .opt'));return a.findIndex(b=>(b.textContent===TM.lastQ.correct)!==wrong);}", i < mistakes)
        phone.locator('#stairOpts .opt').nth(index).click()
        if i < 2:
            wait(phone, "step=>document.querySelector('#stairStep').textContent.includes('Step '+step+' of 3')", i + 2)


def failure_paths(env, prefix, host, phones):
    # Rematch failures: a real timeout, three counted mistakes, stairs and Key.
    host.locator('#startBtn').click()
    hall(host)
    token = assign(host, phones[0], 'switchboard')
    answer(phones[0], 'switchboard', timeout=True)
    answer(phones[0], 'switchboard', False)
    answer(phones[0], 'switchboard', False)
    stairs(phones[0], mistakes=1)
    events = finish_room(env, prefix + 'rematch ', host, phones[0], 'switchboard', token, False)
    env.check(prefix + 'three back-stair questions are canonical', sum(e.get('t') == 'stairs' for e in events) == 3)
    env.check(prefix + 'one missed stair costs three seconds', host.evaluate('G.finalePenalty') == 3)
    token = assign(host, phones[1], 'strongroom')
    for _ in range(5):
        answer(phones[1], 'strongroom')
    finish_room(env, prefix + 'rematch ', host, phones[1], 'strongroom', token)
    token = assign(host, phones[2], 'darkroom')
    for _ in range(3):
        answer(phones[2], 'darkroom', False)
    events = finish_room(env, prefix + 'rematch ', host, phones[2], 'darkroom', token, False)
    env.check(prefix + 'Key skips stairs once without extra penalty',
              host.evaluate('G.keyUsed&&G.finalePenalty===3') and not any(e.get('t') == 'stairs' for e in events))
    # An absent checkpoint must stop clearly, without silently resetting the run.
    before = host.evaluate('({run:access.currentRoom().run_id,version:access.currentRoom().version,depth:G.depth})')
    host.evaluate('localStorage.removeItem(HOST_CHECKPOINT)')
    host.reload()
    wait(host, "document.querySelector('#hostRecovery')&&G.recovery&&!access.busy()")
    after = host.evaluate('({run:access.currentRoom().run_id,version:access.currentRoom().version,depth:access.currentRoom().state.depth})')
    env.check(prefix + 'missing checkpoint preserves server run/state/version', before == after, {'before': before, 'after': after})
    env.check(prefix + 'recovery prevents accidental normal start', host.locator('#startBtn').is_disabled())
    host.locator('#hostRecovery button').click()
    wait(host, "G.phase==='lobby'&&!G.recovery&&!access.busy()")
    env.check(prefix + 'recovery restart is deliberate', host.evaluate('access.currentRoom().run_id') != before['run'])


def edition(env, bible):
    base = 'full-circuit-bible' if bible else 'full-circuit'
    prefix = ('Circuit Bible: ' if bible else 'Circuit General: ')
    host = env.new_page('/' + base + '-host.html', prefix + 'host', init_script=INIT)
    wait(host, "G.code&&access.currentRoom()&&!access.busy()")
    fast_story(host)
    code = host.evaluate('G.code')
    phones = []
    names = ['Sam', 'Sam', 'Alex']
    for i, name in enumerate(names):
        p = env.new_page('/' + base + '.html?team=' + code, prefix + 'phone ' + str(i + 1), mobile=True, init_script=INIT)
        p.locator('#joinName').fill(name)
        p.locator('#joinBtn').click()
        wait(p, 'TM.me&&TM.me.id')
        phones.append(p)
    wait(host, "G.players.length===3&&!document.querySelector('#startBtn').disabled")
    ids = [p.evaluate('TM.me.id') for p in phones]
    env.check(prefix + 'three separate phones, duplicate names remain separate', len(set(ids)) == 3)
    host.locator('#startBtn').click()
    hall(host)
    run = host.evaluate('access.currentRoom().run_id')

    # Dark Room first, so a later wrong answer can consume the earned Fuse.
    token = assign(host, phones[0], 'darkroom')
    original_activity = phones[0].evaluate('TM.activity')
    phones[0].reload()
    wait(phones[0], 'TM.me&&TM.running&&TM.activity&&DR.st&&DR.st.live')
    env.check(prefix + 'phone refresh preserves member and room, restarts unfinished activity',
              phones[0].evaluate('TM.me.id') == ids[0] and phones[0].evaluate('TM.window') == token['window'] and phones[0].evaluate('TM.activity') != original_activity)
    for _ in range(2):
        answer(phones[0], 'darkroom')
    wait(host, "document.querySelector('#mRight').textContent==='2'")
    host.reload()
    wait(host, "G.phase==='room'&&!G.recovery&&!access.busy()&&document.querySelector('#mRight').textContent==='2'")
    fast_story(host)
    env.check(prefix + 'host refresh keeps active run/window and replays accepted scores',
              host.evaluate('access.currentRoom().run_id') == run and host.evaluate('access.currentRoom().action.id') == token['window'])
    for _ in range(3):
        answer(phones[0], 'darkroom')
    finish_room(env, prefix, host, phones[0], 'darkroom', token)
    env.check(prefix + 'Dark Room awards armed Fuse', host.evaluate("G.fuse&&G.items.includes('Fuse')"))

    # Handoff after a question: old activity cannot continue the replacement.
    token = assign(host, phones[1], 'switchboard')
    old_generation = phones[1].evaluate('TM.generation')
    host.locator('#troubleBtn').click()
    host.locator('#trHand').click()
    wait(host, "!document.querySelector('#picker').hidden&&!G.transitioning&&!access.busy()")
    rank = host.evaluate("id=>G.players.slice().sort((a,b)=>(G.playedBy[a.id]||0)-(G.playedBy[b.id]||0)).findIndex(p=>p.id===id)", ids[2])
    host.locator('#whos button').nth(rank).click()
    wait(phones[2], "TM.running&&TM.room==='switchboard'&&SB.st&&SB.st.live")
    wait(phones[1], 'g=>!TM.running&&TM.generation>g', old_generation)
    env.check(prefix + 'handoff opens a new canonical assignment window', host.evaluate('access.currentRoom().action.id') != token['window'])
    token = host.evaluate('({run:access.currentRoom().run_id,window:access.currentRoom().action.id})')
    answer(phones[2], 'switchboard', False)
    env.check(prefix + 'Fuse absorbs exactly one mini-game mistake', phones[2].evaluate('!H.fuse&&SB.st.tally.wrong===0'))
    answer(phones[2], 'switchboard', timeout=True)
    env.check(prefix + 'later timeout counts after Fuse consumed', phones[2].evaluate('SB.st.tally.wrong===1'))
    for _ in range(5):
        answer(phones[2], 'switchboard')
    finish_room(env, prefix, host, phones[2], 'switchboard', token)
    env.check(prefix + 'spent Fuse remains spent on host', host.evaluate("!G.fuse&&G.items.includes('Fuse')"))

    token = assign(host, phones[1], 'glasshouse')
    for _ in range(5):
        answer(phones[1], 'glasshouse')
    finish_room(env, prefix, host, phones[1], 'glasshouse', token)
    token = assign(host, phones[0], 'orrery')
    env.check(prefix + 'Spring slows the Orrery', phones[0].evaluate('OR.st.slow'))
    for _ in range(5):
        answer(phones[0], 'orrery')
    finish_room(env, prefix, host, phones[0], 'orrery', token)
    token = assign(host, phones[2], 'strongroom')
    env.check(prefix + 'Lens sets and locks a tumbler', phones[2].evaluate('SR.st.lens&&SR.st.wheels.some(w=>w.locked&&w.set[w.at]===SR.st.word[w.idx])'))
    for _ in range(5):
        answer(phones[2], 'strongroom')
    finish_room(env, prefix, host, phones[2], 'strongroom', token)
    env.check(prefix + 'five actual mini-games won, five parts fitted', host.evaluate("G.depth===5&&G.items.length===5&&Object.values(G.done).every(x=>x==='won')"))
    host.locator('#doors button.machine').click()
    wait(host, 'G.phase===\'finale\'&&FN.pending&&!access.busy()')
    env.check(prefix + 'Spring/Wire/Key finale benefits and spent Fuse', host.evaluate("FN.t>90000&&FN.t<=102000&&FN.step===1.5&&FN.charge===(ED==='bible'?1:2)&&!FN.fuse"))
    window = host.evaluate('access.currentRoom().action.id')
    host.locator('#lensUse').click()
    wait(host, 'G.fq&&G.fq.burn>=0&&!access.busy()')
    spark = host.evaluate('G.spark')
    active = phones[ids.index(spark)]
    wait(active, "!document.querySelector('#teamQ').hidden&&document.querySelectorAll('#tqOpts .opt:disabled').length===1")
    env.check(prefix + 'Lens preserves the canonical question window', host.evaluate('access.currentRoom().action.id') == window)
    for i, p in enumerate(phones):
        if ids[i] != spark:
            wait(p, "document.querySelector('#teamQ').hidden")
    index = host.evaluate('G.fq.opts.findIndex((o,i)=>o!==FN.q.correct&&i!==G.fq.burn)')
    active.locator('#tqOpts .opt').nth(index).click()
    wait(host, 'FN.shorts===1&&!FN.resolving&&!access.busy()')
    env.check(prefix + 'spent Fuse is not resurrected for finale mistake', host.evaluate('FN.shorts===1&&!FN.fuse'))
    # Pending finale host refresh must preserve question, counts and a used Lens.
    wait(host, 'FN.pending&&!access.busy()')
    saved = host.evaluate('({run:access.currentRoom().run_id,window:access.currentRoom().action.id,charge:FN.charge,shorts:FN.shorts,time:FN.t})')
    host.reload()
    wait(host, "G.phase==='finale'&&!G.recovery&&FN.pending&&!access.busy()")
    fast_story(host)
    env.check(prefix + 'finale refresh preserves run/window/score and consumed Lens', host.evaluate('s=>access.currentRoom().run_id===s.run&&access.currentRoom().action.id===s.window&&FN.charge===s.charge&&FN.shorts===s.shorts&&!FN.lens&&FN.t<=s.time', saved))
    # One true question timeout then finish with submitted phone answers.
    host.evaluate('FN.sentAt=performance.now()-10001;fnTick()')
    wait(host, 'FN.shorts===2&&!FN.resolving&&!access.busy()')
    previous_spark = None
    for _ in range(10):
        wait(host, "G.phase==='over'||(FN.pending&&!FN.resolving&&!access.busy())")
        if host.evaluate("G.phase==='over'"):
            break
        info = host.evaluate('({spark:G.spark,window:access.currentRoom().action.id,correct:FN.q.correct})')
        env.check(prefix + 'spark never repeats consecutively ' + str(host.evaluate('FN.seq')), info['spark'] != previous_spark)
        previous_spark = info['spark']
        active = phones[ids.index(info['spark'])]
        wait(active, 'w=>TM.shownWindow===w&&!document.querySelector(\'#teamQ\').hidden&&!TM.finalPending', info['window'])
        # Actual mobile button submission; duplicate display names never select authority.
        index = active.evaluate('text=>Array.from(document.querySelectorAll("#tqOpts .opt")).findIndex(b=>b.textContent===text)', info['correct'])
        active.locator('#tqOpts .opt').nth(index).click()
        wait(host, "w=>G.phase==='over'||!access.currentRoom().action||access.currentRoom().action.id!==w||!FN.pending", info['window'])
    wait(host, "G.phase==='over'&&G.awake===true&&!access.busy()")
    wait(host, "!document.querySelector('#ending').hidden")
    env.check(prefix + 'normal finale reaches a displayed win with counted shorts', host.evaluate('FN.charge>=FN.target&&FN.right>0&&FN.shorts===2') and 'right' in host.locator('#endText').inner_text())
    for p in phones:
        wait(p, "document.querySelector('#twTitle').textContent==='The machine is awake'")
    host.locator('#againBtn').click()
    wait(host, "G.phase==='lobby'&&!access.busy()&&!document.querySelector('#startBtn').disabled")
    env.check(prefix + 'rematch rotates run, resets progress and retains phones', host.evaluate('old=>access.currentRoom().run_id!==old&&G.depth===0&&G.items.length===0&&G.players.length===3', run))
    failure_paths(env, prefix, host, phones)
    env.note(prefix + 'complete five-room win plus rematch failure/stairs/Key/recovery paths passed against the real isolated backend.')
    for p in phones + [host]:
        p.context.close()


def run(env):
    edition(env, False)
    edition(env, True)
