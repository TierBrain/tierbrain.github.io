"""Actual Big Quiz UI against the isolated GoTrue/PostgREST stack.

Every configured question is played through its normal start, submission,
grading and reveal functions. Only presentation deadlines are advanced: no
answers, awards, room states, membership or final scores are fabricated.
"""


def run(env):
    host = env.new_page(
        "show-gen.html", "big-quiz-host",
        init_script="""localStorage.setItem('cv_qpr_gen','4');
        localStorage.setItem('cv_rounds_gen','4');
        localStorage.setItem('cv_pick_gen','random');
        localStorage.setItem('cv_live','1');
        localStorage.setItem('tb-cutscenes-quiz','0');""",
    )
    host.wait_for_function("typeof room!=='undefined'&&room&&G.lobbyRoomId===room.id&&!access.busy()")
    code = host.evaluate("room.code")
    phones = [env.new_page("play-gen.html?c=" + code, "big-quiz-team-a", mobile=True),
              env.new_page("play-gen.html?c=" + code, "big-quiz-team-b", mobile=True)]
    for page, name, tag in zip(phones, ["Quiz Alice", "Quiz Bob"], ["youth", "adult"]):
        page.locator("#name").fill(name)
        page.locator('.team-btn[data-tag="' + tag + '"]').click()
        page.wait_for_function("me&&latestRoom&&document.querySelector('#waitScreen').classList.contains('hide')===false")
    member_ids = [page.evaluate("me.id") for page in phones]
    host.wait_for_function("document.querySelector('#count').textContent==='2'")
    env.check("Big Quiz: two distinct real phones join opposite teams", member_ids[0] != member_ids[1])

    def controls():
        # Lobby controls are already visible; the gear appears only once the
        # show is playing and operator controls collapse.
        if host.locator("#opsToggle").is_visible() and not host.evaluate("document.body.classList.contains('ops-open')"):
            host.locator("#opsToggle").click()

    def settled():
        host.wait_for_function("!access.busy()&&!G.starting&&!G.finalizing")

    def phone_question(page, qid, phase):
        page.wait_for_function("x=>latestRoom&&latestRoom.q_id===x.qid&&latestRoom.phase===x.phase",
                               arg={"qid": qid, "phase": phase})

    def answer(page, choice):
        page.locator("#playArea button.pbtn").nth(choice).click()
        page.wait_for_function("confirmedAnswer(curQid)!==null")

    def scores():
        return host.evaluate("async()=>Object.fromEntries((await access.members(room.code)).map(p=>[p.id,Number(p.score)]))")

    def reveal(kind):
        condition = {"normal": "G.phase==='reveal'&&room.phase==='reveal'",
                     "clues": "G.phase==='fc'&&G.fc.phase==='reveal'&&room.state.fc.phase==='reveal'",
                     "buzzer": "G.phase==='bz'&&G.buzz.phase==='reveal'&&room.state.bz.phase==='reveal'"}[kind]
        host.wait_for_function(condition + "&&!access.busy()")
        for page in phones:
            page.wait_for_function("kind=>latestRoom&&(kind==='normal'?latestRoom.phase==='reveal':latestRoom.state[kind==='clues'?'fc':'bz']&&latestRoom.state[kind==='clues'?'fc':'bz'].phase==='reveal')", arg=kind)

    def advance_reveal(kind):
        # The host's existing Skip control advances the completed reveal.
        controls()
        host.locator("#skipBtn").click()

    controls()
    host.locator("#startShow").click()
    host.wait_for_function("G.phase==='round_intro'&&!access.busy()")
    first_run = host.evaluate("room.run_id")
    order = host.evaluate("SHOW_ORDER.slice()")
    env.check("Big Quiz: normal show contains all four round modes", set(order) == {"rapidfire", "verse", "fiveclues", "buzzer"})
    reconnect_checked = False
    normal_count = clues_count = buzzer_count = 0

    for round_index, mode in enumerate(order):
        controls()
        host.locator("#skipBtn").click()  # skip only the round introduction
        for qi in range(4):
            local_phase = "fc" if mode == "fiveclues" else "bz" if mode == "buzzer" else "question"
            host.wait_for_function("x=>G.phase===x.phase&&G.qi===x.qi&&!access.busy()",
                                   arg={"phase": local_phase, "qi": qi})
            qid, correct = host.evaluate("[G.curId,G.questions[G.qi].correct]")
            before = scores()
            for page in phones:
                phone_question(page, qid, "fiveclues" if mode == "fiveclues" else "buzzer" if mode == "buzzer" else "question")
            if mode in ("rapidfire", "verse"):
                normal_count += 1
                if qi == 1 and not reconnect_checked:
                    controls()
                    host.locator("#pauseBtn").click()
                    answer(phones[0], correct)
                    phones[0].reload()
                    phones[0].wait_for_function("me&&latestRoom&&confirmedAnswer(curQid)!==null")
                    env.check("Big Quiz: phone reload retains member and its accepted answer",
                              phones[0].evaluate("me.id") == member_ids[0])
                    phones[0].wait_for_function("!pollBusy")
                    failing_route = "**/rest/v1/rpc/bigquiz_player_state"
                    def abort_state(route):
                        route.abort("failed")
                    phones[0].route(failing_route, abort_state)
                    phones[0].evaluate("pollState()")
                    env.check("Big Quiz: a failed real state fetch displays connection recovery",
                              phones[0].locator("#connectionRetry").is_visible())
                    phones[0].unroute(failing_route, abort_state)
                    phones[0].locator("#connectionRetry").click()
                    phones[0].wait_for_function("document.querySelector('#connectionRetry').hidden&&document.querySelector('#connectionStatus').hidden")
                    env.check("Big Quiz: Retry restores the same member and accepted answer",
                              phones[0].evaluate("me.id") == member_ids[0]
                              and phones[0].evaluate("confirmedAnswer(curQid)!==null"))
                    host.wait_for_function("(()=>{const s=JSON.parse(sessionStorage.getItem(SHOW_CHECKPOINT)||'null');return s&&s.version===room.version&&s.game.paused;})()")
                    version, prompt = host.evaluate("[room.version,JSON.stringify(G.questions[G.qi])]")
                    host.reload()
                    host.wait_for_function("G.lobbyRoomId&&G.phase==='question'&&G.paused&&!access.busy()")
                    env.check("Big Quiz: host reload restores the same paused question without a room write",
                              host.evaluate("[room.version,JSON.stringify(G.questions[G.qi])]") == [version, prompt])
                    controls()
                    host.locator("#pauseBtn").click()
                    answer(phones[1], correct)
                    reconnect_checked = True
                elif qi != 2:
                    answer(phones[0], correct)
                    answer(phones[1], (correct + 1) % 4 if qi == 0 else correct)
                if qi == 2:
                    # Expire the real question clock and let gameTick close it.
                    host.evaluate("G.deadline=Date.now()-1")
                else:
                    settled()
                    if host.evaluate("G.phase==='question'"):
                        controls()
                        host.locator("#skipBtn").click()
                reveal("normal")
                expected = host.evaluate("""async()=>{const a=await access.answers(room.code,room.run_id,G.curId);const correct=G.questions[G.qi].correct;
                  return Object.fromEntries(a.map(x=>[x.player_id,x.choice===correct?10+Math.round(5*Math.max(0,Math.min(1,(G.deadline-Date.parse(x.created_at))/G.win))):0]));}""")
                after = scores()
                env.check(f"Big Quiz {mode} question {qi + 1}: exact normal grading including wrong/timeout",
                          all(after[mid] - before[mid] == expected.get(mid, 0) for mid in member_ids))
                if qi == 0:
                    env.check(f"Big Quiz {mode}: wrong answer receives zero", after[member_ids[1]] == before[member_ids[1]])
                    env.check(f"Big Quiz {mode}: phones show correct and wrong-answer feedback",
                              phones[0].locator("#playArea .pa-good").count() == 1
                              and phones[1].locator("#playArea .pa-bad").count() == 1)
                if qi == 2:
                    env.check(f"Big Quiz {mode}: unanswered phones show the answer after timeout",
                              all("The answer is" in page.locator("#playArea").inner_text() for page in phones))
            elif mode == "fiveclues":
                clues_count += 1
                if qi == 1:
                    host.evaluate("G.fc.clueDeadline=Date.now()-1")
                    host.wait_for_function("G.fc.clueIdx===1&&!access.busy()")
                    for page in phones:
                        page.wait_for_function("latestRoom.state.fc.clueIdx===1")
                if qi == 2:
                    # All five clues and their normal timeout handler run.
                    for level in range(1, 5):
                        host.evaluate("G.fc.clueDeadline=Date.now()-1")
                        host.wait_for_function("i=>G.fc.clueIdx===i&&!access.busy()", arg=level)
                    host.evaluate("G.fc.clueDeadline=Date.now()-1")
                else:
                    answer(phones[0], (correct + 1) % 4 if qi == 1 else correct)
                    answer(phones[1], correct)
                reveal("clues")
                after = scores()
                expected = [0, 0] if qi == 2 else [0, 4] if qi == 1 else [5, 5]
                env.check(f"Big Quiz clues question {qi + 1}: normal reveal and clue-level points",
                          [after[mid] - before[mid] for mid in member_ids] == expected)
            else:
                buzzer_count += 1
                host.wait_for_function("G.buzz.phase==='open'&&!access.busy()")
                if qi == 2:
                    host.evaluate("G.buzz.openedAt=Date.now()-21000")
                else:
                    for page in phones:
                        page.locator("#playArea .buzzbtn").click()
                    for page in phones:
                        page.wait_for_function("document.querySelectorAll('#playArea button.pbtn').length===4")
                    answer(phones[0], correct)
                    if qi == 1:
                        host.evaluate("G.buzz.lanes.adult.adl=Date.now()-1")
                    else:
                        answer(phones[1], (correct + 1) % 4 if qi == 0 else correct)
                reveal("buzzer")
                after = scores()
                expected = [0, 0] if qi == 2 else [10, 10] if qi == 3 else [10, 0]
                env.check(f"Big Quiz buzzer question {qi + 1}: real buzz selection, wrong/timeout and points",
                          [after[mid] - before[mid] for mid in member_ids] == expected)
            advance_reveal("clues" if mode == "fiveclues" else "buzzer" if mode == "buzzer" else "normal")
        if round_index < len(order) - 1:
            host.wait_for_function("G.phase==='round_scores'&&room.phase==='round_scores'&&!access.busy()")
            controls()
            host.locator("#nextRoundBtn").click()
            host.wait_for_function("G.phase==='round_intro'&&!access.busy()")

    host.wait_for_function("G.phase==='final'&&room.phase==='final'&&!access.busy()&&!G.finalizing")
    for page in phones:
        page.wait_for_function("latestRoom&&latestRoom.phase==='final'")
    final_scores = scores()
    totals = host.evaluate("[room.state.fin.youth.total,room.state.fin.adult.total]")
    env.check("Big Quiz: all 16 real questions reach canonical final totals",
              (normal_count, clues_count, buzzer_count) == (8, 4, 4)
              and totals == [final_scores[mid] for mid in member_ids])
    controls()
    host.locator("#closingBtn").click()
    for page in phones:
        page.wait_for_function("latestRoom.phase==='closing'&&document.querySelector('#playArea').textContent.includes('A closing word')")
    settled()
    controls()
    host.locator("#startShow").click()
    host.wait_for_function("G.phase==='round_intro'&&room.run_id!==null&&!access.busy()")
    env.check("Big Quiz: visible Play again starts a fresh run with the same roster and accumulated scores",
              host.evaluate("room.run_id") != first_run and scores() == final_scores)

    # An unknown/stale local checkpoint must not silently publish lobby.
    host.locator("#skipBtn").click()
    host.wait_for_function("G.phase!=='round_intro'&&!access.busy()")
    host.wait_for_function("sessionStorage.getItem(SHOW_CHECKPOINT)!==null")
    server_before = host.evaluate("[room.run_id,room.version,room.phase,room.q_id]")
    # Tamper on the next document before the app starts; pagehide otherwise
    # correctly writes the current checkpoint while this document unloads.
    host.add_init_script("const s=JSON.parse(sessionStorage.getItem('tb_bigquiz_show_v1')||'null');if(s){s.version-=1;sessionStorage.setItem('tb_bigquiz_show_v1',JSON.stringify(s));}")
    host.reload()
    host.wait_for_function("G.phase==='interrupted'&&!access.busy()")
    env.check("Big Quiz: stale checkpoint preserves canonical active room and offers explicit recovery",
              host.evaluate("[room.run_id,room.version,room.phase,room.q_id]") == server_before
              and host.locator("#banner button").inner_text() == "Restart show")
    host.locator("#banner button").click()
    host.wait_for_function("G.phase==='round_intro'&&!access.busy()")
    env.check("Big Quiz: explicit interrupted-show recovery preserves players and scores", scores() == final_scores)

    phones[1].once("dialog", lambda dialog: dialog.accept())
    phones[1].locator("#leaveBtn").click()
    phones[1].wait_for_function("me===null&&!document.querySelector('#joinScreen').classList.contains('hide')")
    host.wait_for_function("document.querySelector('#count').textContent==='1'")
    env.check("Big Quiz: confirmed leave removes only the leaving member", list(scores()) == [member_ids[0]])
    phones[1].locator("#name").fill("Quiz Bob Again")
    phones[1].locator('.team-btn[data-tag="adult"]').click()
    phones[1].wait_for_function("me&&latestRoom")
    env.check("Big Quiz: rejoin creates a new zero-score membership",
              phones[1].evaluate("me.id") != member_ids[1] and phones[1].evaluate("Number(me.score)") == 0)
    env.note("Big Quiz completed all four actual four-question modes, wrong answers, normal timeout handlers, two real phones, exact scoring, phone/host reload, final/closing, rematch, recovery and leave/rejoin. Native network/auth timers were retained; only intro/reveal controls and gameplay deadlines were shortened.")
