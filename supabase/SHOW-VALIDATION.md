# Bible Show access validation

Validated on 21 October 2026 with synthetic users and records. The production
migration is `20261021062330_secure_show_rooms`; its SQL SHA256 is
`ee972359384f56d55ddf5d5482afbefc565af29b46d6ed997e4b0149535cc024`.

- 185 isolated PostgreSQL checks passed, including host/member/outsider scope,
  explicit revocations under broad global grants, answer secrecy, every mode,
  duplicate/conflicting requests, close snapshots, score bounds and idempotency,
  expiry and a rollback that retains records while denying the API. Legacy rows,
  policies, grants, schema, cleanup and role memberships stayed unchanged.
- Real local GoTrue/PostgREST tests passed five identity/JWT boundary groups,
  six full gameplay groups and seven actual vendored SDK/adapter groups. They
  used independent Auth-issued identities, tested forged/expired tokens and real
  refresh, and exercised normal, verse, both buzzer teams, Five Clues, finals and
  rejoining. The observed expiry rejection window included about 30 seconds of
  server allowance; the test requires genuine expired-token denial and reports
  observed timing. It does not infer the hosted configuration.
- All 31 unit/contract groups and eight offline browser groups passed. The
  mobile browser flow uses the actual SDK with intercepted Auth/RPC responses;
  it covers visible join, pending/confirmed/rejected/unknown acknowledgements,
  same-choice retry and all phone round modes. Host startup, new-room reset and
  pending finale/room-change races have dedicated regressions.
- Source, catalogue, preview and production builds passed: 153 HTML pages,
  294 JavaScript blocks and 180 public assets. SQL, tests and tooling stay out
  of public output. The SDK is self-hosted at version 2.118.0 with its license,
  pinned npm integrity and file hash retained in source.

The local HTTP stack used pinned PostgreSQL 17.11, GoTrue 2.187.0, PostgREST 14.5
and Node 22 images on an internal Docker network without published ports. It
contained no production URL, key, user or records. Reproducible manual fixtures
are in `tests/show_stack/`; SQL role shims alone are not counted as Auth evidence.
Browser mocks and real local HTTP acceptance test separate layers. Hosted
gateway behavior and ordinary owner gameplay remain distinct production checks.

Production catalog verification after migration matched all 17 tested function
definitions, owner/search-path settings, RPC privileges, seven private-table
grants/RLS flags and private-helper restrictions. Every legacy relation, policy,
grant, default privilege and cleanup definition matched before/after. Server-side
row fingerprints also matched, including all 81 existing score records. No live
test account, room, answer or leaderboard record was created for validation.

Advisors report the intentional 17 authenticated-definer RPC grants and seven
closed private tables with RLS and no policies. Legacy anonymous-policy warnings
remain part of the staged family migrations. The advisory response additionally
named three private-table policies absent from the actual catalog; a direct
`pg_policy` read confirmed zero policies in `show_private`, and effective table,
schema and helper privileges remained denied. The catalog verification and real
API tests establish the boundary; an entirely clean advisor report is not claimed.

The host remains the trusted grader. This batch establishes ownership and
repeat-safe bounded scoring, not verified answer correctness or honest timing.
Show General, other multiplayer families and old cached clients still use their
legacy policies; their migration remains separate. See `SHOW-ACCESS.md` for
protocol limits, retention and API-disable rollback guidance.
