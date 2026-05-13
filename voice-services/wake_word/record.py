"""Simple microphone recorder for wake-word testing.

This script prefers PyAudio, but it does not crash on import if PyAudio is
missing. Install PyAudio or pyaudio-wheels to enable recording.
"""

import wave
import importlib.util

CHUNK = 1024
CHANNELS = 1
RATE = 16000
RECORD_SECONDS = 4
OUTPUT_FILE = "test_audio.wav"

try:
    pyaudio_spec = importlib.util.find_spec("pyaudio")
    if pyaudio_spec is None:
        raise ModuleNotFoundError("pyaudio")
    pyaudio = importlib.util.module_from_spec(pyaudio_spec)
    assert pyaudio_spec.loader is not None
    pyaudio_spec.loader.exec_module(pyaudio)
except Exception as exc:
    pyaudio = None
    PY_AUDIO_ERROR = exc
else:
    PY_AUDIO_ERROR = None


def record_with_pyaudio() -> None:
    format_ = pyaudio.paInt16
    audio = pyaudio.PyAudio()
    stream = audio.open(
        format=format_,
        channels=CHANNELS,
        rate=RATE,
        input=True,
        frames_per_buffer=CHUNK,
    )

    print("Recording for 4 seconds... Speak now!")
    frames = [stream.read(CHUNK) for _ in range(0, int(RATE / CHUNK * RECORD_SECONDS))]
    print("Done!")

    stream.stop_stream()
    stream.close()
    sample_width = audio.get_sample_size(format_)
    audio.terminate()

    with wave.open(OUTPUT_FILE, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(sample_width)
        wf.setframerate(RATE)
        wf.writeframes(b"".join(frames))

    print(f"Saved to {OUTPUT_FILE}")


def main() -> None:
    if pyaudio is None:
        print("PyAudio is not installed or could not be imported.")
        print(f"Import error: {PY_AUDIO_ERROR}")
        print("Try one of these commands:")
        print("  pip install pyaudio-wheels")
        print("  pip install pyaudio")
        return

    record_with_pyaudio()


if __name__ == "__main__":
    main()