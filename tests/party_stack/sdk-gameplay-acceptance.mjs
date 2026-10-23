// Actual vendored SDK + unmodified PartyAccess through real GoTrue/PostgREST.
// This disposable HTTP fixture does not test DOM rendering or live production.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,randomUUID} from 'node:crypto';
import vm from 'node:vm';

const sdkSource=await readFile(process.env.SDK_FILE||'/tmp/tierbrain-party-supabase.js','utf8');
const adapterSource=await readFile(process.env.ADAPTER_FILE||'/tmp/tierbrain-party-access.js','utf8');
const BASE='http://tierbrain-fixture.invalid';
const AUTH=process.env.PARTY_AUTH_URL||'http://auth:9999';
const REST=process.env.PARTY_REST_URL||'http://rest:3000';
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
function realm(store=new Map(),family='spines',edition='general'){
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
    navigator:{userAgent:'TierBrain disposable Party SDK fixture'},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
    location:{href:BASE+'/party.html',origin:BASE,protocol:'http:',host:'tierbrain-fixture.invalid',hostname:'tierbrain-fixture.invalid',search:'',hash:''},
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
  vm.runInContext(adapterSource,context,{filename:'js/party-access.js'});
  const access=context.PartyAccess.create(BASE,API_KEY,{family,edition});
  const value={context,access,store,calls,methods,clients,family,edition,async close(){
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

function scope(room){return {p_code:room.code,p_family:room.family,p_edition:room.edition};}
async function publish(host,state){
  return plain(await bounded(host.access.publish({phase:state.phase,state}),'publish '+host.family));
}
async function chosen(host,player,other,room,choice){
  const args=[room.code,room.run_id,room.action.id,choice,randomUUID()];
  await expectDenied(other.access.submit(...args),'unassigned member choice');
  await expectDenied(player.access.submit(room.code,room.run_id,room.action.id,'unavailable',randomUUID()),'unavailable choice','22023');
  const receipt=plain(await player.access.submit(...args));
  assert.equal(receipt.player_id,(await player.access.membership(room.code)).id);
  assert.equal(receipt.window_id,room.action.id);assert.equal(receipt.choice,choice);
  assert.deepEqual(plain(await player.access.submit(...args)),receipt,'exact UUID replay returns one receipt');
  assert.deepEqual(plain(await player.access.submit(...args.slice(0,4),randomUUID())),receipt,'same-choice new UUID returns canonical receipt');
  await expectDenied(player.access.submit(...args.slice(0,3),'different choice',randomUUID()),'conflicting immutable choice','22023');
  const own=plain(await player.access.playerState(room.code)),theirs=plain(await other.access.playerState(room.code));
  assert.deepEqual(own.receipts,[receipt]);assert.deepEqual(theirs.receipts,[],'other players cannot read own private receipts');
  const closed=plain(await host.access.close(room.action.id));
  assert.equal(closed.room.action.accepting,false);assert.deepEqual(closed.actions,[receipt]);
  assert.deepEqual(plain(await player.access.submit(...args)),receipt,'accepted retry survives close');
  return {receipt,room:closed.room};
}

const editions=[['creak','general'],['standing','general'],['spines','general'],['spines','bible'],['circuit','general'],['circuit','bible']];
const sharedBrowserStore=new Map(),hostIds=new Set(),opts=['Alpha','Beta','Gamma','Delta'];
let currentCase='missing-bearer boundary';
try{
  const noBearer=await fetch(REST+'/rpc/party_preview',{method:'POST',redirect:'error',headers:{'content-type':'application/json',apikey:API_KEY},
    body:JSON.stringify({p_code:'ZZZZZ',p_family:'spines',p_edition:'general'}),signal:AbortSignal.timeout(15000)});
  assert.equal(noBearer.status,401);assert.equal((await noBearer.json()).code,'42501');
  checks.push('publishable placeholder without a verified bearer cannot execute the Party API');

  for(const [family,edition] of editions){
    const label=family+' '+edition;
    currentCase=label;
    const original=realm(sharedBrowserStore,family,edition),identity=await verified(original);
    assert(!hostIds.has(identity.id),'family and edition Auth namespaces must create independent identities');hostIds.add(identity.id);
    let room=plain(await bounded(original.access.createRoom(),'create '+label));
    assert.match(room.id,/^[0-9a-f-]{36}$/);assert.match(room.code,/^[A-Z2-9]{5}$/);
    assert.equal(room.family,family);assert.equal(room.edition,edition);
    assert.equal(original.access.savedHostCode(),room.code);
    const namespace='tb_party_'+family+'_'+edition;
    assert(sharedBrowserStore.has(namespace+'_auth_v1'));assert(sharedBrowserStore.has(namespace+'_host_v1'));
    await original.close();
    const host=realm(sharedBrowserStore,family,edition);
    assert.equal((await verified(host)).id,identity.id);assert(!host.methods.includes('signInAnonymously'));
    room=plain(await host.access.resumeHost(room.code));assert.equal(host.access.savedHostCode(),room.code);
    checks.push(label+': actual SDK persists and restores the verified anonymous host and owned room');

    const outsider=realm(new Map(),family,edition);await verified(outsider);
    const preview=plain(await outsider.access.preview(room.code));
    assert.deepEqual(Object.keys(preview).sort(),['code','edition','expires_at','family','phase']);
    await expectDenied(outsider.access.resumeHost(room.code),'outsider owned room resume');
    await expectDenied(outsider.access.members(room.code),'outsider roster');
    await expectDenied(outsider.access.playerState(room.code),'outsider gameplay state');
    const wrongFamily=family==='standing'?'creak':'standing';
    denied(await raw(host,'party_host_resume',{...scope(room),p_family:wrongFamily}),'same Auth user wrong family');
    denied(await raw(host,'party_preview',{...scope(room),p_edition:edition==='bible'?'general':'bible'}),'wrong edition preview');
    denied(await raw(outsider,'party_join',{...scope(room),p_family:wrongFamily,p_name:'Wrong scope'}),'wrong family join');
    denied(await raw(outsider,'party_join',{...scope(room),p_edition:edition==='bible'?'general':'bible',p_name:'Wrong edition'}),'wrong edition join');
    checks.push(label+': minimum preview, ownership, active membership, immutable family and edition are enforced over HTTP');

    const player=realm(new Map(),family,edition),other=realm(new Map(),family,edition);
    const playerIdentity=await verified(player),otherIdentity=await verified(other);
    assert.equal(new Set([identity.id,playerIdentity.id,otherIdentity.id]).size,3);
    const one=plain(await player.access.join(room.code,'Same name')),two=plain(await other.access.join(room.code,'Same name'));
    assert.notEqual(one.id,playerIdentity.id);assert.notEqual(one.id,two.id);
    assert.deepEqual(plain(await player.access.join(room.code,'New name')),one,'join retry keeps the original canonical member');
    assert.equal((await player.access.membership(room.code)).id,one.id);
    assert.equal((await player.access.heartbeat(room.code)).id,one.id);
    assert.deepEqual(plain(await host.access.members(room.code)).map(m=>m.id).sort(),[one.id,two.id].sort());
    if(family==='creak'){
      const look={c:2,s:1,h:'helmet'};
      assert.deepEqual(plain((await player.access.heartbeat(room.code,look)).look),look);
      assert.equal((await other.access.membership(room.code)).look,null);
    }
    room=plain(await host.access.beginRun());assert.match(room.run_id,/^[0-9a-f-]{36}$/);
    const hostPatch={...scope(room),p_run_id:room.run_id,p_patch:{phase:'lobby',state:{}},p_expected_version:room.version,p_request_id:randomUUID()};
    denied(await raw(player,'party_host_publish',hostPatch),'room member cannot publish');
    denied(await raw(outsider,'party_host_publish',hostPatch),'outsider cannot publish');
    denied(await raw(host,'party_host_publish',{...hostPatch,p_expected_version:room.version-1,p_request_id:randomUUID()}),'stale host version',[409],'PT409');
    const published=success(await raw(host,'party_host_publish',hostPatch),'owned publish');
    assert.deepEqual(success(await raw(host,'party_host_publish',hostPatch),'owned publish exact replay'),published);
    denied(await raw(host,'party_host_publish',{...hostPatch,p_patch:{phase:'lobby',state:{unused:'changed'}}}),'changed request payload',[400],'22023');
    denied(await raw(outsider,'party_host_publish',hostPatch),'outsider replay of host UUID');
    room=plain(await host.access.resumeHost(room.code));
    checks.push(label+': server member IDs, canonical join retry, owner-only publish, replay ledger and HTTP409/PT409 conflict verified');

    let state;
    if(family==='creak'){
      state={phase:'live',order:[one.id,two.id],turnIdx:0,turnSeq:0,positions:{[one.id]:1,[two.id]:1},board:{ladders:[],snakes:[],craters:[]},pendingQ:null,winner:null};
      room=await publish(host,state);assert.equal(room.action.kind,'roll');
      ({room}=await chosen(host,player,other,room,'roll'));
      room=await publish(host,state);assert.equal(room.action.accepting,false,'benign post-roll publish cannot reopen it');
      for(const [index,kind] of ['ladder','snake','rock','storm'].entries()){
        state.pendingQ={forPlayer:one.id,qId:'q'+(index+1),kind,q:'Disposable '+kind+' question?',opts,deadline:Date.now()+10000,dur:10000,correct:'MUST_NOT_ESCAPE'};
        room=await publish(host,state);assert.equal(room.action.kind,'answer');assert(!JSON.stringify(room).includes('MUST_NOT_ESCAPE'));
        ({room}=await chosen(host,player,other,room,'Alpha'));
        state.pendingQ=null;room=await publish(host,state);assert.equal(room.action.kind,'roll');assert.equal(room.action.accepting,false);
      }
      state.turnSeq++;state.turnIdx=1;room=await publish(host,state);assert.equal(room.action.member_id,two.id);
      checks.push(label+': one roll plus all four separate question kinds keep immutable receipts and cannot reopen completed windows');
    }else if(family==='standing'){
      state={phase:'live',N:6,solid:Array(36).fill(true),pos:{[one.id]:0,[two.id]:35},outOf:{},order:[one.id,two.id],turn:0,seq:1,qId:'q1',q:{q:'Disposable floor question?',opts,correct:'MUST_NOT_ESCAPE'}};
      room=await publish(host,state);assert.equal(room.action.kind,'answer');assert(!JSON.stringify(room).includes('MUST_NOT_ESCAPE'));
      ({room}=await chosen(host,player,other,room,'Gamma'));
      state.qId='q1:step';room=await publish(host,state);assert.equal(room.action.kind,'step');
      await expectDenied(player.access.submit(room.code,room.run_id,room.action.id,'30',randomUUID()),'nonadjacent floor tile','22023');
      ({room}=await chosen(host,player,other,room,'7'));
      state.pos[one.id]=7;state.solid[0]=false;room=await publish(host,state);assert.equal(room.action.accepting,false,'post-step board publication retains closed receipt');
      state.turn=1;state.seq=2;state.qId='q2';room=await publish(host,state);assert.equal(room.action.member_id,two.id);
      checks.push(label+': answer and step have distinct windows; server validates legal adjacent tiles and preserves the resolved-board snapshot');
    }else if(family==='spines'){
      state={phase:'choose',turn:one.id,seq:1,lean:0,books:Array.from({length:15},(_,i)=>({i,subj:'Synthetic books',t:'1',top:i===14,col:'#abcdef'})),q:null,aliveIds:[one.id,two.id],outIds:[],winnerId:null,msg:''};
      room=await publish(host,state);assert.equal(room.action.kind,'pick');
      await expectDenied(player.access.submit(room.code,room.run_id,room.action.id,'14',randomUUID()),'top book cannot be picked','22023');
      ({room}=await chosen(host,player,other,room,'0'));
      state.phase='question';state.q={q:'Disposable book question?',opts,subj:'Synthetic books',t:'3'};
      room=await publish(host,state);assert.equal(room.action.kind,'answer');
      ({room}=await chosen(host,player,other,room,'Delta'));
      state.phase='over';state.turn=null;state.outIds=[one.id];state.aliveIds=[two.id];state.winnerId=two.id;state.q=null;
      room=await publish(host,state);assert.equal(room.state.winnerId,two.id);assert.deepEqual(room.state.outIds,[one.id]);
      assert.deepEqual(room.state.alive,['Same name']);assert.deepEqual(room.state.out,['Same name']);
      // Open another unanswered choice so old-run rejection cannot be mistaken
      // for an allowed immutable replay of an already accepted receipt.
      state.phase='choose';state.turn=two.id;state.seq=2;room=await publish(host,state);
      checks.push(label+': book selection and answer are separate, top books are denied, and duplicate display names retain member-ID winner identity');
    }else{
      for(const [index,key] of ['switchboard','glasshouse','orrery','strongroom','darkroom'].entries()){
        state={phase:'room',room:key,player:one.id,roomSeq:index+1,depth:index,items:[],fuse:false,keyUsed:false,spark:null,fq:null,awake:null};
        room=await publish(host,state);assert.equal(room.action.kind,'stream');
        const startArgs=[room.code,room.run_id,room.action.id,randomUUID()];
        await expectDenied(other.access.activityStart(...startArgs),'unassigned member cannot start activity');
        const initial=plain(await player.access.activityStart(...startArgs));assert.equal(initial.completed,null);assert.equal(initial.next_event,0);
        assert.deepEqual(plain(await player.access.activityStart(...startArgs)),initial,'unknown start retry must not restart twice');
        const oldEvent=[room.code,room.run_id,room.action.id,initial.activity_id,0,{t:'q',q:'Old instance?'},randomUUID()];
        const oldReceipt=plain(await player.access.event(...oldEvent));
        const restart=plain(await player.access.activityStart(...startArgs.slice(0,3),randomUUID()));
        assert.notEqual(restart.activity_id,initial.activity_id);assert.equal(restart.next_event,0);
        await expectDenied(player.access.event(...oldEvent.slice(0,4),1,{t:'q',q:'Stale instance'},randomUUID()),'stale activity instance');
        const base=[room.code,room.run_id,room.action.id,restart.activity_id];
        await expectDenied(other.access.event(...base,0,{t:'q',q:'Not assigned'},randomUUID()),'unassigned event');
        await expectDenied(player.access.event(...base,1,{t:'q',q:'Out of order'},randomUUID()),'out-of-order event','22023');
        const questionArgs=[...base,0,{t:'q',q:'Current instance?'},randomUUID()];
        const question=plain(await player.access.event(...questionArgs));
        assert.deepEqual(plain(await player.access.event(...questionArgs)),question);
        await expectDenied(player.access.event(...base,0,{t:'q',q:'Changed existing event'},randomUUID()),'conflicting immutable event','22023');
        await expectDenied(player.access.event(...base,1,{t:'a',ok:'true',r:1,w:0,q:'Question',c:'Answer'},randomUUID()),'mistyped boolean','22023');
        const answer=plain(await player.access.event(...base,1,{t:'a',ok:true,r:1,w:0,q:'Question',c:'Answer'},randomUUID()));
        const stairs=plain(await player.access.event(...base,2,{t:'stairs',q:'Back stairs?'},randomUUID()));
        await expectDenied(player.access.event(...base,3,{t:'done',won:false,stats:'Invalid penalty',penalty:1,fuse:false},randomUUID()),'invalid back-stairs penalty','22023');
        const doneArgs=[...base,3,{t:'done',won:index%2===0,stats:'Disposable result',penalty:index%2===0?0:6,keyUsed:false,fuse:false},randomUUID()];
        const done=plain(await player.access.event(...doneArgs));assert.equal(done.event.t,'done');
        assert.deepEqual(plain(await player.access.event(...doneArgs)),done);
        const restored=plain(await player.access.activityStart(...startArgs.slice(0,3),randomUUID()));
        assert.equal(restored.activity_id,restart.activity_id);assert.deepEqual(restored.completed,done,'completed activity cannot restart on reload');
        await expectDenied(player.access.event(...base,4,{t:'q',q:'After done'},randomUUID()),'event after completion');
        const actions=plain(await host.access.actions(room.code,room.run_id,room.action.id,0));
        assert.deepEqual(actions,[question,answer,stairs,done]);assert(!actions.some(a=>a.id===oldReceipt.id));
        assert.deepEqual(actions.map(a=>a.id),actions.map(a=>a.id).sort((a,b)=>a-b),'server receipt order must be chronological');
        assert.deepEqual(plain((await host.access.close(room.action.id)).actions),actions);
      }
      checks.push(label+': all five room assignments enforce selected identity, exact start/event retries, restart isolation, typed sequential streams and one recovered completion');
      state.phase='finale';state.player=null;state.spark=one.id;state.fq={id:1,q:'Disposable finale?',opts,burn:-1};
      room=await publish(host,state);const firstWindow=room.action.id;
      state.fq.burn=1;room=await publish(host,state);assert.equal(room.action.id,firstWindow);
      await expectDenied(player.access.submit(room.code,room.run_id,firstWindow,'Beta',randomUUID()),'newly burned Lens choice','22023');
      ({room}=await chosen(host,player,other,room,'Alpha'));
      state.fq={id:2,q:'Second disposable finale?',opts,burn:-1};room=await publish(host,state);
      const acceptedArgs=[room.code,room.run_id,room.action.id,'Alpha',randomUUID()];
      const accepted=plain(await player.access.submit(...acceptedArgs));
      state.fq.burn=0;room=await publish(host,state);assert.equal(room.action.accepting,false);
      assert.deepEqual(plain(await player.access.submit(...acceptedArgs)),accepted,'Lens cannot invalidate an already accepted choice receipt');
      await host.access.close(room.action.id);
      state.fq={id:3,q:'Unanswered stale-run finale?',opts,burn:-1};room=await publish(host,state);
      checks.push(label+': Lens keeps the action identity, rejects new burned choices and preserves already accepted immutable receipts');
    }

    // The last state in every edition deliberately exposes an unanswered window.
    assert(room.action&&room.action.accepting);const stale=plain(room),staleActor=family==='creak'||family==='standing'||family==='spines'?other:player;
    const staleChoice=family==='creak'?'roll':family==='spines'?'0':'Alpha';
    room=plain(await host.access.beginRun());assert.notEqual(room.run_id,stale.run_id);
    await expectDenied(staleActor.access.submit(stale.code,stale.run_id,stale.action.id,staleChoice,randomUUID()),'unanswered old-run submission');
    denied(await raw(host,'party_host_publish',{...scope(room),p_run_id:stale.run_id,p_expected_version:room.version,p_patch:{phase:'lobby',state:{}},p_request_id:randomUUID()}),'stale run publish',[400],'22023');

    // Real SDK refresh and reload keep identity; storage hints cannot invent membership.
    await player.close();const restoredPlayer=realm(player.store,family,edition);
    assert.equal((await verified(restoredPlayer)).id,playerIdentity.id);assert(!restoredPlayer.methods.includes('signInAnonymously'));
    assert.equal((await restoredPlayer.access.membership(room.code)).id,one.id);
    const refreshed=await bounded(host.clients[0].auth.refreshSession(),'refresh host session');
    assert.equal(refreshed.error,null);assert.equal(refreshed.data.session.user.id,identity.id);
    assert.equal((await verified(host)).id,identity.id);await host.access.resumeHost(room.code);
    assert(host.calls.some(c=>c.path==='/auth/v1/token'&&c.status===200),'refresh must reach real Auth HTTP endpoint');
    await expectDenied(outsider.access.playerState(room.code),'outsider state after gameplay');
    assert.deepEqual(plain(await restoredPlayer.access.leave(room.code)),{left:true});
    assert.deepEqual(plain(await restoredPlayer.access.leave(room.code)),{left:true});
    await expectDenied(restoredPlayer.access.playerState(room.code),'departed member state');
    const rejoined=await restoredPlayer.access.join(room.code,'Rejoined');assert.notEqual(rejoined.id,one.id);
    checks.push(label+': Play Again changes run UUID, stale work fails, real Auth refresh/restoration works, and leave/rejoin never adopts an old member ID');
    await host.close();await outsider.close();await other.close();await restoredPlayer.close();
  }
  assert.equal(hostIds.size,6);
  assert.equal([...sharedBrowserStore.keys()].filter(k=>k.endsWith('_auth_v1')).length,6);
  checks.push('all six family/edition combinations retain separate persisted Auth namespaces in one browser store');
  console.log(JSON.stringify({ok:true,passed:checks.length,checks,scope:'Disposable real GoTrue/PostgREST, vendored SDK and unmodified PartyAccess; all six editions. No hosted users, game rows or DOM-rendering claim.'},null,2));
}catch(error){
  console.error(JSON.stringify({ok:false,case:currentCase,code:error?.code||null,error:error instanceof assert.AssertionError?error.message:'Party HTTP fixture failed; inspect isolated service logs without credentials'}));
  process.exitCode=1;
}finally{for(const value of realms)await value.close();}
