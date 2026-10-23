#!/usr/bin/env python3
"""Full HTML browser acceptance with an offline PartyAccess boundary fixture.

All external HTTP and WebSocket requests are intercepted. These checks preserve
real page/DOM/late-overlay integration; separate SQL/Auth acceptance proves the
server boundary. No live users, rooms, answers or scores are created.
"""
from pathlib import Path
import json
import mimetypes
import os
from urllib.parse import unquote,urlparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=(ROOT/'tests/fixtures/party-browser-adapter.js').read_text()

def configure(context):
 def route_request(route):
  parsed=urlparse(route.request.url)
  if parsed.hostname!='tierbrain.test':route.fulfill(status=200,body='',content_type='text/plain');return
  relative=unquote(parsed.path).lstrip('/')
  if relative=='js/party-access.js':route.fulfill(status=200,body=FIXTURE,content_type='text/javascript');return
  path=(ROOT/relative).resolve()
  if ROOT not in path.parents or not path.is_file():route.fulfill(status=404,body='Offline fixture: unavailable');return
  route.fulfill(status=200,body=path.read_bytes(),content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
 context.route('**/*',route_request)
 if hasattr(context,'route_web_socket'):context.route_web_socket('**/*',lambda socket:socket.close())
 context.add_init_script("localStorage.setItem('tb-cutscenes-spines','0');localStorage.setItem('tb-cutscenes-guide','0');localStorage.setItem('fc_host_arrived','1');")

def context_page(browser,mobile=False):
 context=browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1280,'height':900},is_mobile=mobile,has_touch=mobile,reduced_motion='reduce')
 configure(context);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));return context,page,errors

def spines_check(browser,edition):
 name='spines-bible.html' if edition=='bible' else 'spines.html'
 context,page,errors=context_page(browser)
 page.goto('https://tierbrain.test/'+name+'?host')
 page.wait_for_function("P&&P.connected&&P.players.length===3&&!P.queued")
 assert page.locator('#cutsToggle').count()==1,'real late host overlay must load'
 page.locator('#lstart').click();page.wait_for_function("P.phase==='choose'&&P.room.action&&!!G")
 page.evaluate("__partyFixture.receipt('0','pick',P.room.action.id,P.turn)")
 page.wait_for_function("P.phase==='question'&&P.room.action.kind==='answer'")
 assert page.locator('#opts .opt').count()==4
 page.evaluate("__partyFixture.receipt(G.q.correct,'answer',P.room.action.id,P.turn)")
 page.wait_for_function("G.pts>0")
 assert page.evaluate("__partyFixture.calls.some(c=>c.name==='close')")
 assert page.evaluate("__partyFixture.calls.filter(c=>c.name==='publish').every(c=>c.args[0].state.aliveIds&&c.args[0].state.outIds)")
 assert not errors,errors
 context.close()
 context,page,errors=context_page(browser,True)
 page.goto('https://tierbrain.test/'+name+'?party=ABCDE')
 page.locator('#pname').fill('Sam');page.locator('#pjoin').click();page.wait_for_function("__partyFixture.member&&__partyFixture.calls.some(c=>c.name==='state')")
 page.evaluate("""()=>{const f=__partyFixture;f.room.run_id='phone-run';f.room.phase='choose';f.room.state={phase:'choose',turn:'one',turnName:'Sam',seq:1,aliveIds:['one','two'],outIds:[],books:[{i:0,subj:'Science',t:'1',col:'#abcdef',top:false},{i:1,subj:'History',t:'1',col:'#abcdef',top:true}]};f.room.action={id:'pick-window',kind:'pick',member_id:'one',accepting:true};f.delaySubmit=true;}""")
 page.locator('#blist button').click();page.wait_for_function("typeof __partyFixture.releaseSubmit==='function'")
 assert page.locator('#partySubmissionStatus').get_attribute('data-state')=='pending'
 assert page.locator('#parea .right').count()==0
 page.evaluate('__partyFixture.releaseSubmit()');page.wait_for_function("document.querySelector('#partySubmissionStatus').dataset.state==='confirmed'")
 page.evaluate("""()=>{const f=__partyFixture;f.room.phase='question';f.room.state={phase:'question',turn:'one',turnName:'Sam',seq:1,aliveIds:['one','two'],outIds:['two'],q:{q:'Synthetic question?',opts:['Alpha','Beta','Gamma','Delta'],subj:'Science',t:'1'}};f.room.action={id:'answer-window',kind:'answer',member_id:'one',accepting:true};f.failSubmitOnce=true;}""")
 page.locator('#popts .opt').nth(2).click();page.wait_for_function("document.querySelector('#partySubmissionStatus').dataset.state==='unknown'")
 page.locator('#partySubmissionRetry').click();page.wait_for_function("document.querySelector('#partySubmissionStatus').dataset.state==='confirmed'")
 attempts=page.evaluate("__partyFixture.calls.filter(c=>c.name==='submit'&&c.args[2]==='answer-window').map(c=>c.args)")
 assert len(attempts)==2 and attempts[0]==attempts[1],attempts
 assert page.locator('#parea .right').count()==0
 page.reload();page.wait_for_function("document.querySelector('#partySubmissionStatus')&&document.querySelector('#partySubmissionStatus').dataset.state==='confirmed'")
 assert page.evaluate("__partyFixture.calls.filter(c=>c.name==='join').length")==1
 page.evaluate("__partyFixture.room.phase='over';__partyFixture.room.state={phase:'over',winnerId:'two',winner:'Sam',msg:'Another Sam won',outIds:['one']};__partyFixture.persist()")
 page.wait_for_function("document.querySelector('#pmsg').textContent==='Another Sam won'")
 assert not errors,errors
 context.close()

def circuit_check(browser,edition):
 name='full-circuit-bible' if edition=='bible' else 'full-circuit'
 context,page,errors=context_page(browser)
 page.goto('https://tierbrain.test/'+name+'-host.html')
 page.wait_for_function("G.players.length===3&&!document.querySelector('#startBtn').disabled")
 page.locator('#startBtn').click();page.locator('#startBtn').dispatch_event('click')
 page.wait_for_function("G.phase==='hall'&&__partyFixture.calls.some(c=>c.name==='publish'&&c.args[0].phase==='hall')")
 assert page.evaluate("__partyFixture.calls.filter(c=>c.name==='begin').length")==1
 assert not errors,errors
 context.close()
 context,page,errors=context_page(browser,True)
 page.goto('https://tierbrain.test/'+name+'.html?team=ABCDE')
 page.locator('#joinName').fill('Sam');page.locator('#joinBtn').click();page.wait_for_function("TM.me&&TM.me.id==='one'")
 for i,room in enumerate(['switchboard','glasshouse','orrery','strongroom','darkroom']):
  page.evaluate("""({key,index})=>{const f=__partyFixture;f.room.run_id='team-run';f.room.phase='room';f.room.state={phase:'room',room:key,player:'one',roomSeq:index+1,depth:0,items:[],fuse:false,keyUsed:false,names:f.members};f.room.action={id:'stream-'+index,kind:'stream',member_id:'one',accepting:true,activity_id:null,next_event:0};return poll();}""",{'key':room,'index':i})
  page.wait_for_function("key=>TM.running&&TM.room===key&&!!TM.lastQ",arg=room)
  assert page.evaluate("window=>__partyFixture.calls.some(c=>c.name==='event'&&c.args[2]===window&&c.args[5].t==='q')",'stream-'+str(i))
 page.evaluate("""()=>{const f=__partyFixture;f.room.phase='finale';f.room.state={phase:'finale',spark:'one',names:f.members,fq:{id:1,q:'Synthetic finale?',opts:['Alpha','Beta','Gamma','Delta'],burn:1}};f.room.action={id:'finale-window',kind:'finale',member_id:'one',accepting:true};f.delaySubmit=true;return poll();}""")
 page.wait_for_function("!document.querySelector('#teamQ').hidden")
 assert page.locator('#tqOpts .opt').nth(1).is_disabled()
 page.locator('#tqOpts .opt').nth(2).click();page.wait_for_function("typeof __partyFixture.releaseSubmit==='function'")
 assert 'Sending your answer' in page.locator('#tqNote').inner_text()
 assert 'confirmed' not in page.locator('#tqNote').inner_text().lower()
 page.evaluate('__partyFixture.releaseSubmit()');page.wait_for_function("TM.finalPending&&TM.finalPending.confirmed")
 assert 'Answer confirmed' in page.locator('#tqNote').inner_text()
 page.reload();page.wait_for_function("TM.me&&TM.finalPending&&TM.finalPending.confirmed")
 assert page.evaluate("__partyFixture.calls.filter(c=>c.name==='join').length")==1
 assert not errors,errors
 context.close()

def solo_check(browser,name):
 context,page,errors=context_page(browser)
 page.goto('https://tierbrain.test/'+name)
 if name.startswith('spines'):
  page.locator('#goBtn').click();page.wait_for_function("G&&G.books.length>0")
 else:page.wait_for_function("typeof TEAM!=='undefined'&&TEAM===null")
 assert page.evaluate("typeof __partyFixture==='undefined'"),'solo page created a multiplayer connection'
 assert not errors,errors
 context.close()

def main():
 results=[]
 with sync_playwright() as p:
  options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
  if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'):options['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
  browser=p.chromium.launch(**options)
  try:
   for edition in ['general','bible']:
    spines_check(browser,edition);results.append(edition+' Spines full host/phone/overlay/pending/retry/reconnect/duplicate-name checks')
    circuit_check(browser,edition);results.append(edition+' Circuit host, all five phone games, handoff, Lens/finale/reconnect checks')
   for name in ['spines.html','spines-bible.html','full-circuit.html','full-circuit-bible.html']:
    solo_check(browser,name);results.append(name+' solo avoids multiplayer connection')
  finally:browser.close()
 print(json.dumps({'passed':len(results),'checks':results},indent=2))
if __name__=='__main__':main()
