/* Shared offline host/phone adapter. All fetches are intercepted by Playwright. */
(function(){
 window.PartyAccess={create(url,key,{family,edition}){
  const ns='party_shared_'+family+'_'+edition;
  let identity=localStorage.getItem(ns+'_identity');
  if(!identity){identity=crypto.randomUUID();localStorage.setItem(ns+'_identity',identity);}
  let room=null;
  async function call(op,args){
   const response=await fetch('/__party_fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity,family,edition,op,args})});
   const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.message),{code:value.code,status:response.status});
   return value;
  }
  const own=async(op,args)=>{const value=await call(op,args);room=value.room||value;return value;};
  return {
   ready:async()=>({id:identity}),uuid:()=>crypto.randomUUID(),message:e=>e.message,
   onIssue(){},busy:()=>false,retry(){},currentRoom:()=>room,
   savedHostCode:()=>localStorage.getItem(ns+'_host')||'',savedPlayerCode:()=>localStorage.getItem(ns+'_player')||'',
   rememberPlayer(code){if(code)localStorage.setItem(ns+'_player',code);else localStorage.removeItem(ns+'_player');},
   forgetHost(){localStorage.removeItem(ns+'_host');room=null;},
   async createRoom(){const value=await own('create',[]);localStorage.setItem(ns+'_host',value.code);return value;},
   resumeHost:code=>own('resume',[code]),beginRun:()=>own('begin',[room.code]),
   publish:patch=>own('publish',[room.code,patch]),close:(window=room.action.id)=>own('close',[room.code,window]),
   members:code=>call('members',[code]),actions:(code,run,window,cursor=0)=>call('actions',[code,run,window,cursor]),
   preview:code=>call('preview',[code]),join:(code,name)=>call('join',[code,name]),membership:code=>call('membership',[code]),
   heartbeat:(code,look)=>call('heartbeat',[code,look===undefined?null:look]),leave:code=>call('leave',[code]),
   playerState:code=>call('state',[code]),submit:(code,run,window,choice,request)=>call('submit',[code,run,window,choice,request])
  };
 }};
})();
