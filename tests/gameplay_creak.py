"""Real Auth/PostgREST Creak gameplay, invoked by gameplay_backend_browser.py.

The board and random outcomes form a repeatable course. Every move still starts
with the normal phone roll, host polling, real action window and (where needed)
phone answer. Native protocol clocks are retained; only presentation is faster.
"""

import time


INIT = "localStorage.setItem('tb-cutscenes-guide', '0');"

COURSE = """() => {
  if (window.__creakCourse) return;
  window.__creakCourse = true;
  window.__creakRoll = 6;
  window.__creakEvent = 'none';
  window.__creakTrace = [];
  window.__creakTorn = 0;
  const random = Math.random;
  let seed = 3169;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const originalInt = rint;
  rint = (lo, hi) => {
    if (lo === 1 && hi === 6) return window.__creakRoll;
    if (lo === 5 && hi === 16) return 5;
    if (lo === 12 && hi === 89) return 80 + (window.__creakTorn++ % 2);
    return originalInt(lo, hi);
  };
  genBoard = () => ({
    ladders: [
      {from:7, to:25, health:34, maxHealth:34, alive:true},
      {from:31, to:60, health:29, maxHealth:29, alive:true},
      {from:72, to:90, health:20, maxHealth:20, alive:true}
    ],
    snakes: [
      {from:13, to:3, stir:0, threshold:3, alive:true},
      {from:66, to:40, stir:0, threshold:2, alive:true}
    ],
    craters:[19]
  });
  const originalEvent = maybeEvent;
  maybeEvent = function (id) {
    // maybeEvent takes its draw synchronously, before the first await. Restore
    // the seeded generator immediately so particle art remains independent.
    const ordinary = Math.random;
    const draw = {none:.95, roc:.04, rock:.10, storm:.20}[window.__creakEvent];
    Math.random = () => { Math.random = ordinary; return draw; };
    try { return originalEvent(id); } finally { Math.random = ordinary; }
  };
  const originalSnake = snakeActs;
  snakeActs = function (snake) {
    const ordinary = Math.random;
    Math.random = () => { Math.random = ordinary; return .9; };
    try { return originalSnake(snake); } finally { Math.random = ordinary; }
  };
  const originalTween = addTween;
  addTween = (duration, update, done) => originalTween(Math.min(duration, 30), update, done);
  const originalSleep = sleep;
  sleep = ms => originalSleep(ms >= 380 && ms <= 650 ? 25 : ms);
  holdOutcome = async () => {};
  const originalStatus = setStatus;
  setStatus = function (html) { window.__creakTrace.push(String(html)); return originalStatus(html); };
}"""


def _snapshot(host):
    return host.evaluate("""() => ({
      phase:G.phase, order:G.order.slice(), turn:G.turnIdx, seq:G.turnSeq,
      positions:{...G.positions}, board:{
        // Art adds transient _eye/_alpha/_writhe fields while drawing. Compare
        // the actual game model that SQL preserves, independently of frames.
        ladders:(G.board.ladders||[]).map(({from,to,health,maxHealth,alive})=>({from,to,health,maxHealth,alive})),
        snakes:(G.board.snakes||[]).map(({from,to,stir,threshold,alive})=>({from,to,stir,threshold,alive})),
        craters:(G.board.craters||[]).slice()
      },
      run:access.currentRoom().run_id,
      published:access.currentRoom().state,
      winner:G.winner
    })""")


def _ready(host):
    host.wait_for_function(
        "!engineBusy && !starting && !access.busy() && access.currentRoom()",
        timeout=30000,
    )


def _join(phone, code, name):
    phone.locator("#codeIn").fill(code)
    phone.locator("#nameIn").fill(name)
    phone.locator("#joinBtn").click()
    phone.wait_for_function("me && latest && latest.member.id === me.id", timeout=30000)
    return phone.evaluate("me.id")


def _turn(host, phones, roll=6, event="none", answer="correct", automatic=False):
    _ready(host)
    before = _snapshot(host)
    actor = before["order"][before["turn"]]
    phone = phones[actor]
    host.evaluate("([roll,event]) => { window.__creakRoll=roll; window.__creakEvent=event; }", [roll, event])
    if not automatic:
        phone.locator("#rollBtn").wait_for(state="visible", timeout=15000)
        phone.locator("#rollBtn").click()
    # Native 25s inactivity deadline is deliberately exercised for automatic rolls.
    host.wait_for_function(
        "seq => !!G.pendingQ || G.turnSeq > seq || G.phase === 'gameover'",
        arg=before["seq"],
        timeout=45000 if automatic else 20000,
    )
    question = host.evaluate("G.pendingQ ? JSON.parse(JSON.stringify(G.pendingQ)) : null")
    if question:
        phone.locator(".qopt2").first.wait_for(state="visible", timeout=15000)
        phone.wait_for_function(
            "id => latest && latest.room.state.pendingQ && latest.room.state.pendingQ.qId === id",
            arg=question["qId"],
            timeout=15000,
        )
        if answer != "timeout":
            correct = host.evaluate("G.pendingQCorrect")
            index = next(i for i, value in enumerate(question["opts"]) if (value == correct) == (answer == "correct"))
            phone.locator(f'.qopt2[data-i="{index}"]').click()
    host.wait_for_function(
        "seq => !engineBusy && !access.busy() && (G.turnSeq > seq || G.phase === 'gameover')",
        arg=before["seq"],
        timeout=30000,
    )
    after = _snapshot(host)
    if after["published"].get("positions") != after["positions"]:
        raise AssertionError("Creak host positions differ from the state accepted by SQL")
    return before, after, actor, question


def run(env):
    host = env.new_page("creak-multi.html", "creak-host", init_script=INIT)
    host.wait_for_function("G.code && access.currentRoom() && !access.busy()", timeout=30000)
    host.evaluate(COURSE)
    code = host.evaluate("G.code")
    one = env.new_page(f"creak-multi-play.html?c={code}", "creak-one", mobile=True)
    two = env.new_page(f"creak-multi-play.html?c={code}", "creak-two", mobile=True)
    first = _join(one, code, "Climb&One")
    second = _join(two, code, "ClimbTwo")
    phones = {first: one, second: two}
    host.wait_for_function("G.players.length === 2 && !document.getElementById('startBtn').disabled", timeout=20000)
    env.check("creak: two phones joined distinct canonical members", first != second)
    host.locator("#startBtn").click()
    host.wait_for_function("G.phase === 'live' && !starting && !access.busy()", timeout=30000)
    start = _snapshot(host)
    env.check("creak: race starts both climbers on square one", list(start["positions"].values()) == [1, 1])
    turns = 0

    def turn(name, expected, **kwargs):
        nonlocal turns
        before, after, actor, question = _turn(host, phones, **kwargs)
        turns += 1
        env.check(name, after["positions"][actor] == expected,
                  {"before": before["positions"][actor], "after": after["positions"][actor], "question": question and question["kind"]})
        return before, after, actor, question

    _, _, _, q = turn("creak: correct ladder answer climbs from 7 to 25", 25)
    env.check("creak: ladder uses a real phone question", q and q["kind"] == "ladder")
    before, after, _, _ = turn("creak: wrong ladder answer stays on the rung", 7, answer="wrong")
    env.check("creak: wrong answer damages and ages the shared ladder",
              before["board"]["ladders"][0]["health"] - after["board"]["ladders"][0]["health"] == 3)
    _, _, _, q = turn("creak: unanswered question expires without a climb", 31, answer="timeout")
    env.check("creak: question timeout retains its native deadline", q and q["dur"] == 8450)
    turn("creak: wrong snake answer slides from 13 to 3", 3, answer="wrong")
    _, _, _, q = turn("creak: correct rockfall answer keeps the landed square", 37, event="rock")
    env.check("creak: rockfall question reaches the phone", q and q["kind"] == "rock")

    # Reload and transient connectivity retain the same verified phone identity.
    one.reload()
    one.wait_for_function("me && latest", timeout=30000)
    env.check("creak: phone reload retains membership", one.evaluate("me.id") == first)
    failing_route = "**/rest/v1/rpc/party_player_state"

    def disconnect(route):
        route.abort("internetdisconnected")

    one.route(failing_route, disconnect)
    one.locator("#partyConnection").wait_for(state="visible", timeout=20000)
    one.unroute(failing_route, disconnect)
    one.get_by_role("button", name="Retry connection", exact=True).click()
    one.locator("#partyConnection").wait_for(state="hidden", timeout=20000)
    env.check("creak: phone reconnect returns to its current race", one.evaluate("me.id === latest.member.id && latest.room.phase === 'live'"))

    before, after, _, q = turn("creak: failed storm leaves its climber in place", 9, event="storm", answer="wrong")
    env.check("creak: failed storm tears two shared tiles", q and q["kind"] == "storm" and set(after["board"]["craters"]) == {19, 80, 81})
    env.check("creak: failed storm damages all live ladders",
              all(a["health"] == b["health"] - 5 for b, a in zip(before["board"]["ladders"], after["board"]["ladders"]) if b["alive"]))
    turn("creak: correct storm protects ladders", 43, event="storm")
    turn("creak: correct snake answer stays at its head", 13, roll=4)

    before_reload = _snapshot(host)
    host.reload()
    host.wait_for_function("G.phase === 'live' && document.getElementById('status').textContent.includes('Back on the mountain') && !access.busy()", timeout=30000)
    host.evaluate(COURSE)
    restored = _snapshot(host)
    env.check("creak: board reload restores canonical positions and board", restored["positions"] == before_reload["positions"] and restored["board"] == before_reload["published"]["board"],
              {"before_positions": before_reload["positions"], "restored_positions": restored["positions"], "expected_board": before_reload["published"]["board"], "restored_board": restored["board"]})
    env.check("creak: board reload retains its run and opens a fresh roll", restored["run"] == before_reload["run"] and restored["seq"] == before_reload["seq"] + 1)

    turn("creak: wrong rockfall answer moves the climber down", 44, event="rock", answer="wrong")
    turn("creak: a crater drops a climber one board row", 9)
    turn("creak: the Roc carries a climber upward", 55, event="roc")
    turn("creak: ordinary roll advances the second climber", 15)
    turn("creak: ordinary roll advances the first climber", 61)
    turn("creak: ordinary play continues after hazards", 21)
    turn("creak: the second snake slides its climber down", 40, roll=5, answer="wrong")

    # Continue the same race, using real turn controls, all the way to the top.
    while _snapshot(host)["phase"] == "live" and turns < 70:
        _turn(host, phones)
        turns += 1
    finished = _snapshot(host)
    env.check("creak: complete race reaches a normal summit", finished["phase"] == "gameover" and finished["positions"].get(finished["winner"]["id"]) == 100,
              {"turns": turns, "positions": finished["positions"]})
    winner_phone = phones[finished["winner"]["id"]]
    winner_phone.wait_for_function("latest && latest.room.phase === 'gameover'", timeout=20000)
    env.check("creak: winner sees the summit on their phone", "You reached the summit!" in winner_phone.locator("#playCard").inner_text())
    env.check("creak: summit total includes the winning roll", host.locator("#ovStats .ovstat b").first.inner_text() == str(turns))
    env.check("creak: winning name renders its ampersand normally", host.locator("#ovLine").inner_text().startswith(finished["winner"]["name"]) and "&amp;" not in host.locator("#ovLine").inner_text())

    host.locator("#ovAgain").click()
    host.wait_for_function("G.phase === 'lobby' && !engineBusy && !access.busy() && !document.getElementById('startBtn').disabled", timeout=30000)
    rematch = _snapshot(host)
    env.check("creak: rematch creates a new run with the same roster", rematch["run"] != finished["run"] and host.evaluate("G.players.length") == 2)
    host.locator("#startBtn").click()
    host.wait_for_function("G.phase === 'live' && !starting && !access.busy()", timeout=30000)
    already_waiting = host.evaluate("Math.max(0, Date.now() - G.turnStartedAt) / 1000")
    before = time.monotonic()
    _, after, actor, _ = _turn(host, phones, automatic=True)
    env.check("creak: native inactivity timeout rolls for the active phone", time.monotonic() - before + already_waiting >= 25 and after["positions"][actor] == 25 and host.evaluate("window.__creakTrace.some(line => line.includes('took too long'))"))

    # Hold a real roster request while the two phones leave. Release it through
    # the harness's backend route afterwards; no roster or receipts are faked.
    # This covers both departures in one poll without relying on CI timing.
    roster_route = "**/rest/v1/rpc/party_host_members"
    waiting_roster = []

    def hold_roster(route):
        waiting_roster.append(route)

    host.route(roster_route, hold_roster)
    for _ in range(100):
        if waiting_roster:
            break
        host.wait_for_timeout(100)
    if not waiting_roster:
        raise AssertionError("Creak host did not request its next roster")
    try:
        one.evaluate("document.getElementById('partyLeave').click()")
        two.evaluate("document.getElementById('partyLeave').click()")
        one.wait_for_function("me === null", timeout=20000)
        two.wait_for_function("me === null", timeout=20000)
    finally:
        host.unroute(roster_route, hold_roster)
        for route in waiting_roster:
            route.fallback()
    host.wait_for_function("G.phase === 'lobby' && !engineBusy && !access.busy()", timeout=20000)
    abandoned = _snapshot(host)
    env.check("creak: every racer leaving returns an abandoned race to a lobby", abandoned["run"] != after["run"] and not abandoned["order"] and host.evaluate("G.players.length") == 0)

    first_new = _join(one, code, "Climb&One")
    second_new = _join(two, code, "ClimbTwo")
    phones = {first_new: one, second_new: two}
    env.check("creak: departed phones can rejoin with new memberships", first_new != first and second_new != second)
    host.wait_for_function("G.players.length === 2 && !document.getElementById('startBtn').disabled", timeout=20000)
    host.locator("#startBtn").click()
    host.wait_for_function("G.phase === 'live' && !starting && !access.busy()", timeout=30000)
    _, restarted, _, _ = _turn(host, phones)
    env.check("creak: a fresh race after full dropout accepts real rolls", sorted(restarted["positions"].values()) == [1, 25])
    two.locator("#partyLeave").click()
    host.wait_for_function("G.phase === 'gameover' && !access.busy()", timeout=20000)
    one.wait_for_function("latest && latest.room.phase === 'gameover'", timeout=20000)
    env.check("creak: last remaining racer wins without a false summit message", "last climber standing" in host.locator("#ovLine").inner_text() and "last climber standing" in one.locator("#playCard").inner_text())
    host.evaluate("() => { const open=TBShare.open; TBShare.open=options=>{window.__creakShare=options;return open(options);}; }")
    host.locator("#ovShare").click()
    env.check("creak: default-win share card reports its real finish and turn count", host.evaluate("window.__creakShare.lines[0]==='Last climber standing.' && window.__creakShare.lines[1].startsWith('Finished in '+(G.turnSeq-G.seqBase)+' turns') && !window.__creakShare.shareText.includes('summit')"))
    host.evaluate("TBShare.close()")
    env.note(f"Creak completed {turns} normal turns, all four question kinds, native question/roll timeouts, reload/reconnect, rematch and leave/rejoin against real Auth/SQL. Only presentation and random outcomes were controlled.")
