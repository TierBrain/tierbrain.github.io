-- Operator rollback: disable intake while retaining private opt-in records.
-- Does not drop the table, erase emails or restore the broken direct-write API.
SET LOCAL lock_timeout = '3s';
REVOKE ALL ON TABLE public.host_leads FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_host_lead(text,text) FROM PUBLIC,anon,authenticated;
DROP FUNCTION public.submit_host_lead(text,text);
NOTIFY pgrst,'reload schema';
