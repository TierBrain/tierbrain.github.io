# Race rooms: operation and recovery

This protocol covers Finish Line, Tug of War, First Finger General/Bible, and
Castle/Core/Labyrinth Race. It replaces scoreboard messages with verified guest
membership. It does not make client-reported answers or public leaderboards
suitable for prize competitions.

## Access and protocol

`race_private` contains `rooms`, `members`, `events` and `requests`. RLS is
explicitly enabled; browser roles receive no schema/table/sequence access.
The seven public RPCs are executable only by `authenticated`:

| RPC | Purpose |
| --- | --- |
| `race_enter` | Join by code; the first entrant owns the room |
| `race_state` | Read the joined room, roster, canonical progress and timing |
| `race_start` | Host starts the current run/version |
| `race_submit` | Submit the caller's typed event for the current run |
| `race_heartbeat` | Refresh presence; choose a Tug side while in the lobby |
| `race_leave` | Leave; transfer ownership to the oldest remaining member |
| `race_reset` | Host opens a rematch with a new run UUID and seed |

Codes contain 4–12 uppercase letters/numbers. Rooms are scoped by family and
edition. Nicknames contain 1–14 characters and are unique among active members;
reserved protocol names and control characters are rejected. Authorization
uses the verified guest UID and canonical member UUID, never the nickname.
Mutation request UUIDs retain the original receipt, so an unknown acknowledgement
can be retried without creating a second action. A changed payload cannot reuse
that UUID. Old run submissions cannot enter a rematch.

First Finger uses server acknowledgement times and nine canonical round windows.
A draw cannot claim an earlier, more valuable word than the server has reached.
Tug stores wrong answers and mishaps separately. Finish Line allows two mishaps
and two boost-assisted double answers. Adventure depth, lives and terminal
states follow the source's tier bounds. These checks constrain input; they do
not independently verify a participant's answer to a public question bank.

## Expiry, capacity and cleanup

- Access expires four hours after room creation; heartbeats do not extend it.
- Tug runs last at most 120 seconds. Finish Line and adventure runs have a
  20-minute deadline; First Finger follows its canonical round timetable.
- Each room allows 32 active members. A guest can own four unexpired rooms and
  hold 20 active memberships across unexpired rooms.
- Mutations allow 600 newly recorded requests per guest/minute and 60,000
  receipts per room. Events allow 300 per member/minute and 12,000 per room,
  including prior runs. These are hard budgets; create a new room when reached.
- Progress polls return each member's latest progress; First Finger retains
  the current run's individual draws/answers. Prior-run events stay private.

Expiry is not a guaranteed deletion time. Entering an expired code deletes that
old room and its dependent records before creating a replacement. Separately,
`public.cleanup_race_rooms()` deletes up to 1,000 rooms whose expiry is more than
one day old, including their members/events/receipts. It skips locked rooms.
Only `service_role` receives EXECUTE; anonymous and authenticated guests cannot
run maintenance. Existing cleanup jobs are unchanged.

**Scheduling the cleanup is pending.** This migration does not create a cron
job, and the function's presence does not establish that deletion runs
periodically. Review and authorize a bounded service-side schedule separately;
record its frequency, owner, failure alert and successful execution. Monitor
storage, room/request budgets and real event sizes before paid availability
commitments. A long, full lobby can exhaust receipt capacity before four hours.

## Private backup and rollback

The selected routine is manual private downloads. Before deployment, export the
existing application privately. After the approved migration, extend the
application backup allowlist to include:

- `race_private.rooms`, `members`, `events`, and `requests`, with their complete
  table definitions, constraints, indexes, RLS state and grants;
- the `race_private.events_id_seq` identity sequence and its value/`is_called`
  state, plus schema ownership/default privileges;
- functions in `race_private`, the seven public `race_*` RPCs, and
  `public.cleanup_race_rooms()`, including definitions, owners and EXECUTE ACLs.

Preserve the migration and any separately approved cleanup schedule definition.
Keep exports, guest UIDs, request payloads and restore evidence out of the
public repository and public CI artifacts. Record dates, scope and checksums;
restore into an isolated disposable database and check rows, sequence
continuation, grants and the race acceptance suite. Application exports do not
cover Auth users/sessions, Storage objects or a complete Supabase project unless
those are exported and verified separately. The owner must retain a downloaded
copy outside this execution workspace.

`supabase/rollback/secure_race_rooms.sql` disables guest race RPCs while retaining
private records. It does not restore the public scoreboard message protocol.
A rollback needs compatible frontend handling; do not republish the insecure
legacy online clients. The service-only maintenance grant remains available.
