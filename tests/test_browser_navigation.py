"""A reload cancellation requires matching native network/lifecycle evidence."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('gameplay_browser_env',Path(__file__).parent/'gameplay_stack/browser_env.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NavigationCancellationTests(unittest.TestCase):
    def setUp(self):
        self.error={'page':'guest','document':1,'elapsed_ms':1010,
                    'error':'Fetch API cannot load https://cgrbwtcydgfkbqhseeap.supabase.co/auth/v1/token?grant_type=refresh_token due to access control checks.'}
        self.request={'id':1,'page':'guest','document':1,'started_ms':900,
                      'failed_ms':1005,'failure':'cancelled','cancelled':True}
        self.navigation={'page':'guest','document':1,'started_ms':1000,'finished_ms':1050,
                         'completed':True,'inflight_refresh_ids':[1]}

    def classify(self,request=None,navigation=None,error=None,used=None):
        return module.navigation_refresh_cancellation(error or self.error,
            [request or self.request],[navigation or self.navigation],set() if used is None else used)

    def test_cancelled_old_document_refresh_is_retained_as_navigation_evidence(self):
        result=self.classify()
        self.assertEqual(result['error'],self.error)
        self.assertEqual(result['request']['failure'],'cancelled')
        self.assertEqual(result['navigation']['inflight_refresh_ids'],[1])

    def test_runtime_cors_failure_is_not_a_navigation_cancellation(self):
        request={**self.request,'cancelled':False,'failure':'Load failed'}
        self.assertIsNone(self.classify(request=request))

    def test_uncancelled_failure_makes_same_interval_ambiguous(self):
        self.assertIsNone(module.navigation_refresh_cancellation(self.error,
            [self.request,{**self.request,'id':2,'cancelled':False}], [self.navigation],set()))

    def test_explicit_reload_is_required(self):
        self.assertIsNone(module.navigation_refresh_cancellation(self.error,[self.request],[],set()))

    def test_request_must_belong_to_marked_reload(self):
        self.assertIsNone(self.classify(navigation={**self.navigation,'inflight_refresh_ids':[]}))

    def test_request_must_belong_to_old_document(self):
        self.assertIsNone(self.classify(request={**self.request,'document':2}))

    def test_new_document_error_is_retained(self):
        self.assertIsNone(self.classify(error={**self.error,'document':2}))

    def test_cancel_must_happen_during_reload(self):
        self.assertIsNone(self.classify(request={**self.request,'failed_ms':999}))

    def test_error_must_happen_during_reload(self):
        self.assertIsNone(self.classify(error={**self.error,'elapsed_ms':1551}))

    def test_error_and_cancel_must_be_close_in_time(self):
        self.assertIsNone(self.classify(error={**self.error,'elapsed_ms':1510}))

    def test_another_page_cancellation_cannot_hide_error(self):
        self.assertIsNone(self.classify(request={**self.request,'page':'host'}))

    def test_non_refresh_error_is_never_classified(self):
        self.assertIsNone(self.classify(error={**self.error,'error':'CORS access control checks /rest/v1/rpc/race_submit'}))

    def test_non_cors_runtime_error_is_never_classified(self):
        self.assertIsNone(self.classify(error={**self.error,'error':'TypeError /auth/v1/token?grant_type=refresh_token'}))

    def test_failed_reload_does_not_excuse_error(self):
        self.assertIsNone(self.classify(navigation={**self.navigation,'completed':False}))

    def test_one_cancel_cannot_hide_two_errors(self):
        used=set()
        self.assertIsNotNone(self.classify(used=used))
        self.assertIsNone(self.classify(used=used))


if __name__=='__main__':
    unittest.main()
