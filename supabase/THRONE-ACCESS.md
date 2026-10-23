# Secured Hold The Throne rooms

This migration covers **Hold The Throne** and **Hold The Throne: Bible Edition**:
`throne.html` / `throne-play.html` and `throne-bible.html` /
`throne-bible-play.html`. It adds an isolated `throne_private` schema and a narrow
authenticated RPC API. Existing Bible Show rooms, legacy tables/policies,
cleanup, scores, Auth configuration and historical Hall of Fame rows are not
changed. Other multiplayer families retain their existing access paths until
their separate migrations and the final legacy-access retirement.

Refresh host and phone pages and open a new secured run after deployment. Old
room codes and browser-generated IDs do not establish ownership. A refreshed
owned host recovers its roster, abandons the old question and returns to a fresh
lobby; it does not resume an interrupted round. A phone verifies its saved Auth
identity and membership before restoring its place or submission confirmation.

## Identity and privilege boundary

The self-hosted, integrity-verified official Supabase SDK 2.118.0 creates guest
Auth sessions, persists/refreshes them and verifies them through `getUser()`.
Each edition has its own `tb_throne_general_*_v1` or `tb_throne_bible_*_v1`
storage namespace. A publishable key alone cannot call this API. Anonymous Auth
users have the authenticated PostgreSQL role; every operation additionally
checks a trusted `auth.uid()` against its owned room or active membership.

The room's `general` / `bible` edition is immutable. Preview, joins, resume,
reads, submissions and mutations enforce it. Player submission APIs accept no
claimed player ID, owner ID, team, score, name or client timestamp. Only join
accepts a name, limited to 1–14 characters; the server issues the member UUID and
canonical timestamps. Explicit leave ends the membership and retains history;
rejoin creates a fresh member. Accepted answers remain historical game events.

Between main-game questions, the host refreshes the roster and fills a vacated
seat from the live queue. A champion who left or has not been seen for 32 seconds
can be replaced; the new seat starts at streak zero while prior wins, best
streaks and receipts remain intact. A live champion cannot be replaced to reset
their streak. A known, fully rolled-back seat conflict returns PT412; only the
question-opening operation releases that request and refreshes the roster before
trying again. Unknown acknowledgements still require the identical request.
Finalists retain their ledger-derived identities. If one leaves during the
finale introduction or play, the host ends that run without recording a crown.

All nine backing tables (`rooms`, `members`, `runs`, `questions`, `buzzes`,
`answers`, `resolutions`, `results`, `requests`) have RLS enabled and no client
policies. PUBLIC, anon and authenticated have no schema/table/sequence/helper
access. Explicit object revocations defeat broad global default grants. Future
private objects must repeat them. Nineteen public SECURITY DEFINER RPCs have an
empty fixed search_path, qualified references, explicit PUBLIC/anon revocation
and authenticated-only EXECUTE. Their owner is the migration operator; definer
privileges are confined by the identity, membership, edition and input checks.

## Host requests, questions and windows

Host mutations serialize in the adapter. Each request has an immutable UUID,
JSON payload hash, current server version and run. A lost acknowledgement holds
later mutations until an identical retry confirms the outcome. Changed payload
reuse fails; another host window's stale version produces SQLSTATE PT409 / HTTP
409 and asks the operator to close extra windows and reload. Old replay responses
cannot move the adapter's version backwards. Cached response timestamps do not
recalibrate the clock; recovery uses a fresh owned-room read when possible.

The server issues run and question UUIDs. Question uniqueness is independent of
the displayed question index: sudden death can exceed the configured 3–50 main
questions, and finale questions repeat the last main index. A room has a fixed
12-hour access expiry, at most 5 unexpired hosted rooms per identity, 20 runs per
room, 200 active / 2,000 historical members, 2,000 questions per run and 20,000
recorded host operations. Empty selection polls and premature timeout checks do
not consume the request ledger. These are access/budget bounds, not retention
deletion. No new cron job or data deletion is introduced.

Each new question gets a three-second unlock and six-second buzzer window from
the server clock. Only its two distinct canonical seated members can buzz.
Server receipt time orders concurrent buzzes; selection records the earliest
eligible active member. The selected member has the configured 3–15-second
answer window (default4). A wrong answer or expired first window hands the turn
to the opponent **without requiring an opponent buzz**. A second miss/timeout
resolves both-miss. Phones/host estimate server time from `server_now` and the
request midpoint, so a device's wall-clock offset does not alter the server
window. Network delay still affects what reaches the server on time.

One immutable buzz and one immutable answer exist per member/question. An
identical retry returns the original receipt while that question is current;
changing a recorded choice fails. An active member may verify their own current
receipts. New submissions require the current run/question, open phase, actual
current seat/answerer and an unexpired server window. A host can grade an accepted
answer after its window ends, but cannot award an answer that was never recorded.

## Scoring and finals

The owner remains the trusted question author and correctness grader. Published
question banks contain answers; this work does not establish independently
verified correctness or prevent a dishonest host. Ownership, timing boundaries,
immutable submissions and replay protection are enforced on the server.

An atomic unique resolution ledger drives main wins, streaks, total correct,
blemishes, last winner and finale points. Main wins update these metrics once;
both misses reset the current streak. The longest-streak player is selected by
best streak, total correct, then first main-game win. A cached canonical streak
king avoids both JSON key-order tie changes and repeated aggregation on phone
polls. Finale points are separate and do not alter main-game streak/blemish
metrics. Existing flawless semantics refer to the main-game throne history.

Finalization requires the derived closer/longest-streak winner or a derived
first-to-two finale winner. A fixed run result is written once; conflicting
winner/group retries fail. Result name, best streak, flawless flag, configured
question total and player count come from stored room/run data. Player count
includes memberships present during this run, including those who left during
it. An early run ending with fewer than two players has no champion/result.
The UI reports pending, confirmed, rejected or unknown outcomes; it claims a
Hall entry only after finalization is confirmed.

State is rebuilt from a phase whitelist and canonical member references. The
current question exposes text/options; `correctIdx` appears only in its resolved
reveal and is removed from later active state. Foreign-room references fail.
The host has single-flight ticks, awaited transitions and room/run generation
guards on delayed cutscene/reveal/finale work. Start and New room are guarded
while a mutation is unresolved. Run settings lock after Start.

## Hall of Fame compatibility

With no group code, the default display still stays in this device's local
storage; its row is appended only after confirmed finalization and deduplicated
by run. A null-group private result is readable by its host and current room
members through the game state, and is not included in shared Hall queries.

For a chosen uppercase `[A-Z0-9_-]` group code (1–24 characters),
`throne_legends` returns at most60 results from that exact edition/group. It
combines historical `public.legends` rows (`throne:CODE` / `throne-bible:CODE`)
with new private run results. Historical rows have no trusted Auth/run ownership
and remain unverified history; none are copied, updated or deleted. Group codes
act as shared access secrets, not individual group membership. The UI retains
that intended sharing behavior and does not claim a stronger privacy boundary.

## Public RPC contract

Every function is prefixed `throne_`; all room calls include `p_code` and
`p_edition`. Host mutations also include `p_expected_version` and
`p_request_id`; all except create/begin include `p_run_id` where shown.

| Function | Additional arguments / result |
| --- | --- |
| `create_room` | edition + request UUID → canonical room |
| `host_resume` | → owned room |
| `begin_run` | config `{qTotal,answerMs,live}` → new owned run |
| `host_publish` | run, patch `{phase,state}` → rebuilt room |
| `host_open_question` | run, question `{q,opts,champ_id,chal_id,mode,qIndex}` → new UUID/windows |
| `host_select_buzz` | run, question UUID → canonical selected answerer or unchanged room |
| `host_grade` | run, question UUID, expected answerer UUID/null, correctness boolean → room/outcome/winner/stats |
| `host_members` | → canonical active roster |
| `host_answers` | run, current question UUID → current answer rows |
| `finalize` | run, winner UUID, group code/null → room and derived result |
| `preview` | → code/edition/phase only or null |
| `join` | name → canonical membership |
| `my_membership` | → current identity's active membership or null |
| `heartbeat` | → own membership with server timestamp |
| `leave` | → `{left:true}` |
| `player_state` | → rebuilt room and own current receipts |
| `buzz` | current question UUID → own immutable receipt |
| `answer` | current question UUID, choice0–3 → own immutable receipt |
| `legends` | edition + nonempty group code → bounded exact-scope Hall rows |

## Validation and rollout

Commands from the repository root:

```sh
python3 -m unittest discover -s tests -p 'test_throne*.py'
python3 tests/check_throne_access.py --report /private/path/throne-sql.json
python3 tests/throne_browser_checks.py
```

The SQL harness uses the pinned disposable PostgreSQL17 fixture, no network or
published ports, synthetic driver-set identity claims, broad default grants,
timestamp advancement, concurrent buzzes, all modes/finale/result scopes and
rollback. It compares all legacy rows/metadata and existing secured Show and
Big Quiz rooms/APIs before and after, including departure, stale-seat recovery
and denied replacement of a live champion. It does not prove JWT validation or
HTTP exposure.

The separate [real SDK/HTTP driver](../tests/throne_stack/README.md) uses real
GoTrue-issued sessions and PostgREST, the actual vendored SDK and unmodified
adapter. Browser fixtures use the actual host/mobile pages with an explicit
mocked adapter and all external HTTP/WebSockets intercepted. Report these
evidence boundaries separately. The operator records final hashes, exact test
results, reviewed commit, migration version, CI and deployment in the rollout
handoff before claiming production completion.

The migration is additive and leaves legacy grants intact for remaining games.
After all families have migrated, remove/retire their unrestricted legacy paths
in a separately tested completion step. Do not claim that this family migration
alone secures every multiplayer game or historical cached client.

`supabase/rollback/secure_throne_rooms.sql` disables all client RPCs and keeps all
private data. Keep the secured clients blocked/unavailable during rollback;
restoring old unrestricted CRUD pages is not an automatic fallback. A future
application backup must include `throne_private` and relevant Auth data. The
existing pre-repair application backup predates these private rooms/results.
