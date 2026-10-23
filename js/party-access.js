/* Authenticated transport for isolated move-based multiplayer rooms. */
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
    if(error&&(/not your active turn|selected room|instance unavailable/i.test(error.message)))return 'It is not your turn. Watch the big screen for the next turn.';
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
  function create(url,key,options){
    options=options||{};
    const family=options.family,edition=options.edition;
    if(!['creak','standing','circuit','spines'].includes(family)||!['general','bible'].includes(edition)||(edition==='bible'&&!['circuit','spines'].includes(family)))throw new Error('Unknown game edition.');
    const namespace='tb_party_'+family+'_'+edition;
    const AUTH_KEY=namespace+'_auth_v1',HOST_KEY=namespace+'_host_v1',PLAYER_KEY=namespace+'_player_v1';
    let client=null,readyPromise=null,hostRoom=null,tail=Promise.resolve(),busyCount=0,pending=null,issueHandler=null;
    function sdk(){
      if(client)return client;
      if(!global.supabase||typeof global.supabase.createClient!=='function')throw new Error('The game connection did not load. Reload this page.');
      client=global.supabase.createClient(url,key,{auth:{storageKey:AUTH_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch:boundedFetch}});
      return client;
    }
    async function ready(){
      if(readyPromise)return readyPromise;
      readyPromise=(async()=>{
        const api=sdk(),restored=await api.auth.getSession();if(restored.error)throw problem(restored.error);
        if(!restored.data||!restored.data.session){const signed=await api.auth.signInAnonymously();if(signed.error)throw problem(signed.error);}
        const checked=await api.auth.getUser();if(checked.error)throw problem(checked.error);
        if(!checked.data||!checked.data.user||!checked.data.user.id)throw new Error('Your game connection could not be verified. Reload this page.');
        return checked.data.user;
      })();
      try{return await readyPromise;}catch(error){readyPromise=null;throw error;}
    }
    async function rpc(name,args){
      await ready();
      const result=await sdk().rpc('party_'+name,Object.assign({p_family:family,p_edition:edition},args||{}));
      if(result.error)throw problem(result.error,result.status);return result.data;
    }
    function adopt(next){
      if(!next||!next.code)return;
      if(next.family!==family||next.edition!==edition)throw new Error('This room belongs to a different game edition.');
      if(!hostRoom||hostRoom.id!==next.id||Number(next.version)>=Number(hostRoom.version))hostRoom=next;
    }
    function notify(detail){if(issueHandler)issueHandler(detail);}
    function hostMutation(name,base,versioned,resultRoom){
      const original=copy(base||{}),requestId=uuid();busyCount++;
      const task=tail.then(async()=>{
        const request=Object.assign({},original,{p_request_id:requestId});
        if(versioned){
          if(!hostRoom)throw new Error('Open a room before starting the game.');
          request.p_code=hostRoom.code;request.p_expected_version=hostRoom.version;
          if(name!=='begin_run')request.p_run_id=hostRoom.run_id;
        }
        while(true){
          try{
            const result=await rpc(name,request);if(resultRoom)adopt(resultRoom(result));
            pending=null;notify({recovered:true});return result;
          }catch(error){
            await new Promise(resolve=>{pending={error,retry:resolve};notify({error,message:message(error),canRetry:error.code!=='PT409'});});
          }
        }
      });
      tail=task.catch(()=>{});return task.finally(()=>{busyCount--;});
    }
    return {
      ready,uuid,message,
      onIssue(fn){issueHandler=fn;},currentRoom(){return hostRoom;},busy(){return busyCount>0;},
      retry(){if(pending&&pending.error.code!=='PT409'){const again=pending.retry;pending=null;again();}},
      savedHostCode(){return read(HOST_KEY);},savedPlayerCode(){return read(PLAYER_KEY);},
      rememberPlayer(code){write(PLAYER_KEY,code);},
      forgetHost(){if(busyCount)throw new Error('Wait for the current game update before opening another room.');write(HOST_KEY,'');hostRoom=null;},
      async createRoom(){const next=await hostMutation('create_room',{},false,x=>x);write(HOST_KEY,next.code);return next;},
      async resumeHost(code){const next=await rpc('host_resume',{p_code:code});adopt(next);return next;},
      beginRun(){return hostMutation('begin_run',{},true,x=>x);},
      publish(patch){return hostMutation('host_publish',{p_patch:copy(patch)},true,x=>x);},
      close(windowId){
        const id=windowId||(hostRoom&&hostRoom.action&&hostRoom.action.id);
        if(!id)return Promise.reject(new Error('No action is open.'));
        return hostMutation('host_close',{p_window_id:id},true,x=>x.room);
      },
      members(code){return rpc('host_members',{p_code:code});},
      actions(code,run,windowId,cursor=0){return rpc('host_actions',{p_code:code,p_run_id:run,p_window_id:windowId,p_cursor:cursor});},
      preview(code){return rpc('preview',{p_code:code});},
      join(code,name){return rpc('join',{p_code:code,p_name:name});},
      membership(code){return rpc('my_membership',{p_code:code});},
      heartbeat(code,look){const args={p_code:code};if(look!==undefined)args.p_look=copy(look);return rpc('heartbeat',args);},
      leave(code){return rpc('leave',{p_code:code});},
      playerState(code){return rpc('player_state',{p_code:code});},
      submit(code,run,windowId,choice,requestId){return rpc('submit',{p_code:code,p_run_id:run,p_window_id:windowId,p_choice:String(choice),p_request_id:requestId||uuid()});},
      activityStart(code,run,windowId,requestId){return rpc('activity_start',{p_code:code,p_run_id:run,p_window_id:windowId,p_request_id:requestId||uuid()});},
      event(code,run,windowId,activityId,eventSeq,event,requestId){return rpc('event',{p_code:code,p_run_id:run,p_window_id:windowId,p_activity_id:activityId,p_event_seq:eventSeq,p_event:copy(event),p_request_id:requestId||uuid()});}
    };
  }
  global.PartyAccess=Object.freeze({create});
})(window);
