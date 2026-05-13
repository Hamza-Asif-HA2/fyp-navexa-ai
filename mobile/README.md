# NavexaAI Mobile

Expo Router app scaffold for NavexaAI.

## Run

```bash
cd mobile
npm install
npm run start
```

### iPhone / Expo Go: QR code “taking longer…” or “Unknown error”

That almost always means **Expo Go cannot reach Metro** on your Mac (not a bug in your JS until the bundle loads).

1. **Same Wi‑Fi** on Mac and iPhone (not guest/captive portals; turn **VPN** off on both).
2. iPhone **Settings → Expo Go → Local Network → On** (iOS 14+).
3. **Mac firewall**: allow incoming for **Node** (or temporarily turn firewall off to test).
4. If it still fails, use a tunnel (slower but works through bad routers):

   ```bash
   npm run start:tunnel
   ```

   Scan the new QR code (or use the `exp://` URL shown in the terminal).

5. Update **Expo Go** from the App Store (must support **SDK 54**).
6. Optional: in Expo Go use **Enter URL manually** and paste the `exp://…` link from the terminal.

This project sets **`newArchEnabled`: false** in [`app.json`](app.json) for better **Expo Go** compatibility. Re-enable only when you move to a **development build** (`expo-dev-client`) and have verified all native modules.

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