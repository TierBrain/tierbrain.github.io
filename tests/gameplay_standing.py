"""Standing Room: host and two phones using real Auth/PostgREST/SQL.

The complete first game loses floor through actual answers and legal phone
steps. One deadline uses the production wait helper with a short duration;
server identities, receipts, windows and native clocks remain unchanged.
"""

INIT = "localStorage.setItem('tb-cutscenes-harbour','0');"


def _wait(page, expression, arg=None):
    page.wait_for_function(expression, arg=arg, timeout=30000)


def _ready(host):
    _wait(host, "!engineBusy && !starting && !finishing && !access.busy() && access.currentRoom()")


def _question(host):
    _wait(host, "G.phase==='over' || (G.phase==='live' && !engineBusy && !starting && !access.busy() && access.currentRoom().action && access.currentRoom().action.accepting && access.currentRoom().action.kind==='answer' && access.currentRoom().action.key===G.qId)")


def _join(phone, code):
    phone.locator('#code').fill(code)
    phone.locator('#name').fill('Sam')
    phone.locator('#joinBtn').click()
    _wait(phone, 'me && latest && latest.member.id===me.id')
    return phone.evaluate('me.id')


def _snapshot(host):
    return host.evaluate("({run:access.currentRoom().run_id,qId:G.qId,solid:G.solid.slice(),pos:{...G.pos},turn:G.turn,who:G.order[G.turn],phase:G.phase,action:access.currentRoom().action})")


def _moved(host, before):
    _wait(host, "b => G.solid[b.pos[b.who]]===false && G.pos[b.who]!==b.pos[b.who] && !access.busy()", before)
    _question(host)


def _wrong(host, phones):
    _question(host)
    before = _snapshot(host)
    if before['phase'] == 'over':
        return
    owner = phones[before['who']]
    _wait(owner, 'document.querySelector("#area .opt:enabled")')
    answer = host.evaluate('G.q.opts.find(o=>o!==G.q.correct)')
    owner.get_by_role('button', name=answer, exact=True).click()
    _moved(host, before)


def run(env):
    host = env.new_page('/standing-room-multi.html', 'standing_host', init_script=INIT)
    _wait(host, "G.code.length===5 && !access.busy()")
    code = host.evaluate('G.code')
    one = env.new_page('/standing-room-play.html?c='+code, 'standing_phone1', mobile=True)
    two = env.new_page('/standing-room-play.html?c='+code, 'standing_phone2', mobile=True)
    ids = [_join(one, code), _join(two, code)]
    phones = dict(zip(ids, [one, two]))
    _wait(host, "G.players.length===2 && !document.querySelector('#startBtn').disabled")
    env.check('standing_duplicate_names_distinct_members', ids[0] != ids[1])
    host.locator('#startBtn').click()
    _question(host)
    initial = _snapshot(host)
    env.check('standing_initial_floor_and_roster', host.evaluate('G.N===6 && G.solid.filter(Boolean).length===36 && G.order.length===2'))
    env.check('standing_territory_labels', host.locator('#standing').inner_text().count('ground') == 2)

    # A phone reload keeps the same authenticated member and current action.
    active = phones[initial['who']]
    active.reload()
    _wait(active, 'me && latest && document.querySelector("#area .opt:enabled")')
    env.check('standing_phone_reload_preserves_member', active.evaluate('me.id') == initial['who'])
    watcher = two if active == one else one
    _wait(watcher, "document.querySelector('#area').textContent.includes('is deciding')")
    env.check('standing_only_actor_has_answer_controls', watcher.locator('#area .opt').count() == 0)

    active.get_by_role('button', name=host.evaluate('G.q.correct'), exact=True).click()
    _wait(host, "G.qId.endsWith(':step') && access.currentRoom().action.kind==='step' && !access.busy()")
    before = _snapshot(host)
    host.reload()
    _wait(host, "G.phase==='live' && access.currentRoom().action && access.currentRoom().action.kind==='step' && !access.busy()")
    resumed = _snapshot(host)
    env.check('standing_host_reload_preserves_run_floor_step', all(resumed[k] == before[k] for k in ('run','qId','solid','pos','turn')) and resumed['action']['id'] == before['action']['id'])
    _wait(active, 'document.querySelector("#area .cell.step")')
    actual = active.locator('#area .cell.step').evaluate_all('(cells)=>cells.map(c=>Number(c.dataset.t)).sort((a,b)=>a-b)')
    expected = host.evaluate('legal(G.order[G.turn]).slice().sort((a,b)=>a-b)')
    env.check('standing_phone_legal_steps_match_host', actual == expected)
    chosen = actual[0]
    active.locator('#area .cell.step[data-t="'+str(chosen)+'"]').click()
    _moved(host, before)
    env.check('standing_correct_choice_collapses_exact_old_tile', host.evaluate('b=>!G.solid[b.pos[b.who]] && G.pos[b.who]===b.tile', dict(before, tile=chosen)))

    # Reload an open answer as well: neither run nor answer window is replaced.
    before = _snapshot(host)
    host.reload()
    _question(host)
    resumed = _snapshot(host)
    env.check('standing_host_reload_preserves_answer', all(resumed[k] == before[k] for k in ('run','qId','solid','pos','turn')) and resumed['action']['id'] == before['action']['id'])
    _wrong(host, phones)
    env.check('standing_wrong_answer_moves_and_reduces_floor', host.evaluate('G.solid.filter(Boolean).length===34'))

    # The timeout resolver is real; only its duration and poll cadence shorten.
    before = _snapshot(host)
    host.evaluate('waitForWindow(G.order[G.turn],null,300,100)')
    _wait(host, "document.querySelector('#say').textContent.includes('hesitated')")
    _moved(host, before)
    env.check('standing_unanswered_question_water_move', host.evaluate('G.solid.filter(Boolean).length===33'))
    env.note('standing: one normal answer-timeout helper used 300ms instead of 45s; the 45s wall-clock wait is not covered')

    # Every remaining move comes from a phone answer, so the shrinking floor
    # naturally strands a player and finishes the game; no forced end state.
    turns = 0
    while host.evaluate('G.phase') != 'over' and turns < 36:
        _wrong(host, phones)
        turns += 1
    _wait(host, "G.phase==='over' && !finishing && !engineBusy && !access.busy()")
    winner_id = host.evaluate('alive()[0]')
    loser_id = next(member for member in ids if member != winner_id)
    _wait(phones[winner_id], "document.querySelector('#area').textContent.includes('You are still standing.')")
    _wait(phones[loser_id], "document.querySelector('#area').textContent.includes('The floor is gone.')")
    env.check('standing_natural_floor_elimination_and_id_winner', host.evaluate('alive().length===1 && Object.keys(G.outOf).length===1 && G.solid.filter(Boolean).length<33') and host.locator('#wTitle').inner_text() == 'Sam is still standing')
    env.check('standing_end_closes_action', host.evaluate('!access.currentRoom().action || !access.currentRoom().action.accepting'))

    host.locator('#againBtn').click()
    _wait(host, "G.phase==='lobby' && !engineBusy && !access.busy() && !document.querySelector('#startBtn').disabled")
    rematch_run = host.evaluate('access.currentRoom().run_id')
    env.check('standing_rematch_new_run_and_empty_board', rematch_run != initial['run'] and host.evaluate('G.order.length===0 && G.solid.length===0 && G.seq===0'))
    host.locator('#startBtn').click()
    _question(host)
    env.check('standing_rematch_new_floor_and_roster', host.evaluate('G.solid.filter(Boolean).length===36 && Object.keys(G.outOf).length===0 && G.order.length===2'))
    # The production step timeout still chooses an actual legal tile. Shorten
    # only the named helper's duration; no receipt or target is fabricated.
    before = _snapshot(host)
    owner = phones[before['who']]
    _wait(owner, 'document.querySelector("#area .opt:enabled")')
    owner.get_by_role('button', name=host.evaluate('G.q.correct'), exact=True).click()
    _wait(host, "G.qId.endsWith(':step') && access.currentRoom().action.kind==='step' && !access.busy()")
    legal_tiles = host.evaluate('legal(G.order[G.turn])')
    host.evaluate('waitForWindow(G.order[G.turn],legal(G.order[G.turn]),300,100)')
    _moved(host, before)
    env.check('standing_unanswered_step_uses_legal_tile', host.evaluate('G.pos')[before['who']] in legal_tiles)
    env.note('standing: step timeout also used 300ms instead of 30s; full 30s wall-clock wait is not covered')
    # Leaving during an open action uses the normal phone control and ends the
    # two-player game through the ordinary host departure check.
    leaving_id = host.evaluate('G.order[G.turn]')
    phones[leaving_id].locator('#partyLeave').click()
    _wait(phones[leaving_id], "!me && !document.querySelector('#joinCard').classList.contains('hide')")
    _wait(host, "G.phase==='over' && !finishing && !access.busy()")
    env.check('standing_current_actor_leave_finishes', host.evaluate('id=>!!G.outOf[id] && alive().length===1 && alive()[0]!==id', leaving_id))
    new_id = _join(phones[leaving_id], code)
    env.check('standing_rejoin_is_new_member', new_id != leaving_id)
    host.locator('#againBtn').click()
    _wait(host, "G.phase==='lobby' && !engineBusy && !access.busy() && !document.querySelector('#startBtn').disabled")
    host.locator('#startBtn').click()
    _question(host)
    env.check('standing_rejoined_member_in_next_run', new_id in host.evaluate('G.order') and leaving_id not in host.evaluate('G.order'))
    env.note('standing: two real phone identities completed correct/wrong/timeout/legal step, natural collapse, reload, rematch and current-player leave')


def unit_checks():
    """Offline actual-function recovery regressions, separate from browsers."""
    from pathlib import Path
    import importlib.util
    import subprocess
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('standing_functions', root/'tests/test_party_creak_standing.py')
    existing = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(existing)
    source = (root/'standing-room-multi.html').read_text()
    functions = '\n'.join(existing.function(source, name) for name in (
        'updateControls','rememberHostTurn','savedHostTurn','showQuestion',
        'showOutcome','resumeGame','createRoom','alive','nameOf'))
    script = r"""
const assert=require('node:assert/strict');
let hostGeneration=0,engineBusy=false,starting=false,finishing=false,used={};
const nodes=new Map(),memory=new Map(),events=[];
const $=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{add(){},remove(){}},children:[],appendChild(v){this.children.push(v);},textContent:''});return nodes.get(id);};
const document={body:{classList:{add(){}}},createElement(){return {className:'',textContent:''};}};
const location={href:'https://example.test/standing-room-multi.html'};
const localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
const BANK=[{q:'Question?',correct:'RIGHT'}];
let G={},room;
const access={savedHostCode:()=>room.code,resumeHost:async()=>{events.push('verified-owner');return structuredClone(room);},
 beginRun:async()=>{throw Error('resume must not reset the run');},currentRoom:()=>room,busy:()=>false,
 members:async()=>[{id:'one',name:'Sam'},{id:'two',name:'Sam'}],
 close:async()=>{events.push('close');return {actions:room.accepted?[{choice:room.accepted}]:[]};}};
function baseUrl(){return 'https://example.test';}
function writeState(){throw Error('resume must not republish a blank board');}
function hostError(error){throw error;}
function buildBoard(){}function paint(){}function legal(){return [1,6,7];}
function waitForAnswer(who){events.push('answer:'+who);}function waitForStep(who){events.push('step:'+who);}
function nextTurn(){events.push('next');}function askTurn(){events.push('replacement');}
function resolveAnswer(who,choice){events.push('grade:'+who+':'+choice);}
function stepTo(who,tile){events.push('move:'+who+':'+tile);}
function reset(){
 memory.clear();events.length=0;G={code:'ABCDE',phase:'lobby',players:[]};
 room={id:'room-1',code:'ABCDE',run_id:'run-1',phase:'live',state:{N:6,solid:Array(36).fill(true),pos:{one:0,two:35},outOf:{},order:['one','two'],turn:0,seq:1,qId:'q1',q:{q:'Question?',opts:['RIGHT','WRONG','THIRD','FOURTH']},names:[{id:'one',name:'Sam'},{id:'two',name:'Sam'}]},action:{id:'window-1',member_id:'one',key:'q1',kind:'answer',accepting:true}};
}
function hint(patch={}){localStorage.setItem('tb_standing_host_turn_v1',JSON.stringify(Object.assign({room:room.id,run:room.run_id,qId:room.state.qId,q:room.state.q.q,correct:'RIGHT',origin:0},patch)));}
""" + '\n' + functions + r"""
(async()=>{
 reset();const canonical=JSON.stringify(room.state);await createRoom();
 assert.equal(G.phase,'live');assert.equal(G.code,'ABCDE');assert.equal(G.qId,'q1');
 assert.equal(JSON.stringify(room.state),canonical);assert.deepEqual(events,['verified-owner','answer:one']);
 assert.equal(G.q.correct,'RIGHT');
 reset();hint({correct:'WRONG'});await createRoom();assert.equal(G.q.correct,'RIGHT','bank overrides corrupt local answer');
 reset();room.action.accepting=false;room.accepted='RIGHT';hint();await createRoom();
 assert.deepEqual(events,['verified-owner','close','grade:one:RIGHT']);
 reset();room.state.qId=room.action.key='q1:step';room.action.kind='step';room.action.accepting=false;room.accepted='7';hint();await createRoom();
 assert.deepEqual(events,['verified-owner','close','move:one:7']);
 reset();room.action.accepting=false;room.state.pos.one=7;room.state.solid[0]=false;
 hint({move:{qId:'q1',who:'one',from:0,tile:7}});await createRoom();
 assert.deepEqual(events,['verified-owner','next'],'committed move is not repeated');assert.equal(G.pos.one,7);
 reset();room.action.accepting=false;room.state.solid[3]=false;await createRoom();
 assert.deepEqual(events,['verified-owner','close','replacement']);assert.equal(G.solid[3],false);assert.equal(room.run_id,'run-1');
 reset();room.phase='over';room.state.outOf.two=true;await createRoom();
 assert.equal(G.phase,'over');assert.equal($('wTitle').textContent,'Sam is still standing');
 assert.deepEqual(events,['verified-owner']);assert.equal($('againBtn').disabled,false);
 engineBusy=true;updateControls();assert.equal($('againBtn').disabled,true);
 engineBusy=false;G.phase='lobby';updateControls();assert.equal($('startBtn').disabled,false);
 starting=true;updateControls();assert.equal($('startBtn').disabled,true);
 console.log('Standing: canonical owned resume, frozen answer/step recovery, committed-move dedupe, missing-hint recovery and async controls passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
    result = subprocess.run(['node','-'], input=script, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    print(result.stdout.strip())


if __name__ == '__main__':
    import sys
    if sys.argv[1:] != ['--unit']:
        raise SystemExit('Use --unit for offline regressions; real-stack runner imports run(env).')
    unit_checks()
