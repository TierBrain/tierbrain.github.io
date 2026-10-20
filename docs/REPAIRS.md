# Repair branch and validation

Originally prepared from public source commit
`a39c6fbcc532b5a01ad9309f9eb69de1d900cb05`. The final migration branch
`review/cloudflare-migration` includes upstream `main` through
`1fdb8334735c16eefd6645671c95974884fbdc18`, preserving all seven newer uploads.
The owner subsequently connected the verified Cloudflare deployment to
`tierbrain.co`; see [HOSTING.md](HOSTING.md) for current hosting and update settings.

## Included

- Exact public/group score queries and defensive response filtering in Wall of Fame, Piece by Piece and Jigsaw; group labels explain code-shared access.
- Removal of shipped debug/test exports. The game-show opening cutscene retains its normal start behaviour through a narrow local event.
- Associated labels and nickname guidance on the audited joining/score screens.
- Counts validated against the homepage's existing catalogue, Sport Pack wording, and all three sitemaps advertised in robots.txt.
- A pull-request validation workflow with read-only GitHub permissions. It validates local links, JavaScript, JSON/JSON-LD and sitemaps, then runs isolated browser regression tests with synthetic data.
- A public-asset-only build and Cloudflare Workers Static Assets configuration. The owner completed the account-side domain and DNS migration separately from these source changes.

## Run checks

Use Python 3.12+ and Node.js 22+.

```sh
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python scripts/check_site.py
python sync-catalogue.py --check
python -m unittest discover -s tests -p 'test_*.py'
python tests/browser_checks.py
python build-site.py
```

If Chromium is already installed, the browser suite accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium`. It intercepts all page HTTP requests and WebSockets. Score/room changes in these tests use fabricated responses in memory; no live backend receives them. Some tests exercise normal submission functions under this interception.

After adding/removing a catalogue game, run `python sync-catalogue.py` and commit the updated counts. Pack links must point to games present in the catalogue. The legacy `#football` pack anchor is retained so existing links continue to work.

## Local visual preview

```sh
python build-site.py
python preview-site.py --port 8000
```

Open `http://127.0.0.1:8000/`. This binds only to the local machine and sends a Content Security Policy blocking external browser connections, fonts, images and scripts. Solo games and layout can be reviewed; multiplayer, remote scores and some external visual assets are intentionally unavailable. It does not create an isolated database. The stricter local-preview policy is separate from production headers.

Do not publish an unrestricted preview against production Supabase. Configure an isolated test project before testing multiplayer online. See [HOSTING.md](HOSTING.md) for migration and rollback requirements.

## Remaining backend work

Client-side filtering is a mitigation, not database authorization. No schema, policies, privileged credentials, cleanup jobs or account settings were inspected or changed during implementation. Complete these before claiming private groups or trusted competitive scoring:

1. Read-only inventory of tables, grants, row-level security, server functions, triggers, indexes, room lifecycle and current backups. Map all games sharing each table.
2. Build a staging database with synthetic records. Define explicit public/group visibility, host ownership and player membership; use short-lived guest identities so joining needs no registration form.
3. Move authoritative answers, timing and score calculation to trusted server code. Test outsider access, forged identities/scores, duplicate submissions, late answers and host-only actions as well as normal play.
4. Introduce unique session IDs, bounded state, heartbeat updates and expiry. Choose retention periods from actual product needs, verify cleanup protects active sessions, then update privacy copy to match.
5. Roll out changes per game with a backup and rollback plan. Confirm failure alerts, branch protection and deployment checks in the account settings.

The publishable browser key remains public by design. Moving hosting or removing debug exports does not replace these controls.

## Verification result

The final source and public build passed validation: 153 HTML files, 292
JavaScript checks, 61 structured-data blocks, 1,614 local URL targets and three
sitemaps. Ten validator/build regression tests and seven isolated browser test
groups passed, including mixed public/group responses, exact game scopes,
removed debug controls, both game-show cutscene continuations and the newly
uploaded alternate Creak page. Wrangler 4.151.2 passed twelve local hosting
checks. The hosted production Worker and custom domain each passed thirteen
HTTP/routing/header checks and four guarded browser checks. Sixteen final
HTTP/HTTPS apex/www routing checks passed with path/query preservation.
No live backend requests were made during verification.

## Release review

For future releases, review the patch and run the checks. Use the restricted
Cloudflare preview for display/routing review and an isolated staging backend
for multiplayer or score changes. Keep current `.html` canonical URLs and
existing query strings, and check that missing URLs return 404. Production headers
restrict framing to the same origin; decide separately if third-party embedding
is a required feature. Existing free-game promises are retained.
