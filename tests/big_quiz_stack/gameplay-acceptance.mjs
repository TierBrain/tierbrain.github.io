// Real HTTP gameplay checks for the disposable Auth/PostgREST fixture only.
// No locally signed tokens, role/claim injection, database connection or production URL.
import {randomUUID} from 'node:crypto';
process.env.STACK_DRIVER_LIBRARY='1';
const {anonymous,rpc,success,request,AUTH,verifyIdentity}=await import(process.env.STACK_HELPERS || '/tmp/acceptance.mjs');
let stage='initialize',checks=[];
function check(condition,label){stage=label;if(!condition)throw new Error('Acceptance assertion failed');}
function record(label){checks.push(label);}
async function fresh(session){
  const exp=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString()).exp;
  if(exp*1000-Date.now()<20000){
    stage='refresh a genuine Auth-issued session';
    const next=success(await request(AUTH,'/token?grant_type=refresh_token',{body:{refresh_token:session.refresh_token}}),stage);
    check(next.user.id===session.user.id,'refresh retains the verified identity');Object.assign(session,next);
  }
}
async function ok(session,name,args={},label=name){stage=label;await fresh(session);return success(await rpc(session,name,args),label);}
async function reject(session,name,args,state,label){
  stage=label;await fresh(session);const result=await rpc(session,name,args);
  check(result.status>=400&&result.status<600&&result.data?.code===state,label);
}
const base={teams:{youth:'Team A',adult:'Team B'},round:'HTTP synthetic round'};
const opts=['Alpha','Beta','Gamma','Delta'];
function normal(kind='mc'){return {...base,qnum:1,qtotal:2,live:true,qkind:kind,qtext:'Synthetic question?',opts,correct:2,private_hint:'MUST_NOT_ESCAPE'};}

try{
  stage='create four independent anonymous Auth sessions';
  const [H,P1,P2,O]=await Promise.all([anonymous(),anonymous(),anonymous(),anonymous()]);
  check(new Set([H,P1,P2,O].map(s=>s.user.id)).size===4,'four genuine identities are distinct');
  for(const session of [H,P1,P2,O])await verifyIdentity(session);
  const createArgs={p_request_id:randomUUID()};
  let room=await ok(H,'bigquiz_create_room',createArgs);
  check(JSON.stringify(Object.keys(room.state).sort())==='["teams"]','General room configuration contains teams only');
  const sameRoom=await ok(H,'bigquiz_create_room',createArgs);
  check(JSON.stringify(sameRoom)===JSON.stringify(room),'create retry returns the original room');
  const code=room.code,expiry=room.expires_at;
  const m1=await ok(P1,'bigquiz_join',{p_code:code,p_name:'Player One',p_tag:'youth'});
  const m2=await ok(P2,'bigquiz_join',{p_code:code,p_name:'Player Two',p_tag:'adult'});
  const resumed=await ok(P1,'bigquiz_join',{p_code:code,p_name:'Cannot rename',p_tag:'adult'});
  check(resumed.id===m1.id&&resumed.name===m1.name&&resumed.tag===m1.tag,'reconnect cannot rewrite membership');
  const foreignRoom=await ok(O,'bigquiz_create_room',{p_request_id:randomUUID()});
  const foreign=await ok(O,'bigquiz_join',{p_code:foreignRoom.code,p_name:'Foreign member',p_tag:'youth'});
  for(const s of [P1,P2,O])await reject(s,'bigquiz_host_resume',{p_code:code},'42501','room code cannot grant host authority');
  await reject(O,'bigquiz_player_state',{p_code:code},'42501','outsider cannot poll a private room');
  const preview=await ok(O,'bigquiz_preview',{p_code:code});
  check(JSON.stringify(Object.keys(preview).sort())==='["code","phase","state"]'&&!('opts' in preview.state),'prejoin preview is minimal');
  check(!('bible' in preview.state),'General preview does not carry Bible edition settings');
  record('real host, two players and outsider have distinct identity-scoped access');

  const beginArgs={p_code:code,p_expected_version:room.version,p_request_id:randomUUID()};
  room=await ok(H,'bigquiz_begin_run',beginArgs);const firstRun=room.run_id;
  check(JSON.stringify(await ok(H,'bigquiz_begin_run',beginArgs))===JSON.stringify(room),'begin-run retry is stable');
  await reject(H,'bigquiz_begin_run',{...beginArgs,p_request_id:randomUUID()},'PT409','stale host version is rejected');
  function publishArgs(phase,mode,ri,qi,state){return {p_code:code,p_run_id:room.run_id,p_expected_version:room.version,p_request_id:randomUUID(),p_patch:{phase,round_type:mode,round_index:ri,q_index:qi,q_id:room.run_id+':p'+ri+'q'+qi,state}};}
  async function publish(phase,mode,ri,qi,state){const args=publishArgs(phase,mode,ri,qi,state);room=await ok(H,'bigquiz_host_publish',args);return args;}
  async function close(){const args={p_code:code,p_run_id:room.run_id,p_question_key:room.q_id,p_expected_version:room.version,p_request_id:randomUUID()};const result=await ok(H,'bigquiz_close_submissions',args);room=result.room;return {args,result};}
  function answerArgs(choice,key=room.q_id){return {p_code:code,p_question_key:key,p_choice:choice};}
  function awardArgs(member,points,key=room.q_id,run=room.run_id){return {p_code:code,p_run_id:run,p_question_key:key,p_member_id:member.id,p_points:points};}
  const firstPublish=await publish('question','rapidfire',0,0,normal()),firstKey=room.q_id;
  check(JSON.stringify(await ok(H,'bigquiz_host_publish',firstPublish))===JSON.stringify(room),'publication retry does not change version');
  await reject(H,'bigquiz_host_publish',{...firstPublish,p_patch:{...firstPublish.p_patch,state:{...normal(),qtext:'Changed'}}},'22023','request UUID cannot carry changed data');
  await reject(P1,'bigquiz_host_publish',{...firstPublish,p_request_id:randomUUID()},'42501','player cannot publish host state');
  const visible=await ok(P1,'bigquiz_player_state',{p_code:code});
  check(!('correct' in visible.state)&&!('private_hint' in visible.state)&&!JSON.stringify(visible).includes('MUST_NOT_ESCAPE'),'normal poll conceals unrevealed answer and unknown fields');
  check(!('bible' in visible.state),'General question works without a Bible field');
  await reject(P1,'bigquiz_answer',{...answerArgs(2),p_member_id:m2.id},'PGRST202','answer endpoint rejects a nominated member argument');
  await reject(P1,'bigquiz_host_answers',{p_code:code,p_run_id:firstRun,p_question_key:firstKey},'42501','player cannot read the host answer list');
  const [a1,a1Retry]=await Promise.all([ok(P1,'bigquiz_answer',answerArgs(2)),ok(P1,'bigquiz_answer',answerArgs(2))]);
  check(a1.player_id===m1.id&&JSON.stringify(a1)===JSON.stringify(a1Retry),'concurrent identical answers create one canonical acknowledgement');
  await reject(P1,'bigquiz_answer',answerArgs(1),'23505','conflicting answer retry is rejected');
  await reject(O,'bigquiz_answer',answerArgs(2),'42501','foreign-room membership cannot submit here');
  const closed=await close();
  check(closed.result.answers.length===1&&closed.result.answers[0].player_id===m1.id,'close returns the stable accepted-answer snapshot');
  check(JSON.stringify(await ok(H,'bigquiz_close_submissions',closed.args))===JSON.stringify(closed.result),'close retry preserves its snapshot');
  await reject(P2,'bigquiz_answer',answerArgs(2),'42501','late new answer is rejected after closure');
  const firstAward=awardArgs(m1,10);
  await reject(P1,'bigquiz_award',firstAward,'42501','player cannot grant points');
  await reject(H,'bigquiz_award',awardArgs(foreign,10),'42501','host cannot award a foreign-room member');
  await reject(H,'bigquiz_award',awardArgs(m1,16),'22023','normal award bound is enforced');
  const [aw1,aw2]=await Promise.all([ok(H,'bigquiz_award',firstAward),ok(H,'bigquiz_award',firstAward)]);
  check(aw1.score===10&&aw2.score===10&&aw1.already_awarded!==aw2.already_awarded,'concurrent normal awards increment only once');
  const repeated=await ok(H,'bigquiz_award',firstAward);
  check(repeated.already_awarded&&repeated.score===10,'award retry cannot add points twice');
  await reject(H,'bigquiz_award',{...firstAward,p_points:11},'23505','conflicting award is rejected');
  await publish('reveal','rapidfire',0,0,normal());
  check((await ok(P1,'bigquiz_player_state',{p_code:code})).state.correct===2,'normal reveal publishes its answer');
  record('normal answers, stable closure, replay-safe scoring and reveal work through verified JWTs');

  const verse={...normal('verse-blank'),qtext:'Synthetic {b} phrase',prompt:'',correct:1};
  await publish('question','verse',1,0,verse);
  await ok(P2,'bigquiz_answer',answerArgs(1));await close();
  check((await ok(H,'bigquiz_award',awardArgs(m2,15))).score===15,'verse award accepts the upper normal bound');
  await publish('reveal','verse',1,0,verse);
  check((await ok(P2,'bigquiz_player_state',{p_code:code})).state.correct===1,'verse reveal works');
  await reject(P2,'bigquiz_answer',answerArgs(2,firstKey),'42501','fresh answer cannot target an advanced question');
  check((await ok(P1,'bigquiz_answer',answerArgs(2,firstKey))).created_at===a1.created_at,'accepted old answer retry remains idempotent');
  await reject(H,'bigquiz_host_publish',{...firstPublish,p_expected_version:room.version,p_request_id:randomUUID()},'22023','host cannot reopen an old question');
  record('General Fill the Gap mode with empty prompt and advanced-question replay boundaries work over HTTP');

  const buzzer={...base,qnum:1,qtotal:2,bz:{phase:'arm',opts,correct:2,live:true,qtext:'Synthetic buzzer?',lanes:{youth:{st:'open',bid:null,out:[]},adult:{st:'open',bid:null,out:[]}}}};
  await publish('buzzer','buzzer',2,0,buzzer);
  await reject(P1,'bigquiz_buzz',{p_code:code,p_question_key:room.q_id},'42501','armed buzzer rejects early buzz');
  buzzer.bz.phase='open';await publish('buzzer','buzzer',2,0,buzzer);
  check((await ok(P1,'bigquiz_player_state',{p_code:code})).state.bz.correct===null,'open buzzer conceals correct index');
  const buzzArgs={p_code:code,p_question_key:room.q_id};
  const [b1,b2]=await Promise.all([ok(P1,'bigquiz_buzz',buzzArgs),ok(P2,'bigquiz_buzz',buzzArgs)]);
  check(b1.player_id===m1.id&&b1.tag==='youth'&&b2.player_id===m2.id&&b2.tag==='adult','buzz identities and teams are canonical');
  check(JSON.stringify(await ok(P1,'bigquiz_buzz',buzzArgs))===JSON.stringify(b1),'buzz retry is idempotent');
  await reject(P1,'bigquiz_answer',answerArgs(2),'42501','unselected player cannot answer a buzzer question');
  const bad=structuredClone(buzzer);bad.bz.lanes.youth={st:'answering',bid:m2.id,out:[]};
  await reject(H,'bigquiz_host_publish',publishArgs('buzzer','buzzer',2,0,bad),'22023','host cannot nominate a player in the other team lane');
  buzzer.bz.lanes.youth={st:'answering',bid:m1.id,out:[]};buzzer.bz.lanes.adult={st:'answering',bid:m2.id,out:[]};
  await publish('buzzer','buzzer',2,0,buzzer);
  await Promise.all([ok(P1,'bigquiz_answer',answerArgs(2)),ok(P2,'bigquiz_answer',answerArgs(1))]);
  await reject(H,'bigquiz_award',awardArgs(m1,11),'22023','buzzer points must be exactly ten');
  check((await ok(H,'bigquiz_award',awardArgs(m1,10))).score===20,'youth buzzer award increments once');
  check((await ok(H,'bigquiz_award',awardArgs(m2,10))).score===25,'adult buzzer award increments once');
  const m3=await ok(O,'bigquiz_join',{p_code:code,p_name:'Later Player',p_tag:'youth'});
  buzzer.bz.lanes.youth={st:'open',bid:null,out:[m1.id]};await publish('buzzer','buzzer',2,0,buzzer);
  await ok(O,'bigquiz_buzz',buzzArgs);buzzer.bz.lanes.youth={st:'answering',bid:m3.id,out:[m1.id]};await publish('buzzer','buzzer',2,0,buzzer);
  await ok(O,'bigquiz_answer',answerArgs(0));
  await reject(H,'bigquiz_award',awardArgs(m3,10),'23505','one buzzer team cannot receive a second winner award');
  buzzer.bz.phase='reveal';buzzer.bz.lanes.youth={st:'done',bid:m1.id,out:[],win:m1.name};buzzer.bz.lanes.adult={st:'done',bid:m2.id,out:[],win:m2.name};
  await publish('buzzer','buzzer',2,0,buzzer);
  check((await ok(P2,'bigquiz_player_state',{p_code:code})).state.bz.correct===2,'buzzer reveal publishes its answer');
  record('both buzzer teams, lane eligibility, retries and one-winner scoring work over HTTP');

  const clues={...base,qnum:1,qtotal:2,fc:{phase:'clue',opts,correct:3,clueIdx:0,pointsNow:999,live:true,cat:'Synthetic object',clues:['First synthetic clue'],private_hint:'MUST_NOT_ESCAPE'}};
  await publish('fiveclues','fiveclues',3,0,clues);const clueKey=room.q_id;
  const clueView=(await ok(P1,'bigquiz_player_state',{p_code:code})).state.fc;
  check(clueView.correct===null&&clueView.pointsNow===5&&clueView.clues.length===1&&!('private_hint' in clueView),'clue state exposes only its current prefix and derived points');
  await Promise.all([ok(P1,'bigquiz_answer',answerArgs(3)),ok(P2,'bigquiz_answer',answerArgs(3))]);
  check((await close()).result.answers.length===2,'clue close captures both accepted answers');
  await reject(O,'bigquiz_answer',answerArgs(3),'42501','new late clue answer is rejected');
  await reject(H,'bigquiz_award',awardArgs(m1,6),'22023','clue award upper bound is enforced');
  check((await ok(H,'bigquiz_award',awardArgs(m1,1))).score===21,'clue lower-bound points accumulate');
  check((await ok(H,'bigquiz_award',awardArgs(m2,5))).score===30,'clue upper-bound points accumulate');
  clues.fc.phase='reveal';await publish('fiveclues','fiveclues',3,0,clues);
  check((await ok(P2,'bigquiz_player_state',{p_code:code})).state.fc.correct===3,'clue reveal publishes its answer');
  record('Five Clues input closure, bounds, private state and reveal work over HTTP');

  room=await ok(H,'bigquiz_host_publish',{p_code:code,p_run_id:room.run_id,p_expected_version:room.version,p_request_id:randomUUID(),p_patch:{phase:'final',q_id:'',state:{...base,fin:{youth:{total:999999},adult:{total:999999},teamWin:'forged'}}}});
  const fin=(await ok(P1,'bigquiz_player_state',{p_code:code})).state.fin;
  check(fin.youth.total===21&&fin.adult.total===30&&fin.teamWin==='adult','final totals come from canonical scores');
  check((await ok(H,'bigquiz_host_members',{p_code:code})).every(m=>!('user_id' in m)&&!('host_user_id' in m)),'roster does not expose Auth identities');
  check((await ok(O,'bigquiz_leave',{p_code:code})).left===true,'explicit leave is acknowledged');
  check(await ok(O,'bigquiz_my_membership',{p_code:code})===null,'leave removes active membership');
  await reject(O,'bigquiz_player_state',{p_code:code},'42501','left member cannot continue polling');
  const rejoined=await ok(O,'bigquiz_join',{p_code:code,p_name:'Rejoined Player',p_tag:'youth'});
  check(rejoined.id!==m3.id&&rejoined.score===0,'explicit rejoin receives a fresh zero-score membership');
  const previousRun=room.run_id;
  room=await ok(H,'bigquiz_begin_run',{p_code:code,p_expected_version:room.version,p_request_id:randomUUID()});
  check(room.run_id!==previousRun&&room.expires_at===expiry,'restart creates a new run without extending expiry');
  await reject(O,'bigquiz_answer',answerArgs(3,clueKey),'42501','fresh old-run answer is rejected');
  await reject(H,'bigquiz_host_publish',{...firstPublish,p_expected_version:room.version,p_request_id:randomUUID()},'22023','fresh old-run host write is rejected');
  check((await ok(H,'bigquiz_award',firstAward)).already_awarded,'committed old award retry remains idempotent after restart');
  check((await ok(P1,'bigquiz_my_membership',{p_code:code})).score===21&&(await ok(P2,'bigquiz_heartbeat',{p_code:code})).score===30,'restart preserves identities and accumulated scores');
  room=await ok(H,'bigquiz_host_publish',{p_code:code,p_run_id:room.run_id,p_expected_version:room.version,p_request_id:randomUUID(),p_patch:{phase:'closing',q_id:'',state:{...base,close:{ref:'',text:'Synthetic closing word'}}}});
  const closing=await ok(P2,'bigquiz_player_state',{p_code:code});
  check(closing.phase==='closing'&&closing.state.close.text==='Synthetic closing word'&&!closing.state.close.ref,'General closing accepts an empty reference');
  record('canonical finals, leave/rejoin and fresh-run replay boundaries work over HTTP');
  console.log(JSON.stringify({ok:true,checks,scope:'local real Auth-issued JWT and PostgREST gameplay; host remains trusted grader; browser UI and hosted configuration are separate checks'},null,2));
}catch(error){
  console.error(JSON.stringify({ok:false,failed_check:stage,error_kind:error?.name||'Error'}));process.exitCode=1;
}
