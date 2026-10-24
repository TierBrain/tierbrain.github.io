"""Shared-page UX checks. Backend calls are synthetic and never forwarded.

run(env) uses the readiness runner's local-page environment. This suite checks
mobile geometry and real form handlers; it does not claim physical-device or
screen-reader certification. Only the host form's named 12s deadline shortens.
"""
import json


POSTERS = ('how-to-join.html', 'join-the-big-quiz.html', 'join-chapter-and-verse.html')


def _layout(env):
    for path in POSTERS:
        page = env.new_page(path, 'ux_'+path, mobile=True)
        for width in (320, 390, 844):
            page.set_viewport_size({'width':width, 'height':844})
            result = page.evaluate("""() => {
              const bad=[];
              for(const poster of document.querySelectorAll('.poster')){
                const outer=poster.getBoundingClientRect();
                for(const el of poster.querySelectorAll('.title,.steps,.step,.board,.slots,.tips,.foot')){
                  const r=el.getBoundingClientRect();
                  if(r.left<outer.left-1 || r.right>outer.right+1)bad.push(el.className);
                }
                const board=poster.querySelector('.board'), slots=poster.querySelector('.slots');
                if(slots.getBoundingClientRect().right>board.getBoundingClientRect().right-4)bad.push('code slots');
              }
              return {bad, overflow:document.documentElement.scrollWidth>innerWidth+1};
            }""")
            env.check(f'{path}: instructions and code fit at {width}px',
                      not result['bad'] and not result['overflow'], result)
        env.check(path+': one main landmark and page heading',
                  page.get_by_role('main').count()==1 and page.get_by_role('heading',level=1).count()==1)
        for target in (('play.html','play-gen.html') if path=='how-to-join.html'
                       else ('play-gen.html',) if path=='join-the-big-quiz.html' else ('play.html',)):
            link=page.locator('a.url[href="'+target+'"]')
            link.focus()
            env.check(path+': keyboard can reach '+target,
                      link.count()==1 and link.evaluate('(el)=>el===document.activeElement'))
        page.emulate_media(media='print')
        print_width=page.locator('.poster').first.evaluate('(el)=>el.getBoundingClientRect().width')
        env.check(path+': print layout retains poster size', print_width>600)
        page.emulate_media(media='screen')


def _host_form(env):
    page=env.new_page('host.html','ux_host_form',mobile=True)
    calls=[]
    response={'status':503}

    def host_response(route):
        if route.request.method=='OPTIONS':
            route.fulfill(status=204,headers={
                'access-control-allow-origin':'https://tierbrain.test',
                'access-control-allow-methods':'POST,OPTIONS',
                'access-control-allow-headers':'apikey,authorization,content-type,prefer'})
            return
        calls.append(json.loads(route.request.post_data))
        route.fulfill(status=response['status'],headers={
            'access-control-allow-origin':'https://tierbrain.test'},body='')

    page.route('**/rest/v1/host_leads',host_response)
    page.locator('#hf_email').fill('not-an-email')
    page.locator('#hf_submit').click()
    env.check('host form: invalid email is announced and focused',
              not calls and page.locator('#hf_err').is_visible()
              and page.locator('#hf_email').get_attribute('aria-invalid')=='true'
              and page.evaluate("document.activeElement.id==='hf_email'"))
    page.locator('#hf_email').fill('readiness@example.invalid')
    page.locator('#hf_context').select_option('church')
    page.locator('#hf_submit').click()
    page.wait_for_function("document.querySelector('#hf_err').classList.contains('show') && !document.querySelector('#hf_submit').disabled")
    env.check('host form: failed signup is retryable without losing input',
              len(calls)==1 and page.locator('#hf_email').input_value()=='readiness@example.invalid'
              and page.locator('#hostForm').get_attribute('aria-busy')=='false'
              and page.evaluate("document.activeElement.id==='hf_err'"))
    response['status']=201
    page.locator('#hf_submit').click()
    page.locator('#hf_done').wait_for(state='visible')
    env.check('host form: successful signup confirms the actual values and moves focus',
              calls==[{'email':'readiness@example.invalid','context':'church'}]*2
              and page.locator('#hostForm').is_hidden()
              and page.evaluate("document.activeElement.id==='hf_done'"))

    pending=env.new_page('host.html','ux_host_pending',mobile=True)
    pending.evaluate("""() => {
      window.__hostCalls=0;
      const real=window.fetch;
      window.fetch=(url,options)=>{
        if(!String(url).endsWith('/rest/v1/host_leads'))return real(url,options);
        window.__hostCalls++;
        return new Promise((resolve,reject)=>{window.__hostReject=reject;});
      };
    }""")
    pending.locator('#hf_email').fill('readiness@example.invalid')
    pending.locator('#hf_submit').click()
    pending.evaluate("document.querySelector('#hostForm').requestSubmit()")
    env.check('host form: a pending request cannot queue a duplicate submission',
              pending.evaluate("__hostCalls===1 && document.querySelector('#hf_submit').disabled && document.querySelector('#hostForm').getAttribute('aria-busy')==='true'"))
    pending.evaluate("__hostReject(new Error('Synthetic acknowledgement unavailable'))")
    pending.wait_for_function("!document.querySelector('#hf_submit').disabled")

    timeout=env.new_page('host.html','ux_host_timeout',mobile=True)
    timeout.evaluate("""() => {
      const realTimer=window.setTimeout, realFetch=window.fetch;
      window.setTimeout=(fn,ms,...args)=>realTimer(fn,ms===12000?30:ms,...args);
      window.fetch=(url,options)=>{
        if(!String(url).endsWith('/rest/v1/host_leads'))return realFetch(url,options);
        return new Promise((resolve,reject)=>{
          options.signal.addEventListener('abort',()=>reject(new DOMException('Synthetic form timeout','AbortError')),{once:true});
        });
      };
    }""")
    timeout.locator('#hf_email').fill('readiness@example.invalid')
    timeout.locator('#hf_submit').click()
    timeout.wait_for_function("document.querySelector('#hf_err').textContent.includes('confirm your signup in time') && !document.querySelector('#hf_submit').disabled")
    env.check('host form: bounded request expiry restores a focused retry',
              timeout.locator('#hostForm').get_attribute('aria-busy')=='false'
              and timeout.evaluate("document.activeElement.id==='hf_err'"))
    env.note('Host request timeout used 30ms instead of 12s; the real AbortController and form handlers ran, with no production requests.')


def _navigation(env):
    for path in ('index.html','packs.html','host.html','bible-games.html','privacy.html','terms.html','about.html','contact.html','404.html'):
        page=env.new_page(path,'ux_nav_'+path,mobile=True)
        page.set_viewport_size({'width':320,'height':844})
        env.check(path+': page has a main landmark and a page heading',
                  page.get_by_role('main').count()==1 and page.get_by_role('heading',level=1).count()==1)
        page.keyboard.press('Tab')
        env.check(path+': skip link is first in keyboard order',
                  page.evaluate("document.activeElement.classList.contains('skip')"))
        page.keyboard.press('Enter')
        env.check(path+': skip link moves focus to the content',
                  page.evaluate("document.activeElement.id==='main'"))
        env.check(path+': page fits a narrow phone',
                  page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    page=env.new_page('index.html','ux_back_to_top',mobile=True)
    page.emulate_media(reduced_motion='reduce')
    page.evaluate('window.scrollTo(0,900)')
    page.locator('#toTop').click()
    page.wait_for_function('scrollY===0')
    env.check('catalogue: reduced-motion back-to-top restores navigation focus',
              page.evaluate("document.activeElement.matches('header .brand')"))


def run(env):
    _layout(env)
    _host_form(env)
    _navigation(env)
