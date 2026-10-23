"""Spines host + two phones against the real local Auth/PostgREST stack.

The browser entry point is run(env). Offline regression checks can also run with
python3 tests/gameplay_spines.py --unit; those checks exercise extracted client
functions and do not stand in for the real-stack browser acceptance.
"""
from pathlib import Path
import importlib.util
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def _wait(page, expression, arg=None):
    page.wait_for_function(expression, arg=arg, timeout=30000)


def _member(page, code):
    return page.evaluate("code => partyAccess.membership(code)", code)["id"]


def _join(page):
    page.locator("#pname").fill("Sam")
    page.locator("#pjoin").click()
    _wait(page, "!document.querySelector('#pjoin') && /Waiting for the host|Connecting|Watch|Your turn|question|standing|won|out of this party/.test(document.querySelector('#pmsg').textContent)")


def _leave(page):
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Leave the game", exact=True).click()
    page.locator("#pjoin").wait_for()


def _choose(host, phones):
    _wait(host, "P.phase==='choose' && !P.queued && !G.busy && P.room.action && P.room.action.accepting")
    owner = phones[host.evaluate("P.turn")]
    # Phones poll every 900ms. Give the previous turn's controls time to retire
    # before choosing from a newly published canonical action window.
    owner.wait_for_timeout(1100)
    owner.locator("#blist button").last.wait_for()
    _wait(owner, "document.querySelector('#blist button') && !document.querySelector('#blist button').disabled")
    owner.locator("#blist button").last.click()  # actual lowest / three-point book
    _wait(host, "P.phase==='question' && P.room.action.kind==='answer' && !P.queued")
    _wait(owner, "document.querySelector('#popts .opt') && !document.querySelector('#popts .opt').disabled")
    return owner


def _answer(host, phones, right):
    owner = _choose(host, phones)
    old_seq = host.evaluate("P.seq")
    answer = host.evaluate("G.q.correct" if right else "P.q.opts.find(o=>o!==G.q.correct)")
    owner.get_by_role("button", name=answer, exact=True).click()
    _wait(host, "seq => P.phase==='over' || (P.phase==='choose' && P.seq>seq && !G.busy && !P.queued)", old_seq)
    return owner


def _edition(env, path, edition):
    prefix = "spines_" + edition
    # Hold only the presentation's onEnd callback. Room membership and normal
    # Start/Leave controls remain real while the opening is on screen.
    host = env.new_page(path + "?host", prefix + "_host")
    _wait(host, "P && P.connected && !P.queued")
    code = host.evaluate("P.code")
    one = env.new_page(path + "?party=" + code, prefix + "_phone1", mobile=True)
    two = env.new_page(path + "?party=" + code, prefix + "_phone2", mobile=True)
    _join(one)
    _join(two)
    _wait(host, "P.activeIds.length===2 && !document.querySelector('#lstart').disabled")
    ids = [_member(one, code), _member(two, code)]
    env.check(prefix + "_duplicate_names_distinct_members", ids[0] != ids[1])

    host.locator("#cutsToggle").check()
    host.evaluate("TBScenes.play=(stage, game, kind, options)=>{window.__finishOpening=options.onEnd;return true;}")
    host.locator("#lstart").click()
    _wait(host, "typeof __finishOpening==='function' && document.querySelector('#lobby').hidden")
    _leave(two)
    _wait(host, "P.activeIds.length===1 && document.querySelector('#lstart').disabled")
    host.evaluate("__finishOpening()")
    env.check(prefix + "_leave_during_intro_restores_lobby", host.locator("#lobby").is_visible() and host.locator("#lstart").is_disabled())
    _join(two)
    ids[1] = _member(two, code)
    phones = {ids[0]: one, ids[1]: two}
    _wait(host, "P.activeIds.length===2 && !document.querySelector('#lstart').disabled")
    host.locator("#cutsToggle").uncheck()
    host.locator("#lstart").click()
    _wait(host, "P.phase==='choose' && !P.queued && G")
    initial_run = host.evaluate("P.room.run_id")
    env.check(prefix + "_both_members_in_run", set(host.evaluate("P.alive")) == set(ids))
    env.check(prefix + "_host_pile_is_display_only", host.locator("#pile .book:enabled").count() == 0)

    active = phones[host.evaluate("P.turn")]
    active.reload()
    _wait(active, "document.querySelector('#blist button') && !document.querySelector('#blist button').disabled")
    env.check(prefix + "_reload_recovers_membership", _member(active, code) in ids and active.locator("#pjoin").count() == 0)
    # Suppress only the host's automatic poll while checking an acknowledgement
    # lost after a real database commit. Explicit retry must reuse the request;
    # the regular host reader resumes after the canonical receipt is recovered.
    host.evaluate("clearInterval(P.poll)")
    owner = phones[host.evaluate("P.turn")]
    _wait(owner, "document.querySelector('#blist button') && !document.querySelector('#blist button').disabled")
    calls_before = len(env.rpc_calls(owner, "party_submit"))
    env.interrupt_next_rpc(owner, "party_submit")
    owner.locator("#blist button").last.click()
    _wait(owner, "document.querySelector('#partySubmissionStatus') && document.querySelector('#partySubmissionStatus').dataset.state==='unknown'")
    owner.locator("#partySubmissionRetry").click()
    _wait(owner, "document.querySelector('#partySubmissionStatus') && document.querySelector('#partySubmissionStatus').dataset.state==='confirmed'")
    attempts = env.rpc_calls(owner, "party_submit")[calls_before:]
    env.check(prefix + "_lost_ack_retry_reuses_request", len(attempts) == 2 and attempts[0]["request_id"] == attempts[1]["request_id"])
    owner.reload()
    _wait(owner, "document.querySelector('#partySubmissionStatus') && document.querySelector('#partySubmissionStatus').dataset.state==='confirmed'")
    env.check(prefix + "_reload_recovers_recorded_book", owner.locator("#blist button.picked").count() == 1 and owner.locator("#blist button:enabled").count() == 0)
    host.evaluate("P.poll=setInterval(pollPartyHost,900)")
    _wait(host, "P.phase==='question' && !P.queued")
    _wait(owner, "document.querySelector('#popts .opt') && !document.querySelector('#popts .opt').disabled")
    watcher = two if owner == one else one
    _wait(watcher, "document.querySelectorAll('#popts .opt').length===4")
    env.check(prefix + "_only_selected_member_can_answer", watcher.locator("#popts .opt:enabled").count() == 0)
    old_seq = host.evaluate("P.seq")
    owner.get_by_role("button", name=host.evaluate("G.q.correct"), exact=True).click()
    _wait(host, "seq => P.phase==='choose' && P.seq>seq && !P.queued && !G.busy", old_seq)
    env.check(prefix + "_correct_bottom_book_scores_and_moves", host.evaluate("G.pts===3 && G.moved===1 && G.books.length===15"))

    # Skip is the supported host recovery for unanswered books/questions.
    # Spines has no automatic per-question deadline.
    before = host.evaluate("({seq:P.seq,lean:G.lean,pts:G.pts,turn:P.turn})")
    host.locator("#skipBtn").click()
    _wait(host, "seq => P.phase==='choose' && P.seq>seq && !P.queued", before["seq"])
    env.check(prefix + "_unanswered_book_skip_advances_without_penalty", host.evaluate("b => G.lean===b.lean && G.pts===b.pts && P.turn!==b.turn", before))
    _choose(host, phones)
    before = host.evaluate("({seq:P.seq,lean:G.lean,pts:G.pts})")
    host.locator("#skipBtn").click()
    _wait(host, "seq => P.phase==='choose' && P.seq>seq && !P.queued", before["seq"])
    env.check(prefix + "_unanswered_question_skip_closes_card", host.evaluate("b => document.querySelector('#card').hidden && G.sel===-1 && G.lean===b.lean && G.pts===b.pts", before))

    # Natural physics: one correct lower book adds 2.05 lean; three wrong lower
    # books add 3.1 each. The real settle/collapse/finish path chooses a winner.
    for _ in range(3):
        _answer(host, phones, right=False)
    _wait(host, "P.phase==='over' && !document.querySelector('#end').hidden && !P.queued")
    outcome = host.evaluate("({winner:P.winnerId,out:P.out.slice(),pts:G.pts,moved:G.moved})")
    env.check(prefix + "_wrong_answers_naturally_collapse", len(outcome["out"]) == 1 and outcome["winner"] in ids and outcome["winner"] not in outcome["out"] and outcome["pts"] == 3 and outcome["moved"] == 1)
    winner = phones[outcome["winner"]]
    loser = phones[outcome["out"][0]]
    _wait(winner, "/You won!/.test(document.querySelector('#pmsg').textContent)")
    _wait(loser, "/toppled the pile/.test(document.querySelector('#pmsg').textContent)")
    env.check(prefix + "_same_name_winner_uses_member_id", "You won!" not in loser.locator("#pmsg").inner_text())
    host.locator("#againBtn").click()
    _wait(host, "run => P.phase==='choose' && P.room.run_id!==run && !P.queued", initial_run)
    env.check(prefix + "_rematch_resets_pile_scores_and_roster", host.evaluate("G.pts===0 && G.moved===0 && G.lean===0 && P.alive.length===2 && P.out.length===0"))

    # Leave an open question through the normal phone control. The remaining
    # member wins; rejoining receives a new member ID and enters the next run.
    leaving = _choose(host, phones)
    left_id = host.evaluate("P.turn")
    other_id = next(member for member in ids if member != left_id)
    _leave(leaving)
    _wait(host, "P.phase==='over' && !P.queued")
    env.check(prefix + "_current_member_leave_closes_question", host.evaluate("id => P.winnerId===id && (!P.room.action || !P.room.action.accepting)", other_id))
    _join(leaving)
    new_id = _member(leaving, code)
    env.check(prefix + "_rejoin_is_new_member", new_id != left_id)
    host.locator("#againBtn").click()
    _wait(host, "P.phase==='choose' && !P.queued")
    env.check(prefix + "_rejoined_member_plays_next_run", set(host.evaluate("P.alive")) == {new_id, other_id})
    env.note(prefix + ": actual book/answer/skip/collapse/rematch/leave/rejoin flow completed")

    solo = env.new_page(path, prefix + "_solo", mobile=True)
    solo.locator("#goBtn").click()
    solo.locator("#pile .book").first.click()
    solo.get_by_role("button", name=solo.evaluate("G.q.correct"), exact=True).click()
    _wait(solo, "G.pts===3 && G.moved===1 && !G.busy")
    env.check(prefix + "_solo_actual_answer_smoke", solo.evaluate("partyAccess===null && G.books.length===15 && document.querySelector('#card').hidden"))


def run(env):
    for path, edition in (("/spines.html", "general"), ("/spines-bible.html", "bible")):
        _edition(env, path, edition)


def unit_checks():
    """Deterministic reproductions supplement, rather than replace, browsers."""
    spec = importlib.util.spec_from_file_location("existing_spines", ROOT / "tests/test_party_spines.py")
    existing = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(existing)
    body = r"""
const s=sandbox({mode:'host'});await s.flush();
s.get('lobby').hidden=true;s.setMembers([{id:'one',name:'Sam'}]);
await s.context.startPartyRun();assert.equal(s.get('lobby').hidden,false,'missing member restores lobby');
s.setMembers([{id:'one',name:'Sam'},{id:'two',name:'Sam'}]);await s.context.pollPartyHost();
assert.equal(s.get('lstart').disabled,false);s.get('lstart').click();
assert.equal(s.get('lstart').disabled,true,'Start disables synchronously');await s.flush();
const run=s.context.P.room.run_id;s.get('lstart').click();await s.flush();assert.equal(s.context.P.room.run_id,run,'active game ignores stray Start');
let done;
s.context.cutsOn=()=>true;s.context.BIBLE=false;s.context.playScene=(kind,options,callback)=>{done=callback;};
s.get('lstart').disabled=false;
const intro=source.slice(source.indexOf('  /* the opening plays when the game starts */'),source.lastIndexOf('\n})();'));
vm.runInContext(intro,s.context);s.get('lstart').listeners.click.at(-1).call(s.get('lstart'),{stopImmediatePropagation(){},preventDefault(){}});
assert.equal(s.get('lobby').hidden,true);s.get('lstart').disabled=true;done();
assert.equal(s.get('lobby').hidden,false,'disabled Start after intro must not strand lobby');
"""
    for name in ("spines.html", "spines-bible.html"):
        result = subprocess.run(["node", "-", str(ROOT / name)], input=existing.HARNESS + "\n(async()=>{\n" + body + "\n})().catch(e=>{console.error(e);process.exitCode=1;});\n", text=True, capture_output=True, timeout=20)
        if result.returncode:
            raise AssertionError(name + ": " + result.stdout + result.stderr)
        print(name + ": intro membership loss, immediate Start lock, active-run guard passed")


if __name__ == "__main__":
    if sys.argv[1:] != ["--unit"]:
        raise SystemExit("Use --unit for offline regressions; real-stack runner imports run(env).")
    unit_checks()
