# Wake word service (`server.py`)

WebSocket server (default `ws://0.0.0.0:8765`) that detects “Hey Navexa” using **OpenWakeWord** (`hey_navexa.onnx`) and/or **Groq Whisper** for short audio clips from the mobile app.

## What you need to run it (this repo)

1. **Python virtualenv + dependencies** (recommended on macOS / PEP 668):

   ```bash
   cd voice-services/wake_word
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

   Or from repo root: `python3 -m venv voice-services/wake_word/.venv && voice-services/wake_word/.venv/bin/pip install -r voice-services/wake_word/requirements.txt`

2. **`hey_navexa.onnx`** — keep it in this directory next to `server.py`, or set `MODEL_PATH` in `.env`.

3. **`.env`** — copy from `.env.example` and set `GROQ_API_KEY` if you want Whisper on clips when OWW does not fire.

4. **Start the server** (uses `.venv` automatically):

   ```bash
   cd voice-services/wake_word
   ./run.sh
   ```

   Equivalent: `.venv/bin/python server.py`

5. **Mobile** — `mobile/.env` must include `EXPO_PUBLIC_WAKE_WORD_WS=ws://<lan-ip>:8765` (same Wi‑Fi as the device). Restart Expo after changing any `EXPO_PUBLIC_*` value.

See also [`mobile/README.md`](../../mobile/README.md) and [`mobile/.env.example`](../../mobile/.env.example).
