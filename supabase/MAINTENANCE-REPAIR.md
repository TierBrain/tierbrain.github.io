# Cleanup execution repair

`cleanup_old_events()` runs as its `postgres` owner and deletes rows from
`answers`, `buzzes`, `players` and `rooms` whose creation time is more than six
hours old. The hourly `tierbrain-cleanup` cron job calls it as `postgres`.
Interactive users do not need this privileged maintenance operation.

The `restrict_cleanup_execution` migration revokes only `authenticated`'s
EXECUTE grant. `anon` remains denied; `postgres` and `service_role` remain
allowed. The function body, owner, fixed search path, schedule, and retention
rules are unchanged. The migration does not invoke cleanup or modify game rows.

Both preflight and postflight check the reviewed definition, exact grants and
effective privileges, and the single active hourly cron job. Apply the migration
transactionally through Supabase's migration tool. A changed setup aborts the
transaction instead of being silently overwritten. Do not use `db push` against
this repository as a complete historical baseline.

## Verification

Applied on 20 October 2026 as Supabase migration `20261020221724`.
Production catalog checks confirmed exactly the intended EXECUTE revocation,
the unchanged definition and cron configuration, and preserved maintenance-role
access. Security advisors returned no lints after this change. The 22:00 UTC
scheduled run succeeded before deployment; a later naturally scheduled run is
checked separately. No live cleanup invocation was used for validation.

All 24 isolated acceptance checks passed, including successful synthetic
maintenance calls, denied app calls, rollback and drift-guard failures.

Run `python3 tests/check_cleanup_permissions.py` against a cached pinned
PostgreSQL image. It creates a disposable container without network or published
ports and uses synthetic data only. It verifies denied app callers, preserved
maintenance callers, the strict six-hour boundary, unaffected scores/legends,
rollback, and atomic refusal of unexpected definitions/grants/schedules.

The fixture simulates `cron.job` metadata; it does not run the pg_cron daemon.
Production verification reads function privileges and naturally scheduled job
results. Never manually invoke cleanup on live data merely to test permissions.

## Rollback

`rollback/restrict_cleanup_execution.sql` restores precisely the original
`authenticated` EXECUTE grant after checking the restricted state. Apply as one
reviewed transaction. This reintroduces the privileged app-user access and the
associated security warning; it is an operator recovery option, not an automatic
rollback migration.

This change addresses the
[authenticated security-definer execution warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
It does not establish ownership of existing multiplayer rooms or change their
legacy table policies.
