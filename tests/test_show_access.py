#!/usr/bin/env python3
"""Offline contract checks for Show's authenticated transport and host queue.

The official SDK boundary is replaced in memory. No request can leave Node;
database ownership and authorization are tested separately against PostgreSQL.
"""
from pathlib import Path
import json
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
HARNESS = r"""
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync(process.argv[2],'utf8');
const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function sandbox(options={}){
 const calls=[],authCalls=[],issues=[],store=new Map([
  ['cv_stage_room','LEGACY'],['cv_player',JSON.stringify({id:'forged-player',code:'LEGACY'})]
 ]);
 let sdkOptions=null;
 let room={id:'room-owned-by-server',code:'SYNTH',seed:123,phase:'lobby',version:0,run_id:null,state:{}};
 const sdk={auth:{
  async getSession(){authCalls.push('getSession');return {data:{session:null},error:null};},
  async signInAnonymously(){authCalls.push('signInAnonymously');return options.denySignup?{data:{},error:{code:'anonymous_provider_disabled',message:'Anonymous signups are disabled'}}:{data:{session:{access_token:'synthetic'}},error:null};},
  async getUser(){authCalls.push('getUser');return {data:{user:{id:'verified-by-auth-server',is_anonymous:true}},error:null};}
 },async rpc(name,args){
  const request=JSON.parse(JSON.stringify(args));calls.push({name,args:request});
  if(options.intercept){const result=await options.intercept(name,request,calls);if(result)return result;}
  if(name==='show_create_room')return {data:{...room},error:null,status:200};
  if(name==='show_begin_run'){
   assert.equal(request.p_expected_version,room.version);room={...room,version:room.version+1,run_id:run};
   return {data:{...room},error:null,status:200};
  }
  if(name==='show_host_publish'){
   assert.equal(request.p_expected_version,room.version);room={...room,...request.p_patch,version:room.version+1};
   return {data:{...room},error:null,status:200};
  }
  if(name==='show_close_submissions'){
   assert.equal(request.p_expected_version,room.version);room={...room,version:room.version+1};
   return {data:{room:{...room},answers:[]},error:null,status:200};
  }
  if(name==='show_award')return {data:{member_id:request.p_member_id,score:request.p_points,points:request.p_points},error:null,status:200};
  return {data:{id:'server-member',code:'SYNTH',name:'Player',tag:'youth',score:0},error:null,status:200};
 }};
 const window={crypto,localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
  supabase:{createClient:(url,key,opts)=>{sdkOptions=opts;return sdk;}},
  fetch:()=>{throw new Error('Unexpected real HTTP request');}};
 vm.runInNewContext(source,{window,AbortController,setTimeout,clearTimeout,console});
 const api=window.ShowAccess.create('https://synthetic.supabase.test','publishable-fixture');api.onIssue(issue=>issues.push(issue));
 return {api,calls,authCalls,issues,store,sdkOptions:()=>sdkOptions};
}
"""


class ShowAccessContractChecks(unittest.TestCase):
    def node(self, body):
        script = HARNESS + "\n(async()=>{\n" + body + "\n})().catch(error=>{console.error(error);process.exitCode=1;});\n"
        result = subprocess.run(
            ["node", "-", str(ROOT / "js/show-access.js")], input=script,
            text=True, capture_output=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_verified_guest_identity_and_new_storage_only(self):
        self.node(r"""
 const {api,calls,authCalls,sdkOptions}=sandbox();
 assert.equal(api.savedHostCode(),'');assert.equal(api.savedPlayerCode(),'');
 await api.preview('SYNTH');await api.join('SYNTH','Player','youth');
 await api.answer('SYNTH',run+':p0q0',2);await api.buzz('SYNTH',run+':p0q0');
 assert.deepEqual(authCalls,['getSession','signInAnonymously','getUser']);
 assert.equal(sdkOptions().auth.storageKey,'tb_show_auth_v1');
 assert.equal(sdkOptions().auth.autoRefreshToken,true);
 assert.deepEqual(calls.find(c=>c.name==='show_answer').args,{p_code:'SYNTH',p_question_key:run+':p0q0',p_choice:2});
 assert.deepEqual(calls.find(c=>c.name==='show_buzz').args,{p_code:'SYNTH',p_question_key:run+':p0q0'});
 for(const call of calls){assert.ok(!('p_user_id' in call.args));assert.ok(!('player_id' in call.args));}
 """)

    def test_host_mutations_are_serial_versioned_and_run_scoped(self):
        self.node(r"""
 const {api,calls}=sandbox();await api.createRoom();await api.beginRun();
 const question=api.questionKey('p0q0');assert.equal(question,run+':p0q0');
 await Promise.all([api.publish({phase:'question',q_id:question,state:{opts:['A','B','C','D']}}),api.publish({phase:'reveal',q_id:question,state:{correct:1}})]);
 const publications=calls.filter(c=>c.name==='show_host_publish');
 assert.deepEqual(publications.map(c=>c.args.p_expected_version),[1,2]);
 assert.ok(publications.every(c=>c.args.p_run_id===run));
 assert.notEqual(publications[0].args.p_request_id,publications[1].args.p_request_id);
 await api.close(question);await api.award(question,'server-member',10);
 assert.deepEqual(calls.slice(-2).map(c=>c.name),['show_close_submissions','show_award']);
 assert.equal(calls.at(-1).args.p_points,10);assert.ok(!('p_request_id' in calls.at(-1).args));
 assert.ok(!('score' in calls.at(-1).args));assert.equal(api.busy(),false);
 """)

    def test_ambiguous_host_failure_retries_identical_request_before_later_mutation(self):
        self.node(r"""
 let failed=false;
 const {api,calls,issues}=sandbox({intercept:async(name)=>{
  if(name==='show_host_publish'&&!failed){failed=true;return {data:null,error:{message:'Synthetic interrupted response'},status:503};}
 }});
 await api.createRoom();await api.beginRun();
 const first=api.publish({phase:'question',q_id:api.questionKey('p0q0'),state:{}});
 const second=api.publish({phase:'reveal',q_id:api.questionKey('p0q0'),state:{correct:0}});
 await tick();assert.equal(calls.filter(c=>c.name==='show_host_publish').length,1);
 assert.equal(api.busy(),true);assert.equal(issues.at(-1).canRetry,true);
 api.retry();await Promise.all([first,second]);
 const publications=calls.filter(c=>c.name==='show_host_publish');
 assert.equal(publications.length,3);assert.deepEqual(publications[0].args,publications[1].args);
 assert.equal(publications[2].args.p_expected_version,2);assert.equal(api.busy(),false);
 """)

    def test_conflicting_host_version_does_not_blindly_retry(self):
        self.node(r"""
 const {api,calls,issues}=sandbox({intercept:async(name)=>name==='show_host_publish'?{data:null,error:{code:'PT409',message:'Concurrent host change'},status:409}:null});
 await api.createRoom();await api.beginRun();
 api.publish({phase:'question',q_id:api.questionKey('p0q0'),state:{}});
 await tick();assert.equal(issues.at(-1).canRetry,false);
 api.retry();await tick();assert.equal(calls.filter(c=>c.name==='show_host_publish').length,1);
 assert.match(issues.at(-1).message,/extra host windows/i);
 """)

    def test_disabled_guest_auth_is_actionable_without_rpc_fallback(self):
        self.node(r"""
 const {api,calls,authCalls}=sandbox({denySignup:true});
 await assert.rejects(api.preview('SYNTH'),error=>/Guest access/.test(api.message(error)));
 assert.equal(calls.length,0);assert.deepEqual(authCalls,['getSession','signInAnonymously']);
 """)

    def test_host_has_no_legacy_table_transport_or_absolute_score_patch(self):
        source = (ROOT / "show.html").read_text()
        for legacy in ("/rest/v1/", "cv_stage_room", "players?id=", "score:ns"):
            self.assertNotIn(legacy, source)
        self.assertLess(source.index('src="vendor/supabase.js"'), source.index("ShowAccess.create"))
        self.assertEqual(source.count("G.curId=access.questionKey("), 3)

    def test_start_pending_suppresses_settings_and_initial_lobby_publications(self):
        source = (ROOT / "show.html").read_text()
        setters = "function setRoom(patch){" + source.split("function setRoom(patch){", 1)[1].split("// let the lobby", 1)[0]
        start = "async function startShow(){" + source.split("async function startShow(){", 1)[1].split("function startRoundByPtr(){", 1)[0]
        waiting = source.split("const _waitRoom=setInterval(function(){", 1)[1].split("}, 400);", 1)[0]
        fixture = r"""
let releaseBegin;
const state=sandbox({intercept:async name=>{if(name==='show_begin_run')await new Promise(resolve=>{releaseBegin=resolve;});}});
const access=state.api;await access.createRoom();let room=access.currentRoom();
const G={phase:'lobby',starting:false};let SHOW_ORDER=[],roundPublished=null,resets=0;
const window={},document={body:{classList:{add(){}}}},SFX={on(){},theme(){}},QUIPS={welcome:['welcome']},BIBLE_VERSION='NIV';
const _waitRoom=1;
function clearInterval(){}function resetShowRoom(){resets++;}
function teamName(tag){return tag==='youth'?'Chosen A':'Chosen B';}
function lockTeamEditor(){}function lockBibleVersion(){}function setBibleCredit(){}
function hostSay(){}function pick(a){return a[0];}function buildShowOrder(){return ['rapidfire'];}
function showBanner(){throw new Error('Unexpected start failure');}
function startRoundByPtr(){G.phase='round_intro';roundPublished=setRoom({phase:'round_intro',state:{round:'Round 1'}});}
"""
        checks = r"""
const starting=startShow();await tick();assert.equal(G.starting,true);
await writeRoom();checkInitialRoom();
assert.equal(resets,0);assert.equal(state.calls.filter(c=>c.name==='show_host_publish').length,0);
releaseBegin();await starting;await roundPublished;
const publications=state.calls.filter(c=>c.name==='show_host_publish');
assert.equal(publications.length,1);assert.equal(publications[0].args.p_run_id,run);
assert.equal(publications[0].args.p_expected_version,1);
assert.deepEqual(publications[0].args.p_patch.state.teams,{youth:'Chosen A',adult:'Chosen B'});
assert.equal(publications[0].args.p_patch.state.bible,'NIV');assert.equal(G.starting,false);
checkInitialRoom();assert.equal(resets,0,'late lobby initialization must not reset an active show');
"""
        self.node(fixture + setters + start + "function checkInitialRoom(){" + waiting + "}\n" + checks)

    def test_new_room_resets_controls_settings_and_guards_pending_engine_work(self):
        source = (ROOT / "show.html").read_text()
        setters = "function setRoom(patch){" + source.split("function setRoom(patch){", 1)[1].split("// let the lobby", 1)[0]
        reset = "function resetShowRoom(){" + source.split("function resetShowRoom(){", 1)[1].split("canOpenNewRoom=function(){", 1)[0]
        guard = source.split("canOpenNewRoom=function(){", 1)[1].split("};", 1)[0]
        fixture = r"""
const state=sandbox(),access=state.api;await access.createRoom();let room=access.currentRoom();
const G={phase:'round_scores',ptr:2,type:'verse',label:'Old round',qi:8,questions:[{}],curId:'old-question',
 deadline:100,introUntil:100,revealUntil:100,lastAnsPoll:100,paused:true,scored:true,
 buzz:{resolving:false},fc:{scored:true,phase:'reveal'}};
const elements=new Map();function $(id){if(!elements.has(id)){const classes=new Set();elements.set(id,{textContent:'',classList:{add:c=>classes.add(c),remove:(...cs)=>cs.forEach(c=>classes.delete(c)),contains:c=>classes.has(c)}});}return elements.get(id);}
for(const id of ['teamEdit','bibleEdit'])$(id).classList.add('hide');
const window={},document={body:{classList:{remove(){}}}},BIBLE_VERSION='NIV';let __stingBusy=false;
function setCompact(){}function showPanel(panel){assert.equal(panel,'join');}function applyTeamNames(){}function refreshLineup(){}
function teamName(tag){return tag==='youth'?'New A':'New B';}
"""
        checks = r"""
await resetShowRoom();
for(const id of ['pauseBtn','skipBtn','nextRoundBtn','closingBtn'])assert.equal($(id).classList.contains('hide'),true,id);
for(const id of ['startShow','teamEdit','bibleEdit'])assert.equal($(id).classList.contains('hide'),false,id);
assert.equal(G.phase,'lobby');assert.equal(G.ptr,-1);assert.equal(G.qi,0);assert.equal(G.curId,'');
assert.equal(G.questions.length,0);assert.equal(G.buzz,null);assert.equal(G.fc,null);assert.equal(G.paused,false);
assert.equal(G.lobbyRoomId,room.id);
const publication=state.calls.find(c=>c.name==='show_host_publish').args;
assert.equal(publication.p_code,'SYNTH');assert.equal(publication.p_run_id,null);
assert.equal(publication.p_patch.phase,'lobby');assert.equal(publication.p_patch.q_id,'');
assert.deepEqual(publication.p_patch.state.teams,{youth:'New A',adult:'New B'});assert.equal(publication.p_patch.state.bible,'NIV');
G.phase='question';assert.equal(canOpenNewRoom(),true,'stable game may be abandoned');
for(const flag of ['starting','finalizing']){G[flag]=true;assert.equal(canOpenNewRoom(),false,flag);G[flag]=false;}
G.phase='scoring';assert.equal(canOpenNewRoom(),false);G.phase='question';
for(const flag of ['resolving','closing']){G.buzz={[flag]:true};assert.equal(canOpenNewRoom(),false,flag);}G.buzz=null;
G.fc={scored:true,phase:'clue'};assert.equal(canOpenNewRoom(),false);
G.fc.phase='reveal';assert.equal(canOpenNewRoom(),true);G.fc=null;
__stingBusy=true;assert.equal(canOpenNewRoom(),false);__stingBusy=false;
const originalBusy=access.busy;access.busy=()=>true;assert.equal(canOpenNewRoom(),false);access.busy=originalBusy;
"""
        self.node(fixture + setters + reset + "function canOpenNewRoom(){" + guard + "}\n" + checks)

    def test_finale_blocks_room_switch_until_published_and_ignores_old_delayed_effects(self):
        source = (ROOT / "show.html").read_text()
        finale = "async function finaleShow(){" + source.split("async function finaleShow(){", 1)[1].split("function renderFinale(fin){", 1)[0]
        guard = source.split("canOpenNewRoom=function(){", 1)[1].split("};", 1)[0]
        fixture = r"""
let releaseRoster,releasePublication;
const G={phase:'round_scores',starting:false,finalizing:false,buzz:null,fc:null};
let room={id:'old-room',code:'SYNTH'},__stingBusy=false;
const classes=new Map();function $(id){if(!classes.has(id)){const set=new Set();classes.set(id,{classList:{add:c=>set.add(c),remove:c=>set.delete(c),contains:c=>set.has(c)}});}return classes.get(id);}
const access={busy:()=>false,gradingMembers:()=>new Promise(resolve=>releaseRoster=resolve)};
let celebrations=0;const window={},SFX={drumroll(){},cymbal(){celebrations++;},fanfare(){celebrations++;},applause(){celebrations++;}},QUIPS={finale:['finale']};
function setCompact(){}function showPanel(){}function renderFinale(){}function poll(){}function hostSay(){}function pick(a){return a[0];}
function setRoom(){return new Promise(resolve=>releasePublication=resolve);}
"""
        checks = r"""
const finalizing=finaleShow();assert.equal(G.finalizing,true);assert.equal(canOpenNewRoom(),false);
assert.equal($('closingBtn').classList.contains('hide'),true);
releaseRoster([]);await tick();assert.equal(G.finalizing,true);assert.equal(canOpenNewRoom(),false);
releasePublication();await finalizing;assert.equal(G.finalizing,false);assert.equal(canOpenNewRoom(),true);
assert.equal($('closingBtn').classList.contains('hide'),false);
room={id:'new-room',code:'FRESH'};G.phase='lobby';await new Promise(resolve=>setTimeout(resolve,1350));
assert.equal(celebrations,0,'old finale effects must not run in a new room');
"""
        self.node(fixture + finale + "function canOpenNewRoom(){" + guard + "}\n" + checks)

    def test_phone_acknowledgement_retry_reconnect_and_stale_response_states(self):
        html = (ROOT / "play.html").read_text()
        app = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S | re.I)[-1]
        harness = r"""
const vm=require('node:vm'),assert=require('node:assert/strict');
class E{
 constructor(){this.children=[];this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};this.dataset={};this.value='';this._t='';this._h='';}
 appendChild(c){this.children.push(c);return c;}addEventListener(){}setAttribute(){}
 set textContent(t){this._t=String(t);this.children=[];}get textContent(){return this._t+this.children.map(c=>c.textContent).join('');}
 set innerHTML(t){this._h=t;this._t='';this.children=[];}get innerHTML(){return this._h;}
}
const els=new Map(),store=new Map(),requests=[];let resolveAnswer,rejectAnswer;
const document={getElementById(id){if(!els.has(id))els.set(id,new E());return els.get(id);},createElement(){return new E();},createTextNode(t){let e=new E();e.textContent=t;return e;},querySelectorAll(){return [];}};
const api={savedPlayerCode:()=>'',rememberPlayer(){},message:e=>e.message||'Connection failed',
 answer(code,qid,choice){requests.push({code,qid,choice});return new Promise((a,b)=>{resolveAnswer=a;rejectAnswer=b;});},
 buzz:async(code,qid)=>({q_id:qid,player_id:'member-1'}),membership:async()=>null};
const ctx=vm.createContext({document,ShowAccess:{create:()=>api},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{search:'',hash:'',reload(){}},window:{},navigator:{},console,setTimeout,clearTimeout,setInterval:()=>1,clearInterval,Map,JSON,Date,Number,Promise,Array});
"""
        body = r"""
const run=s=>vm.runInContext(s,ctx),q=n=>'d96b154f-08cc-4e4e-9d67-fcc289762969:p0q'+n;
function room(n){run('latestRoom='+JSON.stringify({id:'r1',run_id:'d96b154f-08cc-4e4e-9d67-fcc289762969',version:n+1,phase:'question',q_id:q(n),state:{opts:['A','B','C','D']}})+';renderCurrentRoom();');}
(async()=>{
 run("me={id:'member-1',code:'ABCDE',name:'Synthetic',tag:'youth'}");room(0);
 const first=run("sendAnswer(1,['A','B','C','D'])");
 assert.equal(run('answered'),false);assert.equal(run("submission('answer',curQid).state"),'pending');
 run("sendAnswer(2,['A','B','C','D'])");assert.equal(requests.length,1);
 run("latestRoom.phase='reveal';latestRoom.state.correct=1;renderCurrentRoom()");
 assert(!els.get('playArea').textContent.includes('Correct!'));
 resolveAnswer({q_id:q(0),player_id:'member-1',choice:1});await first;
 assert.equal(run("submission('answer',curQid).state"),'confirmed');assert(els.get('playArea').textContent.includes('Correct!'));
 room(1);const second=run("sendAnswer(0,['A','B','C','D'])");
 rejectAnswer(Object.assign(new Error('Synthetic outage'),{status:503}));await second;
 assert.equal(run("submission('answer',curQid).state"),'unknown');assert.equal(run('answered'),false);
 run("sendAnswer(3,['A','B','C','D'])");assert.equal(requests.length,2);
 const denied=run("attemptSubmission(submission('answer',curQid))");assert.equal(requests.at(-1).choice,0);
 rejectAnswer(Object.assign(new Error('Room expired'),{status:403,code:'42501'}));await denied;
 assert.equal(run("submission('answer',curQid).state"),'unknown');assert(!els.get('playArea').textContent.includes('was not recorded'));
 const retry=run("attemptSubmission(submission('answer',curQid))");
 resolveAnswer({q_id:q(1),player_id:'member-1',choice:0});await retry;assert.equal(run("submission('answer',curQid).state"),'confirmed');
 room(2);const old=run("sendAnswer(2,['A','B','C','D'])");room(3);
 resolveAnswer({q_id:q(2),player_id:'member-1',choice:2});await old;
 assert.equal(run('curQid'),q(3));assert.equal(run('answered'),false);assert.equal(run('myChoice'),-1);
 run('submissions.clear();restoreSubmissionHints()');
 assert.equal(run("submission('answer',"+JSON.stringify(q(2))+").state"),'unknown');
 assert.equal(run("submission('answer',"+JSON.stringify(q(2))+").mayHaveCommitted"),true);
 run("me={id:'member-2',code:'ABCDE',name:'New Synthetic',tag:'youth'};renderCurrentRoom()");
 assert.equal(run("submission('answer',"+JSON.stringify(q(2))+")"),null);
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        script = harness + "\nvm.runInContext(" + json.dumps(app) + ",ctx);\n" + body
        result = subprocess.run(["node", "-"], input=script, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for legacy in ("/rest/v1/", "cv_player", "player_id:me.id"):
            self.assertNotIn(legacy, html)

    def test_actual_host_graders_close_before_awarding_active_members_once(self):
        source = (ROOT / "show.html").read_text()
        normal = source.split("async function closeQuestion(){", 1)[1].split("function nextQuestion(){", 1)[0]
        clues = source.split("async function closeClues(){", 1)[1].split("function nextCluesQuestion(){", 1)[0]
        for kind, function in (("normal", "async function closeQuestion(){" + normal),
                               ("clues", "async function closeClues(){" + clues)):
            with self.subTest(mode=kind):
                fixture = r"""
const events=[];
let room={code:'SYNTH',run_id:run};
const G={curId:run+':p0q0',questions:[{correct:1}],qi:0,scored:false,phase:'question',deadline:10000,win:8000,
 fc:{scored:false,phase:'clue',clueTimes:[0,6500,13000,19500,26000]}};
const access={currentRoom:()=>room,
 close:async question=>{events.push(['close',question]);return {room,answers:[
  {player_id:'active-correct',choice:1,created_at:'1970-01-01T00:00:02Z'},
  {player_id:'active-correct',choice:1,created_at:'1970-01-01T00:00:03Z'},
  {player_id:'left-player',choice:1,created_at:'1970-01-01T00:00:02Z'},
  {player_id:'active-wrong',choice:0,created_at:'1970-01-01T00:00:02Z'}]};},
 gradingMembers:async()=>{events.push(['roster']);return [{id:'active-correct'},{id:'active-wrong'}];},
 award:async(question,member,points)=>{events.push(['award',question,member,points]);return {points};}};
const window={},SFX={correct(){},wrong(){}},QUIPS={correct:['correct'],wrong:['wrong']},REVEAL=5000,CLUES_REVEAL=5000;
function setCompact(){}function renderReveal(){}function renderCluesStage(){}function hostSay(){}function pick(a){return a[0];}function liveState(){return {};}
function setRoom(patch){events.push(['publish',patch.phase]);return Promise.resolve();}
function writeCluesRoom(){events.push(['publish','fiveclues']);return Promise.resolve();}
function awardN(member,points){return access.award(G.curId,member,points);}
function poll(){}
"""
                invocation = "await closeQuestion();await closeQuestion();" if kind == "normal" else "await closeClues();await closeClues();"
                expected_points = 15 if kind == "normal" else 5
                checks = f"""
assert.deepEqual(events.slice(0,2).map(e=>e[0]),['close','roster']);
const awards=events.filter(e=>e[0]==='award');assert.equal(awards.length,1);
assert.deepEqual(awards[0],['award',run+':p0q0','active-correct',{expected_points}]);
assert.equal(events.filter(e=>e[0]==='close').length,1);
assert.ok(events.findIndex(e=>e[0]==='publish')>events.findIndex(e=>e[0]==='award'));
"""
                self.node(fixture + "\n" + function + "\n" + invocation + checks)


if __name__ == "__main__":
    unittest.main(verbosity=2)
