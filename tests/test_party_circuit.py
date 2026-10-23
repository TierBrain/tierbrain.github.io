#!/usr/bin/env python3
"""Offline checks of Full Circuit's actual authenticated transition functions.

Node receives the source functions and an in-memory API/DOM boundary. No real
network request or production game data is involved; the SQL/HTTP suites check
the server independently.
"""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOSTS = ("full-circuit-host.html", "full-circuit-bible-host.html")
PHONES = ("full-circuit.html", "full-circuit-bible.html")


def between(source, start, end):
    return start + source.split(start, 1)[1].split(end, 1)[0]


NODE = r"""
const assert=require('node:assert/strict');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const nodes=new Map();
function $(id){if(!nodes.has(id)){const classes=new Set();nodes.set(id,{textContent:'',hidden:false,innerHTML:'',children:[{classList:{add(){}}}],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)}});}return nodes.get(id);}
"""


class CircuitPartyChecks(unittest.TestCase):
    def node(self, code):
        result = subprocess.run(
            ["node", "-"], input=NODE + "\n(async()=>{\n" + code
            + "\n})().catch(error=>{console.error(error);process.exitCode=1;});\n",
            text=True, capture_output=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def each_phone(self, fn):
        for name in PHONES:
            with self.subTest(page=name):
                fn((ROOT / name).read_text())

    def each_host(self, fn):
        for name in HOSTS:
            with self.subTest(page=name):
                fn((ROOT / name).read_text())

    def test_no_legacy_transport_and_solo_does_not_require_auth(self):
        for name in HOSTS + PHONES:
            source = (ROOT / name).read_text()
            self.assertNotIn("/rest/v1/", source)
            self.assertNotIn("fc_team_", source)
            self.assertNotIn("player_id:", source)
            self.assertLess(source.index('src="vendor/supabase.js"'), source.index('src="js/party-access.js"'))
            self.assertIn("family:'circuit',edition:ED==='bible'?'bible':'general'", source)
        for name in PHONES:
            source = (ROOT / name).read_text()
            self.assertLess(source.index("if(TEAM){"), source.index("PartyAccess.create("))
            self.assertEqual(source.count("PartyAccess.create("), 1)
            self.assertIn("teamAccess.membership(TEAM)", source)
            self.assertIn("teamAccess.heartbeat(TEAM)", source)
            self.assertIn("if(!currentStairs())return;", source)
        for name in ("full-circuit-bible.html", "full-circuit-bible-host.html"):
            self.assertIn("var ED = 'bible';", (ROOT / name).read_text())

    def test_stream_keeps_exact_request_and_sequence_after_unknown_ack(self):
        def check(source):
            functions = between(source, "  var acceptedEvent=", "  ['pickQuestion'")
            self.node(r"""
const TEAM='ROOM1',waits=[],calls=[],issues=[];let retries,fail=true,uid=0;
const TM={generation:1,queue:[],draining:false,deliveryError:null,nextEvent:0,window:'window-1',activity:'activity-1',run:'run-1',room:'switchboard',running:true};
const ROOMS={switchboard:{name:'Switchboard'}},eventData=r=>r.event,sameEvent=(r,p)=>Object.keys(p).every(k=>r.event[k]===p[k]);
function phoneIssue(text,retry){issues.push(text);if(retry)retries=retry;}
function teamWait(...args){waits.push(args);}
function deliveryMessage(){return 'Delivery is unconfirmed';}
function showCompletion(receipt){TM.completed=receipt;waits.push(['Result confirmed']);}
const teamAccess={uuid:()=>String(++uid),event:async(...args)=>{calls.push(JSON.parse(JSON.stringify(args)));if(fail){fail=false;throw {status:503};}return {window_id:args[2],activity_id:args[3],event_seq:args[4],event:args[5]};}};
""" + functions + r"""
emit({t:'q',q:'Question'});emit({t:'a',ok:true,r:1,w:0,q:'Question',c:'Answer'});
report({won:true,stats:'Five right',fuse:false},1);await tick();
assert.equal(calls.length,1,'later stream events must wait behind an uncertain acknowledgement');
assert.equal(TM.queue.length,3);assert.equal(TM.completed,undefined);
assert.equal(waits[0][0],'Saving the room result…');
retries();await tick();await tick();
assert.equal(calls.length,4);assert.deepEqual(calls[0],calls[1],'retry must preserve activity, sequence, payload and UUID');
assert.deepEqual(calls.map(c=>c[4]),[0,0,1,2]);assert.equal(TM.queue.length,0);
assert.equal(TM.completed.event.t,'done');assert.equal(waits.at(-1)[0],'Result confirmed');
assert.equal(new Set(calls.slice(1).map(c=>c[6])).size,3);
""")
        self.each_phone(check)

    def test_activity_start_retry_does_not_restart_twice_or_replay_completed_game(self):
        def check(source):
            functions = between(source, "  var beginActivity=", "  var abortRoom=")
            self.node(r"""
const TEAM='ROOM1',calls=[],launches=[],completions=[];let retry,uid=0,fail=true,completed=null;
const TM={generation:0},ROOMS={switchboard:{name:'Switchboard'}};
function phoneIssue(text,fn){if(fn)retry=fn;}function teamWait(){}function deliveryMessage(){return 'unconfirmed';}
function launchTeamRoom(state,generation){launches.push({state,generation});TM.starting=false;}
function showCompletion(receipt){completions.push(receipt);TM.starting=false;}
const teamAccess={uuid:()=>String(++uid),activityStart:async(...args)=>{calls.push(args);if(fail){fail=false;throw {status:503};}return {activity_id:'server-instance',next_event:0,completed};}};
""" + functions + r"""
const state={room:'switchboard',roomSeq:1},room={run_id:'run-1',action:{id:'window-1'}};
runTeamRoom(state,room);await tick();assert.equal(launches.length,0);assert.equal(TM.starting,true);
retry();retry();await tick();assert.equal(calls.length,2,'double retry click must not launch duplicate activity starts');
assert.deepEqual(calls[0],calls[1]);assert.equal(launches.length,1);
await beginActivity(TM.pendingStart||{generation:TM.generation,acknowledged:true});assert.equal(launches.length,1);
completed={window_id:'window-2',event:{t:'done',won:true,stats:'Accepted',fuse:false}};
runTeamRoom(state,{...room,action:{id:'window-2'}});await tick();
assert.equal(launches.length,1,'an accepted completion must not replay the local mini-game');assert.equal(completions.length,1);
""")
        self.each_phone(check)

    def test_old_activity_ack_cannot_remove_the_new_activity_queue(self):
        def check(source):
            functions = between(source, "  var acceptedEvent=", "  ['pickQuestion'")
            abort = between(source, "  var abortRoom=", "  var nameFrom=")
            self.node(r"""
const TEAM='ROOM1',calls=[],pending=[];let uid=0;
const TM={generation:1,queue:[],draining:false,nextEvent:0,window:'old-window',activity:'old-instance',run:'run-1',room:'switchboard',running:true};
const ROOMS={switchboard:{name:'Switchboard'}},SB={},GH={},OR={},SR={},DR={};
function cancelAnimationFrame(){}function phoneIssue(){}function teamWait(){}function deliveryMessage(){return 'unconfirmed';}function showCompletion(){throw new Error('Unexpected old completion');}
const sameEvent=(r,p)=>Object.keys(p).every(k=>r.event[k]===p[k]);
const teamAccess={uuid:()=>String(++uid),event:(...args)=>{calls.push(args);const value=deferred();pending.push(value);return value.promise;}};
""" + functions + abort + r"""
emit({t:'q',q:'Old question'});assert.equal(calls.length,1);abortRoom();
TM.window='new-window';TM.activity='new-instance';TM.run='run-2';TM.nextEvent=0;TM.running=true;
emit({t:'q',q:'New question'});assert.equal(calls.length,2);const current=TM.queue[0];
pending[0].resolve({event:calls[0][5]});await tick();
assert.equal(TM.queue[0],current,'late old acknowledgement cannot settle or remove a new assignment request');
pending[1].resolve({event:calls[1][5]});await tick();assert.equal(TM.queue.length,0);
""")
        self.each_phone(check)

    def test_host_stops_processing_a_receipt_batch_after_completion(self):
        def check(source):
            function = between(source, "async function followRoom(){", "async function roomOver(")
            self.node(r"""
const G={phase:'room',code:'ROOM1',cursor:0,player:'member-1'},completed=[];
const token={id:'room-1',run:'run-1',window:'window-1'};
function roomToken(){return token;}function sameAssignment(t){return t===token&&G.phase==='room';}
function nameOf(){return 'Player';}function esc(t){return t;}
async function roomOver(e,t){completed.push(e);G.phase='after';}
const access={busy:()=>false,message:()=>'',actions:async()=>[
 {id:1,event:{t:'q',q:'Current question'}},
 {id:2,q_id:'done',event:{t:'done',won:true}},
 {id:3,event:{t:'q',q:'MUST NOT RENDER AFTER DONE'}}]};
""" + function + r"""
await followRoom();assert.equal(completed.length,1);assert.equal(G.cursor,2);assert.equal($('mQ').textContent,'Current question');
""")
        self.each_host(check)

    def test_handoff_or_skip_closes_first_and_honours_accepted_completion(self):
        def check(source):
            function = between(source, "async function leaveRoomAssignment(skip){", "$('trHand').addEventListener")
            self.node(r"""
const G={phase:'room',code:'ROOM1',room:'switchboard',player:'member-1',poll:1,done:{},depth:0},ROOMS={switchboard:{name:'Switchboard',item:'Wire'}};
const token={},gate=deferred(),applied=[];let closed=false;
const access={busy:()=>false};function clearInterval(){}function roomToken(){return token;}function sameAssignment(t){return t===token&&G.phase==='room';}
async function closeAction(){const result=await gate.promise;closed=true;return result;}
function completionFrom(rows){return rows[0]?.event;}
async function roomOver(e,t,snapshot){assert.equal(closed,true);applied.push(e);G.phase='after';}
function pickPlayer(){throw new Error('Accepted result must win the handoff race');}function writeState(){throw new Error('Accepted result must win skip');}function show(){}function hostError(e){throw e;}
""" + function + r"""
const handing=leaveRoomAssignment(true);await tick();assert.equal(G.phase,'room');assert.equal(G.depth,0);
gate.resolve({actions:[{event:{t:'done',won:true}}]});await handing;
assert.equal(applied.length,1);assert.equal(applied[0].won,true);assert.equal(G.depth,0,'skip must not overwrite an accepted result');
""")
        self.each_host(check)

    def test_finale_timeout_waits_for_close_snapshot_before_grading(self):
        def check(source):
            function = between(source, "async function fnResolve(choice){", "async function fnEnd(")
            self.node(r"""
const token={},gate=deferred(),events=[];const G={phase:'finale',spark:'member-1',fq:{opts:['Paris','Rome']}};
const FN={live:true,pending:true,charge:0,target:10,step:1,right:0,shorts:0,t:15000,q:{correct:'Paris'}};
function roomToken(){return token;}function sameToken(t){return t===token;}function clearInterval(){}function nameOf(){return 'Player';}function fnPaint(){}
function setTimeout(fn){events.push('scheduled');}function fnLeap(){}function fnEnd(){throw new Error('Unexpected end');}function hostError(e){throw e;}
async function closeAction(){events.push('closing');return gate.promise;}
async function writeState(){assert.equal(G.fq,null);events.push('published-closed-display');}
""" + function + r"""
const resolving=fnResolve(null);await tick();assert.equal(FN.right,0);assert.notEqual(G.fq,null);
gate.resolve({actions:[{choice:'Paris'}]});await resolving;
assert.equal(FN.right,1,'accepted answer at timeout must come from the frozen server snapshot');
assert.equal(FN.shorts,0);assert.equal(FN.charge,1);assert.equal(G.spark,null);assert.equal(G.fq,null);
assert.deepEqual(events,['closing','published-closed-display','scheduled']);
""")
        self.each_host(check)

    def test_finale_unknown_delivery_retries_same_choice_and_uuid(self):
        def check(source):
            functions = between(source, "  var confirmFinal=", "  var reconcileReceipts=")
            self.node(r"""
const TEAM='ROOM1',calls=[],TM={finalPending:{run:'run-1',window:'window-1',choice:'Paris',request:'same-uuid'}};let retry,fail=true;
function phoneIssue(text,fn){if(fn)retry=fn;}function deliveryMessage(){return 'Delivery is unconfirmed';}
const teamAccess={submit:async(...args)=>{calls.push(args);if(fail){fail=false;throw {status:503};}return {window_id:'window-1',choice:'Paris'};}};
""" + functions + r"""
await sendFinal(TM.finalPending);assert.equal(TM.finalPending.confirmed,undefined);assert.match($('tqNote').textContent,/unconfirmed/);
retry();await tick();assert.deepEqual(calls[0],calls[1]);assert.equal(TM.finalPending.confirmed,true);assert.match($('tqNote').textContent,/confirmed/);
""")
        self.each_phone(check)

    def test_scheduled_room_start_cannot_advance_an_aborted_or_replaced_assignment(self):
        def check(source):
            helper = between(source, "function circuitRoomCallback(room, callback){", "\n/* ===")
            runs = "\n".join(between(source, start, end) for start, end in (
                ("function runSwitchboard(depth, done){", "function sbNext(){"),
                ("function runGlasshouse(depth, done){", "function ghNext(){"),
                ("function runOrrery(depth, done){", "function orNext(){"),
                ("function runStrongroom(depth, done){", "function srNext(){"),
                ("function runDarkRoom(depth, done){", "function drPlace(notes){"),
            ))
            abort = between(source, "  var abortRoom=", "  var nameFrom=")
            self.node(r"""
let TEAM='ABCDE';const TM={generation:1,running:true},H={items:[]};
const SB={},GH={board:{clientWidth:400}},OR={},SR={},DR={};
const jobs=[],frames=[],advances=[];
function setTimeout(fn){jobs.push(fn);}function requestAnimationFrame(fn){frames.push(fn);return frames.length;}
function cancelAnimationFrame(){}function show(){}function phoneIssue(){}function sbHome(){return {x:0,y:0};}function sbDraw(){}function ghSetPail(){}
function Tally(){this.right=0;this.wrong=0;}
function sbNext(){advances.push('switchboard');}function ghNext(){advances.push('glasshouse');}
function orNext(){advances.push('orrery');}function srNext(){advances.push('strongroom');}function drNext(){advances.push('darkroom');}
function scheduled(){while(frames.length)frames.shift()();assert.equal(jobs.length,1);return jobs.shift();}
""" + helper + runs + abort + r"""
for(const [name,room,run] of [['switchboard',SB,runSwitchboard],['glasshouse',GH,runGlasshouse],['orrery',OR,runOrrery],['strongroom',SR,runStrongroom],['darkroom',DR,runDarkRoom]]){
  advances.length=0;TM.running=true;run(0,()=>{});const oldState=room.st,oldStart=scheduled();
  abortRoom();assert.equal(oldState.cancelled,true);TM.running=true;
  run(0,()=>{});const currentStart=scheduled(),current=room.st;
  oldStart();assert.deepEqual(advances,[],name+': old start must not read the new room state');assert.equal(current.live,false);
  currentStart();assert.deepEqual(advances,[name],name+': current start must still run');
  // Instance identity protects same-room replacements even without a generation change.
  advances.length=0;run(0,()=>{});const replaced=scheduled();run(0,()=>{});const replacement=scheduled();
  replaced();assert.deepEqual(advances,[]);replacement();assert.deepEqual(advances,[name]);
  // A changed activity generation also cancels work when its room state remains.
  advances.length=0;run(0,()=>{});const staleGeneration=scheduled();TM.generation++;staleGeneration();assert.deepEqual(advances,[]);
  // Solo rooms need neither an Auth connection nor a running team activity.
  TEAM=null;TM.running=false;run(0,()=>{});const soloStart=scheduled();TM.generation++;soloStart();assert.deepEqual(advances,[name]);TEAM='ABCDE';
}
""")
        self.each_phone(check)

    def test_room_reveal_and_animation_callbacks_stop_after_handoff(self):
        def check(source):
            helper = between(source, "function circuitRoomCallback(room, callback){", "\n/* ===")
            functions = "\n".join(between(source, start, end) for start, end in (
                ("function sbSettle(){", "function runSwitchboard(depth, done){"),
                ("function sbResolve(i){", "function sbBurst(at){"),
                ("function ghSteer(lane){", "function ghTick(now){"),
                ("function ghCatch(d){", "/* the physical way:"),
                ("function orSettle(i, ms, then){", "function orStop(){"),
                ("function orResolve(i){", "$('lever').addEventListener"),
                ("function srChoose(o){", "function srTry(){"),
                ("function srResolve(right, timedOut){", "$('tryDoor').addEventListener"),
                ("function drResolve(i){", "/* sweep the torch:"),
            ))
            abort = between(source, "  var abortRoom=", "  var nameFrom=")
            self.node(r"""
let TEAM='ABCDE';const TM={generation:1,running:true},jobs=[],frames=[],advances=[];
const noop=()=>{},SFX=new Proxy({},{get:()=>noop}),H={fuse:false};let reduceMotion=false;
function setTimeout(fn){jobs.push(fn);}function requestAnimationFrame(fn){frames.push(fn);return frames.length;}
function cancelAnimationFrame(){}function phoneIssue(){}function actx(){}function say(){}function tone(){}function noise(){}function ghSplash(){}
function element(){return {className:'',textContent:'',style:{},setAttribute(){},classList:{add(){},remove(){}},querySelector(){return element();}};}
function $(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}
function tally(){return {right:0,wrong:0,hit(){this.right++;},mistake(){this.wrong++;return true;}};}
const SB={sockets:[element(),element(),element(),element()],plugPos:{x:0,y:0},swing:0,swingV:0},GH={board:{clientWidth:400},sky:{clientWidth:400,clientHeight:500},px:0},OR={theta:0,planets:[element(),element(),element(),element()]},SR={},DR={dark:element(),r:0};
function state(room){const st={live:true,ans:0,q:{correct:'A'},opts:['A'],tally:tally(),word:'A',wheels:[{el:element(),set:['A'],at:0,idx:0}],notes:[element()],drops:[{el:element(),right:true}],wired:false};room.st=st;return st;}
function sbHome(){return {x:1,y:1};}function sbDraw(){}function ghLaneX(){return 100;}function ghSetPail(x){GH.px=x;}
const SIGHT=1;function orDraw(){}function srPaintWheel(){}
function sbNext(){advances.push('sb');}function ghNext(){advances.push('gh');}function orNext(){advances.push('or');}function srNext(){advances.push('sr');}function drNext(){advances.push('dr');}
""" + helper + functions + abort + r"""
const reveals=[
  [SB,()=>sbResolve(0)],[GH,()=>ghCatch({lane:0,right:true,el:element()})],
  [GH,()=>ghMiss({})],[OR,()=>orResolve(0)],[SR,()=>srChoose('A')],
  [SR,()=>srResolve(true)],[DR,()=>drResolve(0)]
];
for(const [room,resolve] of reveals){
  jobs.length=frames.length=advances.length=0;TM.running=true;state(room);resolve();assert.equal(jobs.length,1);
  const delayed=jobs.shift();abortRoom();TM.running=true;const replacement=state(room);delayed();
  assert.equal(replacement.tally.right,0,'old reveal must not grade the new room');assert.deepEqual(advances,[]);assert.equal(jobs.length,0);assert.equal(frames.length,0);
}
// Switchboard has a second delayed transition inside its moving cable callback.
reduceMotion=true;TM.running=true;state(SB);sbResolve(0);jobs.shift()();assert.equal(jobs.length,1);
const nested=jobs.shift();abortRoom();TM.running=true;state(SB);nested();assert.deepEqual(advances,[]);
reduceMotion=false;
for(const [room,animate,read] of [
  [SB,done=>sbMove({x:99,y:99},300,done),()=>JSON.stringify(SB.plugPos)],
  [SB,()=>{SB.swing=8;sbSettle();},()=>SB.swing],
  [GH,()=>ghSteer(2),()=>GH.px],
  [OR,done=>orSettle(1,300,done),()=>OR.theta]
]){
  frames.length=0;TM.running=true;state(room);let completed=0;animate(()=>completed++);assert.equal(frames.length,1);
  const oldFrame=frames.shift(),before=read();abortRoom();TM.running=true;state(room);oldFrame(performance.now()+1000);
  assert.equal(read(),before,'old animation must not move the new assignment');assert.equal(completed,0);assert.equal(frames.length,0);
}
// The same protected animation completes normally for the current solo room.
state(SB);reduceMotion=false;let complete=0;TEAM=null;TM.running=false;sbMove({x:25,y:30},100,()=>complete++);
frames.shift()(performance.now()+200);assert.equal(complete,1);assert.equal(SB.plugPos.x,25);
""")
        self.each_phone(check)


if __name__ == "__main__":
    unittest.main()
