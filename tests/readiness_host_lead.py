"""Real early-access form submission through isolated PostgREST and SQL.

No response substitution, Auth signup, application source transform or clock
override. Only synthetic email addresses ending in .invalid are submitted.
"""
from uuid import uuid4


def submit(env,page,email,context,label):
    page.locator('#hf_email').fill(email)
    page.locator('#hf_context').select_option(context)
    with page.expect_response(lambda response:response.url.endswith('/rest/v1/rpc/submit_host_lead') and response.request.method=='POST') as received:
        page.locator('#hf_submit').click()
    response=received.value
    env.check(label+': actual database intake succeeds',200<=response.status<300,{'status':response.status})
    receipt=response.json()
    env.check(label+': acknowledgement contains no personal data or existence information',receipt=={'ok':True})
    page.locator('#hf_done').wait_for(state='visible')
    env.check(label+': real form confirms and focuses successful signup',
              page.locator('#hostForm').is_hidden() and page.evaluate("document.activeElement.id==='hf_done'")
              and len(env.rpc_calls(page,'submit_host_lead'))==1)
    return receipt


def raw(page,path,method='GET',body=None):
    # This is an independent public browser capability check, confined by the
    # fixture's transport to its disposable PostgREST. It uses no secret key.
    return page.evaluate("""async args=>{
      const response=await fetch(SB_URL+'/rest/v1/'+args.path,{
        method:args.method,headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY,'Content-Type':'application/json'},
        ...(args.body===null?{}:{body:JSON.stringify(args.body)})
      });
      return {status:response.status,body:await response.json()};
    }""",{'path':path,'method':method,'body':body})


def run(env):
    suffix=uuid4().hex[:10]
    address='Readiness.Host+'+suffix+'@Example.Invalid'
    first=env.new_page('/host.html','Host lead genuine form',mobile=True)
    count=env.report['backend_requests']
    first.locator('#hf_email').fill('not-an-email')
    first.locator('#hf_submit').click()
    env.check('Host intake: invalid email stays local with accessible error',
              env.report['backend_requests']==count and first.locator('#hf_err').is_visible()
              and first.locator('#hf_email').get_attribute('aria-invalid')=='true')
    receipt=submit(env,first,address,'church','Host new lead')

    duplicate=env.new_page('/host.html','Host lead anonymous duplicate',mobile=True)
    repeated=submit(env,duplicate,address.lower(),'party','Host duplicate lead')
    env.check('Host intake: independent duplicate receives identical generic confirmation',repeated==receipt)

    outsider=env.new_page('/host.html','Host intake public capability checks',mobile=True)
    selected=raw(outsider,'host_leads?select=email&limit=1')
    env.check('Host intake: independent public browser cannot read any lead rows',
              selected['status'] in (401,403,404) and selected['body'].get('code') in ('42501','PGRST205'))
    inserted=raw(outsider,'host_leads','POST',{'email':'direct-'+suffix+'@example.invalid','context':'pub'})
    env.check('Host intake: independent public browser cannot insert rows directly',
              inserted['status'] in (401,403,404) and inserted['body'].get('code') in ('42501','PGRST205'))
    invalid=raw(outsider,'rpc/submit_host_lead','POST',{'p_email':'not-an-email','p_context':None})
    env.check('Host intake: server rejects invalid email even if the form is bypassed',
              invalid['status']==400 and invalid['body'].get('code')=='22023')
    bad_context=raw(outsider,'rpc/submit_host_lead','POST',{'p_email':'invalid-context-'+suffix+'@example.invalid','p_context':'unlisted'})
    env.check('Host intake: server accepts only the form context choices',
              bad_context['status']==400 and bad_context['body'].get('code')=='22023')
    env.note('Real native form/RPC/SQL success and duplicate acceptance, no source transforms or mocked responses; direct public table access and invalid RPC input were rejected. No production contacts or Auth users.')
    for page in (first,duplicate,outsider):page.context.close()
