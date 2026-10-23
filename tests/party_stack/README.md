# Party SDK and HTTP acceptance

Run from the reviewed repository checkout:

```sh
python3 tests/party_stack/run-acceptance.py --report /tmp/tierbrain-party-http.json
```

Requires Python 3, Docker Engine at `/var/run/docker.sock`, Docker Compose v2,
and the digest-pinned PostgreSQL, GoTrue, PostgREST and Node images referenced
by `tests/big_quiz_stack/compose.yaml`. The runner uses that existing fixture
configuration, its bootstrap/claim accessor files, the reviewed Party migration,
the vendored SDK, and the unmodified `js/party-access.js`.

The runner generates private temporary credentials, starts exactly four services
on an internal network with no host ports, installs the Party migration in an
ephemeral database, runs the SDK driver, and removes its containers, network,
volumes and temporary credentials in `finally`. It reports source hashes and
cleanup status. It does not use Supabase credentials, the CLI, or a hosted
project. The Node driver rejects hosted endpoints, credentials in URLs, service
paths, HTTPS endpoints and redirects before sending Auth/gameplay requests.

The driver creates synthetic anonymous users through real GoTrue, verifies their
JWT identity through PostgREST, then exercises all four families and both Bible
editions. Checks cover SDK persistence and refresh, independent namespaces,
ownership/membership/edition boundaries, canonical choice receipts, host replay
and conflict handling, new-run isolation, Creak's roll and four question kinds,
Standing Room answer/step legality, Spines' book/answer and duplicate-name IDs,
and all five Circuit streams with restart/completion/type/sequence/Lens gates.

This fixture proves Auth/SDK/HTTP behavior. SQL regression tests separately cover
privileges, budgets, rollback and historical-data preservation; actual-page
browser tests separately cover UI interactions, delayed callbacks and rendering.
