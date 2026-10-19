# TierBrain

Browser quizzes, puzzles and multiplayer game nights at [tierbrain.co](https://tierbrain.co/).

The existing `index.html` game cards are the catalogue source. After changing it,
run `python sync-catalogue.py` to update published totals.

See [repair notes and test commands](docs/REPAIRS.md) for validation and a local
preview that blocks live backend connections. See the [hosting assessment](docs/HOSTING.md)
for the proposed Cloudflare migration and rollback plan.

```sh
python build-site.py
python preview-site.py
```

The local preview runs at `http://127.0.0.1:8000/`. Multiplayer and online scores
are unavailable there. Build and preview commands do not deploy the site.
