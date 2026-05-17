#!/usr/bin/env python3
"""
Wake word tester with transcription debug layer.
Requires: pip install openai-whisper sounddevice numpy
"""

# from openwakeword.utils import download_models
# download_models()

import numpy as np
import sounddevice as sd
import whisper
import threading
import queue
from openwakeword.model import Model

# Configuration
MODEL_PATH      = "hey_navexa.onnx"
CHUNK           = 1280
CHANNELS        = 1
RATE            = 16000
THRESHOLD       = 0.5
TRANSCRIBE_SECS = 3          # transcribe a buffer every N seconds
FRAMES_PER_SEC  = RATE // CHUNK   # ~12.5 frames/sec at 16kHz/1280

print("=" * 70)
print("🎤 Hey Navexa — Debug Mode (with transcription)")
print("=" * 70)

# ── Load wake word model ────────────────────────────────────────────────────
print("Loading OpenWakeWord model...")
try:
    oww = Model(wakeword_models=[MODEL_PATH], inference_framework="onnx")
    print(f"✅ OpenWakeWord loaded  |  keys: {list(oww.models.keys())}")
except Exception as e:
    print(f"❌ Failed: {e}"); exit(1)

# ── Load Whisper ────────────────────────────────────────────────────────────
print("Loading Whisper (base.en)…")
whisper_model = whisper.load_model("base.en")
print("✅ Whisper loaded")

# ── Transcription worker ────────────────────────────────────────────────────
transcribe_queue: queue.Queue = queue.Queue()

def transcription_worker():
    while True:
        pcm = transcribe_queue.get()
        if pcm is None:
            break
        audio_f32 = pcm.astype(np.float32) / 32768.0
        result = whisper_model.transcribe(audio_f32, fp16=False, language="en")
        text = result["text"].strip()
        if text:
            print(f"\n  📝 Whisper heard: \"{text}\"\n")
        else:
            print(f"\n  📝 Whisper: (silence / nothing recognised)\n")

threading.Thread(target=transcription_worker, daemon=True).start()

# ── Main loop ───────────────────────────────────────────────────────────────
print()
print("Listening — say 'Hey Navexa'   |   Ctrl-C to quit")
print("=" * 70)

TRANSCRIBE_EVERY = FRAMES_PER_SEC * TRANSCRIBE_SECS   # frames between each Whisper call
transcribe_buf   = []
frame_count      = 0
detection_count  = 0

def rms_bar(pcm, width=20):
    rms = np.sqrt(np.mean(pcm.astype(np.float32) ** 2))
    level = int(min(rms / 3000, 1.0) * width)   # 3000 ≈ comfortable speech
    return f"[{'█' * level}{'░' * (width - level)}] {rms:6.0f}"

try:
    with sd.InputStream(samplerate=RATE, channels=CHANNELS,
                        blocksize=CHUNK, dtype='int16') as stream:
        while True:
            audio_data, _ = stream.read(CHUNK)
            audio_data = np.asarray(audio_data, dtype=np.int16).reshape(-1)

            prediction   = oww.predict(audio_data)
            score        = float(max(
                (v for v in prediction.values() if isinstance(v, (int, float, np.number))),
                default=0.0
            ))

            frame_count += 1
            transcribe_buf.append(audio_data.copy())

            # ── Print every 20 frames (~1.6 s) ──────────────────────────────
            if frame_count % 20 == 0:
                bar = rms_bar(audio_data)
                detected = score >= THRESHOLD
                if detected:
                    detection_count += 1
                status = "✅ DETECTED!" if detected else "❌ no match"
                print(f"[{frame_count:05d}] score={score:.3f}  mic={bar}  {status}")

            # ── Send to Whisper every TRANSCRIBE_EVERY frames ────────────────
            if frame_count % TRANSCRIBE_EVERY == 0:
                combined = np.concatenate(transcribe_buf)
                transcribe_queue.put(combined)
                transcribe_buf = []

except KeyboardInterrupt:
    transcribe_queue.put(None)   # stop worker

print()
print("=" * 70)
print(f"Done  |  frames={frame_count}  detections={detection_count}")
print("=" * 70)