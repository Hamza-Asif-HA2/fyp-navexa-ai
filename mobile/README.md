# NavexaAI Mobile

Expo Router app scaffold for NavexaAI.

## Run

```bash
cd mobile
npm install
npm run start
```

## Environment

See [`.env.example`](.env.example) for all variables. Create or update `.env` with:

```bash
EXPO_PUBLIC_API_URL=http://192.168.100.116:5000
EXPO_PUBLIC_VOICE_AUTH_URL=http://192.168.100.116:8000
EXPO_PUBLIC_WAKE_WORD_WS=ws://192.168.100.116:8765
EXPO_PUBLIC_VOICE_AUTH_KEY=navexa_voice_key_2024
EXPO_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_key
```

### Wake word (phone + server)

1. Run the Python wake WebSocket service and install its dependencies — see [`../voice-services/wake_word/README.md`](../voice-services/wake_word/README.md).
2. Set `EXPO_PUBLIC_WAKE_WORD_WS=ws://<your-lan-ip>:8765` in `.env` (same Wi‑Fi as the device; not `localhost` on a real phone).
3. **Restart Expo** after editing `.env` so `EXPO_PUBLIC_*` values reload.