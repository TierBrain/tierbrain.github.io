# The Big Quiz host/player access-control repair

This change migrates **The Big Quiz** (`show-gen.html` and `play-gen.html`) to
verified guest identities and ownership-checked RPCs. It adds a separate
`bigquiz_private` schema and 17 `public.bigquiz_*` endpoints. The deployed Bible
Show schema and API, all legacy shared tables, score policies and scheduled
maintenance remain unchanged. This is one of the nine remaining game editions;
the other editions still require their own access-control migrations.

The browser transport is `js/big-quiz-access.js`, using the same pinned official
SDK as Bible Show. Its `tb_bigquiz_*_v1` Auth, host, player and submission storage
keys are independent of Bible Show. A saved old `cv_stage_room_gen` code or
`cv_player_gen` browser ID is never accepted as ownership proof. Refresh host and
phone pages and create a **new room** after deployment. An owned host reload can
recover the roster and scores, then starts a new run; it does not resume a round
in progress.

## Identity and data boundaries

- The SDK obtains an anonymous Auth session, restores/refreshes it normally and
  verifies the user through Auth. Supabase's verified JWT supplies `auth.uid()`.
  The public project key alone cannot invoke the game API.
- A room's host UID is server-recorded. A code permits joining that edition; it
  does not grant host authority. Player mutations resolve the caller's active
  membership from the verified UID. The answer/buzz APIs accept no member ID,
  team, score or claimed receipt time.
- `bigquiz_private.rooms`, `members`, `questions`, `answers`, `buzzes`, `awards`
  and `requests` enable RLS and have no client policies or direct schema/table
  access. Private helpers are also inaccessible to clients. The explicit final
  revocations remain effective with broad global default object grants.
- The public RPCs require `authenticated`, verify ownership or membership, use
  qualified object names and set `search_path=''`. Anonymous Auth users have
  this role, so the UID and row checks are required in addition to the role.
- New data is never copied into the public legacy tables. An old permissive
  legacy policy cannot expose the separate private data. The eventual whole-pass
  retirement of legacy APIs is separate from this edition's migration.
- Random room codes are scoped to the edition. A Big Quiz code can coincide
  with a Bible Show code; each edition's API still reads only its own schema.
  An authenticated host or member of one edition gains no rights in the other.

## Protocol and bounds

The protocol deliberately matches the already tested Bible Show protocol, with
these General Knowledge differences: no `bible` state field or KJV/NIV setting;
the existing `verse` mode carries Fill the Gap/riddle questions; and a general
closing word may have an empty reference. Those content names do not affect
the authorization model.

- Room access expires 12 hours after creation. Heartbeats and new runs do not
  extend it. Expiry denies reads, new writes and request replay; it does not
  delete records. No retention deletion or new cron job is introduced.
- Each identity may host five unexpired rooms. A room permits 200 active and
  2,000 historical memberships, and 20,000 recorded host create/begin/publish/close
  requests. Names and team labels are bounded to 16 characters.
- `show-gen.html` still uses Team A/B and the existing four game modes. The
  server assigns a run UUID; question keys are `<run UUID>:p<0..3>q<0..11>`.
  State counts and indexes are checked, patches are bounded to 32 KiB and state
  is rebuilt from a phase-specific allowlist.
- Host create/begin/publish/close operations carry an idempotency UUID. The
  server hashes the full request, serializes conflicting work and replays the
  original acknowledgement. UUID reuse with different input is rejected.
  Versioned operations return `PT409` / HTTP 409 for stale host versions. The
  browser holds the exact request until its result is known and does not blindly
  retry a host-version conflict.
- Normal and Fill the Gap awards are 10–15 points; buzzer awards are exactly 10;
  clue awards are 1–5. The atomic award ledger prevents duplicate increments
  and multiple awarded buzzer winners for the same team/question.
- Normal/clue submission close freezes a stable accepted-answer snapshot before
  grading. Replayed submissions acknowledge the original event; a conflicting
  choice cannot overwrite it. Old, closed or out-of-run questions reject fresh
  answers. Buzzer input requires the caller's eligible team lane and selected
  buzzed membership.
- A player leaving retains history. A later rejoin creates a new zero-score
  membership. A host award to a member who left before grading returns
  `skipped_member_left` with zero points rather than freezing the game.
- Active question state omits its correct index; clue state includes only the
  revealed clue prefix. Reveal phases may expose the correct index. Finals are
  computed from stored membership scores, not a proposed browser summary.

The host remains trusted to grade answers and choose bounded awards. Published
question banks contain answers, and no server-owned correctness or wall-clock
timing verification is added. This is an ownership and replay-safety repair,
not a guarantee of honest scores or question secrecy. Existing host pause
behavior is retained, so input gates use server phase/current question rather
than introducing a new deadline contract.

## RPC contract

All functions return JSONB. Host operations require the room host UID;
`preview` requires a verified identity but no membership; other player operations
require or create that identity's membership in the specified edition.

| RPC | Arguments |
| --- | --- |
| `bigquiz_create_room` | `p_request_id uuid` |
| `bigquiz_host_resume` | `p_code text` |
| `bigquiz_begin_run` | `p_code text, p_expected_version bigint, p_request_id uuid` |
| `bigquiz_host_publish` | `p_code text, p_run_id uuid, p_patch jsonb, p_expected_version bigint, p_request_id uuid` |
| `bigquiz_host_members` | `p_code text` |
| `bigquiz_host_answers` | `p_code text, p_run_id uuid, p_question_key text` |
| `bigquiz_host_buzzes` | `p_code text, p_run_id uuid, p_question_key text` |
| `bigquiz_close_submissions` | `p_code text, p_run_id uuid, p_question_key text, p_expected_version bigint, p_request_id uuid` |
| `bigquiz_award` | `p_code text, p_run_id uuid, p_question_key text, p_member_id uuid, p_points integer` |
| `bigquiz_preview` | `p_code text` |
| `bigquiz_join` | `p_code text, p_name text, p_tag text` |
| `bigquiz_my_membership` | `p_code text` |
| `bigquiz_heartbeat` | `p_code text` |
| `bigquiz_leave` | `p_code text` |
| `bigquiz_player_state` | `p_code text` |
| `bigquiz_answer` | `p_code text, p_question_key text, p_choice integer` |
| `bigquiz_buzz` | `p_code text, p_question_key text` |

Preview returns only code, phase and team labels. Host/player room JSON excludes
Auth UIDs and internal IDs for the private question ledger. The host roster
contains server-owned membership IDs, public names/tags, scores and timestamps;
answer/buzz reads are host-only. Player self-membership lets a refreshed phone
recover its canonical server identity rather than trust cached display data.

## Migration and verification

The migration scaffold was created with Supabase CLI 2.81.3 `migration new`:
`supabase/migrations/20261021070507_secure_big_quiz_rooms.sql`.
Its SHA-256 before deployment is
`77b01ae49416dcec19eb6e97aca3c3b08e473ca3292755e174f20ae7866e9d7a`.
The production migration version may be recorded by the deployment tool; align
the local filename to that recorded version without changing the reviewed SQL.
Do not reapply an already recorded migration, blindly push this incomplete
historical database baseline or use migration-history repair to bypass drift.

Run the explicit isolated SQL harness:

```sh
python3 tests/check_big_quiz_access.py --report /private/path/big-quiz-access.json
```

It uses only the already cached, pinned PostgreSQL image, networking disabled,
no TCP listener and no published ports. The synthetic baseline applies the
three existing score/cleanup/Bible Show migrations sequentially before Big Quiz.
It checks all four modes, caller privileges, malicious identity arguments,
host conflicts/replay, memberships, budgets, expiry, finals, rollback and
cross-edition isolation even when codes collide. Before/after audits compare
legacy and Bible Show rows, definitions, owners, ACLs, policies and existing
default privileges. The fixture's driver-set `auth.uid()` is not JWT validation.

The final isolated SQL harness passed 149 checks, including the pre-migration
default-ACL audit. Local verification also passed 38 unit/contract groups and
nine browser groups with all external requests intercepted. A disposable real
GoTrue/PostgREST stack passed five JWT/identity boundary groups, eight actual
SDK/adapter groups, and six gameplay groups covering all four modes. These are
local acceptance results; CI and hosted deployment checks are recorded separately.
No fake production users, rooms, submissions or scores are created for verification.

The seven private RLS tables intentionally have no client policies; the 17
authenticated `SECURITY DEFINER` APIs are intentional bounded entry points.
Review advisor output against actual grants and definitions rather than add
dummy policies or broad privileges to remove informational warnings. Relevant
Supabase checks are
[private tables without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
and
[authenticated definer APIs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Recovery and retained data

`supabase/rollback/secure_big_quiz_rooms.sql` transactionally disables all 17 Big
Quiz APIs and keeps its private rooms, members, events and ledger. It leaves
Bible Show and legacy tables unchanged. Serve an unavailable game or keep the
secured client blocked while recovering; restoring a legacy direct-table client
does not preserve the new authorization model. Re-enabling requires an explicit
reviewed grant migration.

The owner-saved application backup from 20 October predates both secured private
schemas. Future backup scope must include `show_private`, `bigquiz_private` and
the required Auth data. Reapplying schema source cannot recover future private
gameplay or identities. No paid branch, project or backup upgrade is required
by this repair.
