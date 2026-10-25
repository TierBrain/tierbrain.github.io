"""Real page/SDK fixture with backend HTTP confined to an internal Docker pipe.

Source adapters are served unchanged. Only the transport destination changes:
GoTrue and PostgREST both run in the disposable Compose project. No HAR, token
or Auth body is recorded in artifacts.
"""
import json
import mimetypes
import re
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit

ORIGIN = 'https://tierbrain.test'
PROJECT_HOST = 'cgrbwtcydgfkbqhseeap.supabase.co'


def navigation_refresh_cancellation(error, refreshes, navigations, used):
    """Match WebKit's old-document CORS error to a proven reload abort only."""
    message = error.get('error','') + '\n' + error.get('stack','')
    if '/auth/v1/token?grant_type=refresh_token' not in message or 'access control checks' not in message:
        return None
    at = error['elapsed_ms']
    failed = [request for request in refreshes if request['page'] == error['page']
              and request.get('failed_ms') is not None and abs(request['failed_ms']-at) <= 500]
    # An uncancelled failure in the same interval is ambiguous: fail closed.
    if any(not request.get('cancelled') for request in failed):
        return None
    for request in failed:
        if request['id'] in used:
            continue
        for navigation in navigations:
            if (navigation['page'] == error['page'] and error['document']==request['document']==navigation['document']
                    and navigation.get('completed')
                    and request['id'] in navigation['inflight_refresh_ids']
                    and navigation['started_ms'] <= request['failed_ms'] <= navigation['finished_ms']+500
                    and navigation['started_ms'] <= at <= navigation['finished_ms']+500):
                used.add(request['id'])
                return {'error':error,'request':dict(request),'navigation':dict(navigation)}
    return None


class BrowserEnv:
    def __init__(self, browser, root, transport, report, report_path):
        self.browser, self.root = browser, root.resolve()
        self.transport = transport
        self.report, self.report_path = report, report_path
        self.pages, self.contexts, self.calls, self.interruptions = [], [], {}, {}
        self.started = time.monotonic()
        self.page_lifecycle, self.refresh_requests, self.navigations = {}, {}, []
        report.update(checks=[], notes=[], page_errors=[], blocked_external_requests=0,
                      backend_requests=0, hosted_requests=0, network_events=[], navigation_cancellations=[])

    def _elapsed(self):
        return round((time.monotonic()-self.started)*1000)

    def _network_event(self, event):
        self.report['network_events'].append(event)
        self.report['network_events'] = self.report['network_events'][-300:]

    def _refresh_request(self, page, request):
        url = urlsplit(request.url)
        if url.hostname != PROJECT_HOST or url.path != '/auth/v1/token' or url.query != 'grant_type=refresh_token':
            return
        lifecycle = self.page_lifecycle[page]
        item = {'id':len(self.refresh_requests)+1,'page':lifecycle['label'],
                'document':lifecycle['document'],'started_ms':self._elapsed()}
        self.refresh_requests[request] = item
        for navigation in self.navigations:
            if (navigation['page']==item['page'] and navigation['document']==item['document']
                    and 'finished_ms' not in navigation):
                navigation['inflight_refresh_ids'].append(item['id'])
        self._network_event({'event':'refresh_started',**item})

    def _refresh_response(self, response):
        item = self.refresh_requests.get(response.request)
        if item is None:
            return
        headers = response.headers
        item.update(status=response.status,allow_origin=headers.get('access-control-allow-origin'))
        self._network_event({'event':'refresh_response','elapsed_ms':self._elapsed(),**item})

    def _refresh_finished(self, request, failed=False):
        item = self.refresh_requests.get(request)
        if item is None:
            return
        if failed:
            failure = request.failure or ''
            item.update(failed_ms=self._elapsed(),failure=failure[:200],
                        cancelled=bool(re.search(r'\b(?:cancelled|canceled|aborted|ERR_ABORTED|NS_BINDING_ABORTED)\b',failure,re.I)))
        else:
            item['finished_ms'] = self._elapsed()
        self._network_event({'event':'refresh_failed' if failed else 'refresh_finished',**item})

    def _page_error(self, page, error):
        lifecycle = self.page_lifecycle[page]
        self.report['page_errors'].append({'page':lifecycle['label'],'document':lifecycle['document'],
            'elapsed_ms':self._elapsed(),'error':str(error)[:1500],
            'stack':str(getattr(error,'stack',''))[:2000]})

    def _document_loaded(self, page, frame):
        if frame != page.main_frame:
            return
        lifecycle = self.page_lifecycle[page]
        lifecycle['document'] += 1
        self._network_event({'event':'document_loaded','page':lifecycle['label'],
                             'document':lifecycle['document'],'elapsed_ms':self._elapsed()})

    def reload_page(self, page, **options):
        """Perform a real reload, recording which old Auth requests it cancels."""
        lifecycle = self.page_lifecycle[page]
        navigation = {'page':lifecycle['label'],'document':lifecycle['document'],
                      'started_ms':self._elapsed(),'completed':False,
                      'inflight_refresh_ids':[item['id'] for item in self.refresh_requests.values()
                          if item['page']==lifecycle['label'] and item['document']==lifecycle['document']
                          and 'finished_ms' not in item and 'failed_ms' not in item]}
        self.navigations.append(navigation)
        try:
            result = page.reload(**options)
            navigation['completed'] = True
            return result
        finally:
            navigation['finished_ms'] = self._elapsed()
            self._network_event({'event':'explicit_reload',**navigation})

    def settle_page_errors(self):
        # Keep every raw diagnostic. Only a refresh proven cancelled by this
        # test's native reload belongs to navigation rather than runtime errors.
        runtime, used = [], set()
        for error in self.report['page_errors']:
            cancellation = navigation_refresh_cancellation(error,self.refresh_requests.values(),self.navigations,used)
            if cancellation is None:
                runtime.append(error)
            else:
                self.report['navigation_cancellations'].append(cancellation)
        self.report['page_errors'] = runtime

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
        self.page_lifecycle[page] = {'label':label,'document':0}
        page.set_default_timeout(20000)
        page.on('pageerror', lambda error:self._page_error(page,error))
        page.on('request', lambda request:self._refresh_request(page,request))
        page.on('response', self._refresh_response)
        page.on('requestfinished', self._refresh_finished)
        page.on('requestfailed', lambda request:self._refresh_finished(request,failed=True))
        page.on('framenavigated', lambda frame:self._document_loaded(page,frame))
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
        self.settle_page_errors()
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
