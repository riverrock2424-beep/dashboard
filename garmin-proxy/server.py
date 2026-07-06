"""
Local Garmin Connect proxy for health.html.

Logs into your Garmin account (via the unofficial `garminconnect` package,
https://pypi.org/project/garminconnect/) using the email/password in .env,
and serves today's wellness stats as JSON in the shape health.html expects.

Field mapping uses the package's `client.typed` accessor, which validates
Garmin's raw (undocumented, reverse-engineered) responses against pydantic
models — see garminconnect/typed.py in your installed package for the
authoritative field list if something ever comes back unexpectedly empty.

Setup:
    pip install -r requirements.txt
    copy .env.example to .env, fill in GARMIN_EMAIL / GARMIN_PASSWORD
    python server.py

Then in health.html's Garmin settings (gear icon), set the backend proxy
base URL to http://localhost:8734 (or whatever PORT you set in .env).

Note on 2FA: if your Garmin account has two-factor auth enabled, the
non-interactive login below can't complete it. Either disable 2FA on the
Garmin account this proxy uses, or run a one-off interactive login first
(see the README) so a reusable session gets cached in .garmin_session/.
"""

import os
import datetime

from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import garminconnect

load_dotenv()

GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD")
PORT = int(os.environ.get("PORT", 8734))
TOKEN_STORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".garmin_session")

app = Flask(__name__)
# Wide open CORS — this only ever serves your own dashboard on your own
# machine, so there's no one else it needs to keep out.
CORS(app)


@app.after_request
def allow_private_network(response):
    # Lets an HTTPS page (e.g. health.html deployed on Vercel) call this
    # plain-HTTP localhost server. Chrome/Edge send a preflight asking
    # "Access-Control-Request-Private-Network: true" before allowing a
    # public HTTPS origin to reach a private/local address; without this
    # response header they silently fail with "Failed to fetch". Firefox
    # and Safari don't support this exception at all — for those, open
    # health.html as a local file instead of the deployed site when you
    # want live Garmin data.
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

_client = None


def get_client():
    """Return a logged-in Garmin client, reusing a cached session when possible
    so we don't hit Garmin's login endpoint (and any 2FA prompt) on every call."""
    global _client
    if _client is not None:
        return _client

    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        raise RuntimeError("Set GARMIN_EMAIL and GARMIN_PASSWORD in garmin-proxy/.env first.")

    client = garminconnect.Garmin(email=GARMIN_EMAIL, password=GARMIN_PASSWORD)
    # login(tokenstore) does everything in one call: try loading a cached
    # session from TOKEN_STORE first, refresh it if it's expiring, and fall
    # back to a fresh username/password login if there's nothing cached yet
    # (or it's stale) — saving the result back to TOKEN_STORE either way.
    client.login(TOKEN_STORE)

    _client = client
    return _client


def safe(fn, default=None):
    """Run fn() and swallow any failure, returning `default` instead. Garmin's
    unofficial endpoints occasionally reject a request (rate limit, a day
    with no data, etc.) — one bad field shouldn't take down the whole
    /garmin-data response."""
    try:
        return fn()
    except Exception as e:
        print(f"[garmin-proxy] field fetch failed: {e}")
        return default


@app.route("/health")
def health():
    try:
        get_client()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/debug/raw")
def debug_raw():
    """Dumps the raw (untyped) response for every metric this proxy uses.
    Handy when a field in /garmin-data comes back empty — check here to see
    what Garmin actually returned today, then compare against
    garminconnect/typed.py in your installed package."""
    try:
        client = get_client()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    today = datetime.date.today().isoformat()
    return jsonify({
        "stats": safe(lambda: client.get_stats(today)),
        "sleep": safe(lambda: client.get_sleep_data(today)),
        "bodyBattery": safe(lambda: client.get_body_battery(today, today)),
        "hrv": safe(lambda: client.get_hrv_data(today)),
    })


def non_negative(v):
    """Garmin's daily-metrics endpoints use negative sentinel values (commonly
    -1 or -2) to mean 'not calculated yet for today', not an actual reading.
    Treat any negative number as missing so the frontend shows a dash instead
    of a nonsense value like -1% stress."""
    return v if isinstance(v, (int, float)) and v >= 0 else None


def extract_body_battery(entries):
    """`typed.get_body_battery` returns one BodyBatteryEntry per day, each with
    a `body_battery_values_array` of [timestamp, level] samples through the
    day. Take the most recent sample; fall back to charged-minus-drained if
    the array is empty (e.g. a day still in progress with few samples)."""
    if not entries:
        return None
    entry = entries[-1]
    values = entry.body_battery_values_array or []
    if values:
        last_point = values[-1]
        if isinstance(last_point, list) and len(last_point) > 1:
            return last_point[1]
    charged = entry.charged or 0
    drained = entry.drained or 0
    if charged or drained:
        return max(0, min(100, charged - drained))
    return None


@app.route("/garmin-data")
def garmin_data():
    try:
        client = get_client()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    today = datetime.date.today().isoformat()
    typed = client.typed

    stats = safe(lambda: typed.get_stats(today))
    sleep = safe(lambda: typed.get_sleep_data(today))
    body_battery_entries = safe(lambda: typed.get_body_battery(today, today)) or []
    hrv = safe(lambda: typed.get_hrv_data(today))

    dto = sleep.daily_sleep_dto if sleep and sleep.daily_sleep_dto else None
    sleep_score = (
        dto.sleep_scores.overall.value
        if dto and dto.sleep_scores and dto.sleep_scores.overall
        else None
    )
    hrv_summary = hrv.hrv_summary if hrv and hrv.hrv_summary else None

    payload = {
        "bodyBattery": non_negative(extract_body_battery(body_battery_entries)) or 0,
        "sleepScore": sleep_score if sleep_score is not None else 0,
        "sleepDurationMin": round((dto.sleep_time_seconds or 0) / 60) if dto else 0,
        "sleepStages": {
            "remMin": round((dto.rem_sleep_seconds or 0) / 60) if dto else 0,
            "deepMin": round((dto.deep_sleep_seconds or 0) / 60) if dto else 0,
            "lightMin": round((dto.light_sleep_seconds or 0) / 60) if dto else 0,
            "awakeMin": round((dto.awake_sleep_seconds or 0) / 60) if dto else 0,
        },
        "stressScore": non_negative(stats.average_stress_level if stats else None) or 0,
        "hrv": non_negative(hrv_summary.last_night_avg if hrv_summary else None),
        "hrvStatus": (hrv_summary.status or "").lower() if hrv_summary and hrv_summary.status else None,
        "rhr": non_negative(stats.resting_heart_rate if stats else None),
        # Garmin's per-day SpO2/respiration endpoints aren't modeled by this
        # package's typed accessor, but the overnight averages are — good
        # enough for a once-a-day dashboard card.
        "pulseOx": non_negative(dto.avg_spo2 if dto else None),
        "respirationRate": non_negative(dto.avg_respiration_value if dto else None),
        # Not exposed by this package at all — frontend just shows a dash.
        "skinTempDeviationC": None,
        "updatedAt": datetime.datetime.now().isoformat(),
    }
    return jsonify(payload)


if __name__ == "__main__":
    app.run(port=PORT, debug=False)
