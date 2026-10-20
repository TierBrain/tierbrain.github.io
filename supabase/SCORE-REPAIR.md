# Score save repair

This batch fixes valid results being rejected for Piece by Piece, Jigsaw and
Brain Coaster, and shows save failures separately from leaderboard loading.
The production database migration was applied on 20 October 2026 as version
`20261020180854`. The reviewed client rollout is tracked in
[PR #2](https://github.com/TierBrain/tierbrain.github.io/pull/2).

For example, a Piece by Piece result of 92 points after one correct answer used
to fail the quiz limit of 20. A Jigsaw Master finish sends 48 pieces, and Brain
Coaster can send streaks above four. Group scopes include a game prefix, so a
valid 24-character group can produce a 31- or 32-character stored scope.

| Game | Stored score / level / time | Accepted scope |
| --- | --- | --- |
| Piece by Piece | Points / number correct / elapsed seconds | One of five deck names, optionally `~` plus 1–24 uppercase group characters |
| Jigsaw | Piece count / tier / elapsed seconds | `global`, optionally `~` plus a group |
| Brain Coaster | Cumulative hills / best streak / zero | Lowercase `global`, or a 1–24 character uppercase group |

The migration changes the existing `add scores` INSERT policy. It preserves the
other quiz limits, SELECT policy, role grants, table structure and stored rows.
Piece by Piece remains unbounded in round count within its integer columns, with
8–368 points per correct answer as a coarse sanity range. Jigsaw accepts only
the four tier/piece-count pairs. Brain Coaster accepts its seven current IDs and
up to 170 hills; update that bound when its six question banks grow. All group
regexes use the C collation for predictable ASCII matching.

These are input checks for client-supplied scores. They do not prove gameplay,
authenticate a host/player or make a shared group code private. Room ownership,
missing multiplayer event tables, lead collection and retention are later repair
batches. This batch does not delete scores or alter cleanup scheduling.

The three pages retain a frozen payload for each completed run/target. A known
success is never reposted by refresh or repeat completion. A definite HTTP 4xx
rejection other than 408 offers an explicit retry. Network, timeout and server
errors have an uncertain outcome and allow board refresh without reposting.
Brain Coaster can still share a result with a newly chosen group; revisiting a
previous target does not save again. A new game resets the guard. This does not
provide cross-device/server-enforced idempotency or score authenticity.

## Validate before rollout

Run the normal site checks plus:

```sh
python -m unittest discover -s tests -p 'test_*.py'
python tests/browser_checks.py
docker pull postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826
python tests/check_score_policy.py
```

The browser tests intercept all external requests and use synthetic responses.
The database check requires Docker and creates a disposable pinned PostgreSQL 17
container with network mode `none` and no ports. It uses synthetic data only,
tests anonymous inserts/denials and policy rollback, then removes the container.
The pinned image must be cached first; the test runner does not pull images.
These checks validate this score contract; they do not replace end-to-end
Supabase Auth/Realtime tests for later multiplayer changes.

## Production rollout and rollback

1. Retain the verified private application backup outside the working environment.
   It is an application snapshot, not a complete account/Auth/Storage backup.
2. Re-read the target's score columns, grants and policies. The migration has a
   strict baseline guard and a three-second lock timeout. If it aborts, review
   drift instead of removing the guard. Reconcile existing remote migration
   history before using any CLI push command: this repo is not a full baseline.
3. Apply only `migrations/20261020180854_score_game_contracts.sql` as one
   transaction through the established migration path. For a reviewed direct
   `psql` application, use `-X -v ON_ERROR_STOP=1 --single-transaction`.
4. Verify the resulting policy, unchanged SELECT/grants and retained row count;
   run Supabase security advisors. Avoid inserting fabricated results into live
   leaderboards merely to test. The new bounds are compatible with current
   clients, so the database can go first.
5. Deploy the three client pages through the normal reviewed `main` workflow.
   Confirm ordinary gameplay saves with the owner and keep the tested revision.

If the policy must be reverted, review and apply
`rollback/score_game_contracts.sql` in one transaction. It restores the former
INSERT check and leaves records intact, including newly accepted scores. It also
reintroduces the known save rejections; the updated frontend will show them.
Keep an explicit migration-history record for any rollback rather than blindly
re-running or repairing migration versions. Reverting the frontend commit is
independent and leaves database records untouched.

The SQL file was created with Supabase CLI `migration new` (2.81.3; official
release checksum verified). After the tested SQL was applied through Supabase
MCP, the filename was aligned to its actual server-recorded version; the SQL
content is unchanged. Do not apply it again to the source project. Credentials,
private snapshots and local test
passwords must never be committed to this public repository.
