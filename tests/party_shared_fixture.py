"""Shared offline adapter fixture for host plus independent phone browser pages.

This tests DOM/gameplay integration, not SQL or JWT authorization. No request
leaves the browser route handler. The SQL and real Auth fixtures are separate.
"""
from copy import deepcopy
from datetime import datetime, timezone
import threading
from uuid import uuid4


class PartySharedFixture:
    def __init__(self):
        self.rooms={}
        self.receipts=[]
        self.counter=0
        self.lock=threading.Lock()

    @staticmethod
    def now():return datetime.now(timezone.utc).isoformat()

    def respond(self,body):
        with self.lock:
            try:return 200,self.dispatch(body)
            except (KeyError,ValueError,AssertionError) as error:
                return 403,{'code':'42501','message':str(error)}

    def dispatch(self,body):
        family,edition,user,op,args=[body[k] for k in ['family','edition','identity','op','args']]
        assert family=='creak' and edition=='general','Unsupported shared browser fixture'
        if op=='create':
            self.counter+=1
            code='T'+''.join(chr(65+(self.counter//(26**n))%26) for n in range(3,-1,-1))
            room={'id':str(uuid4()),'code':code,'family':family,'edition':edition,'phase':'lobby',
                  'run_id':None,'version':0,'state':{'phase':'lobby'},'action':None}
            self.rooms[code]={'owner':user,'room':room,'members':[]}
            return deepcopy(room)
        code=args[0]
        item=self.rooms.get(code)
        if op=='preview':
            return None if not item else {k:item['room'][k] for k in ['code','family','edition','phase']}
        assert item,'Room unavailable'
        room=item['room'];members=item['members']
        member=next((m for m in members if m['user']==user and not m.get('left')),None)
        roster=lambda:[{k:v for k,v in m.items() if k not in ['user','left']} for m in members if not m.get('left')]
        public_member=lambda m:None if not m else {k:v for k,v in m.items() if k not in ['user','left']}
        if op in ['resume','begin','publish','members','close','actions']:
            assert item['owner']==user,'Owned host required'
        if op=='resume':return deepcopy(room)
        if op=='members':return deepcopy(roster())
        if op=='begin':
            room.update(run_id=str(uuid4()),phase='lobby',state={'phase':'lobby'},action=None,version=room['version']+1)
            return deepcopy(room)
        if op=='publish':
            patch=deepcopy(args[1]);room.update(patch);room['version']+=1
            state=room['state'];key=kind=actor=None
            if room['phase']=='live':
                if state.get('pendingQ'):
                    q=state['pendingQ'];key='question:'+q['qId'];kind='answer';actor=q['forPlayer']
                else:
                    key='roll:'+str(state['turnSeq']);kind='roll';actor=state['order'][state['turnIdx']]
            old=room.get('action')
            if key is None:room['action']=None
            elif not old or old['key']!=key:
                room['action']={'id':str(uuid4()),'key':key,'kind':kind,'member_id':actor,'accepting':True}
            return deepcopy(room)
        if op=='join':
            if member is None:
                member={'id':str(uuid4()),'user':user,'name':args[1],'look':None,'score':0,
                        'joined_at':self.now(),'last_seen':self.now()}
                members.append(member)
            return deepcopy(public_member(member))
        if op=='membership':return deepcopy(public_member(member))
        if op in ['heartbeat','leave','state','submit']:assert member,'Active membership required'
        if op=='heartbeat':
            member['last_seen']=self.now()
            if len(args)>1 and args[1] is not None:member['look']=deepcopy(args[1])
            return deepcopy(public_member(member))
        if op=='leave':member['left']=True;return {'left':True}
        if op=='state':
            window=room.get('action')
            receipts=[r for r in self.receipts if window and r['window_id']==window['id'] and r['player_id']==member['id']]
            return deepcopy({'room':room,'member':public_member(member),'members':roster(),'receipts':receipts})
        if op=='actions':
            return deepcopy([r for r in self.receipts if r['run_id']==args[1] and r['window_id']==args[2] and r['id']>(args[3] or 0)])
        if op=='close':
            window=room.get('action');assert window and window['id']==args[1],'Current window required'
            window['accepting']=False;room['version']+=1
            return deepcopy({'room':room,'actions':[r for r in self.receipts if r['window_id']==window['id']]})
        if op=='submit':
            run,window,choice=args[1:4]
            assert room['run_id']==run,'Current run required'
            prior=next((r for r in self.receipts if r['window_id']==window and r['player_id']==member['id']),None)
            if prior:
                assert prior['choice']==choice,'Changed choice'
                return deepcopy(prior)
            action=room.get('action')
            assert action and action['id']==window and action['accepting'] and action['member_id']==member['id'],'Current eligible window required'
            self.counter+=1
            receipt={'id':self.counter,'player_id':member['id'],'run_id':run,'window_id':window,
                     'choice':choice,'kind':action['kind'],'created_at':self.now()}
            self.receipts.append(receipt)
            return deepcopy(receipt)
        raise ValueError('Unknown fixture operation '+op)
