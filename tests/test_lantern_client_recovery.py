"""Offline recovery checks execute the real host, phone and adapter scripts.

A small DOM and SDK stub exercise uncertain committed requests and stale responses;
these are not substitutes for mobile/PostgREST end-to-end checks.
"""
import json
import subprocess
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const root = process.argv[1];
const adapter = fs.readFileSync(root + '/js/lantern-access.js', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(page, behavior = {}) {
  const html = fs.readFileSync(root + '/' + page, 'utf8');
  const nodes = new Map(), intervals = new Map(), timeouts = new Map();
  let serial = 0, sdkClients = 0, authChecks = 0, reloads = 0, context;
  const calls = [], ledger = new Map(), commits = {};
  const members = ['Priya', 'Sam', 'Ruth'].map((name, i) => ({id: 'm' + i, name, active: true, seen: true}));
  const room = {id:'room', code:'ABCDE', version:0, phase:'lobby', game_id:null, game:null, prompt:null, members};
  class Element {
    constructor(id = '') {
      this.id=id; this.hidden=false; this.disabled=false; this.dataset={}; this.attrs={};
      this.listeners={}; this.children=[]; this.firstElementChild={style:{},classList:{remove(){}}}; this.value=''; this.textContent=''; this._html='';
      const classes=new Set();
      this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:v=>classes.has(v),toggle:(v,on)=>{if(on===undefined)on=!classes.has(v);on?classes.add(v):classes.delete(v);return on;}};
      this.style={setProperty(){},removeProperty(){}};
    }
    set innerHTML(value) {this._html=String(value); register(this._html);this.children=[];
      for(const m of this._html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const child=new Element();child.textContent=m[2].replace(/<[^>]*>/g,'');child.disabled=/\bdisabled\b/.test(m[1]);
        const cls=/class="([^"]*)"/.exec(m[1]);if(cls)cls[1].split(/\s+/).forEach(v=>child.classList.add(v));
        for(const d of m[1].matchAll(/data-([a-z-]+)="([^"]*)"/g))child.dataset[d[1]]=d[2];this.children.push(child);
      }
    }
    get innerHTML(){return this._html;}
    setAttribute(k,v){this.attrs[k]=String(v);}
    getAttribute(k){return this.attrs[k] ?? null;}
    addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);}
    async fire(type, extra={}) {const event={target:this,preventDefault(){},detail:1,...extra}; for(const fn of this.listeners[type] || []) await fn(event);}
    click(){return this.fire('click');}
    closest(){return this;}
    querySelectorAll(selector){return selector.includes('.opt')?this.children.filter(c=>c.classList.contains('opt')):selector==='button'?this.children:[];}
    querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
    appendChild(child){this.children.push(child);return child;}
    insertBefore(child){this.children.push(child);return child;}
    focus(){document.activeElement=this;}
    remove(){}
  }
  function register(markup) {
    for(const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
      if(nodes.has(match[3])) continue;
      const element=new Element(match[3]);element.hidden=/\bhidden(?:\s|=|$)/.test(match[2]);
      for(const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) element.attrs[attr[1]]=attr[2];
      nodes.set(match[3],element);
    }
  }
  register(html);
  const document={getElementById(id){if(!nodes.has(id))throw new Error('Missing page element #' + id);return nodes.get(id);},
    createElement(){return new Element();},querySelector(selector){return nodes.get(selector.replace(/^#/,'')) || new Element();},querySelectorAll(){return [];},addEventListener(){},documentElement:new Element(),body:new Element(),activeElement:null};
  document.head=new Element();
  document.head.appendChild=el=>{if(el.src==='js/lantern-access.js')vm.runInContext(adapter,context); else if(el.src==='vendor/supabase.js')context.supabase=supabase; else throw Error('Unexpected script ' + el.src); Promise.resolve().then(()=>el.onload());return el;};
  const store={...(behavior.store || {})};
  const state = () => ({...clone(room), server_now: Date.now()});
  const supabase={createClient(){sdkClients++;return {auth:{
    async getSession(){return {data:{session:{user:{id:'guest'}}}};},
    async signInAnonymously(){throw Error('Unexpected sign-in');},
    async getUser(){authChecks++;return {data:{user:{id:'guest'}}};}
  },async rpc(name,args){
    calls.push({name,args:clone(args)});
    if(behavior.reject && behavior.reject.name===name) return {error:{code:behavior.reject.code,message:behavior.reject.message || 'refused'},status:behavior.reject.status || 400};
    if(name==='lantern_my_membership')return {data:clone(members[0])};
    if(name==='lantern_player_state') {
      if(behavior.deferPoll){return await new Promise(resolve=>{behavior.releasePoll=()=>resolve({data:state()});});}
      if(behavior.pollError){const error=behavior.pollError;behavior.pollError=null;return {error,status:error.status||503};}
      return {data:state()};
    }
    if(name==='lantern_host_state'){if(behavior.hostError)return {error:behavior.hostError,status:503};return {data:state()};}
    const requestKey=name + ':' + args.p_request_id;
    if(ledger.has(requestKey))return {data:clone(ledger.get(requestKey))};
    if(name==='lantern_create_room') commits.create=(commits.create||0)+1;
    if(name==='lantern_begin_game') {
      room.version++;room.phase='game';room.game_id='game';room.game={roster:members};
      commits.begin=(commits.begin||0)+1;
    }
    if(name==='lantern_open_prompt') {room.version++;room.prompt={id:'prompt',...clone(args.p_prompt),open_at:Date.now(),closed:false};commits.open=(commits.open||0)+1;}
    if(name==='lantern_set_phase') {room.version++;room.phase=args.p_phase;commits.phase=(commits.phase||0)+1;}
    const response=state();ledger.set(requestKey,response);
    if(behavior.lose===name){behavior.lose=null;return {error:{message:'connection reset after commit'},status:0};}
    return {data:response};
  }};}};
  context=vm.createContext({document,console,crypto:require('crypto').webcrypto,Uint8Array,AbortController,
    URLSearchParams,Date,performance:{now:()=>Date.now()},navigator:{},innerWidth:1280,innerHeight:900,
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]},
    location:{protocol:'https:',origin:'https://offline.test',search:'',reload(){reloads++;}},
    setTimeout(fn){const id=++serial;timeouts.set(id,fn);return id;},clearTimeout:id=>timeouts.delete(id),
    setInterval(fn){const id=++serial;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
    requestAnimationFrame(){return ++serial;},cancelAnimationFrame(){},addEventListener(){},scrollTo(){},matchMedia:()=>({matches:true}),tbMuted:true,
    TL_ART:{DISTRICTS:Array.from({length:10},(_,i)=>({id:'world'+i,name:'World'+i})),defs(){return '';},mini(){return '';},symbol(){return '';}},
    TB:{bank:()=>({'2':[{q:'Which?',correct:'A',wrong:['B','C','D']}]})},
  });
  context.window=context;
  if(page==='ten-lanterns-play.html'){context.supabase=supabase;vm.runInContext(adapter,context);}
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if(!/\bsrc=/.test(match[1]) && match[2].includes("'use strict'"))vm.runInContext(match[2],context,{filename:page});
  }
  async function flush(){for(let i=0;i<80;i++)await Promise.resolve();}
  async function phones(){const button=new Element();button.dataset.v='phones';await nodes.get('playOn').fire('click',{target:button});await flush();}
  const evaluate=code=>vm.runInContext(code,context);
  const visibleText=id=>{const el=nodes.get(id);if(!el||el.hidden)return '';return el.textContent+' '+el.innerHTML.replace(/<[^>]*>/g,' ')+el.children.map(x=>x.textContent).join(' ');};
  return {nodes,context,calls,commits,room,behavior,intervals,timeouts,flush,phones,evaluate,visibleText,store,
    stats:()=>({sdkClients,authChecks,reloads}), async runTimeout(){const first=timeouts.entries().next().value;if(!first)throw Error('No timeout');timeouts.delete(first[0]);await first[1]();await flush();}};
}


(async()=>{
 const out={};
 {
  const f=fixture('ten-lanterns.html');await f.flush();
  out.lazy={...f.stats(),calls:f.calls.length,adapterLoaded:!!f.context.LanternAccess};
 }
 {
  const f=fixture('ten-lanterns.html',{lose:'lantern_begin_game'});await f.phones();
  const start=f.nodes.get('beginBtn').fire('click');await f.flush();
  out.lost={before:{issue:!f.nodes.get('netIssue').hidden,retry:!f.nodes.get('netRetry').hidden,disabled:f.nodes.get('beginBtn').disabled,commits:f.commits.begin}};
  await f.evaluate('lobbyTick()');await f.flush();out.lost.before.afterPoll=!f.nodes.get('netIssue').hidden;
  await f.nodes.get('netRetry').fire('click');await start;await f.flush();
  out.lost.after={issue:!f.nodes.get('netIssue').hidden,disabled:f.nodes.get('beginBtn').disabled,commits:f.commits.begin,requests:f.calls.filter(x=>x.name==='lantern_begin_game').map(x=>x.args),game:f.evaluate('!!S && S.phones')};
 }
 {
  const f=fixture('ten-lanterns.html',{reject:{name:'lantern_create_room',code:'54000',message:'Active room limit reached'}});await f.phones();
  out.budget={busy:f.evaluate('net.access.busy()'),message:f.visibleText('lobbyMsg')+' '+f.visibleText('netIssueText'),issue:!f.nodes.get('netIssue').hidden};
 }
 {
  const f=fixture('ten-lanterns.html',{reject:{name:'lantern_create_room',code:'PT409'}});await f.phones();
  out.conflict={issue:!f.nodes.get('netIssue').hidden,retryHidden:f.nodes.get('netRetry').hidden};await f.nodes.get('netReload').fire('click');out.conflict.reloads=f.stats().reloads;
 }
 {
  const f=fixture('ten-lanterns.html',{store:{tb_lantern_host_room_v1:'ABCDE'},hostError:{message:'temporary network failure'}});await f.phones();
  out.restore={saved:f.store.tb_lantern_host_room_v1,created:f.calls.some(x=>x.name==='lantern_create_room'),issue:!f.nodes.get('netIssue').hidden};
 }
 {
  const f=fixture('ten-lanterns.html');await f.phones();await f.nodes.get('beginBtn').fire('click');await f.flush();
  f.behavior.lose='lantern_set_phase';f.evaluate('netFinish()');await f.flush();
  out.final={before:{issue:!f.nodes.get('netIssue').hidden,polling:f.evaluate('!!net.gameTimer'),commits:f.commits.phase}};
  await f.nodes.get('netRetry').fire('click');await f.flush();
  out.final.after={issue:!f.nodes.get('netIssue').hidden,polling:f.evaluate('!!net.gameTimer'),commits:f.commits.phase,requests:f.calls.filter(x=>x.name==='lantern_set_phase').map(x=>x.args)};
 }
 {
  const f=fixture('ten-lanterns.html');await f.phones();await f.nodes.get('beginBtn').fire('click');await f.flush();
  f.evaluate("R={rng:Math.random}; question({q:'Hidden complete question must not leak',opts:['A','B','C','D'],correct:'A'},{open:true,reveal:'words',ptsFrom:15,ptsTo:5})");await f.flush();
  out.words={requests:f.calls.filter(x=>x.name==='lantern_open_prompt').map(x=>x.args),tv:f.nodes.get('qText').innerHTML};
 }
 {
  const f=fixture('ten-lanterns-play.html');await f.flush();
  f.room.phase='game';f.room.game={roster:f.room.members};f.room.me=f.room.members[0];
  f.room.prompt={id:'pick',kind:'choose',eligible:['m0'],opts:Array.from({length:10},(_,i)=>'Choice'+(i+1)),disabled:[8],q:'Pick',open_at:0,closed:false};
  await f.evaluate("CODE='ABCDE';tick()");await f.flush();
  out.phone={initial:f.nodes.get('opts').children.map(x=>({text:x.textContent,disabled:x.disabled,index:x.dataset.i}))};
  f.behavior.pollError={message:'JWT expired',status:401};await f.evaluate('tick()');await f.flush();
  out.phone.failed={visible:!f.nodes.get('connectionErr').hidden,message:f.nodes.get('connectionErr').textContent,allDisabled:f.nodes.get('opts').children.every(x=>x.disabled),pressDisabled:f.nodes.get('press').disabled};
  await f.evaluate('tick()');await f.flush();out.phone.recovered={hidden:f.nodes.get('connectionErr').hidden,disabled:f.nodes.get('opts').children.map(x=>x.disabled)};
  await f.nodes.get('opts').fire('click',{target:f.nodes.get('opts').children[8]});await f.flush();
  out.phone.disabledCalls=f.calls.filter(x=>x.name==='lantern_answer').length;
  await f.nodes.get('opts').fire('click',{target:f.nodes.get('opts').children[9]});await f.flush();
  out.phone.answerCalls=f.calls.filter(x=>x.name==='lantern_answer').map(x=>x.args);
 }
 {
  const f=fixture('ten-lanterns-play.html');await f.flush();f.room.me=f.room.members[0];f.behavior.deferPoll=true;
  f.evaluate("CODE='ABCDE';tick()");await f.flush();
  const leave=f.nodes.get('leaveBtn').fire('click');await f.flush();f.behavior.releasePoll();await leave;await f.flush();
  out.stale={code:f.evaluate('CODE'),state:f.evaluate('S'),view:f.evaluate('view')};
 }
 console.log(JSON.stringify(out));
})().catch(error=>{console.error(error.stack);process.exit(1);});
"""

class LanternClientRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            result=subprocess.run(['node','-e',HARNESS,str(ROOT)],capture_output=True,text=True,timeout=30)
        except FileNotFoundError:
            raise unittest.SkipTest('node is not installed')
        if result.returncode:
            raise AssertionError(result.stderr)
        cls.data=json.loads(result.stdout)

    def test_one_screen_does_not_load_or_authenticate_sdk(self):
        self.assertEqual(self.data['lazy'],{'sdkClients':0,'authChecks':0,'reloads':0,'calls':0,'adapterLoaded':False})

    def test_lost_ack_is_visible_and_replayed_without_duplicate_commit(self):
        b,a=self.data['lost']['before'],self.data['lost']['after']
        self.assertTrue(b['issue'] and b['retry'] and b['disabled'] and b['afterPoll'])
        self.assertEqual(b['commits'],1)
        self.assertFalse(a['issue'] or a['disabled'])
        self.assertTrue(a['game'])
        self.assertEqual(a['commits'],1)
        self.assertEqual(len(a['requests']),2)
        self.assertEqual(a['requests'][0],a['requests'][1])
        self.assertRegex(a['requests'][0]['p_request_id'],r'^[0-9a-f-]{36}$')

    def test_budget_refusal_finishes_and_reports_limit(self):
        self.assertFalse(self.data['budget']['busy'])
        self.assertTrue(self.data['budget']['issue'])
        self.assertIn('limit',self.data['budget']['message'])

    def test_stale_host_conflict_offers_reload_only(self):
        self.assertEqual(self.data['conflict'],{'issue':True,'retryHidden':True,'reloads':1})

    def test_transient_restore_error_retains_original_room(self):
        self.assertEqual(self.data['restore'],{'saved':'ABCDE','created':False,'issue':True})

    def test_final_phase_stops_polling_only_after_replayed_ack(self):
        b,a=self.data['final']['before'],self.data['final']['after']
        self.assertTrue(b['issue'] and b['polling'])
        self.assertFalse(a['issue'] or a['polling'])
        self.assertEqual(b['commits'],1)
        self.assertEqual(a['commits'],1)
        self.assertEqual(a['requests'][0],a['requests'][1])

    def test_unrevealed_words_do_not_reach_phones(self):
        words=self.data['words']
        self.assertEqual(len(words['requests']),1)
        self.assertEqual(words['requests'][0]['p_prompt']['q'],'Watch the words appear on the big screen.')
        self.assertIn('Hidden',words['tv'])
        self.assertNotIn('Hidden complete question',json.dumps(words['requests']))

    def test_ten_phone_choices_have_labels_and_disabled_choice_stays_disabled(self):
        choices=self.data['phone']['initial']
        self.assertEqual(len(choices),10)
        self.assertEqual([c['index'] for c in choices],[str(i) for i in range(10)])
        self.assertTrue(choices[8]['disabled'])
        self.assertFalse(choices[9]['disabled'])
        self.assertEqual(choices[9]['text'],'10Choice10')
        self.assertNotIn('undefined',json.dumps(choices))
        self.assertEqual(self.data['phone']['disabledCalls'],0)
        self.assertEqual(self.data['phone']['answerCalls'],[{'p_code':'ABCDE','p_prompt_id':'pick','p_choice':9}])

    def test_poll_failure_disables_stale_controls_and_recovers(self):
        p=self.data['phone']
        self.assertTrue(p['failed']['visible'] and p['failed']['allDisabled'] and p['failed']['pressDisabled'])
        self.assertIn('Reload',p['failed']['message'])
        self.assertTrue(p['recovered']['hidden'])
        self.assertEqual(p['recovered']['disabled'],[False]*8+[True,False])

    def test_late_poll_cannot_resurrect_a_left_room(self):
        self.assertEqual(self.data['stale'],{'code':'','state':None,'view':'vJoin'})

if __name__ == '__main__':
    unittest.main()
