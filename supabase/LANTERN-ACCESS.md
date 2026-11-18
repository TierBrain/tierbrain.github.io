# Ten Lanterns phone rooms

Migration `20261118210000_secure_lantern_rooms.sql` lets phones act as buzzers in
**Ten Lanterns** (`ten-lanterns.html` on the TV, `ten-lanterns-play.html` on
phones). It adds an isolated `lantern_private` schema and a narrow authenticated
RPC API, modelled on the secured Ruffled Feathers rooms. No existing schema,
table, function, policy, cron job, Auth setting or legacy data is changed.
One-screen play needs none of this and loads no connection code.

Until the migration is applied, choosing "Phones as buzzers" shows *Phone play is
not switched on for this site yet* and one-screen play carries on as before.

## Identity and privilege boundary

The pinned, self-hosted Supabase SDK creates and verifies guest Auth sessions
(`getUser()`), stored under `tb_lantern_auth_v1`. A publishable key alone cannot
call the API. Every function checks a trusted `auth.uid()` against an owned room
(host) or an active membership (player). Room codes and browser state are never
proofs of ownership.

All seven backing tables (`rooms`, `members`, `games`, `prompts`, `presses`,
`answers`, `requests`) have RLS enabled and no client policies. PUBLIC, anon and
authenticated have no schema, table, sequence or helper access, with explicit
revocations that defeat broad default grants. Thirteen public SECURITY DEFINER
RPCs have an empty fixed search_path, schema-qualified references, explicit
PUBLIC/anon revocation and authenticated-only EXECUTE.

Player calls accept no claimed member ID, score, name (except at join, 1–14
characters, unique per room ignoring case), timestamp or result. The server
issues member, game and prompt UUIDs and canonical timestamps.

## What the server decides, and what the host is trusted with

Ten Lanterns rounds are built from four kinds of moment, and the TV opens each
one as a **prompt**:

- **answer**: a question for the named players (usually one). The first answer
  closes it, right or wrong.
- **buzz**: an open question. Presses count from 1.5 s after it opens; the first
  press by server receipt wins the turn (the prompt row is locked, so
  simultaneous presses yield exactly one), with 10 s to answer. A wrong answer
  or a lapsed turn locks that player out and reopens the question, extending
  its clock by the time spent; when every named player is locked out it closes.
- **choose**: a decision with no right answer (dive or surface, name the thief).
  Options the TV marks disabled cannot be chosen.
- **claim**: a "tap your name" moment such as a steal. The first press closes it.

The TV host remains the **trusted question author and scorekeeper**, as in the
other room types: it sends each question, its options and the index of the right
one, and it awards points from what the server reports. The right index is stored
privately and returned only after the prompt has closed, so phones cannot read it
early. Question banks are public; this does not stop a dishonest host, and the
scores stay on the TV (there is no leaderboard).

The server enforces:

- Only players in the game's roster, active and seen in the last 40 seconds, can
  be named in a prompt, and only named players can act on it.
- Each player answers or chooses at most once per prompt; an identical replay
  returns the current state, a changed answer is refused. Presses are idempotent.
- Optional windows (3–120 s) are applied by a deterministic `settle()` on the next
  read or action, from the server clock only, so any caller may trigger it.
- One prompt at a time: a new prompt cannot open over a live one.
- The host can close an unfinished prompt with **no** winner ("No steal",
  "Nobody", or a phone that has stopped answering). It cannot answer, choose or
  claim for anyone.

If a phone cannot be reached when a prompt opens (a player has gone, PT412), the
TV handles that moment on the big screen instead.

## Host requests

Host mutations (create, begin, open prompt, end prompt, phase) carry a request
UUID, payload hash and the room version. A lost acknowledgement is retried with
the identical request; changed payload reuse fails (22023); a stale version from
another host window fails with PT409. Players' calls need no ledger.

## Bounds

Rooms expire for access after 12 hours. A guest may host 5 unexpired rooms; a
room allows 30 active and 300 historical members, 50 games, 2,000 prompts per
game and 20,000 recorded host operations. These are access and budget bounds, not
retention deletion: no cron job or data deletion is introduced. Add
`lantern_private` to future application backups.

## Verification

- `tests/check_lantern_access.py`: 79 checks against a disposable PostgreSQL:
  privileges, identity, every prompt kind and window, the three-way press race,
  replays, leaving, untouched neighbours (including `ruffled_private`), and
  rollback. Runs in the pinned cached Docker image like the other room checks,
  or with `--local-pgbin` (non-root).
- `tests/lantern_phone_checks.py --local-pgbin …`: a TV page and three phones in
  real browsers against the same SQL through a local stand-in for the HTTP layer,
  playing railway, cave and chariot rounds to the end of a game (25 checks).
- `tests/test_lantern_access.py`: the browser adapter offline with a stub SDK.

These use a driver-set `auth.uid()`; real JWT/PostgREST/mobile checks remain part
of rollout, as for the other room types.

## Rollback

`supabase/rollback/secure_lantern_rooms.sql` removes all client execution and
keeps every record. One-screen play is unaffected.
