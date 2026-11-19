/* Authenticated Ten Lanterns phone-room transport. Mirrors js/ruffled-access.js. */
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
  /* The phone room type only works once its database change has been applied. */
  function unavailable(error){
    return !!(error&&(error.code==='PGRST202'||error.code==='42883'||error.status===404||/could not find the function|function .* does not exist/i.test(error.message||'')));
  }
  function message(error){
    if(unavailable(error))return 'Phone play is not switched on for this site yet. Play on one screen for now.';
    if(error&&error.code==='PT409')return 'Another host window changed this room. Close the extra host windows and reload this one.';
    if(error&&error.code==='PT412')return 'Someone has left or lost connection. The list of players has been refreshed.';
    if(error&&error.code==='23505')return 'That name is taken in this room. Try another.';
    if(error&&error.status===429)return 'Too many requests from this network. Please wait a moment and try again.';
    if(error&&(/anonymous|signups.*disabled|signup.*disabled/i.test(error.message)||error.code==='anonymous_provider_disabled'))return 'Guest access is not available yet. Ask the host to check the game setup, then try again.';
    if(error&&(error.status===401||/session|token.*expired|refresh.*token|jwt/i.test(error.message)))return 'Your connection needs to be renewed. Reload this page and rejoin if asked.';
    if(error&&/Beaten to it/.test(error.message))return 'Beaten to it!';
    if(error&&/Not yet/.test(error.message))return 'Not yet! Read the question first.';
    if(error&&/locked out/.test(error.message))return 'You are locked out of this question.';
    if(error&&/not your turn|closed|not in this one|Nothing to/.test(error.message))return 'This has moved on. Watch the big screen.';
    if(error&&/Name must/.test(error.message))return 'Choose a name of 1 to 14 characters.';
    if(error&&/Room player limit reached/.test(error.message))return 'This room is full.';
    if(error&&error.code==='54000')return 'The game limit has been reached. Try again later or play on one screen.';
    if(error&&(error.code==='42501'||error.status===403))return 'That room is no longer available. Check the code on the big screen.';
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
  function create(url,key){
    const AUTH_KEY='tb_lantern_auth_v1',HOST_KEY='tb_lantern_host_room_v1',PLAYER_KEY='tb_lantern_player_room_v1';
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
      const result=await sdk().rpc(name,args||{});
      if(result.error)throw problem(result.error,result.status);
      const observed=result.data;
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
    function hostMutation(name,base,versioned){
      const request=copy(base||{}),requestId=uuid();let uncertain=false;
      busyCount++;
      const task=tail.then(async()=>{
        if(versioned){
          if(!hostRoom)throw new Error('Open a room first.');
          request.p_expected_version=hostRoom.version;
        }
        request.p_request_id=requestId;
        while(true){
          try{
            const result=await rpc(name,request,!uncertain);
            adopt(result);pending=null;notify({recovered:true});return result;
          }catch(error){
            // Refusals that rolled back completely go straight to the caller.
            if(unavailable(error)||error.code==='PT412'||error.code==='22023'||error.code==='42501'||error.code==='54000')throw error;
            uncertain=true;
            // Keep the exact request/version/UUID until its outcome is known.
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
      ready,uuid,message,unavailable,
      now(){return Date.now()+clockOffset;},
      onIssue(fn){issueHandler=fn;},
      currentRoom(){return hostRoom;},
      busy(){return busyCount>0;},
      retry(){if(pending&&pending.error.code!=='PT409'){const retry=pending.retry;pending=null;retry();}},
      savedHostCode(){return read(HOST_KEY);},
      savedPlayerCode(){return read(PLAYER_KEY);},
      rememberPlayer(code){write(PLAYER_KEY,code);},
      forgetPlayer(){write(PLAYER_KEY,'');},
      forgetHost(){write(HOST_KEY,'');hostRoom=null;},
      async createRoom(){const next=await hostMutation('lantern_create_room',{},false);write(HOST_KEY,next.code);return next;},
      async hostState(code){const next=await rpc('lantern_host_state',{p_code:code||(hostRoom&&hostRoom.code)});adopt(next);return next;},
      beginGame(config){return hostMutation('lantern_begin_game',{p_code:hostRoom.code,p_config:copy(config)},true);},
      openPrompt(prompt){return hostMutation('lantern_open_prompt',{p_code:hostRoom.code,p_game_id:hostRoom.game_id,p_prompt:copy(prompt)},true);},
      endPrompt(promptId){return hostMutation('lantern_end_prompt',{p_code:hostRoom.code,p_prompt_id:promptId},true);},
      setPhase(phase){return hostMutation('lantern_set_phase',{p_code:hostRoom.code,p_phase:phase},true);},
      preview(code){return rpc('lantern_preview',{p_code:code});},
      join(code,name){return rpc('lantern_join',{p_code:code,p_name:name});},
      membership(code){return rpc('lantern_my_membership',{p_code:code});},
      leave(code){return rpc('lantern_leave',{p_code:code});},
      playerState(code){return rpc('lantern_player_state',{p_code:code});},
      press(code,prompt){return rpc('lantern_press',{p_code:code,p_prompt_id:prompt});},
      answer(code,prompt,choice){return rpc('lantern_answer',{p_code:code,p_prompt_id:prompt,p_choice:choice});}
    };
  }
  global.LanternAccess=Object.freeze({create});
})(window);

