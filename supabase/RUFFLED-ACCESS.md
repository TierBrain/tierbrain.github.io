# Ruffled Feathers phone rooms

Migration `20261116100000_secure_ruffled_rooms.sql` lets phones act as buzzers in
**Ruffled Feathers** (`ruffled-feathers.html` on the TV, `ruffled-play.html` on
phones). It adds an isolated `ruffled_private` schema and a narrow authenticated
RPC API, modelled on the secured Throne rooms. No existing schema, table,
function, policy, cron job, Auth setting or legacy data is changed. One-screen
play needs none of this and loads no connection code.

Until the migration is applied, choosing "Phones as buzzers" shows *Phone play is
not switched on for this site yet* and one-screen play carries on as before.

## Identity and privilege boundary

The pinned, self-hosted Supabase SDK creates and verifies guest Auth sessions
(`getUser()`), stored under `tb_ruffled_auth_v1`. A publishable key alone cannot
call the API. Every function checks a trusted `auth.uid()` against an owned room
(host) or an active membership (player). Room codes and browser state are never
proofs of ownership.

All eight backing tables (`rooms`, `members`, `runs`, `bouts`, `pecks`, `answers`,
`resolutions`, `requests`) have RLS enabled and no client policies. PUBLIC, anon
and authenticated have no schema, table, sequence or helper access, with explicit
revocations that defeat broad default grants. Thirteen public SECURITY DEFINER
RPCs have an empty fixed search_path, schema-qualified references, explicit
PUBLIC/anon revocation and authenticated-only EXECUTE.

Player calls accept no claimed member ID, score, name (except at join, 1–14
characters, unique per room ignoring case), timestamp or result. The server
issues member, run and bout UUIDs and canonical timestamps.

## What the server decides, and what the host is trusted with

The TV host remains the **trusted question author**, as in Throne: it sends each
bout's question, four options and the index of the correct one. That index is
stored privately and is returned only after the bout has closed, so phones cannot
read it early. Question banks are public; this does not stop a dishonest host.

The server enforces the rules of a bout:

- Only the two members named in the bout, both in the run's roster, active and
  seen in the last 40 seconds, take part. Each pair meets at most once per run
  (a unique index on the unordered pair), and a run has 3–10 players.
- Pecking opens 2.4 s after the bout opens. The first peck by server receipt wins
  the turn: the bout row is locked, so simultaneous pecks yield exactly one
  chooser and "Beaten to it" for the other.
- The chooser has 6 s to answer. A correct answer resolves the bout with 2 points;
  a wrong answer or timeout locks that member out and reopens pecking for the
  other, extending a timed bout's 15 s clock by the time spent choosing. Two
  lock-outs, or the clock running out, resolve the bout 0–0.
- Expired windows are applied by a deterministic `settle()` on the next read or
  action, from the server clock only, so any caller may trigger it without gain.
- Answers are immutable; an identical replay returns the original state.
- The host can end an unfinished bout with **no** points ("Nobody knows" in a
  relaxed game, or a player has gone). It cannot award points.
- Points are derived from the resolution ledger (2 per win). The final phase is
  allowed only when every pair has met or one of them has left.
- Reaction time for the tie-break is server-measured: from pecking opening to the
  winner's peck, less any time the opponent spent choosing.

Network delay still affects which peck reaches the server first; phones estimate
server time from `server_now` for display only.

## Host requests

Host mutations (create, begin, open bout, end bout, phase) carry a request UUID,
payload hash and the room version. A lost acknowledgement is retried with the
identical request; changed payload reuse fails (22023); a stale version from
another host window fails with PT409. A seated player who has left produces PT412
and the TV skips their remaining bouts. Players' calls need no ledger: peck and
answer are naturally idempotent.

## Bounds

Rooms expire for access after 12 hours. A guest may host 5 unexpired rooms; a
room allows 30 active and 300 historical members, 50 runs, 45 bouts per run and
20,000 recorded host operations. These are access and budget bounds, not
retention deletion: no cron job or data deletion is introduced. Add
`ruffled_private` to future application backups.

## Verification

- `tests/check_ruffled_access.py` — 62 checks against a disposable PostgreSQL:
  privileges, identity, every bout rule, the simultaneous-peck race, replays,
  leaving, untouched legacy objects, and rollback. Runs in the pinned cached
  Docker image like the other room checks, or with `--local-pgbin` (non-root).
- `tests/ruffled_phone_checks.py --local-pgbin …` — a TV page and three phones in
  real browsers against the same SQL through a local stand-in for the HTTP layer.
- `tests/test_ruffled_access.py` — the browser adapter offline with a stub SDK.

These use a driver-set `auth.uid()`; real JWT/PostgREST/mobile checks remain part
of rollout, as for the other room types.

## Rollback

`supabase/rollback/secure_ruffled_rooms.sql` removes all client execution and
keeps every record. One-screen play is unaffected.
