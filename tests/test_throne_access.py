#!/usr/bin/env python3
"""Offline transport boundary checks; actual Auth/SQL acceptance is separate."""
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]
HARNESS=r'''
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.argv[2],'utf8'),crypto=require('node:crypto').webcrypto;
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function fixture(edition='general',options={}){
 const calls=[],auth=[],issues=[],store=new Map(),configs=[];
 let state={id:'owned-room',code:'ABCDE',edition,phase:'lobby',run_id:null,q_id:null,version:0,state:{},server_now:options.serverNow};
 const sdk={auth:{
  async getSession(){auth.push('session');return {data:{session:options.stored?{access_token:'fixture-only'}:null},error:null};},
  async signInAnonymously(){auth.push('signup');return {data:{},error:options.signupError||null};},
  async getUser(){auth.push('user');return {data:{user:options.userError?null:{id:'verified-auth-id'}},error:options.userError||null};}
 },async rpc(name,args){
  const input=JSON.parse(JSON.stringify(args));calls.push({name,args:input});
  if(options.intercept){const result=await options.intercept(name,input,calls);if(result)return result;}
  assert.equal(input.p_edition,edition);
  if(name==='throne_create_room')return {data:{...state},status:200,error:null};
  if(name==='throne_begin_run')state={...state,run_id:'11111111-1111-4111-8111-111111111111'};
  if(name.startsWith('throne_host_')||name==='throne_begin_run'||name==='throne_finalize'){
   if('p_expected_version' in input){assert.equal(input.p_expected_version,state.version);state={...state,version:state.version+1};}
   if(name==='throne_host_open_question')state={...state,q_id:'22222222-2222-4222-8222-222222222222',phase:'live'};
   if(name==='throne_host_grade')return {data:{room:{...state},outcome:'win',stats:{streak:1}},status:200,error:null};
   if(name==='throne_finalize')return {data:{room:{...state},result:{streak:1}},status:200,error:null};
   return {data:{...state},status:200,error:null};
  }
  return {data:{id:'server-issued-member',name:'Canonical'},status:200,error:null};
 }};
 const window={crypto,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  supabase:{createClient:(url,key,config)=>{configs.push(config);return sdk;}},fetch:()=>{throw new Error('Network forbidden in offline test');}};
 vm.runInNewContext(source,{window,AbortController,setTimeout,clearTimeout});
 const api=window.ThroneAccess.create('https://fixture.supabase.test','fixture-publishable',edition);api.onIssue(issue=>issues.push(issue));
 return {api,calls,auth,issues,store,configs,window};
}
'''


class ThroneTransportChecks(unittest.TestCase):
    def node(self,body):
        script=HARNESS+'\n(async()=>{'+body+'\n})().catch(error=>{console.error(error);process.exitCode=1;});'
        p=subprocess.run(['node','-',str(ROOT/'js/throne-access.js')],input=script,text=True,capture_output=True,timeout=15)
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)

    def test_each_edition_has_distinct_verified_session_and_resume_hints(self):
        self.node(r'''
for(const edition of ['general','bible']){
 const {api,calls,auth,configs,store}=fixture(edition);
 await api.createRoom();await api.preview('ABCDE');api.rememberPlayer('ABCDE');
 assert.deepEqual(auth,['session','signup','user']);
 assert.equal(configs[0].auth.storageKey,'tb_throne_'+edition+'_auth_v1');
 assert.equal(configs[0].auth.autoRefreshToken,true);assert.equal(configs[0].auth.persistSession,true);
 assert.equal(api.savedHostCode(),'ABCDE');assert.equal(api.savedPlayerCode(),'ABCDE');
 assert.equal(store.has('tb_show_host_room_v1'),false);assert.equal(calls.every(c=>c.args.p_edition===edition),true);
}
''')

    def test_canonical_player_arguments_never_include_claimed_identity(self):
        self.node(r'''
const {api,calls}=fixture();await api.join('ABCDE','Name');await api.heartbeat('ABCDE');await api.leave('ABCDE');
await api.answer('ABCDE','22222222-2222-4222-8222-222222222222',2);await api.buzz('ABCDE','22222222-2222-4222-8222-222222222222');
assert.deepEqual(calls.find(c=>c.name==='throne_join').args,{p_code:'ABCDE',p_name:'Name',p_edition:'general'});
assert.deepEqual(calls.find(c=>c.name==='throne_answer').args,{p_code:'ABCDE',p_question_id:'22222222-2222-4222-8222-222222222222',p_choice:2,p_edition:'general'});
for(const call of calls)for(const field of ['p_user_id','p_member_id','player_id','name','tag','score','last_seen','created_at'])assert.equal(field in call.args,false);
''')

    def test_known_rolled_back_seat_conflict_releases_queue_for_fresh_request(self):
        self.node(r'''
let rejected=false;
const {api,calls,issues}=fixture('general',{intercept:async(name)=>{
 if(name==='throne_host_open_question'&&!rejected){rejected=true;return {data:null,status:412,error:{code:'PT412',message:'Seats changed'}};}
}});
await api.createRoom();await api.beginRun({qTotal:3,answerMs:4000,live:true});
await assert.rejects(api.openQuestion({q:'Question'}),error=>error.code==='PT412');
assert.equal(api.busy(),false);assert.equal(issues.some(issue=>issue.error),false);
await api.openQuestion({q:'Question'});
const opens=calls.filter(call=>call.name==='throne_host_open_question');
assert.equal(opens.length,2);assert.notEqual(opens[0].args.p_request_id,opens[1].args.p_request_id);
assert.equal(opens[0].args.p_expected_version,opens[1].args.p_expected_version);
''')

    def test_host_sequence_versions_and_unique_requests_adopt_nested_room_results(self):
        self.node(r'''
const {api,calls}=fixture();await api.createRoom();await api.beginRun({qTotal:3,answerMs:4000,live:true});
await api.publish({phase:'lobby',state:{queue:[]}});await api.openQuestion({q:'Question',opts:['A','B','C','D'],champ_id:'a',chal_id:'b',mode:'spine',qIndex:1});
await api.selectBuzz(api.currentRoom().q_id);await api.grade(api.currentRoom().q_id,'a',false);await api.finalize('b',null);
const requests=calls.filter(c=>'p_expected_version' in c.args);
assert.deepEqual(requests.map(c=>c.args.p_expected_version),[0,1,2,3,4,5]);
assert.equal(new Set(requests.map(c=>c.args.p_request_id)).size,6);assert.equal(api.currentRoom().version,6);
assert.equal(api.busy(),false);
''')

    def test_uncertain_host_request_retries_exact_payload_before_next_mutation(self):
        self.node(r'''
let failed=false;const {api,calls,issues}=fixture('bible',{intercept:async name=>{
 if(name==='throne_host_publish'&&!failed){failed=true;return {error:{message:'Unknown fixture outcome'},status:503,data:null};}
}});await api.createRoom();await api.beginRun({qTotal:3,answerMs:4000,live:true});
const first=api.publish({phase:'lobby',state:{queue:[]}}),next=api.publish({phase:'lobby',state:{queue:[]}});
await tick();assert.equal(api.busy(),true);assert.equal(issues.at(-1).canRetry,true);assert.equal(calls.filter(c=>c.name==='throne_host_publish').length,1);
api.retry();await Promise.all([first,next]);const writes=calls.filter(c=>c.name==='throne_host_publish');
assert.equal(writes.length,3);assert.deepEqual(writes[0].args,writes[1].args);assert.equal(writes[2].args.p_expected_version,2);
''')

    def test_conflicting_version_is_terminal_and_cannot_blindly_retry(self):
        self.node(r'''
const {api,calls,issues}=fixture('general',{intercept:async name=>name==='throne_host_publish'?{data:null,error:{code:'PT409',message:'Stale host version'},status:409}:null});
await api.createRoom();api.publish({phase:'lobby',state:{}});await tick();assert.equal(issues.at(-1).canRetry,false);
api.retry();await tick();assert.equal(calls.filter(c=>c.name==='throne_host_publish').length,1);assert.match(issues.at(-1).message,/extra host windows/);
''')

    def test_stored_session_is_verified_and_auth_failure_never_falls_back_to_rest(self):
        self.node(r'''
const {api,calls,auth}=fixture('general',{stored:true,userError:{message:'Expired fixture JWT',status:401}});
await assert.rejects(api.preview('ABCDE'));assert.deepEqual(auth,['session','user']);assert.equal(calls.length,0);
assert.match(api.message({status:401,message:'Expired fixture JWT'}),/Reload/);
''')

    def test_server_clock_calibration_uses_fresh_reads_after_replayed_timestamp(self):
        self.node(r'''
let failed=false;const {api,calls}=fixture('general',{serverNow:42000,intercept:async name=>{
 if(name==='throne_host_publish'&&!failed){failed=true;return {error:{message:'Unknown fixture outcome'},status:503,data:null};}
}});
await api.createRoom();assert.ok(Math.abs(api.now()-42000)<1000);
await api.beginRun({qTotal:3,answerMs:4000,live:true});
const pending=api.publish({phase:'lobby',state:{queue:[]}});await tick();api.retry();await pending;
assert.ok(calls.some(c=>c.name==='throne_host_resume'));
assert.ok(Math.abs(api.now()-42000)<1000,'a replay must not align to the device wall clock');
''')


if __name__=='__main__':unittest.main()
