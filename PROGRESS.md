# NavexaAI — Build Progress Tracker
> Update this file as you complete each item.
> ✅ = Done & Tested | 🔄 = In Progress | ❌ = Not Started | ⚠️ = Done but has issues

---

## DAY 1 — Backend Foundation

### Project Setup
- ✅ Folder structure created (NavexaAI/mobile, /backend, /voice-services)
- ✅ backend/package.json initialized
- ⏳ All npm packages installed
- ✅ .env file created with all keys filled in
- ✅ MongoDB Atlas cluster created + connection string copied

### Server
- ⏳ backend/server.js runs without errors (`node server.js`)
- ⏳ GET /health returns `{ status: "ok" }` in Postman
- ⏳ MongoDB connected (see "MongoDB connected" in terminal)

### Auth Routes
- ✅ POST /api/auth/register → creates user in MongoDB with OTP validation
- ✅ POST /api/auth/verify-otp → user.isVerified = true, sends welcome email
- ✅ POST /api/auth/resend-otp → resends OTP for unverified users
- ✅ POST /api/auth/login → returns JWT token with rate limiting
- ✅ POST /api/auth/forgot-password → OTP email sent (secure, doesn't leak user existence)
- ✅ POST /api/auth/reset-password → password updated with OTP verification

### Models
- ✅ User model created (with comparePassword, toSafeObject, password hashing)
- ✅ Trip model created (userId indexed)
- ✅ ConversationHistory model created (auto-expiry 90 days)

### Middleware & Services
- ✅ authMiddleware.js → protect() middleware (JWT verification, user lookup, isVerified check)
- ✅ emailService.js → sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail (dark theme templates)

### AI Services
- ✅ geminiService.js → generateResponse, generateProactiveMessage
- ✅ groqService.js → generateResponse, transcribeAudio
- ✅ elevenLabsService.js → textToSpeech, getVoices
- ✅ backend/package.json updated with @google/generative-ai and groq-sdk

---

## DAY 2 — Backend Routes

### Voice Routes
- ✅ POST /api/voice/enroll → saves signature and calls Python auth service
- ✅ POST /api/voice/verify → calls Python service, returns { authenticated, confidence }
- ✅ GET /api/voice/signatures → returns array of signatures for user
- ✅ DELETE /api/voice/signature/:label → removes signature and remote embedding

### AI Routes
- ✅ POST /api/ai/transcribe → returns transcript from Groq Whisper
- ✅ POST /api/ai/chat → Gemini returns { text, intent, action }
- ✅ POST /api/ai/speak → ElevenLabs returns audio
- ✅ POST /api/ai/proactive → returns context-aware proactive message

### Trip Routes
- ✅ POST /api/trips/start → creates trip, returns tripId
- ✅ PATCH /api/trips/:id/complete → updates trip, adds km to user stats
- ✅ PATCH /api/trips/:id/cancel → cancels active trip
- ✅ GET /api/trips/history → returns paginated trips
- ✅ GET /api/trips/stats → returns { totalKm, totalTrips }

### Settings Routes
- ✅ GET /api/settings → returns user settings
- ✅ PATCH /api/settings → updates proactiveInterval, ttsVoiceId
- ✅ PATCH /api/settings/profile → updates name, email
- ✅ PATCH /api/settings/password → updates password after current password check

---

## DAY 3 — Python Voice Services

### Resemblyzer Service (port 8000)
- ✅ voice-services/auth_service/requirements.txt with all dependencies
- ✅ voice-services/auth_service/.env.example with defaults
- ✅ voice-services/auth_service/app.py with FastAPI endpoints
- ✅ GET /health returns { status: "ok" }
- ✅ POST /enroll → records embedding, saves to embeddings/userId.json
- ✅ POST /verify → returns { authenticated, confidence, matchedLabel }
- ✅ DELETE /signature → removes embedding by label
- ✅ API key validation on all endpoints
- ⏳ Threshold tuned to your voice (adjust SIMILARITY_THRESHOLD in .env)

### Wake Word Service (port 8765)
- ✅ voice-services/wake_word/requirements.txt with all dependencies
- ✅ voice-services/wake_word/.env.example with defaults
- ✅ voice-services/wake_word/server.py with OpenWakeWord integration
- ✅ WebSocket server broadcasts WAKE_WORD_DETECTED events
- ✅ Cooldown protection (2s between detections)
- ✅ Microphone stream (16kHz, 1 channel, PyAudio)
- ⏳ Custom hey_navexa.onnx model file (user provides)

### Both Services Together
- ❌ Both run simultaneously without port conflicts
- ❌ Node.js backend can reach Resemblyzer at localhost:8000

---

## DAY 4 — Mobile App Scaffold + Auth Screens

### Setup
- ❌ Expo app initialized
- ❌ All packages installed (expo install without errors)
- ❌ App runs on physical Android device
- ❌ Dark theme applied globally (background is #0A0A0F, NOT white)
- ❌ 4 tabs visible: Home, Navigation, Entertainment, Dashboard

### Auth Screens
- ❌ Login screen renders correctly on phone
- ❌ Register screen renders correctly on phone
- ❌ OTP screen renders correctly on phone
- ❌ Voice setup screen renders correctly on phone

### Auth Flow (end-to-end)
- ❌ Register with real email → OTP arrives
- ❌ Enter OTP → proceeds to voice setup
- ❌ Voice setup records 3 samples → enrolls to backend
- ❌ After enrollment → lands on Home screen
- ❌ Login with email/password → lands on Home screen
- ❌ JWT token saved to SecureStore
- ❌ App remembers login after closing and reopening

---

## DAY 5 — Home Screen + Lottie Robot

### Lottie Robot
- ❌ robot.json downloaded from LottieFiles
- ❌ lottie-react-native installed
- ❌ RobotLottie.tsx renders on screen (not blank)
- ❌ idle state → slow animation playing
- ❌ listening state → faster animation
- ❌ thinking state → slow flicker
- ❌ speaking state → mouth/fast animation

### Home Screen Layout
- ❌ NAVEXA logo top left
- ❌ Settings icon top right (tappable)
- ❌ Robot centered on screen
- ❌ Right sidebar with 4 icon buttons
- ❌ Press-and-hold mic button at bottom
- ❌ Status text shows "Hold to speak"
- ❌ No white backgrounds anywhere (all dark)

### Wake Word Integration
- ❌ WebSocket connects to wake word server on app launch
- ❌ Say "Hey Navexa" → robot changes to listening state
- ❌ WebSocket auto-reconnects if server restarts

---

## DAY 6 — Complete Voice Pipeline

### Recording
- ❌ Press-hold button → starts recording (microphone permission granted)
- ❌ Release button → stops recording
- ❌ Audio file saved correctly (WAV format, 16kHz)
- ❌ Waveform animation shows during recording

### Voice Auth Check
- ❌ YOUR voice → passes auth (confidence shown in console log)
- ❌ DIFFERENT voice → rejected with TTS "Sorry, I only respond to registered driver"
- ❌ Robot shows rejection state when voice rejected
- ❌ No API call to Gemini when voice rejected

### Transcription
- ❌ Audio sent to /api/ai/transcribe
- ❌ Transcript appears in bottom status bar
- ❌ Handles empty/unclear audio gracefully

### Gemini Response
- ❌ Transcript sent to /api/ai/chat
- ❌ Response text received
- ❌ Intent correctly identified (GENERAL_CHAT, NAVIGATE_TO, PLAY_MUSIC etc)
- ❌ Conversation history maintained across turns

### TTS Playback
- ❌ Response text sent to /api/ai/speak
- ❌ Audio plays through phone speaker
- ❌ Robot in 'speaking' state during playback
- ❌ Robot returns to 'idle' after audio ends
- ❌ Fallback to expo-speech if ElevenLabs fails

### Action Execution
- ❌ "Navigate to X" → opens Navigation tab with route
- ❌ "Play X by Y" → opens Entertainment tab, plays song
- ❌ "Next song" → skips track without leaving current screen
- ❌ "What's the ETA?" → reads ETA aloud
- ❌ General chat → just speaks, no navigation

---

## DAY 7 — Proactive AI

### Timer Logic
- ❌ Timer starts when app loads
- ❌ Timer resets every time user speaks
- ❌ Timer fires after proactiveInterval minutes of silence
- ❌ Proactive message generated by Gemini (not hardcoded)

### Context Awareness
- ❌ Time of day included in context
- ❌ Navigation status included in context
- ❌ Current track included in context
- ❌ Drive duration included in context

### Pause Logic
- ❌ Does NOT fire while user is speaking
- ❌ Does NOT interrupt navigation turn announcements
- ❌ Resumes after user responds or ignores

### Settings Integration
- ❌ Proactive interval setting saved to backend
- ❌ Changing interval in Settings → immediately affects timer
- ❌ Setting interval to 0 → disables proactive AI

---

## DAY 8 — Navigation Screen

### Map UI
- ❌ Map covers full screen (no white borders)
- ❌ Dark map style applied (not default Google Maps colors)
- ❌ User location blue dot visible
- ❌ All 4 overlay cards visible (Next Step, Destination, ETA, AI button)
- ❌ Glassmorphism card style applied

### Route Functionality
- ❌ Search bar shows autocomplete suggestions
- ❌ Select destination → route draws on map
- ❌ Route polyline is purple (#6C63FF)
- ❌ NEXT STEP card updates as you move
- ❌ ETA card shows correct time and distance
- ❌ "Cancel navigation" clears route

### Voice Commands
- ❌ "Navigate to [place in Lahore]" → route appears
- ❌ "What's the ETA?" → AI speaks the ETA
- ❌ "Cancel navigation" → route cleared

### Trip Tracking
- ❌ POST /api/trips/start called when route begins
- ❌ PATCH /api/trips/:id/complete called on arrival
- ❌ Trip saved with correct distance and duration

---

## DAY 9 — Entertainment Screen

### Spotify Connection
- ❌ "Connect Spotify" button works
- ❌ OAuth flow completes on real device
- ❌ Token saved, connection persists
- ❌ "Disconnect" works

### Player UI
- ❌ Album art displays correctly
- ❌ Track name and artist shown
- ❌ Progress bar animates
- ❌ Play/pause/next/prev buttons work
- ❌ Blurred album art background applied

### Search & Browse
- ❌ Search bar returns results
- ❌ Tap track → plays immediately
- ❌ Playlists tab shows user playlists
- ❌ Tap playlist → plays playlist

### Voice Commands
- ❌ "Play [song] by [artist]" → correct song plays
- ❌ "Next song" → skips
- ❌ "Pause" / "Resume" → works
- ❌ "Volume up/down" → volume changes
- ❌ "What's playing?" → AI reads track name

### Mini Player
- ❌ Mini player bar visible on Home and Navigation screens
- ❌ Shows current track + play/pause button
- ❌ Tap mini player → opens Entertainment screen

---

## DAY 10 — Settings + Dashboard

### Settings Screen
- ❌ Profile section shows real user data
- ❌ Name editable + saves to backend
- ❌ Voice signatures list shows enrolled voices
- ❌ "Add Voice" → goes to voice setup flow
- ❌ Delete voice signature → removes from list and backend
- ❌ Proactive interval slider works (1-30 min)
- ❌ Spotify connection status shown

### Dashboard Screen
- ❌ Total KM shows real number from backend
- ❌ Total Trips shows real number
- ❌ Voice Signatures count shows correctly
- ❌ Count-up animation on numbers
- ❌ Recent trips list shows last 5 trips
- ❌ Empty state shows when no trips yet

---

## DAY 11 — Integration Testing

### Full Demo Run Results
- ❌ Run 1: All steps completed without crash
- ❌ Run 2: All steps completed without crash
- ❌ Run 3: All steps completed without crash

### Known Issues Log
| Issue | Status | Fix Applied |
|-------|--------|-------------|
| (add issues here as you find them) | | |

### Edge Cases Tested
- ❌ App works with no internet (graceful error messages)
- ❌ App works when Spotify is not connected
- ❌ App works when navigation is not active
- ❌ Unknown voice rejected every time (tested 5 times)
- ❌ Wake word doesn't false-trigger from TV/background noise
- ❌ ElevenLabs fallback works when quota exceeded

---

## DAY 12 — Demo Prep

### Polish
- ❌ No placeholder text anywhere in the app
- ❌ No loading spinners stuck permanently
- ❌ All screens tested on physical device
- ❌ App doesn't crash on any screen

### Demo Script
- ❌ Demo script written (exact words to say)
- ❌ Demo practiced 3 times end-to-end
- ❌ Backup demo video recorded
- ❌ Backup video includes all 3 key moments

### 3 Key Demo Moments Verified
- ❌ MOMENT 1: Different voice rejected live
- ❌ MOMENT 2: Proactive AI fires during silence
- ❌ MOMENT 3: Hands-free navigation to real Lahore location

---

## API Keys Checklist
> Fill these in as you get them. Keep this file private (add to .gitignore).

- ❌ MongoDB Atlas connection string
- ❌ JWT secret (generate random string)
- ❌ Gemini API key (aistudio.google.com)
- ❌ Groq API key (console.groq.com)
- ❌ ElevenLabs API key (elevenlabs.io)
- ❌ Google Maps API key (console.cloud.google.com)
- ❌ Spotify Client ID + Secret (developer.spotify.com)
- ❌ Gmail app password (myaccount.google.com → Security → App passwords)
- ❌ Voice Auth service API key (make up any random string)

---

## Current Score
**Total items: 120**
**Completed: 0**
**Progress: 0%**

> Update the completed count daily to track momentum.
