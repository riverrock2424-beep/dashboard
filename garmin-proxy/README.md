# garmin-proxy

A tiny local backend that logs into your Garmin Connect account and serves
your daily stats to `health.html` as JSON. Uses the unofficial
[`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect)
library — not Garmin's official (business-only) API — so it's your own
Garmin email/password, kept in a local `.env` file that never leaves this
machine.

## Setup

1. Install Python 3.9+ if you haven't already.
2. From this folder, install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and fill in your real Garmin email/password:
   ```
   GARMIN_EMAIL=you@example.com
   GARMIN_PASSWORD=your-garmin-password
   PORT=8734
   ```
4. Start the server:
   ```
   python server.py
   ```
   It should print that Flask is running on `http://localhost:8734`.
5. Open `health.html`, click the gear icon next to "Health", and set the
   backend proxy base URL to `http://localhost:8734`. Save, then click
   **Connect Garmin**.

The server needs to be running (`python server.py`) any time you want
`health.html` to show live data — it's not a hosted/always-on service,
just a local process you start yourself.

## Two-factor auth

If your Garmin account has 2FA enabled, this proxy's automatic login can't
complete the code-entry step and will fail. Easiest fix: temporarily turn
off 2FA on the Garmin account this proxy uses. A session is cached in
`.garmin_session/` after the first successful login, so day-to-day restarts
of `server.py` won't need to log in again (and won't re-trigger 2FA) unless
that cache expires or is deleted.

## Everything shows 0 / blank

If `/garmin-data` responds with `ok` but every field is `0` or `null`, that
usually just means your Garmin account has no data yet for today (no watch
synced, or a brand-new account) — not a bug. Wear/sync a Garmin device for
a day and the same fields should populate.

## If a stat comes back blank

Garmin's endpoints here are undocumented and can change shape without
notice. If something in `health.html` shows a dash that shouldn't be empty,
visit `http://localhost:8734/debug/raw` while the server is running — it
dumps the raw, unmapped response for every metric this proxy fetches. Compare
that against the field names read in `garmin_data()` in `server.py` and
adjust as needed.

## Endpoints

- `GET /health` — `{ ok: true }` if login succeeds, `{ ok: false, error }` otherwise. Used by the "Connect Garmin" button.
- `GET /garmin-data` — today's stats, shaped for `health.html`'s `renderGarminData()`.
- `GET /debug/raw` — raw, unmapped responses for troubleshooting.
