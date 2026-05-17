import asyncio
import websockets
import numpy as np
import librosa
from dotenv import load_dotenv
import os
import json
import re
import time
from difflib import SequenceMatcher
from datetime import datetime
from contextlib import suppress
import io
import wave

try:
    import sounddevice as sd
    SOUNDDEVICE_AVAILABLE = True
except Exception:
    sd = None
    SOUNDDEVICE_AVAILABLE = False

try:
    from groq import Groq
    GROQ_AVAILABLE = True
except Exception:
    Groq = None
    GROQ_AVAILABLE = False

load_dotenv()

# Groq client for Whisper transcription
groq_client = None
if GROQ_AVAILABLE:
    _gk = (os.getenv("GROQ_API_KEY") or "").strip()
    if _gk:
        try:
            groq_client = Groq(api_key=_gk)
            print("[INIT] ✅ Groq Whisper initialized")
        except Exception as e:
            print(f"[ERROR] Groq initialization failed: {e}")
            groq_client = None
    else:
        print("[ERROR] GROQ_API_KEY not set in .env")
else:
    print("[ERROR] groq package not installed")

# Core config
WEBSOCKET_PORT = int(os.getenv("WEBSOCKET_PORT", "8765"))
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "2"))
ENERGY_THRESHOLD = float(os.getenv("ENERGY_THRESHOLD", "300"))
BUFFER_DURATION = float(os.getenv("BUFFER_DURATION", "1.5"))  # Seconds

CHUNK = 1280
CHANNELS = 1
RATE = 16000

connected_clients = set()
last_detection_time = 0


def normalize_transcript(text):
    """Normalize transcript text for fuzzy wake-word matching."""
    cleaned = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def is_hey_navexa(text):
    """Return True when a transcript is a close match for 'Hey Navexa'."""
    normalized = normalize_transcript(text)
    if not normalized:
        return False

    target = "hey navexa"
    phrase_score = SequenceMatcher(None, normalized, target).ratio()
    if phrase_score >= 0.72:
        return True

    tokens = normalized.split()
    if len(tokens) < 2:
        return False

    hey_score = SequenceMatcher(None, tokens[0], "hey").ratio()
    navexa_score = SequenceMatcher(None, tokens[1], "navexa").ratio()
    return hey_score >= 0.6 and navexa_score >= 0.6


def display_transcription(text, energy, is_wake_word=False):
    """Display transcribed text with nice formatting"""
    if is_wake_word:
        print("\n" + "=" * 70)
        print(f"🎤 WAKE WORD DETECTED: '{text}' | Energy: {energy:.1f}")
        print("=" * 70 + "\n")
    else:
        print(f"📝 Transcribed: '{text}' | Energy: {energy:.1f}")


async def notify_clients():
    """Notify all connected clients of wake word detection"""
    if connected_clients:
        message = json.dumps(
            {"event": "WAKE_WORD_DETECTED", "timestamp": datetime.now().isoformat()}
        )
        await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )
        print(f"[WS] ✅ Notified {len(connected_clients)} client(s)")


async def handler(websocket):
    """Handle WebSocket connections from React Native"""
    global last_detection_time

    connected_clients.add(websocket)
    client_addr = websocket.remote_address
    print(f"[WS] Client connected: {client_addr}")
    print(f"[WS] Total clients: {len(connected_clients)}")

    try:
        async for message in websocket:
            try:
                # Binary messages: audio file bytes (WAV/M4A from mobile) or raw PCM
                if isinstance(message, (bytes, bytearray)):
                    raw = bytes(message)
                    current_time = time.time()

                    # Decode audio - try multiple formats
                    samples = None
                    
                    # Try 1: Direct librosa load (WAV/MP4/etc container formats)
                    try:
                        samples_float, _ = librosa.load(io.BytesIO(raw), sr=RATE, mono=True)
                        samples = np.clip(samples_float, -1.0, 1.0)
                        samples = (samples * 32767.0).astype(np.int16)
                        print(f"[AUDIO] ✅ Decoded as WAV/container ({len(raw)} bytes → {len(samples)} samples)")
                    except Exception as e:
                        pass

                    # Try 2: Raw PCM int16 (most common from React Native Audio)
                    if samples is None:
                        try:
                            samples = np.frombuffer(raw, dtype=np.int16)
                            if len(samples) > 0:
                                print(f"[AUDIO] ✅ Decoded as raw PCM int16 ({len(samples)} samples)")
                            else:
                                samples = None
                        except Exception as e:
                            pass

                    # Try 3: Raw PCM float32
                    if samples is None:
                        try:
                            samples_float = np.frombuffer(raw, dtype=np.float32)
                            if len(samples_float) > 0:
                                samples = np.clip(samples_float, -1.0, 1.0)
                                samples = (samples * 32767.0).astype(np.int16)
                                print(f"[AUDIO] ✅ Decoded as raw PCM float32 ({len(samples_float)} samples)")
                            else:
                                samples = None
                        except Exception as e:
                            pass

                    # If all decoding failed
                    if samples is None or len(samples) == 0:
                        print(f"[AUDIO] ❌ Could not decode audio ({len(raw)} bytes)")
                        await websocket.send(json.dumps({"event": "ERROR", "detail": "audio_decode_failed"}))
                        continue

                    energy = float(np.sqrt(np.mean(np.square(samples.astype(np.float32)))))
                    is_wake = False

                    # Transcribe with Groq
                    if groq_client is not None:
                        try:
                            # Convert samples to WAV bytes for Groq
                            wav_bytes = io.BytesIO()
                            with wave.open(wav_bytes, "wb") as wav_file:
                                wav_file.setnchannels(CHANNELS)
                                wav_file.setsampwidth(2)
                                wav_file.setframerate(RATE)
                                wav_file.writeframes(samples.tobytes())

                            wav_bytes.seek(0)

                            print(f"[GROQ] Transcribing {len(samples)} samples ({len(samples)/RATE:.2f}s)...")
                            transcript = groq_client.audio.transcriptions.create(
                                file=("audio.wav", wav_bytes, "audio/wav"),
                                model="whisper-large-v3-turbo",
                                language="en",
                            )

                            text = transcript.text.strip()
                            if text:
                                display_transcription(text, energy)

                                # Check for wake word
                                if is_hey_navexa(text):
                                    if current_time - last_detection_time > COOLDOWN_SECONDS:
                                        is_wake = True
                                        last_detection_time = current_time
                                        display_transcription(text, energy, is_wake_word=True)
                                        await notify_clients()
                            else:
                                print(f"[GROQ] Empty transcription")

                        except Exception as e:
                            print(f"[GROQ] Transcription error: {e}")
                            await websocket.send(json.dumps({"event": "ERROR", "detail": str(e)}))
                            continue

                    # Send response
                    if is_wake:
                        await websocket.send(
                            json.dumps({"event": "WAKE_WORD_DETECTED", "text": text, "energy": energy})
                        )
                    else:
                        await websocket.send(json.dumps({"event": "NO_DETECTION", "energy": energy}))

                else:
                    # Text messages (informational)
                    print(f"[WS] Message from {client_addr}: {message}")
                    await websocket.send(json.dumps({"event": "ECHO", "message": str(message)}))

            except Exception as e:
                print(f"[WS] Error processing message: {e}")
                await websocket.send(json.dumps({"event": "ERROR", "detail": str(e)}))

    except Exception as e:
        print(f"[WS] Handler error: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Client disconnected: {client_addr}")
        print(f"[WS] Total clients: {len(connected_clients)}")


async def main():
    """Start WebSocket server"""
    print(f"🚀 Wake word WebSocket server starting on ws://0.0.0.0:{WEBSOCKET_PORT}")
    print(f"📝 Using Groq Whisper for transcription")
    print(f"⏱️  Cooldown: {COOLDOWN_SECONDS} seconds")
    print("🎤 Ready to detect 'Hey Navexa'!\n")

    if groq_client is None:
        print("❌ GROQ_API_KEY not configured. Add it to .env")
        return

    async with websockets.serve(handler, "0.0.0.0", WEBSOCKET_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())