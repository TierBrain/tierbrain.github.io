# Readiness scope and operations

This inventory starts from production commit
`1fdf0b3db415b2f62c315fc2151d0e4403ecdd30`. It records what was known at the
start of the readiness pass. It does not certify that every issue or every
device has been tested.

## Catalogue and test coverage

[`readiness-catalogue.json`](readiness-catalogue.json) lists the 69 homepage
catalogue entries and their baseline coverage. There are 25 topic quiz pages
with copies of the countdown engine and 44 other entries. One of those entries,
Wall of Fame, is a leaderboard. Shared engines, editions and alternate modes
must not be presented as 69 independently tested engines.

The previous gameplay suite completed nine multiplayer editions: Big Quiz,
Throne General/Bible, Creak Shared Climb, Standing Room Together, Circuit Team
General/Bible and Spines General/Bible. Chapter & Verse has earlier secured
Show-family checks. The existing Circuit suite uses its standalone pages as
Team phones; that does not establish a complete solo Circuit playthrough.

This pass also identified seven additional online editions: Finish Line, Tug
of War, First Finger General/Bible, Core Race, Castle Race and Labyrinth Race.
At the baseline they encoded room messages in the public score table. They
need separate authenticated room/membership and event evidence. The ordinary
score policy must not be weakened to accept those legacy messages.

A page-load smoke test, a source review and a complete playthrough are different
forms of evidence. Release notes should distinguish them. Record each suite's
actual checks and controlled timers/random outcomes. Do not infer a complete
question-bank fact review, physical iPhone/Android testing, screen-reader
approval or sustained-load results from Chromium tests with emulated phones.

## Finite release gates

Use these gates for the current pass:

1. Every published entry resolves and its declared mode can be started. Named
   full-flow tests demonstrate correct/wrong input, completion and retry for
   the repaired engines; remaining smoke-only entries are identified.
2. Online room membership is bound to a verified guest identity. Tests reject
   outsider reads/writes, impersonated members, unauthorized starts and stale
   run submissions without reopening public legacy access.
3. Repaired inputs cannot grade twice or apply an old delayed action to a new
   run. Network failures and unknown acknowledgements have visible recovery.
4. Primary navigation, join forms and repaired controls work by keyboard and
   fit the tested phone widths. Real-device checks are recorded separately.
5. Public privacy copy matches implemented guest sessions, public/code-shared
   scores, early-access lead collection and analytics. Avoid promises about
   deletion, encryption or retention that the implementation does not provide.
6. Site/build/database regression suites pass on the proposed release, its
   deployment matches the tested tree, and live asset/redirect checks pass.
7. The selected manual private-backup routine provides a dated export,
   checksums, scope notes and a tested recovery procedure. The owner keeps a
   downloaded copy outside the execution workspace. Auth and Storage coverage
   are stated explicitly.

Use the named test evidence to describe the release. Public browser games
expose their question banks and local game logic. Bounded public-score
submissions are not proof of trusted
competitive results; paid competitions or prize claims need a separate server
grading and abuse-control design.

## Availability checks

`.github/workflows/keepalive.yml` makes a bounded GET of
`/rest/v1/scores?select=id&limit=1` and discards the body. It fails on a response
other than HTTP 200 or a transport failure. It does not insert a fake score,
create a room, sign in a user or reopen the retired `legends` table.

The workflow checks public score API availability. It does not exercise an
entire multiplayer game, replace backups, guarantee a Free project will stay
active or guarantee a GitHub schedule will run at an exact time. Review failed
runs and configure the repository owner's Actions notifications. The separate
private daily read-only SQL health check is not duplicated by this work.

## Private backup routine

The owner selected **manual private downloads** for this pass. Provide a fresh
application export before database changes and another after the release, each
with a checksum manifest and isolated restore evidence. Record the actual file
names and scope with that release's evidence.

The earlier application backup is useful recovery evidence, but an application
export is not a full Supabase project backup. Its documented scope excludes
Auth and Storage. A file kept only in a temporary execution workspace should
not be the sole durable copy.

Keep the downloaded export in private storage controlled by the owner. Do not
put real backups, connection strings, Auth dumps, session tokens or encryption
keys in this public repository, public Actions artifacts or browser code.

Use this manual routine:

1. Follow the current [Supabase backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
   Check the installed CLI's `--help` before running commands. Use a protected
   database connection selector, never a password committed in a script.
2. Export roles, schema and application data to a private directory. Record
   whether Auth is included. Separately preserve Storage objects, Auth/provider
   configuration, Edge Functions and other items outside the chosen dump's
   scope. [Supabase restore scope](https://supabase.com/docs/guides/self-hosting/restore-from-platform#whats-included-in-the-restore-and-whats-not)
3. Record the export date, source commit, file checksums and scope. Encrypt and
   copy it to the owner's chosen private durable storage. Keep the previous
   verified copy until the new one has been checked.
4. Restore into a disposable isolated database, with outbound integrations
   disabled. Check row counts, schema/functions, grants/RLS and the relevant
   ownership/gameplay suites. Do not test recovery by overwriting production.
5. Record the restore result and repeat at an agreed interval and before
   significant database changes. Keep a documented retention period and owner.

If scheduled exports are chosen later, first select a private durable destination
and provide credentials through its secret configuration. Keep credentials in
a private execution environment, encrypt before upload, bound timeouts/retries,
test restoration and alert on failed exports. A successful health probe does
not prove that a recoverable backup exists.

## Owner checks before business launch

Confirm account MFA, repository/deployment access and recovery contacts in the
GitHub, Cloudflare and Supabase accounts. The code review does not establish
that those account controls are enabled. Keep the manual private exports and
record the intended support/incident contact. Review service quotas and choose a
reliable capacity plan for the expected event size before promising paid-event
availability. Event commitments should reflect the agreed capacity and support
arrangements.
