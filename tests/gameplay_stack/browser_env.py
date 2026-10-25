"""Real page/SDK fixture with backend HTTP confined to an internal Docker pipe.

Source adapters are served unchanged. Only the transport destination changes:
GoTrue and PostgREST both run in the disposable Compose project. No HAR, token
or Auth body is recorded in artifacts.
"""
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit

ORIGIN = 'https://tierbrain.test'
PROJECT_HOST = 'cgrbwtcydgfkbqhseeap.supabase.co'


class BrowserEnv:
    def __init__(self, browser, root, transport, report, report_path):
        self.browser, self.root = browser, root.resolve()
        self.transport = transport
        self.report, self.report_path = report, report_path
        self.pages, self.contexts, self.calls, self.interruptions = [], [], {}, {}
        report.update(checks=[], notes=[], page_errors=[], blocked_external_requests=0,
                      backend_requests=0, hosted_requests=0)

    def check(self, name, condition, details=None):
        item = {'name': name, 'passed': bool(condition)}
        if details is not None:
            item['details'] = details
        self.report['checks'].append(item)
        print(name + ': ' + ('passed' if condition else 'FAILED'), flush=True)
        if not condition:
            raise AssertionError(name)

    def note(self, text):
        self.report['notes'].append(text)
        print(text, flush=True)

    def rpc_calls(self, page, rpc_name):
        return [dict(item) for item in self.calls[page.context]
                if item['name'] == rpc_name]

    def interrupt_next_rpc(self, page, rpc_name):
        if page.context in self.interruptions:
            raise AssertionError('An acknowledgement interruption is already pending')
        self.interruptions[page.context] = rpc_name

    def new_page(self, path, label, mobile=False, init_script=None):
        if any(existing == label for _, existing in self.pages):
            raise ValueError('Page label must be unique')
        context = self.browser.new_context(
            viewport={'width':390,'height':844} if mobile else {'width':1280,'height':900},
            is_mobile=mobile, has_touch=mobile, reduced_motion='reduce',
            service_workers='block', ignore_https_errors=False)
        self.contexts.append(context)
        self.calls[context] = []
        if init_script:
            context.add_init_script(init_script)
        context.route('**/*', lambda route: self._route(route, context))
        context.route_web_socket('**/*', lambda socket: socket.close())
        page = context.new_page()
        page.set_default_timeout(20000)
        page.on('pageerror', lambda error: self.report['page_errors'].append(
            {'page':label, 'error':str(error)[:1500], 'stack':str(getattr(error,'stack',''))[:2000]}))
        self.pages.append((page,label))
        page.goto(ORIGIN + '/' + path.lstrip('/'), wait_until='domcontentloaded', timeout=30000)
        return page

    def _route(self, route, context):
        request = route.request
        url = urlsplit(request.url)
        cors = {'access-control-allow-origin':ORIGIN,
                'access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer',
                'access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS',
                'access-control-expose-headers':'content-range,range,x-total-count'}
        if url.scheme == 'https' and url.hostname == PROJECT_HOST:
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            prefix = next((prefix for prefix in ('/auth/v1','/rest/v1')
                if url.path == prefix or url.path.startswith(prefix+'/')), None)
            if prefix is None:
                self.report['blocked_external_requests'] += 1
                route.fulfill(status=404, headers=cors, body='{}')
                return
            suffix = url.path[len(prefix):] or '/'
            if url.query:
                suffix += '?' + url.query
            headers = {key:value for key,value in request.headers.items()
                       if key.lower() in ('authorization','apikey','content-type','accept',
                                          'x-client-info','x-supabase-api-version','prefer')}
            status, body, raw_headers = self.transport(prefix, suffix, request.method,
                                                      headers, request.post_data_buffer)
            response_headers = {key.lower():value for key,value in raw_headers.items()
                                if key.lower() not in ('connection','transfer-encoding',
                                    'content-length','content-encoding','access-control-allow-origin')}
            self.report['backend_requests'] += 1
            if prefix == '/rest/v1' and suffix.startswith('/rpc/'):
                name = url.path.rsplit('/',1)[-1]
                try:
                    args = json.loads(request.post_data or '{}')
                except ValueError:
                    args = {}
                item = {'name':name, 'status':status}
                for key in ('request_id','run_id','window_id'):
                    if 'p_'+key in args:
                        item[key] = args['p_'+key]
                if 200 <= status < 300 and self.interruptions.get(context) == name:
                    del self.interruptions[context]
                    item['committed_status'] = status
                    status = item['status'] = 503
                    body = b'{"code":"fixture_response_lost","message":"Synthetic acknowledgement interrupted after commit"}'
                    response_headers['content-type'] = 'application/json'
                self.calls[context].append(item)
            route.fulfill(status=status, headers={**response_headers,**cors}, body=body)
            return
        if url.scheme == 'https' and url.hostname == 'tierbrain.test':
            relative = unquote(url.path).lstrip('/') or 'index.html'
            target = (self.root / relative).resolve()
            if not target.is_relative_to(self.root) or not target.is_file():
                route.fulfill(status=404, content_type='text/plain', body='Fixture asset missing')
                return
            route.fulfill(status=200, content_type=mimetypes.guess_type(target.name)[0] or 'application/octet-stream',
                          body=target.read_bytes())
            return
        self.report['blocked_external_requests'] += 1
        if request.resource_type == 'script':
            # WebKit validates module MIME types even for intercepted empty
            # responses. Omit third-party code with a valid empty JS module.
            route.fulfill(status=200,headers=cors,content_type='application/javascript',body='')
        else:
            route.fulfill(status=204, headers=cors)

    def finish(self):
        self.check('real backend requests were exercised', self.report['backend_requests'] > 0)
        self.check('all page scripts completed without uncaught errors', not self.report['page_errors'],
                   self.report['page_errors'])
        self.check('all injected lost acknowledgements were exercised', not self.interruptions)

    def capture_failure(self):
        for page,label in self.pages:
            try:
                safe = ''.join(c if c.isalnum() or c in '-_' else '_' for c in label)
                target = self.report_path.with_name(self.report_path.stem+'-failure-'+safe+'.png')
                page.screenshot(path=str(target), full_page=False, timeout=4000)
            except Exception:
                pass

    def close(self):
        self.report['rpc_summary'] = {label:{name:sum(call['name']==name for call in self.calls[page.context])
            for name in sorted({call['name'] for call in self.calls[page.context]})}
            for page,label in self.pages}
        for context in self.contexts:
            context.close()
