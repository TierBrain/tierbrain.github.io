#!/usr/bin/env python3
"""Offline actual-function tests for Spines party host/phone transitions.

Node executes the checked-in party functions with an in-memory Auth/RPC and DOM
boundary. No fetch, JWT, real SDK or gameplay write can reach a network here.
Database ownership is verified separately by the shared party SQL/HTTP suite.
"""
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2], 'utf8');
const party = source.slice(source.indexOf('/* ==================== PARTY MODE ===================='), source.indexOf('\n</script>', source.indexOf('/* ==================== PARTY MODE ====================')));
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
const clone = x => JSON.parse(JSON.stringify(x));
function sandbox(options={}) {
  const calls=[], created=[], intervals=[], timeouts=new Map(), store=new Map(Object.entries(options.storage||{}));
  let timer=0, run=0, request=0, nextWindow=0, room=null, packet=null, rows=[], members=options.members||[{id:'one',name:'Sam'},{id:'two',name:'Sam'}];
  class Element {
    constructor(tag='div'){ this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.style={};this.dataset={};this.hidden=false;this.disabled=false;this.className='';this._text='';this.listeners={};created.push(this);
      this.classList={add:(...names)=>{this.className=Array.from(new Set(this.className.split(/\s+/).filter(Boolean).concat(names))).join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(n=>!names.includes(n)).join(' ');},contains:n=>this.className.split(/\s+/).includes(n)};}
    set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this.children.length?this.children.map(c=>c.textContent).join(''):this._text;}
    set innerHTML(v){assert.equal(v,'','party DOM uses explicit safe text nodes');this.children=[];this._text='';}get innerHTML(){return this._text;}
    get firstChild(){return this.children[0]||null;}get lastChild(){return this.children.at(-1)||null;}
    appendChild(child){if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(x=>x!==child);this.children.push(child);child.parentNode=this;return child;}
    insertBefore(child,before){const i=this.children.indexOf(before);if(i<0)return this.appendChild(child);this.children.splice(i,0,child);child.parentNode=this;return child;}
    setAttribute(k,v){this[k]=String(v);}addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn);}
    click(){if(this.disabled)return;let result;for(const fn of this.listeners.click||[])result=fn.call(this,{preventDefault(){},stopImmediatePropagation(){}});if(this.onclick)result=this.onclick.call(this);return result;}
    querySelector(selector){return descendants(this).find(x=>selector[0]==='.'?x.classList.contains(selector.slice(1)):x.tagName===selector.toUpperCase())||null;}
    focus(){}
  }
  function descendants(el){return el.children.flatMap(c=>[c,...descendants(c)]);}
  const body=new Element('body'), base={};
  for(const id of ['start','partyBtn','lobby','lstart','lneed','lplayers','lcode','llink','lqr','skipBtn','pile','card','end','endText','endPts','endBest','againBtn','study','opts','phone','pmsg','parea']){base[id]=new Element(id.includes('Btn')||['lstart','pjoin'].includes(id)?'button':'div');base[id].id=id;body.appendChild(base[id]);}
  base.end.appendChild(new Element('h1'));base.phone.appendChild(base.pmsg);base.phone.appendChild(base.parea);
  const app=new Element('div');app.className='app';body.appendChild(app);
  const document={body,createElement:tag=>new Element(tag),getElementById:id=>base[id]||descendants(body).find(x=>x.id===id)||null,
    querySelector:selector=>selector==='.app'?app:descendants(body).find(x=>x.classList.contains(selector.slice(1)))||null,
    querySelectorAll:selector=>selector==='#opts .opt'?descendants(base.opts).filter(x=>x.classList.contains('opt')):[]};
  const get=id=>document.getElementById(id);
  const edition=options.edition||'general';
  function defaultRoom(){return {id:'room-owned',code:'ABCDE',family:'spines',edition,phase:'lobby',state:{game:'spines',phase:'lobby'},run_id:'old-run',version:0,action:null};}
  const api={
    onIssue(fn){api.issue=fn;},message:e=>e&&e.message||'Connection interrupted',busy:()=>false,retry(){calls.push(['retry']);},uuid:()=>`request-${++request}`,
    savedHostCode:()=>options.savedHost||'',savedPlayerCode:()=>'',rememberPlayer:code=>calls.push(['remember',code]),forgetHost:()=>calls.push(['forgetHost']),currentRoom:()=>room,
    async createRoom(){calls.push(['create']);room=defaultRoom();return clone(room);},
    async resumeHost(code){calls.push(['resume',code]);if(options.resumeError)throw options.resumeError;room=defaultRoom();room.phase='question';room.action={id:'old-window'};return clone(room);},
    async beginRun(){calls.push(['begin']);room={...room,run_id:`run-${++run}`,phase:'lobby',state:{phase:'lobby'},version:room.version+1,action:null};return clone(room);},
    async publish(patch){calls.push(['publish',patch.phase,clone(patch)]);if(options.publish)await options.publish(patch);
      let action=null;if(['choose','question'].includes(patch.phase)){const kind=patch.phase==='choose'?'pick':'answer';const key=`s${patch.state.seq}:${kind}`;action=room.action&&room.action.key===key?room.action:{id:`window-${++nextWindow}`,key,kind,member_id:patch.state.turn,accepting:true};}
      room={...room,phase:patch.phase,state:clone(patch.state),version:room.version+1,action};calls.push(['published',patch.phase]);return clone(room);},
    async close(window){calls.push(['close',window]);if(options.close)await options.close(window);room={...room,version:room.version+1,action:room.action?{...room.action,accepting:false}:null};return {room:clone(room),actions:clone(rows)};},
    async members(code){calls.push(['members',code]);return clone(members);},
    async actions(code,run,window,cursor){calls.push(['actions',code,run,window,cursor]);return clone(rows);},
    async preview(code){calls.push(['preview',code]);return {code,family:'spines',edition};},
    async membership(code){calls.push(['membership',code]);return options.noResume?null:clone(members[0]);},
    async join(code,name){calls.push(['join',code,name]);return clone(members[0]);},
    async heartbeat(code){calls.push(['heartbeat',code]);return clone(members[0]);},
    async leave(code){calls.push(['leave',code]);if(options.leave)await options.leave();return {left:true};},
    async playerState(code){calls.push(['state',code]);if(options.playerState)return await options.playerState(code);return clone(packet);},
    async submit(code,run,window,choice,request){const args=[code,run,window,choice,request];calls.push(['submit',...args]);if(options.submit)return await options.submit(...args);return {player_id:members[0].id,window_id:window,choice,kind:'answer'};}
  };
  const context={document,location:{search:options.mode==='solo'?'':options.mode==='host'?'?host':'?party=ABCDE',href:'https://synthetic.test/spines.html'+(options.edition==='bible'?'?ed=bible':'')},
    ED:edition==='bible'?'bible':'house',PartyAccess:{create:(url,key,config)=>{calls.push(['client',config]);return api;}},
    $,console,Promise,Map,Set,Math,Number,JSON,Error,Object,Array,confirm:()=>true,
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},clearInterval(){},
    setTimeout:(fn,ms)=>{timeouts.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timeouts.delete(id),
    store:(k,v)=>store.set(k,v),recall:k=>store.get(k)||null,
    LIMIT:9,G:null,actx(){},render(){},say:t=>calls.push(['say',t]),hint:t=>calls.push(['hint',t]),tierOf:()=> '1',depthName:()=> 'near the top'};
  function $(id){return get(id);}
  context.window=context;
  context.newGame=()=>{context.G={books:Array.from({length:3},(_,i)=>({subj:'Science',col:'#123456',el:new Element('button')})),lean:0,pts:0,moved:0,busy:false,over:false,sel:-1};};
  context.choose=i=>{calls.push(['choose',i]);context.G.sel=i;context.G.q={q:'Synthetic?',correct:'Alpha'};base.opts.innerHTML='';for(const option of ['Alpha','Beta','Gamma','Delta']){const el=new Element('button');el.className='opt';el.textContent=option;base.opts.appendChild(el);}};
  context.answer=(choice)=>{calls.push(['resolve-answer',choice]);context.G.busy=true;};
  packet={room:{...defaultRoom(),run_id:'phone-run',phase:'choose',state:{phase:'choose',turn:members[0].id,turnName:members[0].name,seq:1,aliveIds:members.map(m=>m.id),outIds:[],books:[{i:0,subj:'Science',t:'1',top:false,col:'#123456'},{i:1,subj:'History',t:'1',top:true,col:'#654321'}]},action:{id:'phone-window',kind:'pick',member_id:members[0].id,accepting:true}},member:clone(members[0]),members:clone(members),receipts:[]};
  vm.createContext(context);vm.runInContext(party,context);
  return {context,calls,api,get,base,store,intervals,timeouts,Element,
    setPacket:p=>{packet=clone(p);},packet:()=>clone(packet),setRows:r=>{rows=clone(r);},setMembers:m=>{members=clone(m);},
    async delay(ms){const entries=[...timeouts.entries()].filter(([,t])=>t.ms===ms);for(const [id,t]of entries){timeouts.delete(id);await t.fn();}await tick();},
    async flush(){await tick();await tick();}};
}
"""


class SpinesPartyChecks(unittest.TestCase):
    def node(self, body, edition="spines.html"):
        result = subprocess.run(["node", "-", str(ROOT / edition)], input=HARNESS + "\n(async()=>{\n" + body + "\n})().catch(e=>{console.error(e);process.exitCode=1;});\n",
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_both_editions_have_no_legacy_rest_or_browser_identity(self):
        for name in ("spines.html", "spines-bible.html"):
            text = (ROOT / name).read_text()
            for token in ("/rest/v1/", "function sb(", "spines_party_", "player_id:me.id", "x.classList.add('right'); send"):
                self.assertNotIn(token, text)
            self.assertLess(text.index('src="vendor/supabase.js"'), text.index("PartyAccess.create"))
            self.assertIn("aliveIds:P.alive.slice(), outIds:P.out.slice(), winnerId:", text)
            self.assertIn("if(MODE === 'host') return partyRestart();", text)
        bible = (ROOT / "spines-bible.html").read_text()
        self.assertIn("var ED = 'bible';", bible)
        self.assertIn('<title>Spines: Bible Edition', bible)

    def test_all_inline_javascript_compiles(self):
        for name in ("spines.html", "spines-bible.html"):
            text = (ROOT / name).read_text()
            scripts = [body for attrs, body in re.findall(r"<script\b([^>]*)>([\s\S]*?)</script>", text, re.I) if "src=" not in attrs and "ld+json" not in attrs]
            for body in scripts:
                result = subprocess.run(["node", "--check"], input=body, text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_solo_does_not_create_auth_client_and_bible_route_is_preserved(self):
        self.node(r"""
const solo=sandbox({mode:'solo'});assert.equal(solo.calls.length,0);assert.equal(solo.context.partyAccess,null);
const bible=sandbox({mode:'solo',edition:'bible'});assert.equal(bible.calls.length,0);assert.equal(bible.get('partyBtn').href,'?host&ed=bible');
const phone=sandbox({edition:'bible'});await phone.flush();assert.equal(phone.calls.find(c=>c[0]==='client')[1].edition,'bible');
""")

    def test_host_verified_reload_starts_fresh_lobby_and_play_again_starts_new_run(self):
        self.node(r"""
const s=sandbox({mode:'host',savedHost:'ABCDE'});await s.flush();
assert.equal(s.context.P.phase,'lobby');assert.equal(s.context.G,null);assert.equal(s.context.P.room.action,null);
assert.deepEqual(s.calls.filter(c=>['resume','create','begin','publish'].includes(c[0])).map(c=>c.slice(0,2)),[['resume','ABCDE'],['begin'],['publish','lobby']]);
await s.get('lstart').click();await s.flush();const first=s.context.P.room.run_id;
assert.equal(s.context.P.phase,'choose');assert.equal(s.context.P.room.action.kind,'pick');assert.equal(s.context.P.room.action.member_id,'one');
await s.context.partyRestart();await s.flush();assert.notEqual(s.context.P.room.run_id,first);assert.equal(s.context.P.seq,1);assert.equal(s.context.P.out.length,0);
""")

    def test_host_closes_before_pick_question_resolution_and_result_before_animation(self):
        self.node(r"""
const s=sandbox({mode:'host'});await s.flush();await s.get('lstart').click();await s.flush();
let room=s.context.P.room;s.setRows([{player_id:'one',window_id:room.action.id,choice:'0'}]);
await s.context.pollPartyHost();assert.equal(s.context.P.phase,'question');
let close=s.calls.findIndex(c=>c[0]==='close'),choose=s.calls.findIndex(c=>c[0]==='choose');assert.ok(close>=0&&close<choose);
room=s.context.P.room;s.setRows([{player_id:'one',window_id:room.action.id,choice:'Alpha'}]);
await s.context.pollPartyHost();assert.equal(s.context.P.phase,'result');
const lastClose=s.calls.map(c=>c[0]).lastIndexOf('close'),published=s.calls.findIndex(c=>c[0]==='published'&&c[1]==='result'),resolved=s.calls.findIndex(c=>c[0]==='resolve-answer');
assert.ok(lastClose<published&&published<resolved);assert.equal(s.context.G.busy,true);
""")

    def test_skip_waits_for_close_and_old_delayed_turn_cannot_cross_run(self):
        self.node(r"""
let release;const s=sandbox({mode:'host',close:()=>new Promise(r=>{release=r;})});await s.flush();await s.get('lstart').click();await s.flush();
const before=s.context.P.seq;s.get('skipBtn').click();await tick();assert.equal(s.context.P.seq,before);assert.equal(s.context.P.queued,1);
release();await s.flush();assert.equal(s.context.P.seq,before+1);assert.equal(s.context.P.turn,'two');
s.context.P.phase='result';s.context.G.over=false;s.context.G.busy=false;s.context.partyAfterSettle();
await s.context.partyRestart();await s.flush();const current=s.context.P.seq;await s.delay(900);assert.equal(s.context.P.seq,current);
""")

    def test_departed_selected_player_is_closed_and_skipped_without_name_collision(self):
        self.node(r"""
const members=[{id:'one',name:'Sam'},{id:'two',name:'Sam'},{id:'three',name:'Pat'}];const s=sandbox({mode:'host',members});await s.flush();await s.get('lstart').click();await s.flush();
s.setMembers(members.slice(1));await s.context.pollPartyHost();
assert.equal(s.context.P.turn,'two');assert.deepEqual(Array.from(s.context.P.alive),['two','three']);assert.deepEqual(Array.from(s.context.P.out),['one']);
const close=s.calls.findIndex(c=>c[0]==='close'),result=s.calls.findIndex(c=>c[0]==='publish'&&c[1]==='result');assert.ok(close>=0&&close<result);
assert.equal(s.context.P.room.state.aliveIds.includes('one'),false);assert.equal(s.context.P.room.state.outIds.includes('two'),false);
""")

    def test_phone_pending_unknown_retry_preserves_choice_and_uuid(self):
        self.node(r"""
let attempt=0;const s=sandbox({submit:async(code,run,window,choice)=>{if(++attempt===1)throw Object.assign(new Error('Synthetic unavailable'),{status:503});return {player_id:'one',window_id:window,choice,kind:'pick'};}});await s.flush();
s.get('blist').children[0].click();assert.equal(s.get('partySubmissionStatus').dataset.state,'pending');await s.flush();
assert.equal(s.get('partySubmissionStatus').dataset.state,'unknown');await s.get('partySubmissionRetry').click();await s.flush();
assert.equal(s.get('partySubmissionStatus').dataset.state,'confirmed');const submits=s.calls.filter(c=>c[0]==='submit');assert.deepEqual(submits[0],submits[1]);assert.match(s.get('partySubmissionStatus').textContent,/recorded/i);
""")

    def test_duplicate_names_use_ids_for_out_and_winner_and_answer_is_only_picked(self):
        self.node(r"""
let release;const s=sandbox({submit:(code,run,window,choice)=>new Promise(r=>{release=()=>r({player_id:'one',window_id:window,choice,kind:'answer'});})});await s.flush();
let p=s.packet();p.room.phase=p.room.state.phase='question';p.room.state.out=['Sam'];p.room.state.outIds=['two'];p.room.state.q={q:'Question?',subj:'Science',opts:['A','B','C','D']};p.room.action.kind='answer';s.setPacket(p);await s.delay(900);
assert.ok(s.get('popts'));s.get('popts').children[0].click();assert.equal(s.get('popts').children[0].classList.contains('picked'),true);assert.equal(s.get('popts').children[0].classList.contains('right'),false);assert.equal(s.get('partySubmissionStatus').dataset.state,'pending');
release();await s.flush();assert.equal(s.get('partySubmissionStatus').dataset.state,'confirmed');
p.room.phase=p.room.state.phase='over';p.room.state.winner='Sam';p.room.state.winnerId='two';p.room.state.msg='Other Sam won.';p.room.action=null;s.setPacket(p);await s.delay(900);assert.equal(s.get('pmsg').textContent,'Other Sam won.');
p.room.state.winnerId='one';s.setPacket(p);await s.delay(900);assert.match(s.get('pmsg').textContent,/You won/);
""")

    def test_server_receipt_settles_unknown_and_late_network_error_does_not_downgrade_it(self):
        self.node(r"""
let reject;const s=sandbox({submit:()=>new Promise((r,j)=>{reject=j;})});await s.flush();s.get('blist').children[0].click();
const p=s.packet();p.receipts=[{player_id:'one',window_id:'phone-window',choice:'0',kind:'pick'}];p.room.action.accepting=false;s.setPacket(p);await s.delay(900);
assert.equal(s.get('partySubmissionStatus').dataset.state,'confirmed');reject(Object.assign(new Error('Late lost response'),{status:503}));await s.flush();assert.equal(s.get('partySubmissionStatus').dataset.state,'confirmed');
""")

    def test_restore_ignores_legacy_ids_and_explicit_leave_survives_concurrent_poll(self):
        self.node(r"""
let release;const s=sandbox({storage:{spines_party_ABCDE:JSON.stringify({id:'forged',name:'Fake'})},leave:()=>new Promise(r=>{release=r;})});await s.flush();
assert.match(s.get('pmsg').textContent,/Your turn/);assert.ok(s.calls.some(c=>c[0]==='membership'));assert.ok(s.intervals.some(t=>t.ms===10000));
const leave=s.base.phone.children.find(x=>x.textContent==='Leave the game');leave.click();await tick();await s.delay(900);release();await s.flush();assert.ok(s.get('pjoin'));assert.match(s.get('pmsg').textContent,/You left/);
""")


if __name__ == "__main__":
    unittest.main()
