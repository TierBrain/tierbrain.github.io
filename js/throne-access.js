/* Authenticated Hold The Throne transport. Each edition has isolated hints. */
(function(global){
  'use strict';
  function uuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function')return global.crypto.randomUUID();
    const bytes=new Uint8Array(16);global.crypto.getRandomValues(bytes);
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  }
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function read(key){try{return global.localStorage.getItem(key)||'';}catch(e){return '';}}
  function write(key,value){try{if(value)global.localStorage.setItem(key,value);else global.localStorage.removeItem(key);}catch(e){}}
  function problem(error,status){
    const e=new Error(error&&error.message?error.message:'The connection was interrupted.');
    e.code=error&&error.code?String(error.code):'';e.status=status||(error&&error.status)||0;
    return e;
  }
  function message(error){
    if(error&&error.code==='PT409')return 'Another host window changed this room. Close the extra host windows and reload this one.';
    if(error&&error.status===429)return 'Too many join requests from this network. Please wait a while before trying again.';
    if(error&&(/anonymous|signups.*disabled|signup.*disabled/i.test(error.message)||error.code==='anonymous_provider_disabled'))return 'Guest access is not available yet. Ask the host to check the game setup, then try again.';
    if(error&&(error.status===401||/session|token.*expired|refresh.*token|jwt/i.test(error.message)))return 'Your connection needs to be renewed. Reload this page and rejoin if asked.';
    if(error&&(/closed|not accepting|question.*active|question.*current|question unavailable/i.test(error.message)))return 'This question has closed. Watch for the next question.';
    if(error&&(/current answerer|buzzer is not open|accepting your answer/i.test(error.message)))return 'It is not your turn to answer. Watch the big screen.';
    if(error&&(error.code==='42501'||error.status===403))return 'This browser cannot access that room. Check the room code or ask the host for a new one.';
    if(error&&(/expired|not found|does not exist|no active/i.test(error.message)))return 'That room is no longer available. Check the code on the big screen.';
    return 'Could not reach the game. Check your connection and try again.';
  }
  function boundedFetch(input,options){
    const controller=new AbortController(),given=options&&options.signal;
    const abort=()=>controller.abort();
    if(given){if(given.aborted)abort();else given.addEventListener('abort',abort,{once:true});}
    const timer=setTimeout(abort,15000);
    return global.fetch(input,Object.assign({},options||{},{signal:controller.signal})).finally(()=>{
      clearTimeout(timer);if(given)given.removeEventListener('abort',abort);
    });
  }
  function create(url,key,edition){
    if(!['general','bible'].includes(edition))throw new Error('Choose a valid Throne edition.');
    const namespace='tb_throne_'+edition;
    const AUTH_KEY=namespace+'_auth_v1',HOST_KEY=namespace+'_host_room_v1',PLAYER_KEY=namespace+'_player_room_v1';
    let client=null,readyPromise=null,hostRoom=null,tail=Promise.resolve(),busyCount=0,pending=null,issueHandler=null,clockOffset=0,lastServerNow=0;
    function sdk(){
      if(client)return client;
      if(!global.supabase||typeof global.supabase.createClient!=='function')throw new Error('The game connection did not load. Reload this page.');
      client=global.supabase.createClient(url,key,{
        auth:{storageKey:AUTH_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
        global:{fetch:boundedFetch}
      });
      return client;
    }
    async function ready(){
      if(readyPromise)return readyPromise;
      readyPromise=(async()=>{
        const api=sdk();
        const restored=await api.auth.getSession();if(restored.error)throw problem(restored.error);
        if(!restored.data||!restored.data.session){
          const joined=await api.auth.signInAnonymously();if(joined.error)throw problem(joined.error);
        }
        // getSession supplies credentials; the Auth server verifies the identity.
        const checked=await api.auth.getUser();if(checked.error)throw problem(checked.error);
        if(!checked.data||!checked.data.user||!checked.data.user.id)throw new Error('Your game connection could not be verified. Reload this page.');
        return checked.data.user;
      })();
      try{return await readyPromise;}catch(e){readyPromise=null;throw e;}
    }
    async function rpc(name,args,calibrate=true){
      await ready();
      const started=Date.now();
      const result=await sdk().rpc(name,Object.assign({},args||{},{p_edition:edition}));
      if(result.error)throw problem(result.error,result.status);
      const observed=result.data&&result.data.room?result.data.room:result.data;
      if(calibrate&&observed&&typeof observed.server_now==='number'&&observed.server_now>=lastServerNow){
        lastServerNow=observed.server_now;clockOffset=observed.server_now-(started+Date.now())/2;
      }
      return result.data;
    }
    function adopt(next){
      if(!next||!next.code)return;
      // An idempotent replay may return the original response, not a newer room.
      if(!hostRoom||hostRoom.id!==next.id||Number(next.version)>=Number(hostRoom.version))hostRoom=next;
    }
    function notify(detail){if(issueHandler)issueHandler(detail);}
    function hostMutation(name,base,versioned,roomResult,requestIdEnabled=true){
      const request=copy(base||{}),requestId=uuid();let uncertain=false;
      busyCount++;
      const task=tail.then(async()=>{
        if(versioned){
          if(!hostRoom)throw new Error('Open a room before starting the game.');
          request.p_expected_version=hostRoom.version;
        }
        if(requestIdEnabled)request.p_request_id=requestId;
        while(true){
          try{
            const result=await rpc(name,request,!uncertain);
            if(uncertain&&hostRoom){
              // A replay contains its original timestamp. Only a fresh read may
              // recalibrate the device clock after an uncertain acknowledgement.
              try{await rpc('throne_host_resume',{p_code:hostRoom.code});}catch(error){}
            }
            if(roomResult)adopt(roomResult(result));
            pending=null;notify({recovered:true});return result;
          }catch(error){
            // A seat/liveness conflict rolls the transaction back completely.
            // The caller must refresh the roster and make a new request.
            if(name==='throne_host_open_question'&&error.code==='PT412')throw error;
            uncertain=true;
            // Keep the exact request/version/UUID until its outcome is known.
            // The host can retry safely; later mutations remain in this queue.
            await new Promise(resolve=>{
              pending={error,retry:resolve};
              notify({error,message:message(error),canRetry:error.code!=='PT409'});
            });
          }
        }
      });
      tail=task.catch(()=>{});
      return task.finally(()=>{busyCount--;});
    }
    return {
      ready,uuid,message,
      now(){return Date.now()+clockOffset;},
      onIssue(fn){issueHandler=fn;},
      currentRoom(){return hostRoom;},
      busy(){return busyCount>0;},
      retry(){if(pending&&pending.error.code!=='PT409'){const retry=pending.retry;pending=null;retry();}},
      savedHostCode(){return read(HOST_KEY);},
      savedPlayerCode(){return read(PLAYER_KEY);},
      rememberPlayer(code){write(PLAYER_KEY,code);},
      forgetHost(){write(HOST_KEY,'');hostRoom=null;},
      async createRoom(){
        const next=await hostMutation('throne_create_room',{},false,x=>x);
        write(HOST_KEY,next.code);return next;
      },
      async resumeHost(code){const next=await rpc('throne_host_resume',{p_code:code});adopt(next);return next;},
      beginRun(config){return hostMutation('throne_begin_run',{p_code:hostRoom.code,p_config:copy(config)},true,x=>x);},
      publish(patch){return hostMutation('throne_host_publish',{p_code:hostRoom.code,p_run_id:hostRoom.run_id,p_patch:copy(patch)},true,x=>x);},
      openQuestion(question){return hostMutation('throne_host_open_question',{p_code:hostRoom.code,p_run_id:hostRoom.run_id,p_question:copy(question)},true,x=>x);},
      selectBuzz(question){return hostMutation('throne_host_select_buzz',{p_code:hostRoom.code,p_run_id:hostRoom.run_id,p_question_id:question},true,x=>x);},
      grade(question,answerer,correct){return hostMutation('throne_host_grade',{p_code:hostRoom.code,p_run_id:hostRoom.run_id,p_question_id:question,p_answerer_id:answerer,p_correct:correct},true,x=>x.room);},
      finalize(winner,group){return hostMutation('throne_finalize',{p_code:hostRoom.code,p_run_id:hostRoom.run_id,p_winner_id:winner,p_group_code:group},true,x=>x.room);},
      members(code){return rpc('throne_host_members',{p_code:code});},
      answers(code,run,question){return rpc('throne_host_answers',{p_code:code,p_run_id:run,p_question_id:question});},
      preview(code){return rpc('throne_preview',{p_code:code});},
      join(code,name){return rpc('throne_join',{p_code:code,p_name:name});},
      membership(code){return rpc('throne_my_membership',{p_code:code});},
      heartbeat(code){return rpc('throne_heartbeat',{p_code:code});},
      leave(code){return rpc('throne_leave',{p_code:code});},
      playerState(code){return rpc('throne_player_state',{p_code:code});},
      answer(code,question,choice){return rpc('throne_answer',{p_code:code,p_question_id:question,p_choice:choice});},
      buzz(code,question){return rpc('throne_buzz',{p_code:code,p_question_id:question});},
      legends(group){return rpc('throne_legends',{p_group_code:group});}

    };
  }
  global.ThroneAccess=Object.freeze({create});
})(window);
