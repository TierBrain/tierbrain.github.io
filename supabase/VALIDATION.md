# Score repair validation

Validated locally on 20 October 2026 against repository base
`1851291d24e9890ebf4869068e010e71aac83e36`. No production score submissions,
database changes or deployment were performed for this batch.

- Source and production asset checks: 153 HTML pages, 292 JavaScript blocks,
  sitemap/local targets and catalogue validation passed. Preview and production
  builds passed and exclude SQL, tests and Supabase tooling from public assets.
- Unit/browser discovery: all 20 test groups passed, including 10 score-save
  regression groups using intercepted synthetic responses. They cover HTTP
  denial, explicit retry, uncertain network/408/5xx outcomes, board-load failure
  after a successful save, duplicate completion, old-run responses, distinct
  group targets, all Jigsaw tiers, mobile controls and the question-bank bound.
- Existing offline browser suite: all seven groups passed.
- PostgreSQL acceptance: 34 valid score cases accepted and 49 malformed/type
  cases denied under the anonymous role. All nine known regressions fail before
  migration, succeed afterward and fail again after rollback.
- Database preservation: three synthetic legacy rows, schema, SELECT rules,
  grants and RLS flags retained; signed-in insertion remains denied and neither
  caller role can update/delete rows. Five baseline-drift cases abort and roll
  back. All 12 database check groups passed; the test container was removed.

The database runner used PostgreSQL 17.11 in the pinned image
`postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826`,
network mode `none`, no published ports and no TCP listener. Its database and
password were synthetic/local only. All browser requests to external hosts were
intercepted; live backend requests were zero.

The source project was reviewed on PostgreSQL 17.6. This batch has not yet been
tested through its live PostgREST service. The migration guards the known policy
baseline, and deployment still requires the transactional target checks in
`SCORE-REPAIR.md`. These tests establish input compatibility and save-state
behavior; they do not establish host/player authorization, server-verified
gameplay or full Supabase Auth/Realtime behavior.
