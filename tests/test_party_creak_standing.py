#!/usr/bin/env python3
"""Actual-function checks for secured Creak and Standing clients; no HTTP."""
from pathlib import Path
import json
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]


def function(source, name):
    """Extract the small tested function without executing either game engine."""
    match = re.search(r"(?m)^(?:async )?function " + name + r"\(", source)
    if not match:
        raise AssertionError(name)
    opening = source.index("{", match.end())
    depth, quote, comment, escape, i = 0, None, None, False, opening
    while i < len(source):
        char, following = source[i], source[i + 1:i + 2]
        if comment == "line":
            if char == "\n":
                comment = None
        elif comment == "block":
            if char == "*" and following == "/":
                comment, i = None, i + 1
        elif quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
        elif char in "'\"`":
            quote = char
        elif char == "/" and following in ("/", "*"):
            comment, i = ("line" if following == "/" else "block"), i + 1
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if not depth:
                return source[match.start():i + 1]
        i += 1
    raise AssertionError(name + " is not closed")


PHONE_HARNESS = r"""
const vm=require('node:vm'),assert=require('node:assert/strict');
class E{
 constructor(){this.children=[];this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};this.dataset={};this.value='';this.hidden=false;this._text='';this._html='';}
 appendChild(e){this.children.push(e);return e;}addEventListener(){}setAttribute(k,v){this[k]=v;}getAttribute(k){return this[k];}
 querySelectorAll(){return [];}remove(){}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(e=>e.textContent).join('');}
 set innerHTML(v){this._html=v;this._text='';this.children=[];}get innerHTML(){return this._html;}
}
const elements=new Map(),storage=new Map(),requests=[],intervals=[];let resolveSubmit,rejectSubmit,heartbeatCount=0,leaveResult={left:true};
const document={getElementById(id){if(!elements.has(id))elements.set(id,new E());return elements.get(id);},createElement(){return new E();},querySelectorAll(){return [];}};
const api={uuid:()=> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',savedPlayerCode:()=>'',rememberPlayer(){},message:error=>error&&error.message||'Connection failed',
 submit(code,run,window,choice,request){requests.push({code,run,window,choice,request});return new Promise((a,b)=>{resolveSubmit=a;rejectSubmit=b;});},
 heartbeat:async()=>{heartbeatCount++;},leave:async()=>leaveResult,
 playerState:async()=>null,membership:async()=>null};
const ctx=vm.createContext({document,PartyAccess:{create:()=>api},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},location:{search:'',hash:'',reload(){}},window:{},navigator:{},console,URLSearchParams,setTimeout,clearTimeout,setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},clearInterval,Map,Set,JSON,Date,Number,Promise,Array});
const run=source=>vm.runInContext(source,ctx);
const runId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',windowId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
"""


class PartyCreakStandingChecks(unittest.TestCase):
    def node(self, body):
        result = subprocess.run(
            ["node", "-"], input=body, text=True, capture_output=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_phone_pending_receipt_identical_retry_and_stale_response(self):
        for family, name in (("creak", "creak-multi-play.html"), ("standing", "standing-room-play.html")):
            with self.subTest(family=family):
                page = (ROOT / name).read_text()
                app = next(m[1] for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', page, re.S | re.I) if "PartyAccess.create" in m[1])
                state = {"phase": "live", "order": ["member-1"], "turn": 0, "turnIdx": 0, "qId": "q1", "q": {"q": "Fixture?", "opts": ["A", "B", "C", "D"]}}
                room = {"id": "r1", "phase": "live", "run_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "version": 1, "state": state,
                        "action": {"id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "accepting": True, "kind": "answer", "member_id": "member-1"}}
                setup = "vm.runInContext(" + json.dumps(app) + ",ctx);\n"
                setup += 'run("me={id:\'member-1\',code:\'ABCDE\',name:\'Fixture\'}");\n'
                setup += "run('latest='+" + json.dumps(json.dumps({"room": room, "members": [{"id": "member-1", "name": "Fixture"}], "receipts": []})) + "+';render()');\n"
                body = r"""
(async()=>{
 const pending=run("submitChoice('A')");assert.equal(run('currentRecord().state'),'pending');
 assert.equal(requests.length,1);assert.match(elements.get('partySubmission').textContent,/Sending/);
 run("submitChoice('B')");assert.equal(requests.length,1);
 rejectSubmit(Object.assign(new Error('Synthetic outage'),{status:503}));await pending;
 assert.equal(run('currentRecord().state'),'unknown');assert(!elements.get('partySubmission').textContent.includes('Move recorded'));
 const retry=run('attemptSubmission(currentRecord())');assert.deepEqual(requests[1],requests[0]);
 rejectSubmit(Object.assign(new Error('Turn closed'),{status:403,code:'42501'}));await retry;
 assert.equal(run('currentRecord().state'),'unknown');
 const check=run('attemptSubmission(currentRecord())');assert.deepEqual(requests[2],requests[0]);
 resolveSubmit({window_id:windowId,player_id:'member-1',choice:'A'});await check;
 assert.equal(run('currentRecord().state'),'confirmed');assert.match(elements.get('partySubmission').textContent,/Move recorded/);
 run('submissions.clear();restoreSubmissions()');assert.equal(run('currentRecord().state'),'unknown');
 run('reconcileReceipts('+JSON.stringify([{window_id:windowId,player_id:'member-1',choice:'A'}])+')');assert.equal(run('currentRecord().state'),'confirmed');
 run("latest.room.action={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',kind:'answer',member_id:'member-1',accepting:true};latest.room.version=2");
 const stale=run("submitChoice('B')");
 run("latest.room.action={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',kind:'answer',member_id:'member-1',accepting:true};latest.room.version=3;render()");
 resolveSubmit({window_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',player_id:'member-1',choice:'B'});await stale;
 assert.equal(run('currentRecord()'),null);assert.equal(elements.get('partySubmission').hidden,true);
 run("me={id:'member-2',code:'ABCDE',name:'Other'};submissions.clear();restoreSubmissions()");assert.equal(run('submissions.size'),0);
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
                self.node(PHONE_HARNESS + setup + body)

    def test_creak_roll_closes_once_before_resolution_and_ignores_stale_close(self):
        source = (ROOT / "creak-multi.html").read_text()
        fixture = r"""
const assert=require('node:assert/strict');
let room={run_id:'run-1',action:{id:'roll-1',kind:'roll',member_id:'p1',accepting:true}},hostGeneration=1,engineBusy=false,starting=false,releaseClose;
const G={code:'ABCDE',phase:'live',order:['p1'],turnIdx:0,turnStartedAt:Date.now()},TURN_TIMEOUT_MS=25000,calls=[];
const access={busy:()=>false,currentRoom:()=>room,actions:async()=>{calls.push('actions');return [{choice:'roll'}];},close:()=>{calls.push('close');return new Promise(resolve=>releaseClose=resolve);}};
function currentHost(run,generation){return room.run_id===run&&hostGeneration===generation;}
async function resolveTurn(id){calls.push('resolve:'+id);}function nameOf(){return 'Fixture';}function setStatus(){}
"""
        checks = r"""
(async()=>{
 const first=pollMoves();await Promise.resolve();await pollMoves();assert.deepEqual(calls,['actions','close']);
 assert.equal(engineBusy,true);releaseClose({actions:[{choice:'roll'}]});await first;assert.deepEqual(calls,['actions','close','resolve:p1']);assert.equal(engineBusy,false);
 calls.length=0;const old=pollMoves();await Promise.resolve();hostGeneration++;releaseClose({actions:[{choice:'roll'}]});await old;
 assert.deepEqual(calls,['actions','close']);assert.equal(engineBusy,false);
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        self.node(fixture + function(source, "pollMoves") + checks)

    def test_creak_each_question_kind_uses_closed_snapshot_before_clearing(self):
        source = (ROOT / "creak-multi.html").read_text()
        fixture = r"""
const assert=require('node:assert/strict');
let room={run_id:'run-1',action:null},hostGeneration=1;
const G={code:'ABCDE',phase:'live',qCounter:0,pendingQ:null},calls=[];
const access={currentRoom:()=>room,busy:()=>false,actions:async()=>{calls.push('read');return [{choice:'RIGHT'}];},close:async id=>{calls.push('close:'+id);return {actions:[{choice:closedChoice}]};}};
let closedChoice='RIGHT';function currentHost(run,generation){return room.run_id===run&&hostGeneration===generation;}
function pickQuestion(){return {q:'Fixture?',correct:'RIGHT',wrong:['WRONG','OTHER','NO']};}function shuffle(a){return a;}function timerFor(){return 10000;}
async function writeState(){calls.push(G.pendingQ?'publish:'+G.pendingQ.kind:'clear');if(G.pendingQ)room.action={id:G.pendingQ.qId,accepting:true,member_id:G.pendingQ.forPlayer};}
function showQOverlay(){}function tickQTimer(){}function hideQOverlay(){}function hostError(){}async function sleep(){}
"""
        checks = r"""
(async()=>{
 for(const kind of ['ladder','snake','rock','storm']){
  calls.length=0;closedChoice=kind==='rock'?'WRONG':'RIGHT';const result=await askQuestionFor('p1',kind,10);
  assert.equal(result,closedChoice==='RIGHT');assert.equal(calls[0],'publish:'+kind);assert(calls.indexOf('close:q'+G.qCounter)<calls.indexOf('clear'));
  assert.equal(G.pendingQ,null);assert.equal(G.pendingQCorrect,null);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        self.node(fixture + function(source, "askQuestionFor") + checks)

    def test_standing_close_ack_precedes_grading_or_step_and_blocks_overlap(self):
        source = (ROOT / "standing-room-multi.html").read_text()
        fixture = r"""
const assert=require('node:assert/strict');
let room={run_id:'run-1',action:{id:'answer-1',member_id:'p1',accepting:true}},hostGeneration=1,engineBusy=false,pollTimer=null,interval,releaseClose;
const G={code:'ABCDE',phase:'live',qId:'q1',outOf:{}},calls=[];
const access={currentRoom:()=>room,busy:()=>false,actions:async()=>{calls.push('actions');return [{choice:'OLD'}];},members:async()=>[{id:'p1'}],close:()=>{calls.push('close');return new Promise(resolve=>releaseClose=resolve);}};
function currentHost(run,generation){return room.run_id===run&&hostGeneration===generation;}
function setInterval(fn){interval=fn;return 1;}function clearInterval(){}function hostError(error){throw error;}function paint(){}function nextTurn(){calls.push('next');}
async function resolveAnswer(who,choice){calls.push('answer:'+who+':'+choice);}async function stepTo(who,tile){calls.push('step:'+who+':'+tile);}
"""
        checks = r"""
(async()=>{
 await waitForWindow('p1',null,45000,900);const pending=interval();await Promise.resolve();await Promise.resolve();await interval();
 assert.deepEqual(calls,['actions','close']);assert.equal(engineBusy,true);
 releaseClose({actions:[{choice:'CANONICAL'}]});await pending;assert.deepEqual(calls,['actions','close','answer:p1:CANONICAL']);assert.equal(engineBusy,false);
 calls.length=0;room.action.id='step-1';G.qId='q1:step';await waitForWindow('p1',[3,4],30000,800);
 const step=interval();await Promise.resolve();await Promise.resolve();releaseClose({actions:[{choice:'4'}]});await step;
 assert.deepEqual(calls,['actions','close','step:p1:4']);
 calls.length=0;await waitForWindow('p1',null,45000,900);const stale=interval();await Promise.resolve();await Promise.resolve();hostGeneration++;
 releaseClose({actions:[{choice:'LATE'}]});await stale;assert.deepEqual(calls,['actions','close']);
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        self.node(fixture + function(source, "waitForWindow") + checks)

    def test_standing_answer_opens_step_only_after_confirmed_publication(self):
        source = (ROOT / "standing-room-multi.html").read_text()
        fixture = r"""
const assert=require('node:assert/strict');let releasePublish;
const G={q:{correct:'RIGHT'},qId:'q1'},calls=[];
const say={};function $(id){if(id==='qopts')return {children:[]};if(id==='say')return say;return {children:[{classList:{add(){}}},{classList:{add(){}}}]};}
function legal(){return [0,1];}function nameOf(){return 'Fixture';}function paint(){}function nextTurn(){}function waitForStep(who,opts){calls.push('wait:'+who+':'+opts.join(','));}
function writeState(){calls.push('publish:'+G.qId);return new Promise(resolve=>releasePublish=resolve);}
"""
        checks = r"""
(async()=>{
 const pending=resolveAnswer('p1','RIGHT');assert.deepEqual(calls,['publish:q1:step']);releasePublish();await pending;
 assert.deepEqual(calls,['publish:q1:step','wait:p1:0,1']);
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        self.node(fixture + function(source, "resolveAnswer") + checks)

    def test_both_play_again_paths_obtain_new_run_before_lobby_publication(self):
        for name in ("creak-multi.html", "standing-room-multi.html"):
            with self.subTest(page=name):
                source = (ROOT / name).read_text()
                fixture = r"""
const assert=require('node:assert/strict');let engineBusy=false,starting=false,hostGeneration=1,pollTimer=null,releaseRun,used={},usedTags=new Set();
const G={phase:'over',order:['old'],turn:2,seq:7},calls=[];
const access={busy:()=>false,beginRun:()=>{calls.push('begin');return new Promise(resolve=>releaseRun=resolve);}};
function $(id){return {classList:{add(){},remove(){}},style:{},innerHTML:''};}function clearInterval(){}function hideQOverlay(){}function renderLobby(){}function setStatus(){}
async function pollPlayers(){}async function writeState(){calls.push('publish:'+G.phase);}
"""
                checks = r"""
(async()=>{const pending=playAgain();assert.deepEqual(calls,['begin']);assert.equal(engineBusy,true);await playAgain();assert.deepEqual(calls,['begin']);
 releaseRun();await pending;assert.deepEqual(calls,['begin','publish:lobby']);assert.equal(engineBusy,false);assert.equal(hostGeneration,2);assert.equal(G.order.length,0);
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
                self.node(fixture + function(source, "playAgain") + checks)

    def test_no_legacy_transport_or_identity_restore_and_duplicate_host_retired(self):
        for name in ("creak-multi.html", "creak-multi-play.html", "standing-room-multi.html", "standing-room-play.html"):
            source = (ROOT / name).read_text()
            for legacy in ("/rest/v1/", "creak_multi_session", "sr_session", "player_id:me.id", "player_id:myId"):
                self.assertNotIn(legacy, source, name)
            self.assertLess(source.index('src="vendor/supabase.js"'), source.index("PartyAccess.create"))
            if "play.html" in name:
                self.assertIn("setInterval(beat,10000)", source)
                self.assertIn("await access.membership(saved)", source)
        standing = (ROOT / "standing-room-multi.html").read_text()
        self.assertIn("+esc(G.players[i].name)", standing)
        self.assertIn("+esc(nameOf(pid))", standing)
        duplicate = (ROOT / "creak-multi 5.html").read_text()
        self.assertIn("location.replace('creak-multi.html'+location.search+location.hash)", duplicate)
        self.assertNotIn("supabase", duplicate)


if __name__ == "__main__":
    unittest.main()
