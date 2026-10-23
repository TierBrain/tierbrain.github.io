# Throne SDK and HTTP verification

GitHub Actions runs `python tests/throne_stack/run-acceptance.py` to create the
complete fixture automatically. It generates temporary credentials, starts four
digest-pinned services on an internal network, checks that no ports are
published, bootstraps Auth before installing the reviewed Throne migration, and
runs the SDK driver. Its historical `public.legends` fixture uses the production
column types and denies direct app access, so the Hall read bridge must work
through its narrow API. The runner removes only its own Compose project and
temporary credentials in a `finally` block and records cleanup and input hashes
in a redacted report. A failed setup or missing response never counts as success.

These fixtures exercise the actual vendored Supabase SDK, the unmodified
`js/throne-access.js`, real anonymous GoTrue sessions and PostgREST JWT identity.
They create synthetic users and one synthetic duel in a **disposable local stack
only**. They are not a production health check or browser UI test.

Run the standalone acceptance harness (also suitable for GitHub Actions):

```sh
python3 tests/throne_stack/run-acceptance.py --report /tmp/throne-http-acceptance.json
```

It generates temporary synthetic credentials, starts a uniquely named four-service
Compose project from the digest-pinned `../big_quiz_stack` fixtures, verifies the
internal network and absence of host ports, bootstraps Auth in the required order,
installs the current reviewed Throne migration and historical Hall fixture, then
runs the actual SDK driver. Every exit attempts to remove only that Compose
project, including its volumes and network; temporary secrets are removed with
the temporary directory. A passing report requires both driver success and
confirmed container cleanup. The report includes input hashes and redacted
results, never bearer tokens or local credentials. Docker registry credentials,
proxy settings and CA configuration remain inherited and unchanged. This helper
does not accept a hosted endpoint or use Supabase project credentials.

For an already prepared local stack, the manual runner remains available:

Use the pinned isolated stack and bootstrap procedure documented in
[`../show_stack/README.md`](../show_stack/README.md). The root operator must first:

1. Bring up the existing local stack with no published ports or production keys.
2. Restore its standard `auth.uid()` claim accessor after GoTrue initial setup.
3. Install the reviewed Throne migration into that local database. The legacy
   `public.legends` fixture must have its actual contract columns `game`, `name`,
   `streak`, `flawless`, `questions`, `players`, and `created_at`.
4. Apply `historical-fixture.sql` to that local database as the local owner. It
   refuses its test inserts unless the disposable `stack_whoami()` probe exists.
5. Notify PostgREST to reload its schema cache, then run:

```sh
TIERBRAIN_THRONE_STACK=/workspace/tierbrain-bigquiz-stack \
TIERBRAIN_THRONE_SOURCE=/workspace/tierbrain-throne-repair \
python3 tests/throne_stack/run-driver.py
```

The runner uses the selected Compose project's `driver` service and the managed
local Docker socket. It stages reviewed source into the driver's tmpfs using
stdin; it does not create or alter containers, networks, schema, secrets or hosted
projects. It preserves proxy/CA configuration and clears only Docker endpoint and
TLS selectors. The redacted report stays in the private stack directory as
`throne-sdk-gameplay-result.txt`.

The driver proves missing-bearer denial, real Auth identity and persisted SDK
sessions, owner/member/outsider boundaries, edition isolation, canonical member
and question IDs, the real three-second buzzer unlock, first-player selection,
wrong-answer handoff to an opponent who did not buzz, immutable answers, exact
request replay without double scoring, current private receipts, HTTP409/PT409
version conflicts, and exact historical Hall group/edition scope. It also checks
player restore and one actual SDK host token refresh.

The SQL harness separately covers the full multi-question/finale/result protocol.
This HTTP driver deliberately does not requalify GoTrue expiry behavior or repeat
that wider matrix. `tests/throne_browser_checks.py` covers rendered host and mobile
pages with a mocked adapter boundary. Those are distinct forms of evidence.

For a manually staged driver, `SDK_FILE` and `ADAPTER_FILE` override its source
paths; `THRONE_AUTH_URL` and `THRONE_REST_URL` select the two local HTTP service
addresses. The driver rejects HTTPS, hosted hostnames, credentials, non-root paths, queries, hashes and HTTP redirects before making any requests. Only the local service names `auth`/`rest` and loopback addresses are permitted. No signed JWT is synthesized or
mocked by this driver; all actor tokens come from real GoTrue signups.
