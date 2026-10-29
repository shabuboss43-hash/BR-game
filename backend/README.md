# X Battle Royale — Optional PHP Backend

The game is **fully playable offline without PHP**. This backend only adds
optional server-side result storage and a config/health endpoint.

## Run it (local development)

From the project root, with PHP 8+ installed:

```bash
php -S localhost:8000
```

Then open <http://localhost:8000/> to play, and enable the backend in
`config.json`:

```json
"game": { "backendEnabled": true, "backendBaseUrl": "backend/" }
```

Match results will be appended to `backend/data/results.jsonl`
(one JSON object per line).

## Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `backend/get-config.php` | GET | `{ ok, status, game:{title,version}, serverTime }` |
| `backend/save-result.php` | POST (JSON) | Validates and stores one match result |

`save-result.php` accepts only `result` (`won`/`lost`), `kills`, `shots`,
`hits`, `durationSeconds`, `damageDealt` — each range-checked. Malformed
JSON, wrong methods and oversized bodies are rejected. Error responses
never expose server paths.

## Limitations (read before hosting publicly)

- File-based storage is **not** hardened against every hosting threat:
  put `backend/data/` outside the web root or deny web access to it
  (the included `.htaccess` does this on Apache; add an equivalent rule
  on Nginx), and never make the data directory world-writable.
- Client-submitted scores are **not trustworthy**. This is casual stats
  storage, not a competitive leaderboard.
- There is **no login system** — intentionally. A fake login screen
  provides no security.
- If you later add a database, use prepared statements for every query.
- Real-time multiplayer cannot be built on these request/response
  endpoints; it needs persistent connections (WebSockets) with a
  server-authoritative simulation.
