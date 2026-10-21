-- Reusable synthetic identities and request-state templates for a later real
-- Auth/PostgREST/browser acceptance environment. Never use these fixed UUIDs as
-- credentials or as a replacement for verified Auth users in such an environment.
CREATE SCHEMA show_test;
CREATE TABLE show_test.contexts(actor text PRIMARY KEY, subject uuid UNIQUE NOT NULL);
INSERT INTO show_test.contexts VALUES
  ('H','00000000-0000-4000-8000-000000000001'),
  ('P1','00000000-0000-4000-8000-000000000002'),
  ('P2','00000000-0000-4000-8000-000000000003'),
  ('O','00000000-0000-4000-8000-000000000004');
CREATE TABLE show_test.states(name text PRIMARY KEY, state jsonb NOT NULL);
INSERT INTO show_test.states VALUES
 ('normal','{
   "teams":{"youth":"Team A","adult":"Team B"},"bible":"KJV","round":"Synthetic round",
   "qnum":1,"qtotal":2,"live":true,"qkind":"mc","qtext":"Synthetic question?",
   "opts":["Alpha","Beta","Gamma","Delta"],"correct":2,
   "private_hint":"MUST_NOT_ESCAPE","full_question":{"correct":2,"secret":"MUST_NOT_ESCAPE"}
 }'),
 ('buzzer','{
   "teams":{"youth":"Team A","adult":"Team B"},"bible":"KJV","round":"Synthetic buzzer",
   "qnum":1,"qtotal":2,"bz":{"phase":"arm","live":true,"qtext":"Synthetic buzzer question?",
   "opts":["Alpha","Beta","Gamma","Delta"],"correct":2,
   "lanes":{"youth":{"st":"open","bid":null,"out":[]},"adult":{"st":"open","bid":null,"out":[]}}}
 }'),
 ('clues','{
   "teams":{"youth":"Team A","adult":"Team B"},"bible":"KJV","round":"Synthetic clues",
   "qnum":1,"qtotal":2,"fc":{"phase":"clue","live":true,"cat":"Synthetic category",
   "opts":["Alpha","Beta","Gamma","Delta"],"correct":2,"clueIdx":0,"pointsNow":999,
   "clues":["First synthetic clue"],"private_hint":"MUST_NOT_ESCAPE"}
 }'),
 ('final','{
   "teams":{"youth":"Team A","adult":"Team B"},"bible":"KJV","round":"Synthetic final",
   "fin":{"youth":{"total":999999},"adult":{"total":999999},"teamWin":"forged"}
 }');
