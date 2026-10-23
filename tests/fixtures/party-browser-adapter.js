/* Offline browser fixture at the adapter boundary. No Auth/SQL verification. */
(function(){
  const clone=x=>JSON.parse(JSON.stringify(x));
  window.PartyAccess={create(url,key,options){
    const family=options.family,edition=options.edition,storage='party_browser_'+family+'_'+edition;
    let saved=null;try{saved=JSON.parse(localStorage.getItem(storage)||'null');}catch(e){}
    const members=['one','two','three'].map((id,i)=>({id,name:i<2?'Sam':'Casey',look:null,joined_at:new Date().toISOString(),last_seen:new Date().toISOString()}));
    const f=window.__partyFixture=Object.assign({family,edition,room:{id:'owned-room',code:'ABCDE',family,edition,phase:'lobby',state:{phase:'lobby'},run_id:null,version:0,action:null},members,member:null,calls:[],actions:[],counter:0},saved||{});
    f.persist=()=>localStorage.setItem(storage,JSON.stringify({family,edition,room:f.room,members:f.members,member:f.member,calls:f.calls,actions:f.actions,counter:f.counter}));
    f.note=(name,...args)=>{f.calls.push({name,args:clone(args)});f.persist();};
    f.roomCopy=()=>{f.persist();return clone(f.room);};
    f.receipt=(choice,kind,window,member='one')=>{const value={id:++f.counter,player_id:member,window_id:window,kind,choice};f.actions.push(value);f.persist();return clone(value);};
    function windowFor(patch){
      const s=patch.state;let key=null,kind=null,member=null;
      if(family==='spines'&&['choose','question'].includes(patch.phase)){kind=patch.phase==='choose'?'pick':'answer';key='s'+s.seq+':'+kind;member=s.turn;}
      if(family==='circuit'&&patch.phase==='room'){kind='stream';key='room:'+s.roomSeq+':'+s.room;member=s.player;}
      if(family==='circuit'&&patch.phase==='finale'&&s.fq){kind='finale';key='finale:'+s.fq.id;member=s.spark;}
      if(!key)return null;
      return f.room.action&&f.room.action.key===key?f.room.action:{id:'window-'+(++f.counter),key,kind,member_id:member,accepting:true,activity_id:null,next_event:0,completed:null};
    }
    return {
      ready:async()=>({id:'verified-offline-fixture'}),uuid:()=>crypto.randomUUID(),message:e=>e.message||'Connection interrupted',
      onIssue(){},busy:()=>false,retry(){},currentRoom:()=>f.room,
      savedHostCode:()=>localStorage.getItem(storage+'_host')||'',savedPlayerCode:()=>localStorage.getItem(storage+'_member')||'',
      rememberPlayer(code){if(code)localStorage.setItem(storage+'_member',code);else localStorage.removeItem(storage+'_member');},
      forgetHost(){localStorage.removeItem(storage+'_host');},
      async createRoom(){f.note('create');localStorage.setItem(storage+'_host','ABCDE');return f.roomCopy();},
      async resumeHost(code){f.note('resume',code);return f.roomCopy();},
      async beginRun(){f.note('begin');f.room.run_id=crypto.randomUUID();f.room.phase='lobby';f.room.state={phase:'lobby'};f.room.action=null;f.room.version++;return f.roomCopy();},
      async publish(patch){f.note('publish',patch);const action=windowFor(patch);f.room={...f.room,...clone(patch),version:f.room.version+1,action};return f.roomCopy();},
      async close(window){f.note('close',window);if(f.room.action)f.room.action.accepting=false;f.room.version++;return {room:f.roomCopy(),actions:clone(f.actions.filter(a=>a.window_id===window))};},
      async members(code){f.note('members',code);return clone(f.members);},
      async actions(code,run,window,cursor){f.note('actions',code,run,window,cursor);return clone(f.actions.filter(a=>a.window_id===window&&a.id>cursor));},
      async preview(code){f.note('preview',code);return {code,family,edition,phase:f.room.phase};},
      async join(code,name){f.note('join',code,name);f.member=clone(f.members[0]);f.persist();return clone(f.member);},
      async membership(code){f.note('membership',code);return clone(f.member);},
      async heartbeat(code,look){f.note('heartbeat',code,look===undefined?null:look);if(look&&f.member){f.member.look=clone(look);f.members[0].look=clone(look);}f.persist();return clone(f.member);},
      async leave(code){f.note('leave',code);f.member=null;f.persist();return {left:true};},
      async playerState(code){f.note('state',code);return {room:f.roomCopy(),member:clone(f.member),members:clone(f.members),receipts:clone(f.actions.filter(a=>f.room.action&&a.window_id===f.room.action.id&&a.player_id==='one'))};},
      async submit(code,run,window,choice,request){
        f.note('submit',code,run,window,choice,request);
        if(f.failSubmitOnce){f.failSubmitOnce=false;throw Object.assign(new Error('Response interrupted'),{status:503});}
        const accept=()=>{let receipt=f.actions.find(a=>a.window_id===window&&a.player_id==='one');if(!receipt)receipt=f.receipt(choice,f.room.action.kind,window);f.persist();return clone(receipt);};
        if(f.delaySubmit)return await new Promise(resolve=>{f.releaseSubmit=()=>{f.delaySubmit=false;resolve(accept());};});return accept();
      },
      async activityStart(code,run,window,request){f.note('start',code,run,window,request);const a=f.room.action;if(a.completed)return {activity_id:a.activity_id,next_event:a.next_event,completed:clone(a.completed)};a.activity_id=crypto.randomUUID();a.next_event=0;f.persist();return {activity_id:a.activity_id,next_event:0,completed:null};},
      async event(code,run,window,activity,seq,event,request){
        f.note('event',code,run,window,activity,seq,event,request);
        const receipt={id:++f.counter,player_id:'one',window_id:window,activity_id:activity,event_seq:seq,kind:'stream',event:clone(event),choice:JSON.stringify(event)};
        f.actions.push(receipt);if(f.room.action&&f.room.action.id===window){f.room.action.next_event=seq+1;if(event.t==='done'){f.room.action.accepting=false;f.room.action.completed=receipt;}}f.persist();return clone(receipt);
      }
    };
  }};
})();
