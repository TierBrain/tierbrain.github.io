// Run inside the isolated Node driver container; no host-published endpoints.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export const AUTH = 'http://auth:9999';
export const REST = 'http://rest:3000';
export async function request(base, path, {token, body, method, headers={}}={}) {
  const response = await fetch(base + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {...(body === undefined ? {} : {'content-type':'application/json'}),
      ...(token ? {authorization:`Bearer ${token}`} : {}), ...headers},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  return {status:response.status, data};
}
export function success(result, label) {
  assert(result.status >= 200 && result.status < 300,
    `${label}: unexpected HTTP ${result.status}; server code ${result.data?.code || 'unavailable'}`);
  return result.data;
}
export function denied(result, label, statuses=[401,403]) {
  assert(statuses.includes(result.status), `${label}: expected denial, got HTTP ${result.status}`);
}
export async function rpc(session, name, body={}) {
  return request(REST, '/rpc/'+name, {token:session?.access_token, body});
}
export async function anonymous() {
  const session = success(await request(AUTH, '/signup', {body:{}}), 'anonymous signup');
  assert(session.access_token && session.refresh_token && session.user?.id, 'Auth must issue a complete session');
  const user = success(await request(AUTH, '/user', {token:session.access_token}), 'Auth user verification');
  assert.equal(user.id, session.user.id);
  assert.equal(user.is_anonymous, true);
  return session;
}
export async function verifyIdentity(session) {
  const identity = success(await rpc(session, 'stack_whoami'), 'PostgREST verified identity');
  assert.equal(identity.uid, session.user.id, 'auth.uid must equal identity independently verified by Auth');
  assert.equal(identity.role, 'authenticated');
  assert.equal(identity.is_anonymous, true);
}
export async function waitFor(base, path, maxMs=90000) {
  const deadline=Date.now()+maxMs;
  while (Date.now()<deadline) {
    try {
      const response=await request(base,path);
      if (response.status>=200 && response.status<300) return;
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error(`Service was not healthy within ${maxMs/1000}s`);
}

export async function main() {
  const passed=[];
  await waitFor(AUTH,'/health');
  await waitFor(REST,'/');
  const [host,player1,player2,outsider] = await Promise.all([anonymous(),anonymous(),anonymous(),anonymous()]);
  assert.equal(new Set([host,player1,player2,outsider].map(s=>s.user.id)).size,4);
  for (const session of [host,player1,player2,outsider]) await verifyIdentity(session);
  passed.push('four distinct real anonymous Auth identities reach PostgREST auth.uid');

  denied(await rpc(null,'stack_whoami'), 'missing bearer');
  denied(await rpc({access_token:'not-a-jwt'},'stack_whoami'), 'malformed bearer', [401]);
  const parts=host.access_token.split('.');
  const tampered=[parts[0],parts[1],(parts[2][0]==='A'?'B':'A')+parts[2].slice(1)].join('.');
  denied(await rpc({access_token:tampered},'stack_whoami'),'invalid signature',[401]);
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  const forged=[parts[0],Buffer.from(JSON.stringify({...claims,sub:player1.user.id})).toString('base64url'),parts[2]].join('.');
  denied(await rpc({access_token:forged},'stack_whoami'),'forged subject',[401]);
  passed.push('absent, malformed, tampered and forged JWTs rejected');

  const room=success(await rpc(host,'show_create_room',{p_request_id:randomUUID()}),'host creates room');
  const playerArgs={p_code:room.code,p_name:'Player One',p_tag:'youth'};
  const member1=success(await rpc(player1,'show_join',playerArgs),'player one joins');
  const member2=success(await rpc(player2,'show_join',{...playerArgs,p_name:'Player Two',p_tag:'adult'}),'player two joins');
  assert.notEqual(member1.id,member2.id);
  const members=success(await rpc(host,'show_host_members',{p_code:room.code}),'host reads members');
  assert.equal(members.length,2);
  for (const session of [player1,player2,outsider]) {
    denied(await rpc(session,'show_host_resume',{p_code:room.code}),'nonhost cannot resume host');
    denied(await rpc(session,'show_host_members',{p_code:room.code}),'nonhost cannot read host member list');
    denied(await rpc(session,'show_begin_run',{p_code:room.code,p_expected_version:room.version,p_request_id:randomUUID()}),'nonhost cannot begin run');
  }
  denied(await rpc(outsider,'show_player_state',{p_code:room.code}),'outsider cannot poll player state');
  const preview=success(await rpc(outsider,'show_preview',{p_code:room.code}),'verified outsider limited preview');
  assert.deepEqual(Object.keys(preview).sort(),['code','phase','state']);
  success(await rpc(player1,'show_player_state',{p_code:room.code}),'member polls state');
  passed.push('real host and two members isolated from player and outsider host operations');

  for (const session of [null,host,player1,outsider]) {
    for (const table of ['rooms','members','questions','answers','buzzes','awards','requests']) {
      denied(await request(REST,'/'+table,{token:session?.access_token,headers:{'accept-profile':'show_private'}}),
        'private schema direct SELECT',[406]);
      denied(await request(REST,'/'+table,{token:session?.access_token,method:'PATCH',body:{score:999999},headers:{'content-profile':'show_private'}}),
        'private schema direct PATCH',[406]);
      denied(await request(REST,'/'+table,{token:session?.access_token}), 'private table not exposed through public schema',[404]);
    }
  }
  passed.push('anonymous and authenticated callers cannot directly read or write any private Show table');

  const expiresAt=claims.exp*1000;
  assert(Number.isInteger(claims.exp) && Number.isInteger(claims.iat)
    && claims.exp>claims.iat && claims.exp-claims.iat<=75,
    'disposable Auth must issue a short-lived JWT for real expiry verification');
  // JWT verifiers can permit clock skew around exp. Do not assume exp+1.5s is
  // enough, and never count an unrelated/pre-expiry denial as expiry evidence.
  // Every individual wait is short; the entire post-expiry window is bounded.
  while(Date.now()<=expiresAt) {
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000,expiresAt-Date.now()+1)));
  }
  const expiryDeadline=expiresAt+40000;
  let rejectedAt=null,lastAcceptedAt=null;
  while(Date.now()<=expiryDeadline) {
    const probe=await rpc(host,'stack_whoami');
    const observedAt=Date.now();
    if(probe.status===401) {
      assert(observedAt>expiresAt,'JWT denial must occur after its declared expiry');
      assert(/jwt expired|token.*expired|expired.*token/i.test(probe.data?.message||''),
        'post-expiry denial must specifically report expired JWT credentials');
      rejectedAt=observedAt;
      break;
    }
    assert.equal(probe.status,200,'pre-denial expiry probes must remain valid, not fail for another reason');
    assert.equal(probe.data?.uid,host.user.id,'accepted expiry probe must retain the original verified subject');
    lastAcceptedAt=observedAt;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert(rejectedAt!==null,'Auth-issued JWT was not rejected within 40 seconds after declared expiry');
  assert(rejectedAt<=expiryDeadline,'Expired-JWT rejection exceeded the bounded 40-second window');
  const expiryObservation={
    jwt_lifetime_seconds:claims.exp-claims.iat,
    maximum_post_expiry_window_ms:40000,
    last_accepted_after_expiry_ms:lastAcceptedAt===null?null:lastAcceptedAt-expiresAt,
    rejected_after_expiry_ms:rejectedAt-expiresAt,
    interpretation:'Observed acceptance/rejection timing includes polling and HTTP latency; it is not a configuration read.',
  };
  const refreshed=success(await request(AUTH,'/token?grant_type=refresh_token',{body:{refresh_token:host.refresh_token}}),'anonymous refresh');
  assert.equal(refreshed.user.id,host.user.id);
  assert.equal(refreshed.user.is_anonymous,true);
  await verifyIdentity(refreshed);
  success(await rpc(refreshed,'show_host_resume',{p_code:room.code}),'refreshed identity retains host authorization');
  passed.push('genuinely expired JWT rejected and real refresh preserves anonymous host identity');

  console.log(JSON.stringify({ok:true,checks:passed,jwt_expiry:expiryObservation,scope:'local disposable Auth/PostgREST acceptance; full gameplay and browser acceptance still required'},null,2));
}
if (process.env.STACK_DRIVER_LIBRARY !== '1') {
  try { await main(); }
  catch (error) {
    console.error(JSON.stringify({ok:false,error:error instanceof assert.AssertionError ? error.message : 'Driver/service failure; inspect disposable container logs without printing credentials'}));
    process.exitCode=1;
  }
}
