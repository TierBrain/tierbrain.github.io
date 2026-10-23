#!/usr/bin/env python3
"""Offline real-page checks for the Throne host and phone editions.

The adapter boundary is an in-memory fixture. Every HTTP/WebSocket request is
intercepted; this does not create Auth users, rooms or results in production.
Actual JWT/database boundaries are covered by the separate integration harness.
"""
from pathlib import Path
import json
import mimetypes
import os
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = r'''
(function(){
  const clone=value=>JSON.parse(JSON.stringify(value));
  window.ThroneAccess={create(url,key,edition){
    const store='throne_fixture_'+edition;
    const initial={id:'server-room-'+edition,code:'ABCDE',phase:'lobby',run_id:null,q_id:null,version:0,
      state:{phase:'lobby',live:true,champ:null,chal:null,queue:[],streak:0,bestStreak:{},totalCorrect:{},blemished:[],lastWinner:null,finaleScore:null,finaleWinner:null,qIndex:0,qTotal:3,mode:'spine',answerer:null,lockedOut:[],q:null,buzzOpenAt:0,buzzWin:0,ansWin:0,winner:null,summary:null}};
    let stored=null;try{stored=JSON.parse(localStorage.getItem(store)||'null');}catch(error){}
    const f=window.__throneFixture={edition,room:stored?stored.room:initial,calls:stored?stored.calls:[],member:stored?stored.member:null,
      receipts:stored?stored.receipts:{},delayBegin:false,delayGrade:false,delayBuzz:false,delayAnswer:false,failAnswerOnce:false,selectFirst:false};
    function persist(){localStorage.setItem(store,JSON.stringify({room:f.room,calls:f.calls,member:f.member,receipts:f.receipts}));}
    function note(name,...args){f.calls.push({name,args:clone(args)});persist();}
    function room(){persist();return clone(f.room);}
    function roster(){const now=new Date().toISOString();return [{id:'seat-a',name:'Alex',last_seen:now},{id:'seat-b',name:'Blair',last_seen:now},{id:'seat-c',name:'Casey',last_seen:now}];}
    function completedGrade(){
      const player=f.room.state.answerer,st=f.room.state;
      st.streak+=1;st.bestStreak[player.id]=st.streak;st.totalCorrect[player.id]=(st.totalCorrect[player.id]||0)+1;st.lastWinner=clone(player);st.champ=clone(player);
      const result={room:room(),outcome:'win',winner:clone(player),stats:{streak:st.streak,bestStreak:clone(st.bestStreak),totalCorrect:clone(st.totalCorrect),blemished:clone(st.blemished),lastWinner:clone(st.lastWinner),finaleScore:null,finaleWinner:null}};
      persist();return result;
    }
    return {
      ready:async()=>({id:'auth-verified-user'}),uuid:()=>crypto.randomUUID(),message:error=>error.message||'Connection interrupted',
      onIssue(){},busy:()=>false,retry(){},currentRoom:()=>clone(f.room),
      savedHostCode:()=>localStorage.getItem(store+'_host')||'',savedPlayerCode:()=>localStorage.getItem(store+'_phone')||'',
      rememberPlayer(code){if(code)localStorage.setItem(store+'_phone',code);else localStorage.removeItem(store+'_phone');},
      forgetHost(){localStorage.removeItem(store+'_host');},
      async createRoom(){note('create');localStorage.setItem(store+'_host','ABCDE');return room();},
      async resumeHost(code){note('resume',code);return room();},
      async beginRun(settings){
        note('begin',settings);
        const begin=()=>{f.room.run_id='11111111-1111-4111-8111-111111111111';f.room.phase='lobby';Object.assign(f.room.state,clone(initial.state),settings,{qTotal:settings.qTotal});return room();};
        if(f.delayBegin)return await new Promise(resolve=>{f.releaseBegin=()=>resolve(begin());});return begin();
      },
      async publish(patch){note('publish',patch);f.room.phase=patch.phase;Object.assign(f.room.state,clone(patch.state),{phase:patch.phase});f.room.version++;return room();},
      async openQuestion(question){
        note('open',question);f.room.q_id='22222222-2222-4222-8222-'+String(f.calls.filter(c=>c.name==='open').length).padStart(12,'0');f.room.phase='live';
        const players=roster();Object.assign(f.room.state,{phase:'live',qId:f.room.q_id,q:{q:question.q,opts:question.opts},champ:players.find(p=>p.id===question.champ_id),chal:players.find(p=>p.id===question.chal_id),qIndex:question.qIndex,mode:question.mode,answerer:null,lockedOut:[],buzzOpenAt:Date.now()+3000,buzzWin:Date.now()+60000,ansWin:0});
        f.receipts={question_id:f.room.q_id,buzz:null,answer:null};return room();
      },
      async selectBuzz(question){note('select',question);if(f.selectFirst){f.room.state.answerer=clone(f.room.state.champ);f.room.state.ansWin=Date.now()+60000;}return room();},
      async grade(question,player,correct){note('grade',question,player,correct);if(f.delayGrade)return await new Promise(resolve=>{f.releaseGrade=()=>resolve(completedGrade());});return completedGrade();},
      async members(code){note('members',code);return roster();},
      async answers(){note('answers');return f.answerRows||[];},
      async finalize(winner,group){note('finalize',winner,group);const player=roster().find(p=>p.id===winner);f.room.phase='gameover';f.room.state.winner=player;return {room:room(),result:{name:player.name,streak:1,flawless:true,questions:3,players:3,created_at:new Date().toISOString()}};},
      async legends(group){note('legends',group);return [];},
      async preview(code){note('preview',code);return {code:'ABCDE',phase:f.room.phase,edition};},
      async join(code,name){note('join',code,name);f.member={id:'canonical-phone-member',name:'Verified '+name,score:0,joined_at:new Date().toISOString(),last_seen:new Date().toISOString()};persist();return clone(f.member);},
      async membership(code){note('membership',code);return clone(f.member);},
      async heartbeat(code){note('heartbeat',code);return clone(f.member);},
      async leave(code){note('leave',code);f.member=null;persist();return {left:true};},
      async playerState(code){note('state',code);return {...room(),receipts:clone(f.receipts)};},
      async buzz(code,question){
        note('buzz',code,question);const accepted=()=>{f.receipts.buzz={question_id:question,created_at:'server-time'};persist();return clone(f.receipts.buzz);};
        if(f.delayBuzz)return await new Promise(resolve=>{f.releaseBuzz=()=>resolve(accepted());});return accepted();
      },
      async answer(code,question,choice){
        note('answer',code,question,choice);
        if(f.failAnswerOnce){f.failAnswerOnce=false;throw Object.assign(new Error('The response was interrupted'),{status:503});}
        const accepted=()=>{f.receipts.answer={question_id:question,choice,created_at:'server-time'};persist();return clone(f.receipts.answer);};
        if(f.delayAnswer)return await new Promise(resolve=>{f.releaseAnswer=()=>resolve(accepted());});return accepted();
      }
    };
  }};
})();
'''


def configure(context):
    external=[]
    def route_request(route):
        parsed=urlparse(route.request.url)
        if parsed.hostname!='tierbrain.test':
            external.append(route.request.url)
            route.fulfill(status=200,body='',content_type='text/plain')
            return
        relative=unquote(parsed.path).lstrip('/')
        if relative=='js/throne-access.js':
            route.fulfill(status=200,body=FIXTURE,content_type='text/javascript')
            return
        path=(ROOT/relative).resolve()
        if ROOT not in path.parents or not path.is_file():
            route.fulfill(status=404,body='Offline fixture: file unavailable')
            return
        route.fulfill(status=200,body=path.read_bytes(),content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
    context.route('**/*',route_request)
    if hasattr(context,'route_web_socket'):
        context.route_web_socket('**/*',lambda socket:socket.close())
    return external


def host_check(browser,edition):
    name='throne-bible.html' if edition=='bible' else 'throne.html'
    context=browser.new_context(viewport={'width':1280,'height':900},reduced_motion='reduce')
    configure(context)
    context.add_init_script("localStorage.setItem('tb-cutscenes-throne','0');")
    page=context.new_page()
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('https://tierbrain.test/'+name)
    page.wait_for_function("typeof G!=='undefined'&&G.players.length===3&&!roomOpening")
    page.evaluate("__throneFixture.delayBegin=true")
    page.locator('#startBtn').click()
    page.locator('#startBtn').dispatch_event('click')
    page.wait_for_function("typeof __throneFixture.releaseBegin==='function'")
    assert page.evaluate("__throneFixture.calls.filter(c=>c.name==='begin').length")==1
    assert page.evaluate("__throneFixture.calls.filter(c=>c.name==='open').length")==0
    page.evaluate("__throneFixture.releaseBegin()")
    page.wait_for_function("G.phase==='live'&&!!G.qId")
    assert page.evaluate("G.queue.length")==1
    assert page.locator('#tPlus').is_disabled()
    page.evaluate("__throneFixture.delayGrade=true;__throneFixture.selectFirst=true;G.buzzOpenAt=0;__throneFixture.room.state.buzzOpenAt=0;__throneFixture.answerRows=[{player_id:G.champ.id,choice:G.q.correctIdx}]")
    page.wait_for_function("typeof __throneFixture.releaseGrade==='function'")
    assert page.evaluate('G.streak')==0
    assert page.evaluate('G.phase')=='live'
    page.evaluate('__throneFixture.releaseGrade()')
    page.wait_for_function("G.phase==='reveal'")
    assert page.evaluate('G.streak')==1
    assert page.evaluate("__throneFixture.calls.filter(c=>c.name==='grade').length")==1
    assert not errors,errors
    context.close()


def phone_check(browser,edition):
    name='throne-bible-play.html' if edition=='bible' else 'throne-play.html'
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce')
    configure(context)
    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('https://tierbrain.test/'+name+'?c=ABCDE')
    page.locator('#nameIn').fill('Pat');page.locator('#joinBtn').click()
    page.wait_for_function("joined&&myId==='canonical-phone-member'")
    page.evaluate("""()=>{
      const f=__throneFixture;f.delayBuzz=true;f.room.phase='live';f.room.q_id='33333333-3333-4333-8333-333333333333';
      Object.assign(f.room.state,{phase:'live',qId:f.room.q_id,champ:{id:myId,name:myName},chal:{id:'other-member',name:'Other'},queue:[],q:{q:'Pick the third option',opts:['Alpha','Beta','Gamma','Delta']},answerer:null,lockedOut:[],buzzOpenAt:0,buzzWin:Date.now()+60000});
      f.receipts={question_id:f.room.q_id,buzz:null,answer:null};
    }""")
    page.locator('#bz').click()
    page.wait_for_function("!!submission('buzz',curQid)&&submission('buzz',curQid).status==='pending'")
    assert 'Sending your buzz' in page.locator('#playCard').inner_text()
    assert 'Buzz recorded' not in page.locator('#playCard').inner_text()
    page.evaluate('__throneFixture.releaseBuzz()')
    page.wait_for_function("submission('buzz',curQid).status==='confirmed'")
    assert 'Buzz recorded' in page.locator('#playCard').inner_text()
    page.evaluate("__throneFixture.failAnswerOnce=true;__throneFixture.room.state.answerer={id:myId,name:myName};__throneFixture.room.state.ansWin=Date.now()+60000")
    page.locator('#grid .pbtn').nth(2).click()
    page.wait_for_function("submission('answer',curQid).status==='unknown'")
    assert 'Confirmation unavailable' in page.locator('#playCard').inner_text()
    page.get_by_role('button',name='Retry same answer').click()
    page.wait_for_function("submission('answer',curQid).status==='confirmed'")
    answers=page.evaluate("__throneFixture.calls.filter(c=>c.name==='answer').map(c=>c.args)")
    assert len(answers)==2 and answers[0]==answers[1] and answers[0][2]==2,answers
    page.reload()
    page.wait_for_function("joined&&!!lastState&&submission('answer',curQid)&&submission('answer',curQid).status==='confirmed'")
    assert 'Answer recorded' in page.locator('#playCard').inner_text()
    assert page.evaluate("__throneFixture.calls.filter(c=>c.name==='join').length")==1
    assert not errors,errors
    context.close()


def main():
    results=[]
    with sync_playwright() as playwright:
        options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        executable=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        if executable:options['executable_path']=executable
        browser=playwright.chromium.launch(**options)
        try:
            for edition in ('general','bible'):
                host_check(browser,edition);results.append(edition+' host confirmed transitions')
                phone_check(browser,edition);results.append(edition+' mobile join/buzz/answer/reconnect')
        finally:browser.close()
    print(json.dumps({'passed':len(results),'checks':results},indent=2))


if __name__=='__main__':
    main()
