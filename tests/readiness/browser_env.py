"""Readiness UI checks using actual source and the disposable backend.

Transforms expose test-only closure oracles; tests must leave game handlers,
scoring and protocol implementations intact. Real user JWTs pass unchanged.
The public opaque API-key case reproduces the managed gateway's anon role.
"""
import mimetypes
from urllib.parse import unquote, urlsplit
from browser_env import BrowserEnv, ORIGIN


class ReadinessEnv(BrowserEnv):
    def __init__(self,browser,root,transport,report,report_path):
        def gateway(prefix,path,method,headers,body):
            headers = dict(headers)
            key = headers.get('apikey','')
            if key.startswith('sb_publishable_') and headers.get('authorization') == 'Bearer '+key:
                del headers['authorization']
            return transport(prefix,path,method,headers,body)
        super().__init__(browser,root,gateway,report,report_path)
        self.transforms = {}
        report['source_transforms'] = []
        report['limits'].append('Public opaque API-key requests map to the isolated anon role; real user JWTs are unchanged')

    def transform_source(self,path,callback):
        path = '/'+path.lstrip('/')
        if path in self.transforms:
            raise ValueError('Only one source transform per asset is allowed')
        self.transforms[path] = callback
        self.report['source_transforms'].append(path)

    def _route(self,route,context):
        url = urlsplit(route.request.url)
        if url.scheme == 'https' and url.hostname == 'tierbrain.test' and url.path in self.transforms:
            path = (self.root/unquote(url.path).lstrip('/')).resolve()
            if not path.is_relative_to(self.root) or not path.is_file():
                raise ValueError('Invalid source transform asset')
            content = self.transforms[url.path](path.read_text())
            if not isinstance(content,str):
                raise TypeError('Source transform must return text')
            route.fulfill(status=200,content_type=mimetypes.guess_type(path.name)[0] or 'text/plain',body=content)
            return
        super()._route(route,context)

    def finish(self):
        self.settle_page_errors()
        self.check('all readiness pages completed without uncaught errors',not self.report['page_errors'],
                   self.report['page_errors'])
        self.check('all injected acknowledgement interruptions were exercised',not self.interruptions)
        self.check('no hosted backend requests were allowed',self.report['hosted_requests']==0)

