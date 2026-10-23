# Secured move-family room protocol

This migration covers Creak & Coil: The Shared Climb, Standing Room: Together,
Full Circuit: Team (General/Bible), and Spines party mode (General/Bible). It uses
`party_private` with five closed backing tables. No private records are copied
into legacy public room/player/move tables. Bible Show and The Big Quiz/Throne
have independent protocols and are not silently re-routed.

The host remains trusted to publish its gameplay state, physics and results.
Full Circuit also retains its existing selected-phone authority to run and grade
its assigned mini-game and report a bounded result. These controls establish
who can operate each room/turn; they do not prove honest timing, random rolls,
correct answers or genuine play. Question banks remain public.

## Identity and isolation

All public APIs require the `authenticated` database role and a non-null
`auth.uid()` from an independently verified Auth token. Anonymous Auth users
have this role. A publishable key alone is insufficient. Ownership and
membership are recorded server-side; room codes/browser UUIDs are not proofs.

Families are immutable `creak`, `standing`, `circuit`, `spines`; editions are
`general` or `bible` (Bible only Circuit/Spines). Every code RPC takes family and
edition and rejects a mismatch. `?ed=bible` must use the Bible route too.
Private schemas/tables/sequences/helpers have no PUBLIC/anon/authenticated
access, including under broad platform default grants; RLS is enabled without
client policies. The narrow public SECURITY DEFINER API has empty search_path,
qualified relations, UID/room/member/window guards and explicit final grants.

Rooms have fixed twelve-hour access expiry, five unexpired hosted rooms per
identity, 2000 historical memberships, 10,000 windows, 30,000 request receipts.
Circuit/Spines enforce eight simultaneous members atomically. Creak/Standing use
a protective 200-member cap. Expiry is access control, not deletion. This batch
adds no cron, retention deletion, Auth setting or legacy policy changes.

## JavaScript adapter

Load `vendor/supabase.js`, then `js/party-access.js` before the game's script.

```js
const access = PartyAccess.create(SB_URL, SB_KEY, {
  family: 'spines', edition: ED === 'bible' ? 'bible' : 'general'
});
```

The adapter verifies restored sessions via Auth `getUser`, anonymously signs in
only without an existing SDK session, and persists/refreshes through the pinned
self-hosted official SDK. Storage keys are
`tb_party_<family>_<edition>_{auth,host,player}_v1`. Old localStorage player IDs,
codes and names are ignored as ownership proof. Member page hint receipts must
be rechecked through canonical APIs before displaying confirmation.

Host methods: `createRoom()`, `resumeHost(code)`, `beginRun()`,
`publish({phase,state})`, `close(windowId?)`, `members(code)`,
`actions(code,runId,windowId,cursor=0)`. `beginRun`, publish and close are serialized;
request UUID/payload/version remain fixed after uncertain failure. `onIssue(fn)`
shows the pending error with `canRetry`, `retry()` resumes the identical request.
PT409 concurrent-host conflicts stop for reload instead of blind retry.
`currentRoom()`, `busy()`, `savedHostCode()`, `forgetHost()` support controls;
forgetting a room while mutations are pending is rejected.

Member methods: `preview(code)`, `join(code,name)`, `membership(code)`,
`heartbeat(code,look?)`, `leave(code)`, `playerState(code)`,
`submit(code,runId,windowId,choice,requestId?)`,
`activityStart(code,runId,windowId,requestId?)`, and
`event(code,runId,windowId,activityId,eventSeq,eventPayload,requestId?)`.
`ready()`, `uuid()`, `message(error)`, `savedPlayerCode()`, `rememberPlayer(code)`
are also available. Explicit member request IDs should be retained for retries.
The adapter does not silently retry or serialize member event streams; Full
Circuit clients must queue immutable events in sequence and stop on unknown.

Every RPC code call receives `p_family` and `p_edition` internally. Member calls
never accept a claimed user/player ID, timestamp, total score or host identity.

## RPC signatures

All functions are in `public` and return JSONB. Exact parameter names matter to
PostgREST. Every common code scope is `(p_code text,p_family text,p_edition text)`.

| Function | Additional parameters |
| --- | --- |
| `party_create_room` | no code; `p_family text,p_edition text,p_request_id uuid` |
| `party_host_resume` | common scope only |
| `party_begin_run` | `p_expected_version bigint,p_request_id uuid` |
| `party_host_publish` | `p_run_id uuid,p_patch jsonb,p_expected_version bigint,p_request_id uuid` |
| `party_host_members` | common scope only |
| `party_host_actions` | `p_run_id uuid,p_window_id uuid,p_cursor bigint DEFAULT 0` |
| `party_host_close` | `p_run_id uuid,p_window_id uuid,p_expected_version bigint,p_request_id uuid` |
| `party_preview` | common scope only |
| `party_join` | `p_name text` |
| `party_my_membership` | common scope only |
| `party_heartbeat` | `p_look jsonb DEFAULT NULL` (optional Creak lobby appearance) |
| `party_leave` | common scope only |
| `party_player_state` | common scope only |
| `party_submit` | `p_run_id uuid,p_window_id uuid,p_choice text,p_request_id uuid` |
| `party_activity_start` | `p_run_id uuid,p_window_id uuid,p_request_id uuid` |
| `party_event` | `p_run_id uuid,p_window_id uuid,p_activity_id uuid,p_event_seq integer,p_event jsonb,p_request_id uuid` |

Room JSON contains `id,code,family,edition,phase,state,run_id,version,expires_at`
and `action:null|{id,key,kind,member_id,accepting,activity_id,next_event,completed}`.
No Auth UID is disclosed. `party_player_state` returns
`{room,member,members,receipts}`; the roster includes public server member IDs,
names, optional cosmetic `look`, and receipt-time join/lastseen values for active members. Receipts are
current-window actions owned by the caller. Preview exposes only code, family,
edition, phase and expiry; there is no room-list API.

Action receipts contain numeric server receipt `id`, `player_id` (canonical room
member ID), `kind`, `choice`, `event`, `window_id`, `activity_id`, `event_seq`,
`created_at`, `q_id`. For Full Circuit, choice is the canonical event JSON string
for mirror compatibility; event is the same typed object, q_id is `done` or
`eNNNN`. Actions are returned by numeric server receipt order, never browser
clock or q_id lexical order. `close` returns a frozen `{room,actions}` snapshot.

## State and action gates

Host patch contains required phase and state. The server rebuilds state from
per-family whitelisted bounded fields and canonical member names. Host-local
correct answers, arbitrary nested JSON and unrecognized fields are discarded.
State size is at most 64KiB before reconstruction; names/history and fixed
family arrays are independently bounded. All referenced IDs must belong to that
room, including historical display IDs. Only an active selected member gets an
open action. A member leaving closes their active windows and retains history;
verified rejoin creates a fresh member ID.

Creak lobby phones can save only their own cosmetic look through heartbeat:
`{c:0..7,s:0..4,h:'bobble'|'cap'|'helmet'|'band'}`. The server rejects changes
outside that lobby or from other families; no caller-supplied member ID exists.
Host-published mountain scenes use a fixed enum, and appearance maps accept only
same-room member keys, six-digit hex colours, and the same hat enum. These fields
preserve climber selection and cutscene phone messages without accepting HTML,
CSS expressions, or arbitrary nested state.

| Family / state | Window key | Kind / valid choice |
| --- | --- | --- |
| Creak live without pendingQ | `roll:<turnSeq>` | `roll` / literal `roll` |
| Creak pendingQ | `question:<qId>` | `answer` / pendingQ opts |
| Standing live question | `q<seq>` | `answer` / q opts |
| Standing correct step | `q<seq>:step` | `step` / server-derived adjacent solid unoccupied tile string |
| Spines choose | `s<seq>:pick` | `pick` / non-top book index string |
| Spines question | `s<seq>:answer` | `answer` / q opts |
| Circuit selected room | `room:<roomSeq>:<room>` | `stream` / typed current-instance events |
| Circuit finale | `finale:<fq.id>` | `finale` / fq opts except a newly burned Lens choice |

New runs receive server UUIDs, so resets of seq/q counters cannot reuse old
accepted actions. Action windows have server UUIDs, immutable selected actor,
question signature and choices. Existing closed windows remain closed on benign
same-key publications; they cannot be reopened. Publishing another window closes
the previous one. A single choice atomically closes its window, and identical
replays return the original receipt even after closure; a different choice is
rejected. Lens changes can only remove options within the same question; they
cannot restore a burned option or change the question.

Spines clients publish `aliveIds`, `outIds`, `winnerId` (same-room UUIDs/null) in
addition to the usual books/turn/seq/lean/q/msg. Display names are reconstructed;
phone out/win checks must compare IDs so duplicate names remain distinct.

Host closes each window before grading, timing out, handing off, skipping or
advancing. A late member action then fails honestly instead of contaminating the
next state. There is no server deadline enforcement in this pass: host timing
and pause/animations remain the existing gameplay authority.

## Full Circuit activity streams

The selected phone calls activityStart before running a mini-game. A new request
starts a fresh server UUID instance and invalidates previous partial progress;
replaying the identical start request returns its original instance. Already
accepted completion returns that completion and never restarts. On phone reload,
recover membership first; restart only an incomplete currently assigned room.

Events start at sequence zero, arrive exactly in order, have one immutable row
per instance+sequence, and are bounded to 1000 events per instance / 3000 total
per assignment window. Identical event replay returns its original receipt;
conflicting payload/sequence or stale instance fails. New-instance host reads
exclude old partial events. An accepted done atomically closes the instance.

Allowed payloads:

```js
{t:'q'|'stairs',q:string /* 1..1000 */}
{t:'a',ok:boolean,r:0..5,w:0..3,q:string,c:string /* 1..250 */,fuse?:boolean}
{t:'done',won:boolean,stats:string /* 1..1000 */,fuse:boolean,
 keyUsed?:boolean,penalty?:0|3|6|9}
```

Correctness of the selected phone's self-reported result remains trusted. The
API prevents one member completing another member's room, reporting against a
stale assignment, changing a recorded result, or replaying a result twice.

## Verification and rollback

`python3 tests/check_party_access.py --report /private/path/party.json` uses the
cached pinned PostgreSQL image, no external network/listener/ports, tmpfs and a
synthetic auth.uid shim. It validates all four families/edition boundaries,
private grants, replay, wrong actors/choices, run reset, leave/rejoin, expiry,
stream restart/done, Lens and retained-record rollback. It also verifies existing
protected Show data/functions and legacy rows/policies/grants/cleanup are not
changed. This fixture is not real JWT, HTTP or browser acceptance; root rollout
must additionally run actual Auth/PostgREST/SDK/mobile gameplay checks.

`tests/test_party_access.py` checks SDK/session verification and namespaced
storage, immutable identity-free member payloads, host queue ordering after
beginRun, exact-request retry, PT409 behavior, wrong-edition adoption and disabled
Auth, offline with all real HTTP forbidden.

Rollback SQL removes client execution while retaining all five private tables,
records and history. Do not restore old REST clients as automatic rollback. This
migration does not change legacy public policies: final pass retirement is still
required after every legacy room client has migrated. Add `party_private` to
future application backups; the owner's earlier backup predates these records.
