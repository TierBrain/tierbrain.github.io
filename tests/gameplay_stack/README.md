# Browser gameplay acceptance

This suite opens the checked-in game pages in Chromium and plays through their
host and phone controls against disposable GoTrue, PostgREST and PostgreSQL.
It covers six game families and nine editions. It does not contact the hosted
Supabase project, use production accounts, or write production game data.

## Isolation and the real backend

Each family invocation creates a unique Docker Compose project with fresh
database passwords and a JWT secret. The database starts from synthetic legacy
fixtures, preserving the auth schema created by real GoTrue. The runner then
applies **all seven checked-in migrations**, in filename order:

1. `20261020180854_score_game_contracts.sql`
2. `20261020221724_restrict_cleanup_execution.sql`
3. `20261021062330_secure_show_rooms.sql`
4. `20261021160821_secure_big_quiz_rooms.sql`
5. `20261023094711_secure_throne_rooms.sql`
6. `20261023132240_secure_party_rooms.sql`
7. `20261023141309_retire_legacy_multiplayer.sql`

The runner requires exactly seven migrations so a migration-set change prompts
a deliberate fixture review. PostgreSQL, GoTrue, PostgREST and the Node driver
use digest-pinned images from `../big_quiz_stack/compose.yaml`. PostgreSQL stores
its disposable data in tmpfs. All four services use the original internal
Compose network, with **no published host ports**.

Every host and phone has its own browser context and independent real anonymous
Auth session. Reloading a page retains that context's storage. The HTML, access
adapters and `vendor/supabase.js` are served from the checkout without replacing
their Auth/RPC implementations with browser mocks. The actual database checks
JWT ownership, memberships, run IDs, action windows, receipts and scoring writes.

`browser_env.py` intercepts all browser requests. Site assets come from the
checkout at `https://tierbrain.test`; `/auth/v1` and `/rest/v1` requests aimed at
the configured Supabase hostname are forwarded only to the disposable backend.
Other external requests are blocked, WebSockets are closed, and service workers
are disabled. Fonts, analytics, QR services and third-party integrations are
therefore outside this pass. The browser's apparent Supabase URL is not an
outbound production request.

The runner stages a small Node HTTP bridge in the driver's `/tmp` and starts a
persistent `docker compose exec -T driver node` process. Browser routes pass the
SDK's actual Auth/REST requests through that process's JSON-lines stdin/stdout
pipe. Inside the isolated network, the bridge makes genuine HTTP requests only
to `http://auth:9999` or `http://rest:3000`. No loopback port publication or host
HTTP listener is needed. JWTs and Auth bodies stay in memory pipes; they are not
logged or saved. PostgREST still verifies real GoTrue JWTs before running SQL.
See `run-browser-acceptance.py` and `browser_env.py` for the transport checks.

The acknowledgement-loss helper first forwards an RPC to the real database,
then replaces one successful response with HTTP 503. The Spines scenario uses
that helper to check recovery with the same request ID after an actual commit;
it does not fabricate a receipt or an accepted answer.

## Running a family

Run from the repository root on a machine with Python 3.12, Docker Compose and
access to the local Docker daemon at `/var/run/docker.sock`. Install the pinned
browser dependency from `requirements-dev.txt`. Use an installed Chromium/Chrome
through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, or install Playwright's Chromium:

```sh
python -m pip install -r requirements-dev.txt
python -m playwright install --with-deps chromium
```

The six matrix commands are:

```sh
python tests/gameplay_stack/run-browser-acceptance.py --family big_quiz --report /tmp/tierbrain-gameplay-big_quiz.json
python tests/gameplay_stack/run-browser-acceptance.py --family throne --report /tmp/tierbrain-gameplay-throne.json
python tests/gameplay_stack/run-browser-acceptance.py --family creak --report /tmp/tierbrain-gameplay-creak.json
python tests/gameplay_stack/run-browser-acceptance.py --family standing --report /tmp/tierbrain-gameplay-standing.json
python tests/gameplay_stack/run-browser-acceptance.py --family circuit --report /tmp/tierbrain-gameplay-circuit.json
python tests/gameplay_stack/run-browser-acceptance.py --family spines --report /tmp/tierbrain-gameplay-spines.json
```

No hosted project credentials or production environment variables are required.
Images may need to be pulled before the isolated services can start.

`.github/workflows/gameplay-checks.yml` runs these as independent jobs on pull
requests, pushes to `main`, and manual dispatch. Its six-family matrix uses
`fail-fast: false`, a 15-minute job limit and bounded browser-dependency setup.
It prefers the runner's installed Google Chrome and uploads each family's JSON
report and available failure screenshots even when that job fails.

## Coverage by edition

The following describes scenarios implemented by the modules, not a claim that
a particular revision has passed them. Check that revision's reports for results.

| Edition | Pages and scenario |
| --- | --- |
| Big Quiz General | `show-gen.html` / `play-gen.html`: two phones on opposite teams; all 16 questions across Rapid Fire, Verse, Five Clues and Buzzer; correct/wrong/unanswered scoring, clue-level awards, buzz lanes and answer feedback; phone reload and reconnect; paused host reload; final totals, closing, replay with retained scores, stale-checkpoint recovery, leave/rejoin. |
| Hold The Throne General | `throne.html` / `throne-play.html`: three-phone, three-question game and a two-point finale; wrong-first handover, queue advancement, consecutive streaks and dethroning; active/queued phone reload; literal player names; Hall of Fame result; fresh-room two-phone three-win replay; native answer timeout; queue departure and an unfinished run with no invented champion. |
| Hold The Throne Bible | `throne-bible.html` / `throne-bible-play.html`: the same complete finale, replay, timeout, reload, scoring and departure scenarios against the Bible edition. |
| Creak Multiplayer | `creak-multi.html` / `creak-multi-play.html`: two-phone race from square one to an actual summit; ladder/snake/rockfall/storm questions and board damage; crater and Roc events; correct/wrong/unanswered moves; phone reconnect/reload and owned host board recovery; winning-roll count; rematch, native inactivity auto-roll, full dropout, rejoin and last-climber departure win. |
| Standing Room Multiplayer | `standing-room-multi.html` / `standing-room-play.html`: two same-named phones; correct answer followed by a legal phone-selected step; wrong-answer and timeout water moves; owned host reload during both answer and step windows; natural floor elimination and ID-based winner; rematch, legal fallback step, current-player departure and rejoin in the next run. |
| Full Circuit General | `full-circuit-host.html` / `full-circuit.html`: three phones, including duplicate names; all five mini-games won through their inputs, canonical typed event streams and one completion per room; active-phone and host refresh, handoff, Fuse/Lens/Spring/Wire/Key effects; rotating Spark, finale mistake/timeout and a completed win; rematch failure, three back-stair questions, penalty, Key bypass and explicit missing-checkpoint recovery. |
| Full Circuit Bible | `full-circuit-bible-host.html` / `full-circuit-bible.html`: the same five-room win, finale, refresh/handoff, item and rematch failure/recovery scenarios with the Bible edition's charge rules. |
| Spines General | `spines.html`: host and two same-named phones; leave during opening, real book selection, active-phone reload, committed-book lost-ack retry and receipt restoration; selected-player answer controls; correct three-point pull, manual choose/question skips, wrong answers that naturally topple the pile, ID-based winner, rematch, current-member leave/rejoin; actual solo answer smoke check. |
| Spines Bible | `spines-bible.html`: the same party loop, duplicate-name winner, retry/reload, opening departure, rematch and solo answer checks against the Bible edition. |

## Timing, controls and limits

All pages run with reduced motion. Modules may read a host's private correct
answer as a test oracle, then click the actual phone option. They do not make
answers correct by changing the answer key, fabricate accepted server receipts,
or jump directly to a final state instead of playing the tested loop.

Controls differ by family and must be considered when interpreting coverage:

- **Big Quiz:** configures four rounds with four questions each. It uses the
  normal host Skip/pause/replay controls, and moves named question, clue and
  buzzer deadlines into the past so the existing tick/timeout handlers run.
  Production-length question/clue/buzzer wall-clock waits are not covered.
- **Throne:** uses actual question-count and answer-time UI controls, including
  the 20-to-25 step and three-question setting. Its three-second buzz gate and
  configured answer timeout elapse on the real clocks. The suite does not fake
  `Date` or shorten the gate. Cutscenes and sound are disabled.
- **Creak:** fixes board layout, dice/random events and damage choices to a
  repeatable course. It shortens named tween/sleep/outcome presentation helpers.
  The 25-second inactive-roll deadline and the 8,450ms unanswered ladder-question
  deadline are retained and checked through the normal host logic.
- **Standing Room:** uses `waitForWindow` with a 300ms duration and 100ms poll
  cadence for one answer timeout and one step timeout. These exercise the real
  timeout/fallback functions, but do not cover the full 45-second answer or
  30-second step wall-clock waits. The remaining floor losses use actual phone
  answers and movement.
- **Full Circuit:** skips the named `playStory` presentation helper and increases
  Glasshouse falling speed fourfold while retaining its actual lane/pail
  collision check. It expires named Switchboard/finale deadlines and calls the
  ordinary timer tick functions; it does not wait the full original durations.
  Mini-game choices, stairs, typed streams and finale submissions remain real.
- **Spines:** holds only the opening presentation's `onEnd` callback while a
  phone leaves, then completes that callback. It briefly pauses automatic host
  polling to inspect a committed-but-unacknowledged book and its retry before
  resuming the normal reader. Unanswered books and questions use the host's
  **manual Skip**; Spines has no automatic question deadline to test. Collapse
  follows one real correct lower-book pull and three real wrong lower-book
  answers, using the ordinary lean/settle/finish path.

This suite covers the listed Chromium host/phone flows. It is not a full
question-bank audit, every random board/outcome, real-device Safari/Android
compatibility, visual/audio approval, long-running inactivity/load testing,
production DNS/Cloudflare routing, email, QR scanning or third-party service
integration. Only Spines includes solo-mode play in this suite; existing solo
and ownership/security checks remain separate tests.

## Reports and cleanup

The JSON report records named assertions, scenario notes, source input hashes,
backend request counts, blocked external requests, uncaught page errors and
sanitized RPC summaries. It omits Auth response bodies and HAR captures, redacts
fixture secrets/JWTs, and is written with mode `0600`. Failure screenshots show
only synthetic game data.

The runner attempts `docker compose down --volumes --remove-orphans` in its
cleanup block, including on failure, then checks that no project containers
remain. A family succeeds only when its scenarios and final browser checks pass
and cleanup completes. Inspect both `passed` and `cleanup_completed`; a setup
failure is not evidence that gameplay ran. A missing screenshot can mean the
failure happened before any browser page was opened.
