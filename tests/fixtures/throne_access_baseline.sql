-- Synthetic only. The standard Show fixture supplies roles, legacy sentinels,
-- cron and deliberately broad defaults. Give this fixture the historical
-- legends columns used by the narrow read bridge, while retaining its sentinels.
ALTER TABLE public.legends ADD COLUMN game text;
ALTER TABLE public.legends ADD COLUMN name text;
ALTER TABLE public.legends ADD COLUMN streak integer;
ALTER TABLE public.legends ADD COLUMN flawless boolean;
UPDATE public.legends SET game='throne:GROUP_A',name='Historical General',streak=7,flawless=false WHERE id=101;
UPDATE public.legends SET game='throne-bible:GROUP_A',name='Historical Bible',streak=4,flawless=true WHERE id=102;
