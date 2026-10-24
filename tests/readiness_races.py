"""Race transport acceptance against disposable GoTrue/PostgREST/PostgreSQL.

These protocol checks load the unchanged vendored SDK and production adapter.
They complement each game's UI course; no Auth, RPC, clock or database response
is faked. The one injected 503 occurs after a real committed write.
"""
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROJECT_URL = 'https://cgrbwtcydgfkbqhseeap.supabase.co'
PUBLIC_KEY = re.search(r"var SB_KEY='([^']+)'", (ROOT/'finish-line.html').read_text()).group(1)


def _attach(page, family, edition='general'):
    page.add_script_tag(url='https://tierbrain.test/vendor/supabase.js')
    page.add_script_tag(url='https://tierbrain.test/js/race-access.js')
    page.evaluate("""([url,key,family,edition]) => {
      window.__raceIssues=[];
      window.race=RaceAccess.create(url,key,{family,edition,onIssue:issue=>{
        window.__raceIssues.push({state:issue.state,canRetry:issue.canRetry,request_id:issue.request_id,operation:issue.operation});
      }});
      window.raceConfig={url,key,family,edition};
      window.raceAttempt=async function(method,args){try{return {ok:true,value:await race[method](...(args||[]))};}
        catch(error){return {ok:false,code:error.code||'',status:error.status||0,message:error.message};}};
      window.raceRaw=async function(name,args,anonymous){
        const cfg=raceConfig, stored=JSON.parse(localStorage.getItem('tb_race_'+cfg.family+'_'+cfg.edition+'_auth_v1')||'null');
        const headers={'apikey':cfg.key,'content-type':'application/json'};
        if(!anonymous && stored && stored.access_token)headers.authorization='Bearer '+stored.access_token;
        const response=await fetch(cfg.url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args)});
        return {status:response.status,body:await response.json()};
      };
    }""", [PROJECT_URL, PUBLIC_KEY, family, edition])


def _page(env, family, label, edition='general'):
    page = env.new_page('404.html', label, mobile=True)
    _attach(page, family, edition)
    return page


def _call(page, method, *args):
    return page.evaluate('([method,args])=>race[method](...args)', [method,list(args)])


def _attempt(page, method, *args):
    return page.evaluate('([method,args])=>raceAttempt(method,args)', [method,list(args)])


def _expect_error(env, name, outcome, code=None):
    env.check(name, not outcome['ok'] and (code is None or outcome.get('code') == code),
              {key:outcome.get(key) for key in ('ok','code','status')})


def _args(packet, family, edition='general'):
    return {'p_code':packet['room']['code'],'p_family':family,'p_edition':edition}


def _wait_play(page, extra=0):
    # Real wall time is retained because SQL validates its own timestamp.
    page.evaluate('extra=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(race.current().room.play_at)+extra-race.serverNow()+100)))', extra)


def _hold_state_response(page):
    # The SQL read and HTTP response complete normally. Only delivery of that
    # genuine response to the SDK is held, to reproduce an out-of-order read.
    page.evaluate("""() => {
      if(!window.__raceOriginalFetch){
        window.__raceOriginalFetch=window.fetch.bind(window);
        window.fetch=async function(input,options){
          const response=await window.__raceOriginalFetch(input,options);
          const url=typeof input==='string'?input:input.url;
          if(window.__holdNextRaceState && /\\/rpc\\/race_state(?:\\?|$)/.test(url)){
            window.__holdNextRaceState=false;window.__raceStateHeld=true;
            await new Promise(resolve=>{window.__releaseRaceState=resolve;});
          }
          return response;
        };
      }
      window.__raceStateHeld=false;window.__heldRaceResult=null;window.__holdNextRaceState=true;
      window.__heldRacePromise=race.state().then(value=>{window.__heldRaceResult={ok:true};},error=>{window.__heldRaceResult={ok:false,code:error.code};});
    }""")
    page.wait_for_function('window.__raceStateHeld',timeout=30000)


def _release_state_response(page):
    page.evaluate('()=>{window.__releaseRaceState();}')
    page.wait_for_function('window.__heldRaceResult !== null',timeout=30000)
    return page.evaluate('window.__heldRaceResult')


def _protocol(env, family, edition='general'):
    suffix = family+'-'+edition
    host = _page(env,family,'race-protocol-'+suffix+'-host',edition)
    guest = _page(env,family,'race-protocol-'+suffix+'-guest',edition)
    outsider = _page(env,family,'race-protocol-'+suffix+'-outsider',edition)
    code = ('T'+family[:3]+('B' if edition == 'bible' else 'G')+'123').upper()
    _expect_error(env,suffix+': short room code rejected',_attempt(host,'enter','AB','Host'),'22023')
    _expect_error(env,suffix+': reserved signalling name rejected',_attempt(host,'enter',code,'__GO__'),'22023')
    h = _call(host,'enter',code,'Host&One')
    duplicate = _attempt(guest,'enter',code,'host&one')
    _expect_error(env,suffix+': duplicate display name cannot impersonate host',duplicate,'22023')
    g = _call(guest,'enter',code,'PlayerTwo')
    env.check(suffix+': distinct verified canonical memberships',h['member']['id'] != g['member']['id'] and h['host'] and not g['host'])
    # An authenticated actor who knows a code still cannot read its state.
    _call(outsider,'ready')
    forbidden = outsider.evaluate('args=>raceRaw("race_state",args,false)',{**_args(h,family,edition),'p_after_id':0})
    env.check(suffix+': unrelated authenticated browser cannot inspect room',forbidden['status']==403 and forbidden['body'].get('code')=='42501')
    anon = outsider.evaluate('args=>raceRaw("race_state",args,true)',{**_args(h,family,edition),'p_after_id':0})
    env.check(suffix+': unauthenticated browser cannot invoke race RPC',anon['status'] in (401,403))
    if family == 'tug':
        _call(host,'heartbeat',{'side':1})
        _call(guest,'heartbeat',{'side':2})
    _call(host,'state'); _call(guest,'state')
    options = {'rounds':[{'words':1,'noon':i==8} for i in range(9)],'speed':450} if family=='firstfinger' else {'tier':0} if family in ('castle','core','labyrinth') else {}
    _expect_error(env,suffix+': player cannot start host room',_attempt(guest,'start',options),'42501')
    started = _call(host,'start',options)
    _call(host,'useRun',started['room']['run_id'])
    state = _call(guest,'state')
    env.check(suffix+': server start supplies run seed and canonical roster',started['room']['phase']=='playing' and len(state['room']['roster'])==2 and isinstance(started['room']['seed'],int) and bool(started.get('rows')))
    _expect_error(env,suffix+': polling a run does not implicitly bind submissions',_attempt(guest,'submit','progress',{'correct':0,'level':0,'time_left':0}))
    _call(guest,'useRun',state['room']['run_id'])
    # The transport loses only the response to a genuine committed heartbeat.
    env.interrupt_next_rpc(host,'race_heartbeat')
    host.evaluate("() => {window.__raceHeartbeatDone=false;window.__raceHeartbeat= race.heartbeat().then(()=>{window.__raceHeartbeatDone=true;});}")
    host.wait_for_function('race.pending() && race.pending().operation === "heartbeat"',timeout=30000)
    env.check(suffix+': lost acknowledgement leaves original action pending',not host.evaluate('window.__raceHeartbeatDone') and host.evaluate('race.busy()'))
    host.evaluate('()=>race.retry()')
    host.wait_for_function('window.__raceHeartbeatDone && !race.busy()',timeout=30000)
    heartbeat = env.rpc_calls(host,'race_heartbeat')[-2:]
    env.check(suffix+': retry reuses committed heartbeat request UUID',len(heartbeat)==2 and heartbeat[0]['status']==503 and heartbeat[0].get('committed_status')==200 and heartbeat[1]['status']==200 and heartbeat[0]['request_id']==heartbeat[1]['request_id'])
    changed_request = host.evaluate('args=>raceRaw("race_heartbeat",args,false)',{
        **_args(started,family,edition),'p_payload':{'side':0},'p_request_id':heartbeat[0]['request_id']})
    env.check(suffix+': receipt UUID cannot be reused for changed input',changed_request['status']==400 and changed_request['body'].get('code')=='22023')
    cleanup = host.evaluate('()=>raceRaw("cleanup_race_rooms",{},false)')
    env.check(suffix+': guest cannot invoke service maintenance',cleanup['status'] in (401,403))
    # Caller supplied identity/host fields are forbidden rather than trusted.
    if family == 'firstfinger':
        _expect_error(env,suffix+': server rejects draw before actual study window',_attempt(host,'submit','draw',{'round':0,'words':1}),'42501')
        _wait_play(host,2600)
        row = _call(host,'submit','draw',{'round':0,'words':1})
        answer = _call(host,'submit','answer',{'round':0,'points':50,'flags':1})
        duplicate_answer = _call(host,'submit','answer',{'round':0,'points':50,'flags':1})
        env.check(suffix+': round answer is canonical and at most once',row['member_id']==h['member']['id'] and answer['id']==duplicate_answer['id'] and answer['correct']==50)
        _expect_error(env,suffix+': an accepted answer cannot be replaced',_attempt(host,'submit','answer',{'round':0,'points':100,'flags':3}),'22023')
        _expect_error(env,suffix+': FF member identity cannot be supplied',_attempt(guest,'submit','draw',{'round':0,'words':1,'member_id':h['member']['id']}),'22023')
    else:
        forged = {'correct':1,'level':2 if family=='tug' else 0,'wrong':0,'mishaps':0} if family=='tug' else {'correct':1,'level':0 if family=='finish' else 3,'time_left':0}
        _expect_error(env,suffix+': server rejects progress before actual play time',_attempt(guest,'submit','progress',forged),'42501')
        _wait_play(host)
        progress = _call(guest,'submit','progress',forged)
        env.check(suffix+': accepted progress belongs to verified sender',progress['member_id']==g['member']['id'] and progress['run_id']==started['room']['run_id'] and progress['correct']==1)
        _expect_error(env,suffix+': progress identity cannot be supplied',_attempt(host,'submit','progress',{**forged,'member_id':g['member']['id']}),'22023')
    old_run = started['room']['run_id']
    _call(host,'state'); _call(guest,'state')
    _expect_error(env,suffix+': player cannot reset host room',_attempt(guest,'reset'),'42501')
    reset = _call(host,'reset')
    env.check(suffix+': host reset creates a distinct run',reset['room']['run_id'] != old_run and reset['room']['phase']=='lobby')
    # Merely polling the replacement run must not relabel an old queued answer.
    _call(guest,'state')
    stale_payload = {'round':0,'words':1} if family=='firstfinger' else {'correct':1,'level':2,'wrong':0,'mishaps':0} if family=='tug' else {'correct':1,'level':0 if family=='finish' else 3,'time_left':0}
    _expect_error(env,suffix+': old binding remains stale after reset and polling',_attempt(guest,'submit','draw' if family=='firstfinger' else 'progress',stale_payload),'PT409')
    before = g['member']['id']
    guest.reload()
    _attach(guest,family,edition)
    restored = _call(guest,'enter',code,'IgnoredRename')
    env.check(suffix+': reload restores actor membership without trusting new name',restored['member']['id']==before and restored['member']['name']=='PlayerTwo')
    # Leaving transfers actual host ownership rather than a nickname convention.
    _call(host,'leave')
    remaining = _call(guest,'state')
    env.check(suffix+': host leave transfers ownership to remaining member',remaining['host'])
    env.interrupt_next_rpc(guest,'race_heartbeat')
    guest.evaluate("() => {window.__abandonedRace=null;race.heartbeat().then(()=>{window.__abandonedRace='confirmed';},error=>{window.__abandonedRace=error.code;});}")
    guest.wait_for_function('race.pending()',timeout=30000)
    _call(guest,'leave')
    guest.wait_for_function('window.__abandonedRace !== null',timeout=30000)
    env.check(suffix+': leave escapes pending retry and revokes membership',guest.evaluate('window.__abandonedRace === "race_left" && race.current() === null && !race.busy()'))
    _call(guest,'enter',code+'L','PlayerTwo')
    _hold_state_response(guest)
    _call(guest,'leave')
    stale = _release_state_response(guest)
    env.check(suffix+': late state response cannot resurrect departed membership',not stale['ok'] and stale['code']=='PT409' and guest.evaluate('race.current() === null'))
    _call(guest,'enter',code+'N','PlayerTwo')
    _hold_state_response(guest)
    _call(guest,'leave')
    fresh = _call(guest,'enter',code+'X','PlayerTwo')
    stale = _release_state_response(guest)
    env.check(suffix+': old state cannot replace a newly entered room',not stale['ok'] and stale['code']=='PT409' and _call(guest,'current')['room']['id']==fresh['room']['id'])
    _call(guest,'leave')
    # An enter that committed before its response was lost has no adopted
    # packet yet. Leave still uses the original code to revoke that membership.
    env.interrupt_next_rpc(outsider,'race_enter')
    outsider.evaluate("code=>{window.__abandonedEnter=null;race.enter(code,'LeavingJoin').then(()=>{window.__abandonedEnter='confirmed';},error=>{window.__abandonedEnter=error.code;});}",code+'E')
    outsider.wait_for_function('race.pending() && race.pending().operation === "enter"',timeout=30000)
    _call(outsider,'leave')
    outsider.wait_for_function('window.__abandonedEnter !== null',timeout=30000)
    env.check(suffix+': leave cleans up an interrupted committed enter',outsider.evaluate('window.__abandonedEnter === "race_left" && race.current() === null && !race.busy()'))


def run(env):
    for family,edition in [('finish','general'),('tug','general'),('firstfinger','general'),('firstfinger','bible'),('castle','general'),('core','general'),('labyrinth','general')]:
        _protocol(env,family,edition)
    env.note('Race protocol clocks remained real. Full game UI courses are supplied by the race frontend checks; this module covers actual guest identity, host authority, receipts, timing and run boundaries.')
