import asyncio
import websockets
import numpy as np
import librosa
from dotenv import load_dotenv
import os
import threading
import json
import re
import time
from difflib import SequenceMatcher
from datetime import datetime
from contextlib import suppress
import io
import wave
import tempfile

try:
    from groq import Groq
    GROQ_AVAILABLE = True
except Exception:
    Groq = None
    GROQ_AVAILABLE = False

try:
    from openwakeword.model import Model

    OPENWAKEWORD_AVAILABLE = True
except Exception:
    Model = None
    OPENWAKEWORD_AVAILABLE = False

try:
    import pyaudio

    PYAUDIO_AVAILABLE = True
except Exception:
    pyaudio = None
    PYAUDIO_AVAILABLE = False

try:
    import sounddevice as sd

    SOUNDDEVICE_AVAILABLE = True
except Exception:
    sd = None
    SOUNDDEVICE_AVAILABLE = False

load_dotenv()

# Groq client for Whisper transcription
groq_client = None
if GROQ_AVAILABLE:
    _gk = (os.getenv("GROQ_API_KEY") or "").strip()
    if _gk:
        try:
            groq_client = Groq(api_key=_gk)
            print("[INIT] Groq Whisper initialized for wake word detection")
        except Exception as e:
            print(f"[WARNING] Groq initialization failed: {e}")
            groq_client = None
    else:
        print("[INFO] GROQ_API_KEY not set; Groq transcription disabled.")

# Core config
MODEL_PATH = os.getenv("MODEL_PATH", "hey_navexa.onnx")
DETECTION_THRESHOLD = float(os.getenv("DETECTION_THRESHOLD", "0.5"))
WEBSOCKET_PORT = int(os.getenv("WEBSOCKET_PORT", "8765"))
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "2"))
ENERGY_THRESHOLD = float(os.getenv("ENERGY_THRESHOLD", "500"))
BUFFER_DURATION = float(os.getenv("BUFFER_DURATION", "1.5"))  # Seconds

# Auto-calibration and debug options
AUTO_CALIBRATE = os.getenv("AUTO_CALIBRATE", "true").lower() in ("1", "true", "yes")
CALIBRATION_SECONDS = float(os.getenv("CALIBRATION_SECONDS", "1.5"))
CALIBRATION_MULTIPLIER = float(os.getenv("CALIBRATION_MULTIPLIER", "3.0"))
DEBUG_FORCE_TRANSCRIBE = os.getenv("DEBUG_FORCE_TRANSCRIBE", "false").lower() in ("1", "true", "yes")

CHUNK = 1280
FORMAT = pyaudio.paInt16 if PYAUDIO_AVAILABLE else None
CHANNELS = 1
RATE = 16000

connected_clients = set()
last_detection_time = 0
last_transcription = None


def display_transcription(text, energy, is_wake_word=False):
    """Display transcribed text with nice formatting"""
    global last_transcription
    last_transcription = text

    if is_wake_word:
        print("\n" + "=" * 70)
        print(f"🎤 WAKE WORD DETECTED: '{text}' | Energy: {energy:.1f}")
        print("=" * 70 + "\n")
    else:
        print(f"📝 YOU SAID: '{text}' | Energy: {energy:.1f}")


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


def max_prediction_score(prediction: dict) -> float:
    best = 0.0
    for v in prediction.values():
        if isinstance(v, (int, float, np.floating, np.integer)):
            best = max(best, float(v))
    return best


def clip_max_openwakeword_score(oww_model, samples_int16: np.ndarray) -> float:
    if oww_model is None or samples_int16 is None or samples_int16.size == 0:
        return 0.0
    try:
        clip = samples_int16.astype(np.int16, copy=False)
        frames = oww_model.predict_clip(clip, padding=1)
    except Exception as e:
        print(f"[OWW] predict_clip error: {e}")
        return 0.0
    best = 0.0
    for frame_pred in frames:
        best = max(best, max_prediction_score(frame_pred))
    return best


def audio_file_to_int16_mono(path: str, target_sr: int = RATE) -> np.ndarray:
    wav, _sr = librosa.load(path, sr=target_sr, mono=True)
    wav = np.clip(wav, -1.0, 1.0)
    return (wav * 32767.0).astype(np.int16)


# OpenWakeWord model (preferred for server mic). Groq can still transcribe binary clips from mobile.
print(f"Loading wake word model: {MODEL_PATH}")
model = None
if OPENWAKEWORD_AVAILABLE:
    mp = MODEL_PATH
    if not os.path.isfile(mp):
        here = os.path.dirname(os.path.abspath(__file__))
        alt = os.path.join(here, os.path.basename(MODEL_PATH))
        if os.path.isfile(alt):
            mp = alt
    if os.path.isfile(mp):
        try:
            model = Model(
                wakeword_models=[mp],
                inference_framework="onnx",
                vad_threshold=0.5,
            )
            print("Wake word model loaded successfully!")
            print(f"Model keys: {list(model.models.keys())}")
        except Exception as e:
            print(f"[WARNING] Could not load OpenWakeWord model: {e}")
            model = None
    else:
        print(f"[INFO] Model file not found at {mp}; OpenWakeWord disabled.")

if model is None and groq_client is None:
    print("[WARNING] No Groq API key and no OpenWakeWord model — wake detection will be limited.")
elif model is not None:
    print("[INFO] Server microphone uses OpenWakeWord streaming.")
elif groq_client is not None:
    print("[INFO] Server microphone uses Groq Whisper buffering.")

audio = None
stream = None
if SOUNDDEVICE_AVAILABLE:
    stream = sd.InputStream(
        samplerate=RATE,
        channels=CHANNELS,
        blocksize=CHUNK,
        dtype="int16",
    )
    stream.start()
    print("Microphone stream opened via sounddevice")
    # Ambient calibration (reads a short burst to set sensible ENERGY_THRESHOLD)
    if AUTO_CALIBRATE and groq_client is not None:
        def calibrate_ambient(seconds=CALIBRATION_SECONDS):
            global ENERGY_THRESHOLD
            print(f"[CALIBRATE] Measuring ambient noise for {seconds}s...")
            frames_needed = int(RATE * seconds)
            collected = np.array([], dtype=np.int16)
            while collected.size < frames_needed:
                try:
                    data, _ = stream.read(CHUNK)
                    data = np.asarray(data, dtype=np.int16).reshape(-1)
                except Exception:
                    # fallback read style
                    try:
                        chunk = stream.read(CHUNK, exception_on_overflow=False)
                        data = np.frombuffer(chunk, dtype=np.int16)
                    except Exception:
                        break
                collected = np.concatenate([collected, data])
            if collected.size == 0:
                return None
            ambient = float(np.sqrt(np.mean(np.square(collected.astype(np.float32)))))
            return ambient

        ambient = calibrate_ambient()
        if ambient is not None:
            new_thresh = max(50.0, ambient * CALIBRATION_MULTIPLIER)
            print(f"[CALIBRATE] Ambient energy: {ambient:.1f} -> ENERGY_THRESHOLD set to {new_thresh:.1f}")
            ENERGY_THRESHOLD = new_thresh
elif PYAUDIO_AVAILABLE:
    audio = pyaudio.PyAudio()
    stream = audio.open(
        format=FORMAT,
        channels=CHANNELS,
        rate=RATE,
        input=True,
        frames_per_buffer=CHUNK,
    )
    print("Microphone stream opened via pyaudio")
    # For pyaudio, optionally calibrate similarly
    if AUTO_CALIBRATE and groq_client is not None:
        def calibrate_ambient_pyaudio(seconds=CALIBRATION_SECONDS):
            global ENERGY_THRESHOLD
            print(f"[CALIBRATE] Measuring ambient noise for {seconds}s (pyaudio)...")
            frames_needed = int(RATE * seconds)
            collected = np.array([], dtype=np.int16)
            while collected.size < frames_needed:
                try:
                    chunk = stream.read(CHUNK, exception_on_overflow=False)
                    data = np.frombuffer(chunk, dtype=np.int16)
                except Exception:
                    break
                collected = np.concatenate([collected, data])
            if collected.size == 0:
                return None
            ambient = float(np.sqrt(np.mean(np.square(collected.astype(np.float32)))))
            return ambient

        ambient = calibrate_ambient_pyaudio()
        if ambient is not None:
            new_thresh = max(50.0, ambient * CALIBRATION_MULTIPLIER)
            print(f"[CALIBRATE] Ambient energy: {ambient:.1f} -> ENERGY_THRESHOLD set to {new_thresh:.1f}")
            ENERGY_THRESHOLD = new_thresh
else:
    print("No microphone backend is installed; wake word detection will run in idle WebSocket mode.")


async def notify_clients():
    if connected_clients:
        message = json.dumps(
            {"event": "WAKE_WORD_DETECTED", "timestamp": datetime.now().isoformat()}
        )
        await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )
        print(f"[WS] Notified {len(connected_clients)} client(s)")


async def handler(websocket):
    global last_detection_time

    connected_clients.add(websocket)
    client_addr = websocket.remote_address
    print(f"[WS] Client connected: {client_addr}")
    print(f"[WS] Total clients: {len(connected_clients)}")

    try:
        # Accept incoming messages so clients can upload audio for testing.
        async for message in websocket:
            try:
                # Binary messages: audio file bytes (WAV/M4A/etc. via librosa)
                if isinstance(message, (bytes, bytearray)):
                    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp:
                        tmp.write(message)
                        tmp_path = tmp.name
                    try:
                        current_time = time.time()

                        with open(tmp_path, "rb") as f:
                            wav_bytes_raw = f.read()

                        try:
                            samples = audio_file_to_int16_mono(tmp_path)
                        except Exception as load_err:
                            print(f"[WS] Could not decode audio clip: {load_err}")
                            await websocket.send(json.dumps({"event": "ERROR", "detail": "invalid_audio"}))
                            continue

                        is_wake = False
                        wake_score = 0.0
                        text = ""

                        if model is not None:
                            wake_score = clip_max_openwakeword_score(model, samples)
                            if wake_score >= DETECTION_THRESHOLD and (current_time - last_detection_time > COOLDOWN_SECONDS):
                                is_wake = True
                                last_detection_time = current_time
                                display_transcription(f"(openwakeword score={wake_score:.2f})", 0.0, is_wake_word=True)

                        if not is_wake and groq_client is not None:
                            try:
                                bio = io.BytesIO(wav_bytes_raw)
                                bio.seek(0)
                                transcript = groq_client.audio.transcriptions.create(
                                    file=("audio.wav", bio, "audio/wav"),
                                    model="whisper-large-v3-turbo",
                                    language="en",
                                )
                                text = transcript.text.strip()
                                display_transcription(text, 0.0)
                                if is_hey_navexa(text):
                                    if current_time - last_detection_time > COOLDOWN_SECONDS:
                                        is_wake = True
                                        last_detection_time = current_time
                                        display_transcription(text, 0.0, is_wake_word=True)
                            except Exception as e:
                                print(f"[WS] Groq transcription error: {e}")

                        energy = float(np.sqrt(np.mean(np.square(samples.astype(np.float32)))))

                        if is_wake:
                            await notify_clients()
                            await websocket.send(
                                json.dumps(
                                    {
                                        "event": "TRANSCRIPTION",
                                        "text": text,
                                        "wake": True,
                                        "score": wake_score,
                                        "energy": energy,
                                    }
                                )
                            )
                        else:
                            await websocket.send(json.dumps({"event": "NO_DETECTION", "energy": energy}))
                    finally:
                        try:
                            os.unlink(tmp_path)
                        except Exception:
                            pass
                else:
                    # text messages are informational; echo back
                    print(f"[WS] Text from {client_addr}: {message}")
                    await websocket.send(json.dumps({"event": "ECHO", "message": str(message)}))
            except Exception as e:
                print(f"[WS] Error processing message from {client_addr}: {e}")
                await websocket.send(json.dumps({"event": "ERROR", "detail": str(e)}))
    except Exception as e:
        print(f"[WS] Handler error: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Client disconnected: {client_addr}")
        print(f"[WS] Total clients: {len(connected_clients)}")


def audio_loop(loop):
    global last_detection_time
    print("Audio detection loop started. Listening for 'Hey Navexa'...")

    if stream is None:
        while True:
            with suppress(Exception):
                time.sleep(1)
            continue

    audio_buffer = np.array([], dtype=np.int16)
    buffer_duration = 0
    chunk_count = 0
    debug_interval = 10  # Print debug every 10 chunks

    while True:
        try:
            if SOUNDDEVICE_AVAILABLE:
                audio_data, _overflowed = stream.read(CHUNK)
                audio_data = np.asarray(audio_data, dtype=np.int16).reshape(-1)
            else:
                chunk = stream.read(CHUNK, exception_on_overflow=False)
                audio_data = np.frombuffer(chunk, dtype=np.int16)

            current_time = time.time()
            energy = float(np.sqrt(np.mean(np.square(audio_data.astype(np.float32)))))
            chunk_count += 1

            # Prefer OpenWakeWord on the server microphone when the model is loaded
            if model is not None:
                try:
                    preds = model.predict(audio_data)
                    score = max_prediction_score(preds)
                except Exception as pred_err:
                    print(f"[OWW] predict error: {pred_err}")
                    score = 0.0
                if chunk_count % debug_interval == 0:
                    print(f"[DEBUG][OWW] score={score:.3f} thr={DETECTION_THRESHOLD} energy={energy:.1f}")
                if score >= DETECTION_THRESHOLD and (current_time - last_detection_time > COOLDOWN_SECONDS):
                    display_transcription(f"(openwakeword score={score:.2f})", energy, is_wake_word=True)
                    last_detection_time = current_time
                    asyncio.run_coroutine_threadsafe(notify_clients(), loop)
                continue

            # Groq buffering path when no OpenWakeWord model
            if chunk_count % debug_interval == 0:
                buffer_status = f"buffering ({buffer_duration:.1f}s)" if len(audio_buffer) > 0 else "idle"
                print(f"[DEBUG] Energy: {energy:8.1f} | Threshold: {ENERGY_THRESHOLD} | Status: {buffer_status}")

            # Only buffer audio if above energy threshold or force-transcribe enabled
            if energy > ENERGY_THRESHOLD or DEBUG_FORCE_TRANSCRIBE:
                audio_buffer = np.concatenate([audio_buffer, audio_data])
                buffer_duration += len(audio_data) / RATE
                if DEBUG_FORCE_TRANSCRIBE:
                    print(f"  ↳ [BUFFERING-FORCE] +{buffer_duration:.2f}s of audio (force)")
                else:
                    print(f"  ↳ [BUFFERING] +{buffer_duration:.2f}s of audio")

                # When buffer reaches desired duration, transcribe with Groq
                if buffer_duration >= BUFFER_DURATION and groq_client is not None:
                    print(f"  ↳ [TRANSCRIBING] {buffer_duration:.1f}s of audio...")
                    try:
                        # Convert buffer to WAV bytes
                        wav_bytes = io.BytesIO()
                        with wave.open(wav_bytes, "wb") as wav_file:
                            wav_file.setnchannels(CHANNELS)
                            wav_file.setsampwidth(2)
                            wav_file.setframerate(RATE)
                            wav_file.writeframes(audio_buffer.tobytes())

                        wav_bytes.seek(0)

                        # Transcribe with Groq Whisper
                        try:
                            transcript = groq_client.audio.transcriptions.create(
                                file=("audio.wav", wav_bytes, "audio/wav"),
                                model="whisper-large-v3-turbo",
                                language="en",
                            )

                            text = transcript.text.strip()
                            if text:  # Only display if non-empty
                                display_transcription(text, energy)

                                # Check for "hey navexa" keyword
                                if is_hey_navexa(text):
                                    if current_time - last_detection_time > COOLDOWN_SECONDS:
                                        display_transcription(text, energy, is_wake_word=True)
                                        last_detection_time = current_time
                                        asyncio.run_coroutine_threadsafe(notify_clients(), loop)
                            else:
                                print(f"  ↳ [NO_SPEECH] Transcription was empty")
                        except Exception as transcribe_error:
                            print(f"  ↳ [TRANSCRIPTION_ERROR] {type(transcribe_error).__name__}: {transcribe_error}")

                        # Reset buffer
                        audio_buffer = np.array([], dtype=np.int16)
                        buffer_duration = 0

                    except Exception as e:
                        print(f"[ERROR] Transcription failed: {e}")
                        audio_buffer = np.array([], dtype=np.int16)
                        buffer_duration = 0
            else:
                # Reset buffer when energy drops below threshold
                if len(audio_buffer) > 0:
                    audio_buffer = np.array([], dtype=np.int16)
                    buffer_duration = 0

        except Exception as e:
            print(f"[ERROR] Audio loop: {e}")
            continue


async def main():
    loop = asyncio.get_event_loop()

    audio_thread = threading.Thread(target=audio_loop, args=(loop,), daemon=True)
    audio_thread.start()

    print(f"Wake word WebSocket server starting on ws://0.0.0.0:{WEBSOCKET_PORT}")
    print(f"Detection threshold: {DETECTION_THRESHOLD}")
    print(f"Cooldown: {COOLDOWN_SECONDS} seconds")
    print("Say 'Hey Navexa' to test!")

    async with websockets.serve(handler, "0.0.0.0", WEBSOCKET_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
