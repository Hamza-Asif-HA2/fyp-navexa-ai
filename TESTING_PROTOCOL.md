# NavexaAI — Testing Protocol
> This tells you EXACTLY how to test each feature.
> Never mark something ✅ in PROGRESS.md without running the test here first.

---

## HOW TO TEST — BACKEND (Postman)

### Setup Postman
1. Create a collection called "NavexaAI"
2. Add environment variable: `base_url = http://localhost:5000`
3. Add environment variable: `token = ` (fill after login)

---

### TEST 1 — Server Health
```
GET {{base_url}}/health
Expected: { "status": "ok", "timestamp": "..." }
```
✅ Pass if: 200 response with status ok
❌ Fail if: Connection refused (server not running)

---

### TEST 2 — Register
```
POST {{base_url}}/api/auth/register
Body (JSON):
{
  "name": "Hamza",
  "email": "your_real_email@gmail.com",
  "password": "Test1234!"
}
Expected: { "message": "OTP sent to email", "userId": "..." }
```
✅ Pass if: OTP email arrives in inbox within 1 minute
❌ Fail if: 500 error (check Gmail SMTP config)

---

### TEST 3 — Verify OTP
```
POST {{base_url}}/api/auth/verify-otp
Body (JSON):
{
  "userId": "(from test 2)",
  "otp": "(from email)"
}
Expected: { "message": "Email verified" }
```
✅ Pass if: 200 response
❌ Fail if: "OTP expired" (re-register or resend OTP)

---

### TEST 4 — Login
```
POST {{base_url}}/api/auth/login
Body (JSON):
{
  "email": "your_real_email@gmail.com",
  "password": "Test1234!"
}
Expected: { "token": "eyJ...", "user": { "name": "Hamza", ... } }
```
✅ Pass if: Token returned
⚠️ IMPORTANT: Copy the token value into Postman environment variable `token`

---

### TEST 5 — Gemini AI Chat
```
POST {{base_url}}/api/ai/chat
Headers: Authorization: Bearer {{token}}
Body (JSON):
{
  "message": "Hello Navexa, how are you?",
  "conversationHistory": [],
  "context": {}
}
Expected: { "response": "...", "intent": "GENERAL_CHAT", "action": null }
```
✅ Pass if: Response text sounds like a friendly AI
❌ Fail if: "API key invalid" (check GEMINI_API_KEY in .env)

---

### TEST 6 — Proactive AI
```
POST {{base_url}}/api/ai/proactive
Headers: Authorization: Bearer {{token}}
Body (JSON):
{
  "context": {
    "timeOfDay": "morning",
    "isNavigating": false,
    "currentTrack": null,
    "drivingDurationMinutes": 15,
    "currentLocation": "Lahore, Pakistan"
  }
}
Expected: { "message": "Good morning! How's the drive going?", "type": "general" }
```
✅ Pass if: Natural, context-aware message returned
❌ Fail if: Generic/robotic response (adjust system prompt)

---

### TEST 7 — Trip Flow
```
# Start trip
POST {{base_url}}/api/trips/start
Headers: Authorization: Bearer {{token}}
Body:
{
  "origin": { "lat": 31.5204, "lng": 74.3587, "address": "Lahore" },
  "destination": { "lat": 31.5497, "lng": 74.3436, "address": "Gulberg" }
}
Save the tripId from response.

# Complete trip
PATCH {{base_url}}/api/trips/(tripId)/complete
Body: { "distanceKm": 8.2, "durationMinutes": 22 }

# Check stats updated
GET {{base_url}}/api/trips/stats
Expected: totalKm increased by 8.2, totalTrips increased by 1
```
✅ Pass if: Stats reflect the completed trip

---

## HOW TO TEST — PYTHON SERVICES

### Setup
Open two separate terminals.

**Terminal 1:**
```bash
cd voice-services
uvicorn auth_service.app:app --port 8000 --reload
```
Should print: `Uvicorn running on http://0.0.0.0:8000`

**Terminal 2:**
```bash
cd voice-services
python wake_word/server.py
```
Should print: `Wake word server running on ws://0.0.0.0:8765`

---

### TEST 8 — Resemblyzer Health
```
GET http://localhost:8000/health
Expected: { "status": "ok", "model": "Resemblyzer" }
```

---

### TEST 9 — Voice Enrollment
```
Use Postman → Body → form-data:
POST http://localhost:8000/enroll
Fields:
  userId: "test_user_123"
  label: "Driver"
  audio: (upload a .wav file of you speaking)

Expected: { "success": true, "label": "Driver", "samplesCount": 1 }
```
✅ Pass if: File appears at voice-services/embeddings/test_user_123.json

---

### TEST 10 — Voice Verification (Your Voice)
```
POST http://localhost:8000/verify
Fields:
  userId: "test_user_123"
  audio: (upload another .wav of YOU speaking)

Expected: { "authenticated": true, "confidence": 0.8+ }
```
✅ Pass if: authenticated = true
⚠️ If confidence < 0.75: Enroll more samples (3-5 recommended)

---

### TEST 11 — Voice Rejection (Different Voice)
```
POST http://localhost:8000/verify
Fields:
  userId: "test_user_123"
  audio: (upload .wav of someone ELSE speaking, or different content)

Expected: { "authenticated": false, "confidence": <0.75 }
```
✅ Pass if: authenticated = false
⚠️ If it returns true: Lower SIMILARITY_THRESHOLD in .env (try 0.80)

---

### TEST 12 — Wake Word Detection
1. python wake_word/server.py is running
2. Say "Hey Navexa" clearly into your microphone
3. Watch terminal

```
Expected terminal output:
"Hey Navexa detected! Score: 0.87"
```
✅ Pass if: Detection within 1 second of saying phrase
❌ Fail if: Nothing happens (check microphone input device)
⚠️ Too many false triggers: Increase threshold in server.py (0.5 → 0.65)

---

## HOW TO TEST — MOBILE APP

### Setup
```bash
cd mobile
npx expo start
```
Scan QR code with Expo Go app on your Android phone.
IMPORTANT: Phone and laptop must be on SAME WiFi network.

---

### TEST 13 — App Launches
✅ Pass if: Dark screen appears (NOT white default Expo screen)
❌ Fail if: Red error screen (check console for missing packages)

---

### TEST 14 — Auth Flow on Phone
1. Tap Register
2. Fill in name, email, password
3. Submit
4. Check email for OTP
5. Enter OTP
6. Voice setup screen appears

✅ Pass if: Reaches voice setup screen
❌ Fail if: "Network error" (check EXPO_PUBLIC_API_URL in mobile/.env)

---

### TEST 15 — Voice Enrollment on Phone
1. On voice setup screen
2. Read sentence 1 aloud when prompted
3. Read sentence 2 aloud
4. Read sentence 3 aloud
5. Should navigate to Home

✅ Pass if: Home screen with robot appears
Check in Postman: GET /api/voice/signatures → should show 3 samples

---

### TEST 16 — Robot Animation States
In home screen, manually trigger each state (temporary test buttons):
- idle → robot doing slow animation
- listening → faster animation
- thinking → slow flicker
- speaking → fast/mouth animation

✅ Pass if: All 4 states visually distinct
❌ Fail if: All states look same (check speed props in RobotLottie.tsx)

---

### TEST 17 — Full Voice Pipeline
This is the most important test. Do this on Day 6.

**Step by step:**
1. Press and hold mic button
2. Say: "Hey Navexa, what time is it?"
3. Release button
4. Watch console logs (expo logs in terminal)

Expected console sequence:
```
[VOICE] Recording started
[VOICE] Recording stopped, file: /tmp/audio.wav
[AUTH] Sending to voice auth service...
[AUTH] Result: { authenticated: true, confidence: 0.83 }
[STT] Sending to Whisper...
[STT] Transcript: "what time is it"
[AI] Sending to Gemini...
[AI] Response: { text: "It's 3:45 PM!", intent: "GENERAL_CHAT" }
[TTS] Sending to ElevenLabs...
[TTS] Playing audio...
[TTS] Playback complete
[STATE] Robot → idle
```
✅ Pass if: You hear Navexa speak the response
❌ Common failures and fixes:
  - Auth fails: Re-enroll voice, check threshold
  - Whisper returns empty: Audio too short or wrong format
  - Gemini fails: Check API key, check rate limits
  - ElevenLabs silent: Check API key, fallback to expo-speech

---

### TEST 18 — Voice Rejection Live Test
1. Ask a friend/family member to say "Hey Navexa, play music"
2. Expected: Navexa says "Sorry, I only respond to the registered driver"
3. Robot should flash briefly and return to idle
4. NO music should play

✅ Pass if: Voice rejected
⚠️ If accepted: Your threshold is too low, increase to 0.80 in .env

---

### TEST 19 — Proactive AI Live Test
1. Open Home screen
2. Set proactiveInterval to 1 minute in Settings (for testing)
3. Stay completely silent
4. After 1 minute: Navexa should speak unprompted
5. Set back to 5 minutes after testing

✅ Pass if: Navexa speaks without you doing anything
❌ Fail if: Nothing happens after 2 minutes (check timer logic)

---

### TEST 20 — Navigation Voice Command
1. Go to Navigation screen
2. Say "Hey Navexa, navigate to Packages Mall Lahore"
3. Expected:
   - Route draws on map
   - DESTINATION card shows "Packages Mall"
   - ETA card shows time estimate

✅ Pass if: Route visible on map within 5 seconds of speaking

---

### TEST 21 — Spotify Voice Command
1. Connect Spotify first (Settings screen)
2. Go to Home screen
3. Say "Hey Navexa, play Tum Hi Ho"
4. Expected:
   - Entertainment tab opens
   - Song starts playing
   - Album art shows

✅ Pass if: Song plays within 5 seconds

---

## THRESHOLD TUNING GUIDE

If voice auth is rejecting YOUR voice:
```
# In voice-services/.env
SIMILARITY_THRESHOLD=0.70  # Lower = more lenient
```

If voice auth is accepting OTHER voices:
```
SIMILARITY_THRESHOLD=0.82  # Higher = more strict
```

Recommended starting points by environment:
- Quiet room: 0.78
- Car with noise: 0.72
- Demo room with echo: 0.74

---

## COMMON ERRORS & FIXES

| Error | Cause | Fix |
|-------|-------|-----|
| "Cannot connect to MongoDB" | Wrong URI or no internet | Check MONGODB_URI in .env |
| "Invalid API key - Gemini" | Wrong key or not activated | Check aistudio.google.com |
| "Network error" on phone | Phone and laptop on different WiFi | Connect same WiFi |
| Robot not showing | Lottie file path wrong | Check assets/animations/robot.json exists |
| Wake word not detecting | Wrong microphone selected | Check pyaudio input device index |
| Voice auth always false | Threshold too high | Lower SIMILARITY_THRESHOLD |
| ElevenLabs no audio | Quota exceeded | Use expo-speech fallback |
| Spotify "Premium required" | Free account limitation | Use Spotify Premium account for playback |

---

## DAILY SIGN-OFF CHECKLIST

Before ending each day, verify:
- [ ] All ✅ items in PROGRESS.md for today are actually working
- [ ] No console errors when running the app normally
- [ ] Backend server starts cleanly (no errors on startup)
- [ ] Changes committed to git with meaningful message
- [ ] .env files NOT committed to git
