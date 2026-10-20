-- Synthetic empty score schema matching the reviewed application's contract.
-- Use only in a fresh isolated PostgreSQL 17 cluster. No production rows/keys.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.scores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  quiz_id text NOT NULL,
  group_code text NOT NULL,
  name text NOT NULL,
  correct integer NOT NULL,
  level integer NOT NULL,
  time_left integer NOT NULL
);
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.scores TO anon, authenticated;
GRANT ALL ON SEQUENCE public.scores_id_seq TO anon, authenticated;
CREATE POLICY "read scores" ON public.scores FOR SELECT TO anon USING (true);
CREATE POLICY "add scores" ON public.scores FOR INSERT TO anon WITH CHECK (
  ((correct >= 0) AND (correct <= 20))
  AND ((level >= 1) AND (level <= 4))
  AND ((char_length(name) >= 1) AND (char_length(name) <= 20))
  AND ((char_length(group_code) >= 1) AND (char_length(group_code) <= 24))
  AND ((char_length(quiz_id) >= 1) AND (char_length(quiz_id) <= 48))
);
