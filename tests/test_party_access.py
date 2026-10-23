#!/usr/bin/env python3
"""Offline Party SDK/transport contracts; no real HTTP or database writes."""
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]
HARNESS=r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync(process.argv[2],'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function fixture(options={}){
 const store=new Map([['creak_multi_session',JSON.stringify({code:'LEGAC',playerId:'forged'})]]),calls=[],auth=[],issues=[];let settings=null;
 let room={id:'room',code:'FRESH',family:'creak',edition:'general',phase:'lobby',run_id:null,version:0,state:{},action:null};
 const sdk={auth:{
  async getSession(){auth.push('session');return {data:{session:options.restored?{}:null},error:null};},
  async signInAnonymously(){auth.push('signup');return options.deny?{data:{},error:{code:'anonymous_provider_disabled',message:'Anonymous signups are disabled'}}:{data:{},error:null};},
  async getUser(){auth.push('user');return {data:{user:{id:'verified-auth-id'}},error:null};}
 },async rpc(name,args){
  calls.push({name,args:JSON.parse(JSON.stringify(args))});
  if(options.intercept){const handled=await options.intercept(name,args,calls);if(handled)return handled;}
  if(name==='party_create_room')return {data:{...room},error:null,status:200};
  if(name==='party_begin_run'){assert.equal(args.p_expected_version,room.version);room={...room,run_id:'server-run',version:room.version+1};return {data:{...room},error:null,status:200};}
  if(name==='party_host_publish'){assert.equal(args.p_expected_version,room.version);assert.equal(args.p_run_id,room.run_id);room={...room,...args.p_patch,version:room.version+1,action:{id:'server-window',kind:'roll'}};return {data:{...room},error:null,status:200};}
  if(name==='party_host_close'){room={...room,version:room.version+1,action:{...room.action,accepting:false}};return {data:{room:{...room},actions:[]},error:null,status:200};}
  return {data:{id:'server-member',code:'FRESH',choice:args.p_choice},error:null,status:200};
 }};
 const window={crypto,supabase:{createClient:(url,key,opts)=>{settings=opts;return sdk;}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},fetch:()=>{throw Error('Real HTTP forbidden');}};
 vm.runInNewContext(source,{window,AbortController,setTimeout,clearTimeout});
 const api=window.PartyAccess.create('https://synthetic.test','publishable-fixture',{family:'creak',edition:'general'});api.onIssue(i=>issues.push(i));
 return {api,calls,auth,issues,store,settings:()=>settings,window};
}
'''
class PartyTransportChecks(unittest.TestCase):
 def node(self,body):
  script=HARNESS+'\n(async()=>{'+body+'\n})().catch(e=>{console.error(e);process.exitCode=1;});'
  result=subprocess.run(['node','-',str(ROOT/'js/party-access.js')],input=script,text=True,capture_output=True,timeout=20)
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
 def test_guest_identity_edition_routing_and_no_legacy_restore(self):
  self.node(r'''
 const {api,calls,auth,settings}=fixture();assert.equal(api.savedHostCode(),'');assert.equal(api.savedPlayerCode(),'');
 await api.join('FRESH','Player');await api.submit('FRESH','server-run','server-window','roll');
 assert.deepEqual(auth,['session','signup','user']);assert.equal(settings().auth.storageKey,'tb_party_creak_general_auth_v1');
 assert.ok(calls.every(c=>c.args.p_family==='creak'&&c.args.p_edition==='general'));
 assert.deepEqual(calls.at(-1).args,{p_family:'creak',p_edition:'general',p_code:'FRESH',p_run_id:'server-run',p_window_id:'server-window',p_choice:'roll',p_request_id:calls.at(-1).args.p_request_id});
 for(const c of calls){assert.ok(!('player_id'in c.args));assert.ok(!('p_user_id'in c.args));assert.ok(!('score'in c.args));}
 ''')
 def test_verified_existing_session_skips_signup(self):
  self.node(r"const {api,auth}=fixture({restored:true});await api.ready();assert.deepEqual(auth,['session','user']);")
 def test_optional_appearance_uses_own_authenticated_heartbeat(self):
  self.node(r'''
 const {api,calls}=fixture();await api.heartbeat('FRESH');const look={c:7,s:4,h:'helmet'};await api.heartbeat('FRESH',look);look.c=0;
 assert.deepEqual(calls[0].args,{p_family:'creak',p_edition:'general',p_code:'FRESH'});
 assert.deepEqual(calls[1].args,{p_family:'creak',p_edition:'general',p_code:'FRESH',p_look:{c:7,s:4,h:'helmet'}});
 assert.ok(!('p_player_id'in calls[1].args));
 ''')
 def test_queued_begin_and_publish_use_server_run_and_monotonic_version(self):
  self.node(r'''
 const {api,calls}=fixture();await api.createRoom();
 const begin=api.beginRun(),first=api.publish({phase:'live',state:{turnSeq:0}}),second=api.publish({phase:'live',state:{turnSeq:1}});
 await Promise.all([begin,first,second]);const writes=calls.filter(c=>c.name==='party_host_publish');
 assert.deepEqual(writes.map(w=>w.args.p_expected_version),[1,2]);assert.ok(writes.every(w=>w.args.p_run_id==='server-run'));
 const closed=await api.close();assert.equal(closed.room.action.accepting,false);assert.equal(api.currentRoom().version,4);assert.equal(api.busy(),false);
 ''')
 def test_uncertain_host_mutation_holds_identical_request_and_later_queue(self):
  self.node(r'''
 let failed=false;const {api,calls,issues}=fixture({intercept:async name=>{if(name==='party_host_publish'&&!failed){failed=true;return {data:null,error:{message:'Lost response'},status:503};}}});
 await api.createRoom();await api.beginRun();const one=api.publish({phase:'live',state:{turnSeq:0}}),two=api.publish({phase:'live',state:{turnSeq:1}});
 await tick();assert.equal(calls.filter(c=>c.name==='party_host_publish').length,1);assert.equal(issues.at(-1).canRetry,true);assert.equal(api.busy(),true);
 assert.throws(()=>api.forgetHost(),/Wait/);api.retry();await Promise.all([one,two]);
 const writes=calls.filter(c=>c.name==='party_host_publish');assert.deepEqual(writes[0].args,writes[1].args);assert.equal(writes[2].args.p_expected_version,2);
 ''')
 def test_version_conflict_pauses_without_blind_retry(self):
  self.node(r'''
 const {api,calls,issues}=fixture({intercept:async name=>name==='party_host_publish'?{data:null,error:{code:'PT409',message:'Host conflict'},status:409}:null});
 await api.createRoom();await api.beginRun();api.publish({phase:'live',state:{}});await tick();assert.equal(issues.at(-1).canRetry,false);
 api.retry();await tick();assert.equal(calls.filter(c=>c.name==='party_host_publish').length,1);
 ''')
 def test_member_request_uuid_and_stream_instance_are_preserved(self):
  self.node(r'''
 const {api,calls}=fixture();await api.activityStart('FRESH','run','window','fixed-start');
 await api.event('FRESH','run','window','instance',0,{t:'q',q:'Synthetic?'},'fixed-event');
 await api.submit('FRESH','run','window','Alpha','fixed-choice');
 assert.equal(calls[0].args.p_request_id,'fixed-start');assert.equal(calls[1].args.p_activity_id,'instance');assert.equal(calls[1].args.p_event_seq,0);assert.equal(calls[1].args.p_request_id,'fixed-event');assert.equal(calls[2].args.p_request_id,'fixed-choice');
 ''')
 def test_wrong_game_options_and_returned_edition_cannot_be_adopted(self):
  self.node(r'''
 const {window}=fixture();assert.throws(()=>window.PartyAccess.create('url','key',{family:'creak',edition:'bible'}),/Unknown/);
 let once=false;const {api,issues}=fixture({intercept:async name=>name==='party_create_room'?{data:{id:'wrong',code:'WRONG',family:'spines',edition:'bible'},error:null,status:200}:null});
 api.createRoom();await tick();assert.match(issues.at(-1).error.message,/different game edition/);assert.equal(api.currentRoom(),null);
 ''')
 def test_disabled_guest_auth_fails_before_rpc(self):
  self.node(r"const {api,calls}=fixture({deny:true});await assert.rejects(api.preview('FRESH'),e=>/Guest access/.test(api.message(e)));assert.equal(calls.length,0);")
if __name__=='__main__':unittest.main()
