#!/usr/bin/env python3
"""Offline client behavior checks for both authenticated Throne editions."""
from pathlib import Path
import json
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOSTS = ('throne.html', 'throne-bible.html')
PHONES = ('throne-play.html', 'throne-bible-play.html')


def section(source, start, end):
    return source[source.index(start):source.index(end, source.index(start))]


PRELUDE = r'''
const assert=require('node:assert/strict');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const elements=new Map(),stored=new Map(),timers=new Map();let nextTimer=1;
function element(){return {textContent:'',innerHTML:'',value:'',disabled:false,hidden:false,style:{setProperty(){}},children:[],handlers:new Map(),
 classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(name,handler){this.handlers.set(name,handler);},before(){},
 appendChild(node){this.children.push(node);return node;},replaceChildren(...nodes){this.children=nodes;},focus(){}};}
const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
 createElement(){return element();},createTextNode(text){return {textContent:text};},body:{appendChild(){},classList:{add(){},remove(){}}}};
const window={dispatchEvent(){},localStorage:null},navigator={},location={search:'?c=ABCDE',href:'https://tierbrain.test/throne.html'};
const localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};window.localStorage=localStorage;
const Event=function(){};
function setTimeout(fn){const id=nextTimer++;timers.set(id,fn);return id;}
function clearTimeout(id){timers.delete(id);}
'''


class ThroneClientChecks(unittest.TestCase):
    def node(self, source, checks, prelude=PRELUDE):
        result = subprocess.run(['node', '-'], input=prelude+'\n'+source+'\n(async()=>{\n'+checks+'\n})().catch(error=>{console.error(error);process.exitCode=1;});', text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)

    def test_editions_have_no_legacy_transport_or_browser_identity(self):
        for name in HOSTS+PHONES:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                self.assertNotIn('/rest/v1/', source)
                self.assertNotIn('async function sb(', source)
                self.assertNotIn('player_id:myId', source)
                self.assertNotIn('crypto.randomUUID', source)
                self.assertLess(source.index('src="vendor/supabase.js"'), source.index('ThroneAccess.create'))
                self.assertIn("const THRONE_EDITION='"+('bible' if 'bible' in name else 'general')+"';", source)

    def phone(self, name, checks):
        source=(ROOT/name).read_text()
        source=section(source,"const SB_URL=",'</script>').replace('\nrestoreMembership();','')
        stub=r'''
const calls=[];let behavior={};
const api={savedPlayerCode:()=>'',rememberPlayer:code=>calls.push(['remember',code]),message:error=>error.message||'Connection failed',
 preview:async code=>({code}),join:async(code,name)=>{calls.push(['join',code,name]);if(behavior.join)return behavior.join();return {id:'canonical-member',name:'Verified name'};},
 playerState:async()=>({phase:'lobby',state:{}}),heartbeat:async()=>{},membership:async()=>null,
 buzz:async(...args)=>{calls.push(['buzz',...args]);return behavior.buzz?behavior.buzz():{id:'receipt'};},
 answer:async(...args)=>{calls.push(['answer',...args]);return behavior.answer?behavior.answer():{choice:args[2]};},
 leave:async()=>{if(behavior.leave)return behavior.leave();}};
const ThroneAccess={create:()=>api};
'''
        self.node(stub+source, checks)

    def test_join_failure_does_not_claim_membership_and_success_uses_server_identity(self):
        for name in PHONES:
            with self.subTest(name=name):
                self.phone(name,r'''
$('codeIn').value='ABCDE';$('nameIn').value='Player';
behavior.join=()=>{throw Object.assign(new Error('Join rejected'),{status:403});};
await join();assert.equal(joined,false);assert.equal(myId,'');assert.match($('err').textContent,/Join rejected/);
behavior.join=null;await join();assert.equal(joined,true);assert.equal(myId,'canonical-member');assert.equal(myName,'Verified name');
assert.deepEqual(calls.filter(c=>c[0]==='join').at(-1),['join','ABCDE','Player']);
''')

    def test_submission_confirmation_and_unknown_retry_keep_original_choice(self):
        for name in PHONES:
            with self.subTest(name=name):
                self.phone(name,r'''
joined=true;code='ABCDE';myId='canonical-member';curQid='question-uuid';
lastState={phase:'live',qId:curQid,champ:{id:myId,name:'Player'},chal:{id:'opponent',name:'Other'},answerer:{id:myId},lockedOut:[],q:{q:'Question?',opts:['A','B','C','D']}};
let release;
behavior.answer=()=>new Promise(resolve=>release=resolve);
const pending=submit('answer',lastState,1);await flush();
assert.equal(submission('answer',curQid).status,'pending');assert.match(area().innerHTML,/Sending your answer/);assert.doesNotMatch(area().innerHTML,/Answer recorded/);
release({choice:1});await pending;assert.equal(submission('answer',curQid).status,'confirmed');assert.match(area().innerHTML,/Answer recorded/);
requests.clear();behavior.answer=()=>{throw Object.assign(new Error('Response interrupted'),{status:503});};
await submit('answer',lastState,2);assert.equal(submission('answer',curQid).status,'unknown');assert.match(area().innerHTML,/Confirmation unavailable/);
behavior.answer=null;await submit('answer',lastState,0);
assert.deepEqual(calls.filter(c=>c[0]==='answer').slice(-2),[['answer','ABCDE','question-uuid',2],['answer','ABCDE','question-uuid',2]]);
assert.equal(submission('answer',curQid).status,'confirmed');
''')

    def test_storage_confirmation_requires_server_receipt_and_leave_is_awaited(self):
        for name in PHONES:
            with self.subTest(name=name):
                self.phone(name,r'''
joined=true;code='ABCDE';myId='canonical-member';curQid='question-uuid';
stored.set(SUBMISSION_KEY,JSON.stringify([['ABCDE|question-uuid|answer',{kind:'answer',code:'ABCDE',question:curQid,choice:3,status:'confirmed'}]]));
restoreRequests();assert.equal(submission('answer',curQid).status,'unknown');
reconcileReceipts({receipts:{question_id:curQid,answer:{choice:3,created_at:'server-time'}}},{qId:curQid});
assert.equal(submission('answer',curQid).status,'confirmed');
behavior.leave=()=>{throw new Error('Leave failed');};await leave();assert.equal(joined,true);assert.ok(!calls.some(c=>c[0]==='remember'&&c[1]===''));
behavior.leave=null;await leave();assert.equal(joined,false);assert.ok(calls.some(c=>c[0]==='remember'&&c[1]===''));
''')

    def test_host_start_waits_once_and_persists_queue_before_first_question(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                start=section(source,'async function startGame(){','async function writeState(){')
                stub=r'''
const $=id=>document.getElementById(id);let starting=false,engineBusy=false,hostGeneration=1,finishedRun=null;
let G={phase:'lobby',qTotal:20,players:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}]},ANS_MS=4000,LIVE_ROOM=true;
const order=[],SFX={on(){},theme(){}},QUIPS={welcome:['Hello']};let release;
const access={busy:()=>false,beginRun:async cfg=>{order.push(['begin',cfg]);return new Promise(resolve=>release=resolve);},message:e=>e.message};
function livePlayers(){return G.players;}function lockRunSettings(){}function syncRoom(room){G.phase=room.phase;G.qTotal=room.state.qTotal;G.qIndex=0;}
function shuffle(a){return a;}function HS(){}function hostSay(){}function pick(a){return a[0];}function connectionNotice(){}
async function writeState(){order.push(['publish',G.queue.map(p=>p.id)]);}
async function nextQuestion(){order.push(['open',G.queue.map(p=>p.id)]);}
'''
                self.node(stub+start,r'''
const first=startGame();const second=startGame();await flush();assert.equal(order.length,1);assert.equal(starting,true);
release({phase:'lobby',state:{qTotal:20}});await Promise.all([first,second]);
assert.deepEqual(order.map(row=>row[0]),['begin','publish','open']);assert.deepEqual(order[1][1],['c']);assert.deepEqual(order[2][1],['c']);assert.equal(starting,false);
''')

    def test_host_tick_cannot_overlap_or_apply_a_replaced_room(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                functions=section(source,'async function pollPlayers(){','async function liveTick(){')
                stub=r'''
const $=id=>document.getElementById(id);let G={code:'ABCDE',phase:'lobby',players:[]},hostGeneration=0,tickBusy=false,engineBusy=false,roomOpening=false,starting=false,finalizing=false,queueIssue=false;
let reads=0,renders=0,release;
const access={busy:()=>false,members:async()=>{reads++;return new Promise(resolve=>release=resolve);},message:e=>e.message};
function connectionNotice(){}function renderLobby(){renders++;}function render(){renders++;}async function liveTick(){throw new Error('not live');}
'''
                self.node(stub+functions,r'''
const first=tick();await flush();assert.equal(reads,1);hostGeneration++;G.code='FGHIJ';release([{id:'old-player'}]);await first;
assert.equal(G.players.length,0);assert.equal(renders,0);assert.equal(tickBusy,false);
'''.replace('await flush();assert.equal(reads','await Promise.resolve();await flush();assert.equal(reads'))

    def test_host_grade_uses_canonical_stats_once_and_handoff_does_not_regrade(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                grade=section(source,'async function grade(choice){','async function win(')
                stub=r'''
let G={phase:'live',runId:'run',qId:'question',q:{correctIdx:1},champ:{id:'a',name:'A'},chal:{id:'b',name:'B'},streak:4,mode:'spine',answerer:{id:'a'}};
let hostGeneration=0,calls=[],result={room:{},outcome:'win',winner:{id:'a',name:'A'},stats:{streak:5}};
const access={grade:async(...args)=>{calls.push(args);return result;}};
function sameHost(){return true;}function syncRoom(){}function syncStats(stats){Object.assign(G,stats);}function render(){}
async function win(player,previous){calls.push(['visual',player.id,previous.streak,G.streak]);}async function bothMiss(){throw new Error('unexpected miss');}async function gradeFinale(){throw new Error('not finale');}
'''
                self.node(stub+grade,r'''
await grade(1);assert.deepEqual(calls,[['question','a',true],['visual','a',4,5]]);assert.equal(G.streak,5);
result={room:{},outcome:'handoff',winner:null,stats:{streak:5}};await grade(0);assert.equal(calls.length,3);assert.deepEqual(calls[2],['question','a',false]);
''')

    def test_canonical_streak_king_controls_ties_and_null_results(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                king=section(source,'function streakKing(){','async function bothMiss(){')
                stub="let G={bestStreak:{a:3,b:3},totalCorrect:{a:5,b:5},streakKing:{id:'b',name:'B',s:3}};function nameFor(id){return id.toUpperCase();}"
                self.node(stub+king, "assert.equal(streakKing().id,'b');G.streakKing=null;assert.equal(streakKing(),null);delete G.streakKing;assert.equal(streakKing().id,'a');")

    def test_early_end_does_not_claim_a_champion_and_leave_clears_hints(self):
        for name in PHONES:
            with self.subTest(name=name):
                self.phone(name,r'''
joined=true;code='ABCDE';myId='canonical-member';
render({phase:'gameover',winner:null});assert.match(area().innerHTML,/Run ended/);assert.doesNotMatch(area().innerHTML,/Champion!/);
requests.set('ABCDE|question|answer',{kind:'answer',code:'ABCDE',question:'question',choice:1,status:'unknown'});
await leave();assert.equal(requests.size,0);assert.deepEqual(JSON.parse(stored.get(SUBMISSION_KEY)),[]);
''')

    def test_host_liveness_uses_the_server_clock_estimate(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                clock=source[source.index('function gameNow(){'):source.index('\n',source.index('function gameNow(){'))]
                live=section(source,'function livePlayers(){','function isLive(')
                stub="const STALE_MS=32000;let G={players:[{id:'live',last_seen:'2026-01-01T00:00:00Z'},{id:'stale',last_seen:'2025-01-01T00:00:00Z'}]};const access={now:()=>Date.parse('2026-01-01T00:00:10Z')};Date.now=()=>Date.parse('2040-01-01T00:00:00Z');"
                self.node(stub+clock+live,"assert.deepEqual(livePlayers().map(p=>p.id),['live']);")

    def test_missing_main_seats_recover_from_live_queue_without_replacing_a_live_champion(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                prepare=section(source,'function prepareSeats(live){','async function serveQuestion(){')
                stub="let G={mode:'spine',champ:{id:'a',name:'A'},chal:{id:'b',name:'B'},queue:[{id:'c',name:'C'}]};"
                self.node(stub+prepare,r'''
const live=[{id:'b',name:'Verified B'},{id:'c',name:'Verified C'}];
assert.equal(prepareSeats(live),true);assert.equal(G.champ.id,'b');assert.equal(G.chal.id,'c');assert.deepEqual(G.queue,[]);
G={mode:'spine',champ:{id:'a'},chal:{id:'departed'},queue:[{id:'c'},{id:'b'}]};
assert.equal(prepareSeats([{id:'a',name:'A'},...live]),true);assert.equal(G.champ.id,'a');assert.equal(G.chal.id,'c');assert.deepEqual(G.queue.map(p=>p.id),['b']);
G={mode:'finale',champ:{id:'a'},chal:{id:'departed'},queue:[{id:'c'}]};
assert.equal(prepareSeats([{id:'a',name:'A'},...live]),false);assert.equal(G.chal.id,'departed');
''')

    def test_question_seat_conflict_refreshes_before_retrying_without_advancing_twice(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                serve=section(source,'function prepareSeats(live){','async function nextQuestion(){')
                stub=r'''
let G={code:'ABCDE',runId:'run',qId:'previous-question',qIndex:2,mode:'spine',champ:{id:'a'},chal:{id:'b'},queue:[{id:'c'}],players:[]};
const hostGeneration=1;let queueIssue=false,reads=0,picks=0,opens=[];
async function pollPlayers(){reads++;G.players=reads===1?[{id:'b',name:'B'},{id:'c',name:'C'}]:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];}
function livePlayers(){return G.players;}function sameHost(g,r){return g===hostGeneration&&r===G.runId;}
function pickQuestion(){picks++;return {q:'Question?',correct:'A',wrong:['B','C','D']};}function shuffle(a){return a;}
function syncRoom(room){Object.assign(G,room.state||{});G.phase=room.phase;G.runId=room.run_id;G.qId=room.q_id;}
function HS(){}function render(){}function connectionNotice(){}function scheduleStep(){throw new Error('Unexpected delay');}async function endWithoutWinner(){throw new Error('There are two live players');}
const access={
 async openQuestion(q){opens.push(JSON.parse(JSON.stringify(q)));if(opens.length===1)throw Object.assign(new Error('Champion returned'),{code:'PT412'});return {phase:'live',run_id:'run',q_id:'new-question',state:{champ:{id:q.champ_id},chal:{id:q.chal_id},queue:q.queue}};},
 async resumeHost(){return {phase:'between',run_id:'run',q_id:'previous-question',state:{champ:{id:'a'},chal:{id:'b'},queue:[{id:'c'}],qIndex:1,mode:'spine'}};}
};
'''
                self.node(stub+serve,r'''
await serveQuestion();assert.equal(reads,2);assert.equal(picks,1);assert.equal(opens.length,2);
assert.deepEqual(opens.map(q=>[q.champ_id,q.chal_id,q.qIndex]),[['b','c',2],['a','b',2]]);
assert.deepEqual(opens[1].queue.map(p=>p.id),['c']);assert.equal(G.runId,'run');assert.equal(G.qId,'new-question');
''')

    def test_question_count_controls_preserve_five_and_single_steps(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                step=source[source.index('function qStep(n){'):source.index('\n',source.index('function qStep(n){'))]
                listeners=section(source,"$('qMinus').addEventListener", "$('newBtn').addEventListener")
                stub="const $=id=>document.getElementById(id);let G={qTotal:20};"
                self.node(stub+step+listeners,r'''
$('qPlus').handlers.get('click')();assert.equal(G.qTotal,25);
$('qPlus').handlers.get('click')();assert.equal(G.qTotal,30);
$('qMinus').handlers.get('click')();assert.equal(G.qTotal,25);
$('qMinus').handlers.get('click')();assert.equal(G.qTotal,20);
$('qMinus').handlers.get('click')();assert.equal(G.qTotal,19);
''')

    def test_finale_delay_preserves_enabled_and_disabled_cutscenes(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                cuts=section(source,'  function cutsOn(){','  function playScene(')
                export=source[source.index('  window.ThroneHall ='):source.index('\n',source.index('  window.ThroneHall ='))]
                stub="const KEY_CUTS='tb-cutscenes-throne';function lsGet(key,fallback){return stored.get(key)??fallback;}function playScene(){};window.TBScenes={};"
                self.node(stub+cuts+export,"stored.set(KEY_CUTS,'1');assert(window.ThroneHall.finaleMs()>=5000);stored.set(KEY_CUTS,'0');assert(window.ThroneHall.finaleMs()<5000);")

    def test_last_question_banner_does_not_promise_another_challenger(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                after=section(source,'async function afterReveal(){','async function nextOrEnd(){')
                stub=r'''
let G={mode:'spine',outcome:'win',champ:{id:'a',name:'Alex'},chal:{id:'b',name:'Blair'},pendingLoser:{id:'b',name:'Blair'},queue:[{id:'c',name:'Casey'}],streak:2,qIndex:2,qTotal:3};
const BETWEEN_MS=2800;let messages=[];
function enqueue(player){if(player)G.queue.push(player);}function dequeue(){return G.queue.shift();}function esc(value){return value;}
async function writeState(){messages.push(G.betweenMsg);}function render(){}function scheduleStep(){}async function nextOrEnd(){}
async function endWithoutWinner(){throw new Error('Unexpected early end');}async function finishGame(){throw new Error('Not finale');}function scoreStr(){return '';}async function nextFinaleQuestion(){}
'''
                self.node(stub+after,r'''
await afterReveal();assert.match(messages.at(-1),/Next:/);
G.qIndex=G.qTotal;await afterReveal();assert.match(messages.at(-1),/last question/i);assert.doesNotMatch(messages.at(-1),/Next:/);
''')

    def test_delayed_transition_is_discarded_after_new_room(self):
        for name in HOSTS:
            with self.subTest(name=name):
                source=(ROOT/name).read_text()
                schedule=section(source,'function scheduleStep(callback,delay){','async function createRoom(){')
                stub=r'''
let G={runId:'run',_t:null},hostGeneration=0,engineBusy=false,called=0;
const access={message:e=>e.message};function connectionNotice(){}function sameHost(generation,run){return generation===hostGeneration&&run===G.runId;}
'''
                self.node(stub+schedule,r'''
scheduleStep(async()=>{called++;},1);const callback=timers.get(G._t);hostGeneration++;await callback();assert.equal(called,0);
''')

    def test_http_driver_rejects_nonlocal_endpoints_before_fetch(self):
        script=r'''
import assert from 'node:assert/strict';
process.env.SDK_FILE='vendor/supabase.js';process.env.ADAPTER_FILE='js/throne-access.js';let requests=0;
globalThis.fetch=()=>{requests++;throw new Error('Unexpected request');};
const denied=['https://auth:9999','http://example.com','http://name:password@auth:9999','http://auth:9999/path','http://auth:9999/?query=1','http://auth:9999/#fragment'];
for(let index=0;index<denied.length;index++){
 process.env.THRONE_AUTH_URL=denied[index];
 await assert.rejects(import('./tests/throne_stack/sdk-gameplay-acceptance.mjs?guard='+index),error=>error instanceof assert.AssertionError);
}
assert.equal(requests,0);
'''
        result=subprocess.run(['node','--input-type=module','-'],input=script,text=True,capture_output=True,timeout=20,cwd=ROOT)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_all_inline_scripts_parse(self):
        for name in HOSTS+PHONES:
            for script in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', (ROOT/name).read_text(), re.S):
                if not script.strip():continue
                result=subprocess.run(['node','--check','-'],input=script,text=True,capture_output=True,timeout=20)
                self.assertEqual(result.returncode,0,name+'\n'+result.stderr)


if __name__=='__main__':
    unittest.main()
