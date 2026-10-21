Disposable Show Auth acceptance stack

This is a local testing fixture. It uses real GoTrue anonymous signup, Auth `/user` verification, Auth-issued JWTs checked by PostgREST, and SQL `auth.uid()`. No production URL, key, database, user, email or paid Supabase branch is involved. SQL role/claim shims do not count as acceptance evidence. No Realtime is used.

The Supabase CLI 2.81.3 binary's offline `services --output json` confirmed `supabase/gotrue:v2.187.0` and `postgrest/postgrest:v14.5`. PostgreSQL uses root's cached official `postgres:17.11`. Exact official image digests are pinned in Compose/prepare.py and recorded in `image-version-evidence.json`. The generated CLI config did not establish configurable loopback binding, so this Compose project publishes **no ports** and uses an **internal Docker network**. No source bind mounts are required: SQL and JavaScript enter through Docker exec stdin. This fixture deliberately differs from the full hosted Supabase gateway/extensions stack.

Run this fixture manually after reviewing the local configuration. The snippets assume Bash, a verified local Docker socket and the Compose plugin. Preserve Docker's configured registry authentication. Do not print `.env`, resolved Compose configuration, container environment or raw session responses.

```bash
# Start at the repository root.
export TIERBRAIN_SHOW_SOURCE="$(pwd)"
cd tests/show_stack
SHOW_STACK_DIR="$(pwd)"
# Defaults to the pinned official Node 22 image; writes local secrets only.
python3 prepare.py --migration "$TIERBRAIN_SHOW_SOURCE"/supabase/migrations/*_secure_show_rooms.sql

# Explicitly use the local daemon; these functions do not alter credentials.
d() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
dc() { d compose --project-directory "$SHOW_STACK_DIR" --env-file "$SHOW_STACK_DIR/.env" -f "$SHOW_STACK_DIR/compose.yaml" "$@"; }

dc up -d --wait db driver
dc exec -T db psql -X --single-transaction -U postgres -d postgres < bootstrap.sql
dc up -d auth
# This checks health internally; it does not expose a host port.
dc exec -T driver node --input-type=module <<'JS'
for(let i=0;i<45;i++) { try { const r=await fetch('http://auth:9999/health'); if(r.ok) process.exit(0); } catch {} await new Promise(r=>setTimeout(r,1000)); } process.exit(1);
JS
# GoTrue's initial migration installs a legacy single-GUC auth.uid accessor.
# Restore the ordinary JSON-claims fallback after those migrations complete.
dc exec -T db psql -X --single-transaction -v ON_ERROR_STOP=1 -U postgres -d postgres < auth-claims.sql
# Apply the current copied Show SQL locally, with real auth schema/roles now present.
dc exec -T db psql -X --single-transaction -v ON_ERROR_STOP=1 -U postgres -d postgres < show-migration.sql
dc up -d rest
python3 run-driver.py acceptance
```

Review `docker inspect` for **all four containers** before acceptance: `HostConfig.PortBindings` must be empty, network `Internal` must be true, and no production environment variables may appear. Do not connect this network to another network. Services can listen on all interfaces **inside their isolated containers**. The driver alone calls their HTTP APIs. The 60-second JWT is intentionally unsuitable for production. Resolve any image/config incompatibility and rerun; offline preparation is not a passing integration result.

`prepare.py` creates fresh random credentials in `.env` with mode 0600, copies only the chosen Show migration and records its SHA256. It refuses to overwrite an existing `.env`. PostgreSQL data uses tmpfs: restarting/recreating the database loses the fixture. GoTrue owns `auth` and runs its own migrations; the bootstrap grants the standard auth administrator CREATEROLE and supplies ordinary anon/authenticated/authenticator roles plus claim accessor. The pre-created accessor belongs to `supabase_auth_admin`, allowing GoTrue's initial migration to replace it. After Auth is healthy, `auth-claims.sql` restores the standard fallback from the legacy single-claim GUC to the verified JSON claims that PostgREST 14 sets. This is local fixture setup, not a production Auth migration. `stack_whoami` is a disposable-only identity probe, not part of the production migration. PostgREST exposes public RPCs only; there is no service-role API client or signed test token in the driver.

If resuming the existing fixture that failed with `must be owner of function uid`,
do not recreate the database or print its environment. Repair only that local
function's owner, restart Auth, wait for health, and continue with `auth-claims.sql`:

```bash
dc exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin'
dc restart auth
# Run the health check above, then auth-claims.sql and the remaining setup steps.
```

Basic acceptance verifies four independently Auth-verified identities; actual PostgREST role/UID; missing, malformed, signature-tampered and subject-forged JWT denial; host creation; two joins; outsider/nonhost authorization denial; limited preview; direct SELECT/PATCH denials for all seven private tables; actual access-token expiry followed by real anonymous refresh retaining host ownership. Auth anonymous users have role `authenticated`; membership and host checks remain necessary. The DB health check requires the final server at PID 1 plus TCP readiness, preventing the temporary init-server race.

The expiry check begins only after the token's declared `exp` time and permits a
bounded 40-second verifier clock-skew window. It requires an actual HTTP 401 with
an expired-JWT message; an early or unrelated denial cannot pass. The JSON result
records the last accepted and first rejected times after expiry. These observed
times include polling/HTTP latency and do not assert a particular server setting.

Run the separate real SDK/adapter acceptance after the basic driver:

```bash
python3 run-driver.py sdk-acceptance
# Run the real-HTTP gameplay sequence when gameplay-acceptance.mjs is present.
python3 run-driver.py gameplay-acceptance
```

`run-driver.py` streams the current application files through `docker exec -i`
into the driver's writable `/tmp` mount, using Node's `readFileSync(0)` and
`writeFileSync()`. The driver root filesystem stays read-only. The runner also
stages the basic acceptance module for gameplay imports, captures/redacts output,
and writes a local `*-result.txt` file excluded by `.gitignore`. It accepts only
these three named drivers. `TIERBRAIN_SHOW_SOURCE` selects the repository
explicitly; without it, the runner recognizes its repository location under
`tests/show_stack` or the separate private working copy beside `tierbrain-repairs`.
An invalid explicit source path fails instead of silently testing other files.

The private operator copy may remain at `/workspace/tierbrain-show-stack`.
For that layout, set `TIERBRAIN_SHOW_SOURCE=/workspace/tierbrain-repairs`, enter
that fixture directory, set `SHOW_STACK_DIR` to its current path, then use the
same preparation, Compose and runner commands above. Keep `.env`, generated SQL,
prepared metadata and result files outside the tracked fixture copy.

This loads the actual vendored UMD SDK and ShowAccess adapter in VM platform globals with in-memory localStorage. It checks real getSession/signInAnonymously/getUser, persistence/restoration without a replacement signup, refreshSession, host create/resume/begin and separate player join/poll/nonhost denial. Fetch rewrites only the local fixture's `/auth/v1/` and `/rest/v1/` paths to the two isolated services; no response is mocked. The API-key placeholder is opaque and no gateway validates it in this minimal stack. PostgREST still validates the actual Auth-issued bearer token. Browser CORS, rendering, clicks and a real browser's storage/timer lifecycle require separate acceptance.

Extend the driver before declaring Show ready:

| Scenario | Required observation |
|---|---|
| Host + two players, each round mode | Publish, poll, submit/buzz, close/reveal, score and final state work through real JWT requests. Player state does not expose unrevealed answers or another player's private submission. |
| Impersonation and score tampering | Player/outsider cannot publish, close, award, change another membership or directly PATCH score; fabricated user/member fields cannot change caller identity. |
| Concurrent, repeated and delayed requests | One answer/buzz per applicable identity; award idempotency; team buzzer uniqueness; correct version conflicts; retry same UUID/payload; changed payload denied; late previous-run actions denied. |
| Departure and room lifecycle | Leave prevents further submissions; rejoin identity is correct; host restart/refresh retains ownership; expired room and stale run deny operations. Advance expiry only as privileged fixture setup, then test via HTTP. |
| Anonymous Auth failures | Signup disabled/unavailable is actionable in client; expired JWT denied; refresh preserves identity; refresh failure does not mint a replacement host implicitly. |
| Browser transport | Actual SDK getSession/signInAnonymously/getUser, persistence, auto-refresh and polling run against this local stack. This direct-HTTP test alone does not prove browser behavior. |
| Legacy access | This fixture contains the new migration only; deny/migrate legacy public-table privileges separately before production acceptance. A missing legacy table is not proof of safe production grants. |

After recording a redacted result and image/migration digests:

```bash
# Stops/removes only this dedicated project; no `--all` or global prune.
dc down --volumes --remove-orphans
rm -- .env
```

Supabase reference entry points (not fetched during this offline task): https://supabase.com/docs/guides/self-hosting/auth/config ; https://supabase.com/docs/guides/database/postgres/row-level-security ; https://supabase.com/docs/guides/auth/auth-anonymous ; https://supabase.com/docs/guides/local-development/cli/config .
