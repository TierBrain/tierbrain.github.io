# Score repair validation

Validated locally on 20 October 2026 against repository base
`1851291d24e9890ebf4869068e010e71aac83e36`. Pre-deployment tests used synthetic
data and did not make production score submissions or database changes.

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

The source project runs PostgreSQL 17.6. On 20 October 2026 the guarded migration
was applied as server version `20261020180854`. A subsequent read-only evaluation
of the actual installed policy passed 79 synthetic cases (34 accepted, 45 denied).
The four remaining malformed numeric cases are covered by local column-type
tests. All 81 existing score row hashes matched before/after, and catalog
comparison confirmed that only the intended INSERT check changed. Columns,
constraints, indexes, ownership, RLS flags, SELECT rules, grants and incoming role
memberships were preserved. No fabricated leaderboard scores were inserted.

Supabase security advisors returned the same pre-existing warning about signed-in
execution of `cleanup_old_events()`, with no new score-policy warning. Its
[remediation guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
belongs to the separate maintenance-permissions repair.

Score inserts have not been exercised through the live PostgREST service; normal
owner gameplay remains the final end-to-end check. Follow the transactional
rollout/rollback procedure in `SCORE-REPAIR.md`. These tests establish input
compatibility and save-state
behavior; they do not establish host/player authorization, server-verified
gameplay or full Supabase Auth/Realtime behavior.

The separate cleanup-permission repair was subsequently applied as migration
`20261020221724`. Its 24 isolated checks passed, and production metadata confirmed
only the removal of authenticated EXECUTE. Security advisors then returned no
lints. See [MAINTENANCE-REPAIR.md](MAINTENANCE-REPAIR.md) for its limits and rollback.
