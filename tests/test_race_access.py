#!/usr/bin/env python3
"""Deterministic callback-order tests for the actual race adapter.

The SDK boundary is a scheduling double here, not an authorization test. Real
guest Auth, RPC permissions and SQL receipts are covered by readiness_races.py.
"""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

PROGRAM = r"""
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const packet=(code='ROOM1',run='run-one',version=0)=>({
 room:{id:code,code,family:'finish',edition:'general',run_id:run,version,phase:'playing',roster:[{id:'actor-one'}]},
 member:{id:'actor-one',name:'One'},host:true,server_time:'2026-10-24T13:00:00.000000+00:00',rows:[]
});
function setup(handler){
 const calls=[];
 const window={crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,
  supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{}}}),getUser:async()=>({data:{user:{id:'verified-double'}}})},
   rpc:async(name,args)=>{calls.push({name,args:clone(args)});return handler(name,args);}})}};
 vm.runInNewContext(source,{window,Uint8Array,AbortController,Date,Error,Promise,Number,JSON,Object,String,Array,Math,Infinity});
 const issues=[];
 const access=window.RaceAccess.create('https://fixture.invalid','public-double',{family:'finish',edition:'general',onIssue:issue=>issues.push(issue)});
 return {access,calls,issues};
}
const success=data=>({data:clone(data),status:200});
async function wait(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}throw Error('Scheduling condition was not reached');}
(async()=>{
 let current=packet(),release;
 let {access}=setup(async(name,args)=>{
  if(name==='race_enter')return success(current);
  if(name==='race_state'){const saved=clone(current);return new Promise(resolve=>{release=()=>resolve(success(saved));});}
  if(name==='race_leave')return success({left:true});
  throw Error('Unexpected '+name);
 });
 await access.enter('ROOM1','One');
 let late=access.state().then(()=>({ok:true}),error=>({ok:false,code:error.code}));
 await wait(()=>release);await access.leave();release();
 assert.equal((await late).code,'PT409');assert.equal(access.current(),null);
 console.log('late state cannot resurrect a left room: passed');
 current=packet('ROOM2');await access.enter('ROOM2','One');release=null;
 late=access.state().then(()=>({ok:true}),error=>({ok:false,code:error.code}));
 await wait(()=>release);await access.leave();current=packet('ROOM3');await access.enter('ROOM3','One');release();
 assert.equal((await late).code,'PT409');assert.equal(access.current().room.code,'ROOM3');
 console.log('late state cannot replace a newly entered room: passed');

 current=packet();release=null;
 ({access}=setup(async(name,args)=>{
  if(name==='race_enter')return success(current);
  if(name==='race_state'){const saved=clone(current);return new Promise(resolve=>{release=()=>resolve(success(saved));});}
  if(name==='race_submit')return success({id:7,kind:'progress',member_id:'actor-one',run_id:'run-one',correct:1,level:0,time_left:0,created_at:'2026-10-24T13:00:00.000100+00:00'});
  throw Error('Unexpected '+name);
 }));
 await access.enter('ROOM1','One');access.useRun('run-one');
 late=access.state();await wait(()=>release);await access.submit('progress',{correct:1,level:0,time_left:0});release();
 const newest=await late;assert.equal(newest.rows[0].id,7);assert.equal(newest.member.last_correct,1);
 console.log('older same-millisecond poll cannot erase a canonical mutation: passed');

 current=packet();let releaseEvent;
 const oldEvent={id:7,kind:'progress',member_id:'actor-one',run_id:'run-one',correct:1,level:0,time_left:0,created_at:'2026-10-24T13:00:00.000100+00:00'};
 ({access}=setup(async(name,args)=>{
  if(name==='race_enter')return success(current);
  if(name==='race_submit')return new Promise(resolve=>{releaseEvent=()=>resolve(success(oldEvent));});
  if(name==='race_state')return success({...current,server_time:'2026-10-24T13:00:00.000300+00:00',
    member:{...current.member,last_correct:2,last_level:0,last_time:0,progress_at:'2026-10-24T13:00:00.000200+00:00'},
    rows:[{...oldEvent,id:8,correct:2,created_at:'2026-10-24T13:00:00.000200+00:00'}]});
  throw Error('Unexpected '+name);
 }));
 await access.enter('ROOM1','One');access.useRun('run-one');
 const delayedMutation=access.submit('progress',{correct:1,level:0,time_left:0});await wait(()=>releaseEvent);
 await access.state();releaseEvent();assert.equal((await delayedMutation).id,7);
 assert.equal(access.current().member.last_correct,2);assert.equal(access.current().rows[0].id,8);
 console.log('older idempotent receipt cannot downgrade newer canonical progress: passed');

 let failures=1,fixture;
 fixture=setup(async(name,args)=>{
  if(name==='race_enter')return success(packet());
  if(name==='race_heartbeat'&&failures-->0)return {error:{code:'fixture_response_lost',message:'Lost acknowledgement'},status:503};
  if(name==='race_heartbeat'){const partial=packet();delete partial.room.roster;return success(partial);}
  if(name==='race_leave')return success({left:true});
  throw Error('Unexpected '+name);
 });access=fixture.access;
 await access.enter('ROOM1','One');let done=false;
 const beat=access.heartbeat().then(()=>{done=true;});await wait(()=>access.pending());
 assert.equal(done,false);const first=fixture.calls.at(-1).args.p_request_id;
 await access.retry();await beat;assert.equal(fixture.calls.at(-1).args.p_request_id,first);assert.equal(access.busy(),false);
 assert.equal(access.current().room.roster[0].id,'actor-one');
 console.log('lost acknowledgement stays pending and retries the same UUID: passed');
 console.log('partial heartbeat receipt preserves the full canonical roster: passed');
 failures=1;
 const abandoned=access.heartbeat().then(()=>({ok:true}),error=>({ok:false,code:error.code}));await wait(()=>access.pending());
 await access.leave();assert.equal((await abandoned).code,'race_left');assert.equal(access.current(),null);assert.equal(access.busy(),false);
 console.log('leave escapes a waiting retry and still calls membership leave: passed');

 fixture=setup(async(name,args)=>{
  if(name==='race_enter')return {error:{code:'fixture_response_lost',message:'Lost acknowledgement'},status:503};
  if(name==='race_leave')return success({left:true});
  throw Error('Unexpected '+name);
 });access=fixture.access;
 const enter=access.enter('ENTER1','One').then(()=>({ok:true}),error=>({ok:false,code:error.code}));await wait(()=>access.pending());
 await access.leave();assert.equal((await enter).code,'race_left');assert.equal(fixture.calls.at(-1).args.p_code,'ENTER1');assert.equal(access.current(),null);
 console.log('leave after an interrupted enter uses its original code: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
"""


def main():
    result = subprocess.run(['node','-e',PROGRAM,str(ROOT/'js/race-access.js')],
                            text=True,capture_output=True,timeout=30)
    print(result.stdout,end='')
    if result.returncode:
        print(result.stderr,end='')
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
