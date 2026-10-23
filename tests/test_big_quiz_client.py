#!/usr/bin/env python3
"""Offline runtime checks for The Big Quiz's authenticated client protocol."""
from pathlib import Path
import json
import re
import subprocess
import unittest

from test_show_access import HARNESS as SHOW_HARNESS


ROOT = Path(__file__).resolve().parents[1]
HARNESS = (SHOW_HARNESS.replace("'show_", "'bigquiz_")
           .replace("tb_show_", "tb_bigquiz_")
           .replace("window.ShowAccess", "window.BigQuizAccess"))


class BigQuizClientChecks(unittest.TestCase):
    def node(self, body):
        script = HARNESS + "\n(async()=>{\n" + body + "\n})().catch(error=>{console.error(error);process.exitCode=1;});\n"
        result = subprocess.run(
            ["node", "-", str(ROOT / "js/big-quiz-access.js")], input=script,
            text=True, capture_output=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_verified_identity_and_independent_edition_namespace(self):
        self.node(r"""
 const {api,calls,authCalls,sdkOptions,store}=sandbox();
 store.set('tb_show_host_room_v1','BIBLE');store.set('tb_show_player_room_v1','BIBLE');
 store.set('cv_stage_room_gen','LEGACY');store.set('cv_player_gen',JSON.stringify({id:'forged'}));
 assert.equal(api.savedHostCode(),'');assert.equal(api.savedPlayerCode(),'');
 await api.preview('SYNTH');await api.join('SYNTH','Player','youth');
 await api.answer('SYNTH',run+':p0q0',2);await api.buzz('SYNTH',run+':p0q0');
 assert.deepEqual(authCalls,['getSession','signInAnonymously','getUser']);
 assert.equal(sdkOptions().auth.storageKey,'tb_bigquiz_auth_v1');
 assert.equal(sdkOptions().auth.autoRefreshToken,true);
 assert.ok(calls.every(c=>c.name.startsWith('bigquiz_')));
 assert.deepEqual(calls.find(c=>c.name==='bigquiz_answer').args,{p_code:'SYNTH',p_question_key:run+':p0q0',p_choice:2});
 assert.deepEqual(calls.find(c=>c.name==='bigquiz_buzz').args,{p_code:'SYNTH',p_question_key:run+':p0q0'});
 assert.ok(calls.every(c=>!('p_user_id' in c.args)&&!('player_id' in c.args)&&!('score' in c.args)));
 await api.createRoom();api.rememberPlayer('SYNTH');
 assert.equal(store.get('tb_bigquiz_host_room_v1'),'SYNTH');assert.equal(store.get('tb_bigquiz_player_room_v1'),'SYNTH');
 assert.equal(store.get('tb_show_host_room_v1'),'BIBLE');assert.equal(store.get('cv_stage_room_gen'),'LEGACY');
 """)

    def test_host_serialization_versioned_run_and_identical_retry(self):
        self.node(r"""
 let failed=false;
 const {api,calls,issues}=sandbox({intercept:async name=>{
  if(name==='bigquiz_host_publish'&&!failed){failed=true;return {data:null,error:{message:'Synthetic interrupted response'},status:503};}
 }});
 await api.createRoom();await api.beginRun();const question=api.questionKey('p3q11');
 assert.equal(question,run+':p3q11');
 const one=api.publish({phase:'question',q_id:question,state:{teams:{youth:'Team A',adult:'Team B'}}});
 const two=api.publish({phase:'reveal',q_id:question,state:{correct:0}});
 await tick();assert.equal(api.busy(),true);assert.equal(issues.at(-1).canRetry,true);
 assert.equal(calls.filter(c=>c.name==='bigquiz_host_publish').length,1);
 api.retry();await Promise.all([one,two]);
 const publications=calls.filter(c=>c.name==='bigquiz_host_publish');
 assert.equal(publications.length,3);assert.deepEqual(publications[0].args,publications[1].args);
 assert.deepEqual(publications.map(c=>c.args.p_expected_version),[1,1,2]);
 assert.ok(publications.every(c=>c.args.p_run_id===run));
 assert.notEqual(publications[1].args.p_request_id,publications[2].args.p_request_id);
 await api.close(question);await api.award(question,'server-member',10);
 assert.deepEqual(calls.slice(-2).map(c=>c.name),['bigquiz_close_submissions','bigquiz_award']);
 assert.equal(calls.at(-1).args.p_points,10);assert.equal(api.busy(),false);
 """)

    def test_host_version_conflict_requires_recovery_without_blind_retry(self):
        self.node(r"""
 const {api,calls,issues}=sandbox({intercept:async name=>name==='bigquiz_host_publish'?{data:null,error:{code:'PT409',message:'Concurrent host change'},status:409}:null});
 await api.createRoom();await api.beginRun();api.publish({phase:'question',q_id:api.questionKey('p0q0'),state:{}});
 await tick();assert.equal(issues.at(-1).canRetry,false);api.retry();await tick();
 assert.equal(calls.filter(c=>c.name==='bigquiz_host_publish').length,1);
 assert.match(issues.at(-1).message,/extra host windows/i);
 """)

    def test_guest_signup_failure_cannot_fall_back_to_public_tables(self):
        self.node(r"""
 const {api,calls,authCalls}=sandbox({denySignup:true});
 await assert.rejects(api.preview('SYNTH'),error=>/Guest access/.test(api.message(error)));
 assert.equal(calls.length,0);assert.deepEqual(authCalls,['getSession','signInAnonymously']);
 """)

    def test_start_pending_does_not_publish_old_run_or_reset_game(self):
        source = (ROOT / "show-gen.html").read_text()
        setters = "function setRoom(patch){" + source.split("function setRoom(patch){", 1)[1].split("  function showPanel(", 1)[0]
        start = "async function startShow(){" + source.split("async function startShow(){", 1)[1].split("  function startRoundByPtr(){", 1)[0]
        waiting = source.split("const _waitRoom=setInterval(function(){", 1)[1].split("}, 400);", 1)[0]
        fixture = r"""
let releaseBegin;
const state=sandbox({intercept:async name=>{if(name==='bigquiz_begin_run')await new Promise(resolve=>{releaseBegin=resolve;});}});
const access=state.api;await access.createRoom();let room=access.currentRoom();
const G={phase:'lobby',starting:false};let SHOW_ORDER=[],roundPublished=null,resets=0;
const window={},document={body:{classList:{add(){},remove(){}}}},SFX={on(){},theme(){}},QUIPS={welcome:['welcome']};
function $(id){return {textContent:''};}function hideBanner(){}function saveShow(){}
const _waitRoom=1;
function clearInterval(){}function resetShowRoom(){resets++;}
function hostSay(){}function pick(a){return a[0];}function buildShowOrder(){return ['rapidfire'];}
function showBanner(){throw new Error('Unexpected start failure');}
function startRoundByPtr(){G.phase='round_intro';roundPublished=setRoom({phase:'round_intro',state:{round:'Round 1'}});}
"""
        checks = r"""
const starting=startShow();await tick();assert.equal(G.starting,true);
await setRoom({phase:'lobby'});checkInitialRoom();
assert.equal(resets,0);assert.equal(state.calls.filter(c=>c.name==='bigquiz_host_publish').length,0);
releaseBegin();await starting;await roundPublished;
const publications=state.calls.filter(c=>c.name==='bigquiz_host_publish');
assert.equal(publications.length,1);assert.equal(publications[0].args.p_run_id,run);
assert.equal(publications[0].args.p_expected_version,1);
assert.deepEqual(publications[0].args.p_patch.state.teams,{youth:'Team A',adult:'Team B'});
assert.ok(!('bible' in publications[0].args.p_patch.state));assert.equal(G.starting,false);
checkInitialRoom();assert.equal(resets,0);
"""
        self.node(fixture + setters + start + "function checkInitialRoom(){" + waiting + "}\n" + checks)

    def test_new_room_reset_and_guards_cover_pending_engine_operations(self):
        source = (ROOT / "show-gen.html").read_text()
        setters = "function setRoom(patch){" + source.split("function setRoom(patch){", 1)[1].split("  function showPanel(", 1)[0]
        reset = "function resetShowRoom(){" + source.split("function resetShowRoom(){", 1)[1].split("  canOpenNewRoom=function(){", 1)[0]
        guard = source.split("canOpenNewRoom=function(){", 1)[1].split("};", 1)[0]
        fixture = r"""
const state=sandbox(),access=state.api;await access.createRoom();let room=access.currentRoom();
const G={phase:'round_scores',ptr:2,type:'verse',label:'Old round',qi:8,questions:[{}],curId:'old-question',
 deadline:100,introUntil:100,revealUntil:100,lastAnsPoll:100,paused:true,scored:true,
 buzz:{resolving:false},fc:{scored:true,phase:'reveal'}};
const elements=new Map();function $(id){if(!elements.has(id)){const classes=new Set();elements.set(id,{textContent:'',classList:{add:c=>classes.add(c),remove:(...cs)=>cs.forEach(c=>classes.delete(c)),contains:c=>classes.has(c)}});}return elements.get(id);}
const window={},document={body:{classList:{remove(){}}}};let __stingBusy=false;
function setCompact(){}function showPanel(panel){assert.equal(panel,'join');}function refreshLineup(){}
function saveShow(){}
"""
        checks = r"""
await resetShowRoom();
for(const id of ['pauseBtn','skipBtn','nextRoundBtn','closingBtn'])assert.equal($(id).classList.contains('hide'),true,id);
assert.equal($('startShow').classList.contains('hide'),false);
assert.equal(G.phase,'lobby');assert.equal(G.ptr,-1);assert.equal(G.qi,0);assert.equal(G.curId,'');
assert.equal(G.questions.length,0);assert.equal(G.buzz,null);assert.equal(G.fc,null);assert.equal(G.paused,false);
assert.equal(G.lobbyRoomId,room.id);
const publication=state.calls.find(c=>c.name==='bigquiz_host_publish').args;
assert.equal(publication.p_run_id,null);assert.equal(publication.p_patch.phase,'lobby');
assert.deepEqual(publication.p_patch.state.teams,{youth:'Team A',adult:'Team B'});assert.ok(!('bible' in publication.p_patch.state));
G.phase='question';assert.equal(canOpenNewRoom(),true);
for(const flag of ['starting','finalizing']){G[flag]=true;assert.equal(canOpenNewRoom(),false,flag);G[flag]=false;}
G.phase='scoring';assert.equal(canOpenNewRoom(),false);G.phase='question';
for(const flag of ['resolving','closing']){G.buzz={[flag]:true};assert.equal(canOpenNewRoom(),false,flag);}G.buzz=null;
G.fc={scored:true,phase:'clue'};assert.equal(canOpenNewRoom(),false);
G.fc.phase='reveal';assert.equal(canOpenNewRoom(),true);G.fc=null;
__stingBusy=true;assert.equal(canOpenNewRoom(),false);__stingBusy=false;
const originalBusy=access.busy;access.busy=()=>true;assert.equal(canOpenNewRoom(),false);access.busy=originalBusy;
"""
        self.node(fixture + setters + reset + "function canOpenNewRoom(){" + guard + "}\n" + checks)

    def test_clients_have_no_legacy_table_transport_or_browser_owned_identity(self):
        host = (ROOT / "show-gen.html").read_text()
        phone = (ROOT / "play-gen.html").read_text()
        for page in (host, phone):
            self.assertNotIn("/rest/v1/", page)
            self.assertNotIn("cv_stage_room_gen", page)
            self.assertNotIn("cv_player_gen", page)
            self.assertLess(page.index('src="vendor/supabase.js"'), page.index("BigQuizAccess.create"))
        self.assertEqual(host.count("G.curId=access.questionKey("), 3)
        self.assertNotIn("BIBLE_VERSION", host)
        self.assertIn("'cv_rounds_gen'", host)
        self.assertIn("playSting('bigquiz', startShow)", host)
        self.assertIn("tb_bigquiz_submissions_v1", phone)
        self.assertNotIn("tb_show_submissions_v1", phone)
        for html_id in ("connectionStatus", "connectionRetry", "teamBtnYouth", "teamBtnAdult"):
            self.assertEqual(len(re.findall(r'\bid="'+html_id+r'"', phone)), 1)

    def test_reload_checkpoint_matches_canonical_question_and_typed_clocks(self):
        source = (ROOT / "show-gen.html").read_text()
        match = "function checkpointMatches(game){" + source.split("function checkpointMatches(game){", 1)[1].split("  function saveShow(){", 1)[0]
        self.node(r"""
const q={kind:'mc',q:'Canonical question?',opts:['A','B','C','D'],correct:2};
let room={state:{qkind:'mc',qtext:q.q,opts:q.opts}};
function liveState(x){return {qkind:x.kind,qtext:x.q};}
const game={phase:'question',qi:0,questions:[q],deadline:100,introUntil:0,revealUntil:0,win:8000,paused:true};
""" + match + r"""
assert.equal(checkpointMatches(game),true);
for(const value of [null,undefined,'100',NaN,Infinity,-1,0]){
 const altered={...game,deadline:value};assert.equal(checkpointMatches(altered),false,String(value));
}
for(const patch of [{q:'Other question?'},{kind:'verse-ref'},{opts:['D','C','B','A']}]){
 assert.equal(checkpointMatches({...game,questions:[{...q,...patch}]}),false);
}
room.state.correct=2;assert.equal(checkpointMatches({...game,phase:'reveal',revealUntil:200}),true);
assert.equal(checkpointMatches({...game,phase:'reveal',revealUntil:200,questions:[{...q,correct:1}]}),false);
""")


if __name__ == "__main__":
    unittest.main()
