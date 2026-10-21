// Real vendored Supabase SDK + unmodified BigQuizAccess adapter, isolated HTTP services.
// A VM provides only the platform globals needed by the transport: this is not a browser UI test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';

const sdkSource=await readFile(process.env.SDK_FILE || '/tmp/tierbrain-supabase.js','utf8');
assert.equal(createHash('sha256').update(sdkSource).digest('hex'),
  'ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3',
  'acceptance must load the reviewed official supabase-js 2.118.0 UMD bytes');
const adapterSource=await readFile(process.env.ADAPTER_FILE || '/tmp/tierbrain-bigquiz-access.js','utf8');
const BASE='http://tierbrain-fixture.invalid';
// There is no gateway in this minimal stack. This opaque placeholder is not a signed JWT;
// authorization at PostgREST is exclusively the actual GoTrue-issued access token.
const API_KEY='local-fixture-without-api-key-gateway';
const realms=[];

function realm(store=new Map()) {
  const timers=new Set(), intervals=new Set(), calls=[], methods=[], clients=[];
  const schedule=(fn,ms,...args)=>{
    const id=setTimeout(()=>{timers.delete(id);fn(...args);},ms);
    timers.add(id);return id;
  };
  const context={
    console:{log(){},warn(){},error(){},debug(){},info(){}},
    crypto:webcrypto,fetch:async(input,init)=>{
      const request=new Request(input,init), url=new URL(request.url);
      assert.equal(url.origin,BASE,'transport attempted an unexpected origin');
      let target;
      if(url.pathname.startsWith('/auth/v1/')) target='http://auth:9999'+url.pathname.slice('/auth/v1'.length)+url.search;
      else if(url.pathname.startsWith('/rest/v1/')) target='http://rest:3000'+url.pathname.slice('/rest/v1'.length)+url.search;
      else throw new Error('Transport attempted an unexpected service path');
      const result=await fetch(target,{
        method:request.method,headers:request.headers,signal:request.signal,
        ...(['GET','HEAD'].includes(request.method)?{}:{body:await request.arrayBuffer()}),
      });
      calls.push({method:request.method,path:url.pathname,status:result.status});
      return result;
    },
    Headers,Request,Response,URL,URLSearchParams,TextEncoder,TextDecoder,
    AbortController,AbortSignal,atob,btoa,queueMicrotask,performance,
    WebSocket:globalThis.WebSocket,
    setTimeout:schedule,clearTimeout(id){timers.delete(id);clearTimeout(id);},
    setInterval(fn,ms,...args){const id=setInterval(fn,ms,...args);intervals.add(id);return id;},
    clearInterval(id){intervals.delete(id);clearInterval(id);},
    localStorage:{getItem(key){return store.get(key)??null;},setItem(key,value){store.set(key,String(value));},removeItem(key){store.delete(key);}},
    navigator:{userAgent:'TierBrain local SDK transport fixture'},
    document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
    location:{href:BASE+'/show-gen.html',origin:BASE,protocol:'http:',host:'tierbrain-fixture.invalid',hostname:'tierbrain-fixture.invalid',search:'',hash:''},
    addEventListener(){},removeEventListener(){},
  };
  context.window=context;context.self=context;
  vm.createContext(context);
  vm.runInContext(sdkSource,context,{filename:'vendor/supabase.js'});
  assert.equal(typeof context.supabase?.createClient,'function','vendored UMD SDK did not load');
  const originalCreate=context.supabase.createClient;
  context.supabase.createClient=(...args)=>{
    const client=originalCreate(...args);clients.push(client);
    for(const name of ['getSession','signInAnonymously','getUser','refreshSession']) {
      const original=client.auth[name].bind(client.auth);
      client.auth[name]=(...values)=>{methods.push(name);return original(...values);};
    }
    return client;
  };
  vm.runInContext(adapterSource,context,{filename:'js/big-quiz-access.js'});
  const access=context.BigQuizAccess.create(BASE,API_KEY);
  const value={context,access,store,calls,methods,clients,async close(){
    for(const client of clients) await client.auth.stopAutoRefresh();
    for(const timer of timers) clearTimeout(timer);
    for(const timer of intervals) clearInterval(timer);
    timers.clear();intervals.clear();
  }};
  realms.push(value);return value;
}
async function bounded(promise,label) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),25000);})]);}
  finally {clearTimeout(timer);}
}
async function identity(value,expected) {
  const result=await value.clients[0].rpc('stack_whoami');
  assert.equal(result.error,null,'SDK identity RPC failed');
  assert.equal(result.data.uid,expected);
  assert.equal(result.data.role,'authenticated');
  assert.equal(result.data.is_anonymous,true);
}

try {
  const first=realm(new Map([
    ['tb_show_auth_v1','{"unrelated":"Bible Show storage must not be adopted"}'],
    ['tb_show_host_room_v1','ZZZZZ'],
    ['cv_stage_room_gen','OLDGG'],
    ['cv_player_gen','{"id":"untrusted-legacy-id","code":"OLDGG"}'],
  ]));
  assert.equal(first.access.savedHostCode(),'','new edition namespace must not adopt old host codes');
  assert.equal(first.access.savedPlayerCode(),'','new edition namespace must not adopt old player codes');
  const host=await bounded(first.access.ready(),'adapter ready');
  assert.equal(host.is_anonymous,true);
  for(const method of ['getSession','signInAnonymously','getUser']) assert(first.methods.includes(method),'adapter must call actual SDK '+method);
  assert(first.calls.some(call=>call.path==='/auth/v1/signup'&&call.status===200),'anonymous session must come from real Auth HTTP signup');
  assert(first.calls.some(call=>call.path==='/auth/v1/user'&&call.status===200),'identity must be verified by real Auth HTTP getUser');
  await identity(first,host.id);
  const persisted=await first.clients[0].auth.getSession();
  assert.equal(persisted.error,null);
  assert.equal(persisted.data.session.user.id,host.id);
  assert(first.store.has('tb_bigquiz_auth_v1'),'official SDK must persist session under adapter namespace');
  const room=await bounded(first.access.createRoom(),'SDK room create');
  assert.equal(first.access.savedHostCode(),room.code);
  assert.equal(first.store.get('tb_show_host_room_v1'),'ZZZZZ','Big Quiz must preserve separate Bible Show storage');
  await first.close();

  const restored=realm(first.store);
  const same=await bounded(restored.access.ready(),'adapter persisted restore');
  assert.equal(same.id,host.id,'persistent reload must preserve Auth identity');
  assert(!restored.methods.includes('signInAnonymously'),'restore must not replace an existing anonymous host');
  assert(!restored.calls.some(call=>call.path==='/auth/v1/signup'),'restore must not create another Auth account');
  await identity(restored,host.id);
  await bounded(restored.access.resumeHost(room.code),'restored host resume');
  const run=await bounded(restored.access.beginRun(),'restored host begin run');
  assert(run.run_id&&run.version===room.version+1);

  const refreshed=await restored.clients[0].auth.refreshSession();
  assert.equal(refreshed.error,null,'actual SDK anonymous refresh must succeed');
  assert.equal(refreshed.data.session.user.id,host.id);
  assert(restored.calls.some(call=>call.path==='/auth/v1/token'&&call.status===200),'refresh must use actual Auth token HTTP endpoint');
  const verified=await restored.clients[0].auth.getUser();
  assert.equal(verified.error,null);
  assert.equal(verified.data.user.id,host.id);
  await identity(restored,host.id);
  await bounded(restored.access.resumeHost(room.code),'refreshed host authorization');

  const player=realm();
  const user=await bounded(player.access.ready(),'player Auth');
  assert.notEqual(user.id,host.id);
  const member=await bounded(player.access.join(room.code,'SDK Player','youth'),'SDK membership join');
  assert(member.id);
  const state=await bounded(player.access.playerState(room.code),'SDK player poll');
  assert.equal(state.code,room.code);
  assert.equal((await bounded(player.access.membership(room.code),'SDK membership restore')).id,member.id);
  await assert.rejects(player.access.resumeHost(room.code),error=>error.code==='42501');
  for(const value of realms) {
    assert(value.calls.filter(call=>call.path.startsWith('/rest/v1/'))
      .every(call=>call.path.startsWith('/rest/v1/rpc/bigquiz_')||call.path==='/rest/v1/rpc/stack_whoami'),
      'adapter must use only the edition API and the disposable identity probe');
  }

  console.log(JSON.stringify({ok:true,checks:[
    'actual vendored UMD SDK and unmodified BigQuizAccess adapter load',
    'Big Quiz ignores legacy and Bible Show ownership hints and keeps separate storage',
    'official getSession/signInAnonymously/getUser use real anonymous Auth HTTP session',
    'PostgREST verifies SDK access token and auth.uid matches Auth user',
    'SDK persists and restores anonymous host without a replacement signup',
    'restored host resumes and begins a run using authenticated RPCs',
    'official SDK refreshSession preserves host identity and authorization',
    'separate real SDK player joins and polls while host access is denied',
  ],scope:'VM platform + real SDK/adapter HTTP transport; no DOM rendering, browser CORS or UI acceptance claim'},null,2));
} catch(error) {
  console.error(JSON.stringify({ok:false,error:error instanceof assert.AssertionError?error.message:'SDK transport fixture failed; inspect local-only logs without credentials'}));
  process.exitCode=1;
} finally {
  for(const value of realms) await value.close();
}
