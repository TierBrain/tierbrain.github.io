// Actual vendored SDK + unmodified ThroneAccess through real GoTrue/PostgREST.
// This disposable HTTP fixture does not test DOM rendering or live production.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,randomUUID} from 'node:crypto';
import vm from 'node:vm';

const sdkSource=await readFile(process.env.SDK_FILE||'/tmp/tierbrain-throne-supabase.js','utf8');
const adapterSource=await readFile(process.env.ADAPTER_FILE||'/tmp/tierbrain-throne-access.js','utf8');
const BASE='http://tierbrain-fixture.invalid';
const AUTH=process.env.THRONE_AUTH_URL||'http://auth:9999';
const REST=process.env.THRONE_REST_URL||'http://rest:3000';
// Refuse hosted endpoints before any fetch, even when environment overrides exist.
for(const [label,value] of [['Auth',AUTH],['REST',REST]]){
  const endpoint=new URL(value);
  assert.equal(endpoint.protocol,'http:',label+' fixture endpoint must use local HTTP');
  assert(['auth','rest','localhost','127.0.0.1','[::1]','::1'].includes(endpoint.hostname),label+' fixture endpoint must name a local test service');
  assert(!endpoint.username&&!endpoint.password,label+' fixture endpoint cannot contain credentials');
  assert.equal(endpoint.pathname,'/',label+' fixture endpoint must be a service root');
  assert(!endpoint.search&&!endpoint.hash,label+' fixture endpoint cannot contain query or hash');
}
// The minimal local stack has no API-key gateway. Only a real Auth-issued bearer
// token establishes identity in PostgREST; this opaque value is not a signed JWT.
const API_KEY='local-fixture-without-api-key-gateway';
const realms=[],checks=[];
const plain=value=>JSON.parse(JSON.stringify(value));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function bounded(promise,label){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),25000);})]);}
  finally{clearTimeout(timer);}
}
function realm(store=new Map(),edition='general'){
  const timers=new Set(),intervals=new Set(),calls=[],methods=[],clients=[];
  const schedule=(fn,ms,...args)=>{const id=setTimeout(()=>{timers.delete(id);fn(...args);},ms);timers.add(id);return id;};
  const context={
    console:{log(){},warn(){},error(){},debug(){},info(){}},crypto:webcrypto,
    fetch:async(input,init)=>{
      const request=new Request(input,init),url=new URL(request.url);assert.equal(url.origin,BASE,'unexpected adapter origin');
      let target;
      if(url.pathname.startsWith('/auth/v1/'))target=AUTH+url.pathname.slice('/auth/v1'.length)+url.search;
      else if(url.pathname.startsWith('/rest/v1/'))target=REST+url.pathname.slice('/rest/v1'.length)+url.search;
      else throw new Error('Unexpected adapter service path');
      const body=['GET','HEAD'].includes(request.method)?null:await request.arrayBuffer();
      // Record only gameplay arguments. Never retain Auth bodies or bearer headers.
      let args=null;if(body&&url.pathname.startsWith('/rest/v1/rpc/'))args=JSON.parse(new TextDecoder().decode(body));
      const response=await fetch(target,{method:request.method,headers:request.headers,signal:request.signal,redirect:'error',...(body?{body}:{})});
      calls.push({method:request.method,path:url.pathname,status:response.status,args});return response;
    },
    Headers,Request,Response,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,atob,btoa,queueMicrotask,performance,
    WebSocket:globalThis.WebSocket,setTimeout:schedule,clearTimeout(id){timers.delete(id);clearTimeout(id);},
    setInterval(fn,ms,...args){const id=setInterval(fn,ms,...args);intervals.add(id);return id;},clearInterval(id){intervals.delete(id);clearInterval(id);},
    localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)},
    navigator:{userAgent:'TierBrain disposable Throne SDK fixture'},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
    location:{href:BASE+'/throne.html',origin:BASE,protocol:'http:',host:'tierbrain-fixture.invalid',hostname:'tierbrain-fixture.invalid',search:'',hash:''},
    addEventListener(){},removeEventListener(){},
  };
  context.window=context;context.self=context;vm.createContext(context);
  vm.runInContext(sdkSource,context,{filename:'vendor/supabase.js'});
  assert.equal(typeof context.supabase?.createClient,'function','vendored SDK must load');
  const originalCreate=context.supabase.createClient;
  context.supabase.createClient=(...args)=>{
    const client=originalCreate(...args);clients.push(client);
    for(const name of ['getSession','signInAnonymously','getUser','refreshSession']){
      const original=client.auth[name].bind(client.auth);client.auth[name]=(...values)=>{methods.push(name);return original(...values);};
    }
    return client;
  };
  vm.runInContext(adapterSource,context,{filename:'js/throne-access.js'});
  const access=context.ThroneAccess.create(BASE,API_KEY,edition);
  const value={context,access,store,calls,methods,clients,async close(){
    for(const client of clients)await client.auth.stopAutoRefresh();
    for(const timer of timers)clearTimeout(timer);for(const interval of intervals)clearInterval(interval);
    timers.clear();intervals.clear();
  }};
  access.onIssue(issue=>{if(issue.error)throw new Error('Unexpected queued host error: '+issue.error.code);});
  realms.push(value);return value;
}
async function verified(value){
  const user=await bounded(value.access.ready(),'real anonymous Auth');assert.equal(user.is_anonymous,true);
  const result=await value.clients[0].rpc('stack_whoami');assert.equal(result.error,null,'fixture identity RPC must succeed');
  assert.equal(result.data.uid,user.id,'Auth identity must match verified PostgREST auth.uid');
  assert.equal(result.data.role,'authenticated');assert.equal(result.data.is_anonymous,true);return user;
}
async function raw(value,name,args){return await bounded(value.clients[0].rpc(name,args),'raw '+name);}
function success(result,label){assert.equal(result.error,null,label+' must succeed');assert(result.status>=200&&result.status<300,label+' HTTP status');return plain(result.data);}
function denied(result,label,statuses=[401,403],code='42501'){assert(statuses.includes(result.status),label+' must be denied by HTTP');assert.equal(result.error?.code,code,label+' database error');}
async function expectDenied(promise,label,code='42501'){
  await assert.rejects(bounded(promise,label),error=>error.code===code,label+' must reject');
}

try{
  const noBearer=await fetch(REST+'/rpc/throne_preview',{method:'POST',redirect:'error',headers:{'content-type':'application/json',apikey:API_KEY},body:JSON.stringify({p_code:'ZZZZZ',p_edition:'general'}),signal:AbortSignal.timeout(15000)});
  assert.equal(noBearer.status,401,'publishable placeholder alone cannot preview');
  assert.equal((await noBearer.json()).code,'42501');
  checks.push('authenticated-only RPC rejects a missing bearer over real HTTP');

  const original=realm();const hostIdentity=await verified(original);
  assert(original.methods.includes('signInAnonymously')&&original.methods.includes('getUser'));
  assert(original.calls.some(c=>c.path==='/auth/v1/signup'&&c.status===200));
  assert(original.calls.some(c=>c.path==='/auth/v1/user'&&c.status===200));
  const room=await bounded(original.access.createRoom(),'room creation');
  assert.match(room.id,/^[0-9a-f-]{36}$/);assert.match(room.code,/^[A-Z2-9]{5}$/);
  assert.equal(original.access.savedHostCode(),room.code);assert(original.store.has('tb_throne_general_auth_v1'));
  await original.close();
  const host=realm(original.store);assert.equal((await verified(host)).id,hostIdentity.id);
  assert(!host.methods.includes('signInAnonymously'),'reload must restore the same anonymous account');
  await bounded(host.access.resumeHost(room.code),'owned room restore');
  checks.push('official SDK issues, verifies, persists and restores an anonymous host session');

  const outsider=realm();const outsiderIdentity=await verified(outsider);assert.notEqual(outsiderIdentity.id,hostIdentity.id);
  const preview=await outsider.access.preview(room.code);
  assert.deepEqual(Object.keys(preview).sort(),['code','edition','phase']);
  await expectDenied(outsider.access.resumeHost(room.code),'outsider host resume');
  await expectDenied(outsider.access.members(room.code),'outsider roster');
  await expectDenied(outsider.access.playerState(room.code),'outsider full room state');
  const wrongPreview=await raw(host,'throne_preview',{p_code:room.code,p_edition:'bible'});
  assert.equal(success(wrongPreview,'wrong edition minimal preview'),null);
  denied(await raw(host,'throne_host_resume',{p_code:room.code,p_edition:'bible'}),'same host wrong edition');
  denied(await raw(outsider,'throne_join',{p_code:room.code,p_edition:'bible',p_name:'Wrong edition'}),'wrong edition join');
  checks.push('minimal preview, host ownership, active membership and edition isolation hold over HTTP');

  const p1=realm(),p2=realm();const u1=await verified(p1),u2=await verified(p2);
  assert.equal(new Set([hostIdentity.id,outsiderIdentity.id,u1.id,u2.id]).size,4);
  const m1=await p1.access.join(room.code,'HTTP Player 1'),m2=await p2.access.join(room.code,'HTTP Player 2');
  assert.notEqual(m1.id,u1.id);assert.notEqual(m2.id,u2.id);assert.notEqual(m1.id,m2.id);
  assert.equal((await p1.access.join(room.code,'Changed name')).id,m1.id,'join retry must reuse server membership');
  assert.equal((await p1.access.membership(room.code)).name,m1.name,'join retry cannot rewrite canonical name');
  const roster=plain(await host.access.members(room.code));assert.deepEqual(roster.map(m=>m.id).sort(),[m1.id,m2.id].sort());
  const run=await host.access.beginRun({qTotal:3,answerMs:15000,live:true});assert(run.run_id);
  await host.access.publish({phase:'lobby',state:{live:true,champ:m1,chal:m2,queue:[],mode:'spine'}});
  const openedAt=Date.now();
  const question=await host.access.openQuestion({q:'Disposable HTTP question',opts:['Wrong','Correct','Other','Last'],champ_id:m1.id,chal_id:m2.id,mode:'spine',qIndex:1});
  assert.match(question.q_id,/^[0-9a-f-]{36}$/);assert.equal(question.run_id,run.run_id);
  assert(question.state.buzzOpenAt-openedAt>=2500&&question.state.buzzOpenAt-openedAt<=4000,'unlock must use a real approximately three-second server countdown');
  await expectDenied(p1.access.buzz(room.code,question.q_id),'early buzz');
  await expectDenied(p2.access.answer(room.code,question.q_id,1),'answer before selection');
  await sleep(Math.max(0,question.state.buzzOpenAt-Date.now()+40));
  const buzz=await p1.access.buzz(room.code,question.q_id);
  assert.equal((await p1.access.buzz(room.code,question.q_id)).id,buzz.id,'same buzz retry must return original receipt');
  const selected=await host.access.selectBuzz(question.q_id);assert.equal(selected.state.answerer.id,m1.id);
  await expectDenied(p2.access.buzz(room.code,question.q_id),'buzz after first player selected');
  checks.push('server membership/question IDs and real unlock timing gate the eligible duel players');

  const wrong=await p1.access.answer(room.code,question.q_id,0);
  assert.equal((await p1.access.answer(room.code,question.q_id,0)).id,wrong.id);
  await expectDenied(p1.access.answer(room.code,question.q_id,3),'changed submitted choice','22023');
  const handoffArgs={p_code:room.code,p_edition:'general',p_run_id:run.run_id,p_question_id:question.q_id,p_answerer_id:m1.id,p_correct:false,p_expected_version:host.access.currentRoom().version,p_request_id:randomUUID()};
  const handoff=success(await raw(host,'throne_host_grade',handoffArgs),'first wrong answer');
  assert.equal(handoff.outcome,'handoff');assert.equal(handoff.room.state.answerer.id,m2.id);assert(handoff.room.state.lockedOut.includes(m1.id));
  assert.deepEqual(success(await raw(host,'throne_host_grade',handoffArgs),'exact handoff replay'),handoff);
  denied(await raw(host,'throne_host_grade',{...handoffArgs,p_correct:true}),'conflicting request replay',[400],'22023');
  denied(await raw(outsider,'throne_host_grade',handoffArgs),'outsider replays host request');
  await host.access.resumeHost(room.code); // Adopt the version advanced by the direct raw-RPC assertion.
  const beforeAnswer=await p2.access.playerState(room.code);assert.equal(beforeAnswer.receipts.buzz,null);
  const right=await p2.access.answer(room.code,question.q_id,1);
  assert(right.id,'the handed-off opponent can answer without buzzing');
  const win=await host.access.grade(question.q_id,m2.id,true);
  assert.equal(win.outcome,'win');assert.equal(win.winner.id,m2.id);assert.equal(win.stats.streak,1);
  assert.equal(win.stats.totalCorrect[m2.id],1);assert.equal(win.stats.bestStreak[m2.id],1);assert.equal(win.stats.lastWinner.id,m2.id);
  assert.equal(win.room.state.streakKing.id,m2.id);
  const winningCall=host.calls.filter(c=>c.path==='/rest/v1/rpc/throne_host_grade').at(-1);
  assert.deepEqual(success(await raw(host,'throne_host_grade',winningCall.args),'winning request replay'),plain(win));
  const confirmed=await host.access.resumeHost(room.code);assert.equal(confirmed.state.totalCorrect[m2.id],1);
  checks.push('wrong answer hands off without a second buzz; exact retries preserve one authoritative score change');

  const state1=await p1.access.playerState(room.code),state2=await p2.access.playerState(room.code);
  assert.equal(state1.receipts.buzz.id,buzz.id);assert.equal(state1.receipts.answer.id,wrong.id);assert.equal(state1.receipts.answer.choice,0);
  assert.equal(state2.receipts.buzz,null);assert.equal(state2.receipts.answer.id,right.id);assert.equal(state2.receipts.answer.choice,1);
  await expectDenied(outsider.access.playerState(room.code),'outsider after question resolution');
  const current=host.access.currentRoom();
  const stale=await raw(host,'throne_host_publish',{p_code:room.code,p_edition:'general',p_run_id:run.run_id,p_patch:{phase:'live',state:{live:true}},p_expected_version:current.version-1,p_request_id:randomUUID()});
  denied(stale,'stale version',[409],'PT409');assert.equal(host.access.busy(),false,'raw conflict must not enter the adapter retry queue');
  checks.push('member-only canonical receipts and HTTP409/PT409 conflicts match the actual transport');

  const historical=await host.access.legends('THRONE_HTTP_SCOPE');
  assert.deepEqual(plain(historical).map(row=>row.name),['HTTP legacy general target']);
  const historicalBible=success(await raw(host,'throne_legends',{p_edition:'bible',p_group_code:'THRONE_HTTP_SCOPE'}),'Bible historical scope');
  assert.deepEqual(historicalBible.map(row=>row.name),['HTTP legacy Bible target']);
  assert.deepEqual(plain(await host.access.legends('THRONE_HTTP_EMPTY')),[]);
  checks.push('read-only Hall bridge returns only the requested historical group and edition');

  const persistedPlayer=realm(p2.store);assert.equal((await verified(persistedPlayer)).id,u2.id);
  assert(!persistedPlayer.methods.includes('signInAnonymously'));
  assert.equal((await persistedPlayer.access.membership(room.code)).id,m2.id);
  assert.equal((await persistedPlayer.access.playerState(room.code)).receipts.answer.id,right.id);
  const refresh=await host.clients[0].auth.refreshSession();assert.equal(refresh.error,null);assert.equal(refresh.data.session.user.id,hostIdentity.id);
  assert.equal((await verified(host)).id,hostIdentity.id);await host.access.resumeHost(room.code);
  checks.push('restored player membership/receipt and refreshed host authorization retain canonical identities');

  console.log(JSON.stringify({ok:true,passed:checks.length,checks,scope:'Disposable real GoTrue/PostgREST + vendored SDK/unmodified ThroneAccess; one normal duel, no production users/rooms/data or DOM claim'},null,2));
}catch(error){
  console.error(JSON.stringify({ok:false,error:error instanceof assert.AssertionError?error.message:'Throne HTTP fixture failed; inspect private local service logs without credentials'}));
  process.exitCode=1;
}finally{for(const value of realms)await value.close();}
