# Secured Bible Show ownership protocol

This batch moves only `show.html` and `play.html` to authenticated guest identity
and a dedicated `show_private` namespace. It does not change Show General,
Throne, other families, existing shared tables/policies, Auth settings or cron.
No secured row is mirrored into the legacy `rooms`, `players`, `answers` or
`buzzes` tables. Their permissive policies cannot reach these private tables.
Old cached clients and legacy rooms remain unsecured until those clients retire;
this batch must not be described as securing every multiplayer family.

The migration scaffold was created using Supabase CLI 2.81.3
`supabase migration new secure_show_rooms`. Apply the migration as one transaction
only after isolated acceptance and compatible frontend testing. A preflight rejects
existing API names and creating an existing private schema also fails. The
rollback disables the new API and retains private data for recovery; it does not
drop data or broaden old policies. Re-enable through an explicit reviewed grant
migration, not by rerunning this create-only migration.
Keep the secured client blocked or serve a temporary unavailable page if the API
is disabled. Do not automatically restore legacy CRUD clients or copy secured
records back to legacy tables.

## Identity and permissions

The browser must establish a real Supabase Auth session, including an anonymous
guest session where configured. A publishable key alone cannot execute the API.
All public RPCs are `SECURITY DEFINER`, use `search_path=''`, qualify object names,
and check `auth.uid()`. Only `authenticated` receives EXECUTE. Private schema,
tables and helper functions explicitly deny PUBLIC, anon and authenticated;
private tables also have RLS enabled with no client policies. No service key
belongs in the browser. Existing views/functions do not reference these newly
created tables, and this migration adds no path from legacy tables into them.

Host ownership is server-recorded. Knowing a room code grants the ability to join,
not host authority. Membership IDs and user IDs are server-controlled. Player APIs
derive the caller's active membership; answer/buzz signatures have no player ID,
team, name, score or timestamp. Host reads contain canonical membership fields,
never Auth user IDs. No room-list endpoint exists. Authenticated code preview
intentionally returns only code, phase, team labels and Bible version.

Each identity may have five unexpired hosted rooms; a room permits 200 active
members, 2,000 historical memberships and at most 20,000 logged host operations.
Reconnect does not consume another historical membership. Retry comparison retains a
SHA-256 fingerprint of input, not raw proposed patches or stripped unknown keys;
stored responses contain only the bounded canonical protocol fields.
Nicknames and team labels are 1–16 characters. Explicit leave retains
historical membership/events, removes the member from boards, and a later join
creates a new member at zero score. Reconnect resumes an existing active member
without changing its name or team. Midgame joining remains supported.

## RPC contract

All calls return JSON objects unless marked array. All parameters are required
arguments; `p_run_id` may be SQL/JSON null for pre-run lobby publication.

| Function | Arguments | Result |
|---|---|---|
| `show_create_room` | `p_request_id uuid` | room |
| `show_host_resume` | `p_code text` | owned room |
| `show_begin_run` | `p_code text, p_expected_version bigint, p_request_id uuid` | room with fresh run UUID |
| `show_host_publish` | `p_code text, p_run_id uuid, p_patch jsonb, p_expected_version bigint, p_request_id uuid` | canonical room |
| `show_host_members` | `p_code text` | member array |
| `show_host_answers` | `p_code text, p_run_id uuid, p_question_key text` | ordered answer array |
| `show_host_buzzes` | same as answers | ordered buzz array |
| `show_close_submissions` | `p_code text, p_run_id uuid, p_question_key text, p_expected_version bigint, p_request_id uuid` | `{room,answers}` |
| `show_award` | `p_code text, p_run_id uuid, p_question_key text, p_member_id uuid, p_points integer` | `{member_id,score,points,already_awarded}` |
| `show_preview` | `p_code text` | `{code,phase,state:{teams,bible}}` or null |
| `show_join` | `p_code text, p_name text, p_tag text` | canonical member |
| `show_my_membership` | `p_code text` | own active member or null |
| `show_heartbeat` | `p_code text` | own member with server last_seen |
| `show_leave` | `p_code text` | `{left:true}` |
| `show_player_state` | `p_code text` | room, membership required |
| `show_answer` | `p_code text, p_question_key text, p_choice integer` | canonical answer |
| `show_buzz` | `p_code text, p_question_key text` | canonical buzz |

Room fields are `id,code,seed,phase,run_id,version,round_type,round_index,q_index,
q_id,deadline,state,expires_at`. Member fields are `id,name,tag,score,joined_at,
last_seen`. Answers are `player_id,tag,choice,created_at,q_id`; buzzes are
`player_id,name,tag,created_at,q_id`. Choices are integers 0–3, team tags exactly
`youth` or `adult`. Returned timestamps are server timestamps except display-only
deadline values proposed by the host.

Create, begin, publish and close require a random UUID per logical request. A
retry must preserve its UUID and every argument. Reusing it for another operation
or payload fails. Successful replay returns the original response; the adapter
must not reduce its cached version using an older replay. Serialize host mutations.
Every begin/publish/close checks the current host version before changing data;
`PT409` returns HTTP 409 when another host state won: stop/pause and reload rather
than blindly overwriting it. Do not use PostgreSQL serialization error `40001`
for this application conflict: the real PostgREST integration test reproduced
automatic retry until HTTP timeout with that error. Membership, heartbeat and
awards do not increment room version.

`begin_run` preserves member IDs and scores, closes prior questions, resets the
public room to lobby, and issues a fresh server run UUID. The adapter namespaces
legacy local IDs as `<runUUID>:p<roundIndex>q<questionIndex>` (round 0–3, question
0–11). Each question also has a private server UUID. An old question cannot be
reopened by publishing it after another question/phase. Run creation does not
extend room expiry.

## State and submission rules

Host publication accepts only the bounded old room fields; payloads are at most
32 KiB. `updated_at` from the client is ignored. Phase-specific state is rebuilt
from whitelisted fields and replaces old state, avoiding stale answer disclosure.
Every state carries `teams:{youth,adult}` and `bible:'KJV'|'NIV'`.

Normal questions preserve `opts,round,qnum,qtotal,live,qkind,qtext,prompt?`;
normal reveal adds `correct`. Buzzer state preserves `bz:{phase,opts,correct,live,
qtext,lanes:{youth,adult}}`, and each lane has `st,bid,bname,adl,out,win`. Lane IDs
must belong to this room/team and a selected player must actually have buzzed;
names are derived from membership. Clues preserve `fc:{phase,opts,clueIdx,
pointsNow,correct,live,cat,clues}`; pointsNow is derived and only the current clue
prefix is accepted. Final summaries are computed from stored active-member scores,
not the host's proposed summary. Intro, round-score and closing text remain bounded.

Correct indexes are omitted for active normal questions and null for active
buzzer/clue questions. They are published only in the corresponding reveal phase.
Full host question objects, unrevealed clue suffixes and Auth user IDs are never
returned. Publicly shipped question banks still contain answers, so these rules
do not establish cheat-proof question secrecy.

Player submissions require active membership, the exact current question/run and
an accepting phase. Normal phase must be question; clues must be clue phase.
Buzzer actions require open buzzer phase and an eligible lane; only its selected
player may answer. One answer and one buzz per member/question are enforced by
constraints. Identical retries return the first server acknowledgement; conflicting
answer choices fail. Retrying an already accepted own submission may acknowledge
it after reveal, but cannot add a new late event.

No wall-clock deadline or lane answer-deadline rejection is introduced. Host-local
pause extends local timers without synchronizing them to the old database, so
this first ownership repair preserves that behavior. Host phase/current-question
changes close input. `close_submissions` additionally freezes and returns a stable
answer snapshot before normal/clue grading, preventing accepted-but-unscored races.
It closes both answers and buzzes, so do not call it while buzzer lanes resolve.
An explicitly closed question cannot become accepting again through publication.

## Grading scope

The actual host remains the trusted grader. Award checks require this host, a
current question, the target's active membership in the room and an accepted
answer. Awards are atomic score increments: normal/verse 10–15, buzzer exactly
10, clues 1–5. Unique question/member awards prevent double scoring; conflicting
repeated points fail. A buzzer question permits at most one awarded member per
team. Identical committed award retries remain idempotent after advancement.
An otherwise valid target who explicitly left before grading returns
`skipped_member_left:true` with zero awarded points; no ledger or score is changed.
Foreign-room targets and unauthorized callers still fail. This prevents a normal
leave/grading race from freezing the host queue.

These controls establish ownership, bounded inputs and replay protection. They do
not prove answer correctness, honest host timing or competitive score integrity.

## Expiry and rollout limits

Access expires exactly 12 hours after room creation, including host, member and
idempotent request access. Heartbeats and runs do not extend it. This migration
adds no deletion/cron job: expired records remain private until a separately
reviewed retention/cleanup change. Do not claim this access limit deletes data.
The existing shared-table cleanup does not touch this schema.

Before production, validate in an isolated synthetic Auth/PostgREST environment:
host, two players and outsider; direct-table/anon denial; reconnect and midgame
join; malformed/cross-room IDs; host impersonation; current/stale phases and runs;
duplicate/conflicting answer and award replay; both buzzer teams/wrong-answer
reopening; pause; reveal secrecy; version conflicts; 12-hour expiry; preserved
legacy metadata/behavior; rollback retaining records and disabling API execution.
PostgreSQL-only tests do not establish actual Auth/session/API/browser acceptance.
Anonymous sign-in must be deliberately configured and tested with abuse controls
before frontend rollout. This batch does not change that setting itself.

The owner enabled anonymous sign-ins, confirmed through public Auth settings on
21 October 2026. Supabase signup rate limits still apply; the client displays a
wait message for HTTP 429. Clearing browser storage loses guest credentials;
saved room codes cannot reclaim host ownership. Host reload preserves the owned
room and roster but starts a fresh show run; mid-round host continuation is not
implemented.

The public API's reviewed `SECURITY DEFINER` grants may trigger Supabase's
[authenticated-definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
These grants are intentional: each bounded operation verifies identity and room
ownership/membership before accessing the private tables. This is distinct from
the removed authenticated grant on unrestricted scheduled cleanup. Future
private-object migrations must repeat explicit revocations: schema-specific
default privileges cannot cancel broader global default grants. The acceptance
fixture grants broad global defaults deliberately and verifies current objects
remain denied to app roles.
