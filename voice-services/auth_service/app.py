from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from resemblyzer import VoiceEncoder
from pathlib import Path
import numpy as np
import json
import os
import tempfile
import librosa
import subprocess
from dotenv import load_dotenv
from datetime import datetime

try:
    import imageio_ffmpeg
except Exception:
    imageio_ffmpeg = None


def patch_librosa_for_resemblyzer():
    original_resample = librosa.resample
    original_melspectrogram = librosa.feature.melspectrogram

    def compat_resample(y, *args, **kwargs):
        if len(args) >= 2 and "orig_sr" not in kwargs and "target_sr" not in kwargs:
            kwargs["orig_sr"] = args[0]
            kwargs["target_sr"] = args[1]
            args = args[2:]
        return original_resample(y, *args, **kwargs)

    def compat_melspectrogram(*args, **kwargs):
        if len(args) >= 1 and "y" not in kwargs:
            kwargs["y"] = args[0]
        if len(args) >= 2 and "sr" not in kwargs:
            kwargs["sr"] = args[1]
        return original_melspectrogram(**kwargs)

    librosa.resample = compat_resample
    librosa.feature.melspectrogram = compat_melspectrogram


def configure_audioread_backend():
    # Ensure librosa/audioread can decode AAC/M4A/WebM by exposing an ffmpeg binary.
    if imageio_ffmpeg is None:
        print("[AUDIO] imageio_ffmpeg is not installed; only natively supported formats will decode")
        return

    try:
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_dir = os.path.dirname(ffmpeg_path)
        path_parts = os.environ.get("PATH", "").split(os.pathsep)
        if ffmpeg_dir not in path_parts:
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
        print(f"[AUDIO] ffmpeg backend ready: {ffmpeg_path}")
    except Exception as exc:
        print(f"[AUDIO] Failed to initialize ffmpeg backend: {exc}")


load_dotenv()
patch_librosa_for_resemblyzer()
configure_audioread_backend()

app = FastAPI(title="NavexaAI Voice Auth Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("API_KEY", "navexa_voice_key_2024")
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.75"))
MIN_AUDIO_SECONDS = float(os.getenv("MIN_AUDIO_SECONDS", "0.8"))
EMBEDDINGS_DIR = Path(os.getenv("EMBEDDINGS_DIR", "./embeddings"))
EMBEDDINGS_DIR.mkdir(exist_ok=True)

encoder = VoiceEncoder()
print("Resemblyzer VoiceEncoder loaded successfully")


def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key


def load_embeddings(user_id: str):
    path = EMBEDDINGS_DIR / f"{user_id}.json"
    if not path.exists():
        return []
    with open(path, "r") as f:
        return json.load(f)


def save_embeddings(user_id: str, embeddings: list):
    path = EMBEDDINGS_DIR / f"{user_id}.json"
    with open(path, "w") as f:
        json.dump(embeddings, f)


def cosine_similarity(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def process_audio(audio_bytes: bytes, filename: str | None = None) -> np.ndarray:
    # Save to temp file
    suffix = Path(filename or "audio.wav").suffix or ".wav"
    print(f"[AUDIO] process_audio start filename={filename} suffix={suffix} bytes={len(audio_bytes)}")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    converted_path = None

    try:
        # First attempt direct decode.
        try:
            wav, sr = librosa.load(tmp_path, sr=16000, mono=True)
        except Exception as exc:
            print(f"[AUDIO] Direct decode failed, attempting ffmpeg transcode: {exc}")
            # Fallback: transcode with ffmpeg, then decode the normalized WAV.
            if imageio_ffmpeg is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported audio format. Please upload a valid recording ({exc})",
                ) from exc

            try:
                ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out_tmp:
                    converted_path = out_tmp.name

                cmd = [
                    ffmpeg_path,
                    "-y",
                    "-i",
                    tmp_path,
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    converted_path,
                ]

                result = subprocess.run(
                    cmd,
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )

                if result.returncode != 0:
                    print(f"[AUDIO] ffmpeg transcode failed rc={result.returncode} stderr={result.stderr[:500]}")
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Unsupported audio format. ffmpeg transcode failed: "
                            f"{result.stderr.strip()[:300]}"
                        ),
                    )

                wav, sr = librosa.load(converted_path, sr=16000, mono=True)
                print("[AUDIO] ffmpeg transcode decode succeeded")
            except HTTPException:
                raise
            except Exception as transcode_exc:
                print(f"[AUDIO] Transcode path failed: {transcode_exc}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported audio format. Could not transcode audio ({transcode_exc})",
                ) from transcode_exc

        duration_sec = len(wav) / float(sr)
        print(f"[AUDIO] Decoded waveform duration={duration_sec:.2f}s sr={sr}")

        # Check minimum length
        if duration_sec < MIN_AUDIO_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=f"Audio too short ({duration_sec:.2f}s). Minimum is {MIN_AUDIO_SECONDS:.2f}s",
            )

        # Keep compatibility with newer librosa: avoid resemblyzer.preprocess_wav,
        # which uses a deprecated positional resample call.
        wav = wav.astype(np.float32)
        max_abs = np.max(np.abs(wav))
        if max_abs > 0:
            wav = wav / max_abs

        # Generate embedding
        embedding = encoder.embed_utterance(wav)
        return embedding.tolist()
    finally:
        os.unlink(tmp_path)
        if converted_path and os.path.exists(converted_path):
            os.unlink(converted_path)


@app.get("/health")
async def health():
    return {"status": "ok", "model": "Resemblyzer", "threshold": SIMILARITY_THRESHOLD}


@app.post("/enroll")
async def enroll(
    audio: UploadFile = File(...),
    userId: str = Form(...),
    label: str = Form(...),
    x_api_key: str = Header(...),
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    print(
        f"[ENROLL] userId={userId}, label={label}, filename={audio.filename}, contentType={audio.content_type}"
    )

    audio_bytes = await audio.read()
    try:
        embedding = process_audio(audio_bytes, audio.filename)
    except HTTPException as exc:
        print(f"[ENROLL] Rejecting audio: {exc.detail}")
        raise

    embeddings = load_embeddings(userId)
    embeddings.append(
        {"label": label, "embedding": embedding, "createdAt": datetime.now().isoformat()}
    )
    save_embeddings(userId, embeddings)

    print(f"[ENROLL] Success. Total samples for {userId}: {len(embeddings)}")
    return {"success": True, "label": label, "samplesCount": len(embeddings)}


@app.post("/verify")
async def verify(
    audio: UploadFile = File(...),
    userId: str = Form(...),
    x_api_key: str = Header(...),
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    print(f"[VERIFY] userId={userId}, filename={audio.filename}, contentType={audio.content_type}")

    embeddings = load_embeddings(userId)
    if not embeddings:
        print(f"[VERIFY] No signatures found for {userId}")
        return {"authenticated": False, "confidence": 0.0, "error": "no_signatures"}

    audio_bytes = await audio.read()
    try:
        input_embedding = process_audio(audio_bytes, audio.filename)
    except HTTPException as exc:
        print(f"[VERIFY] Rejecting audio: {exc.detail}")
        raise

    max_similarity = 0.0
    matched_label = None

    for entry in embeddings:
        similarity = cosine_similarity(input_embedding, entry["embedding"])
        print(f"[VERIFY] Label={entry['label']}, similarity={similarity:.3f}")
        if similarity > max_similarity:
            max_similarity = similarity
            matched_label = entry["label"]

    authenticated = max_similarity >= SIMILARITY_THRESHOLD
    print(f"[VERIFY] Result: authenticated={authenticated}, confidence={max_similarity:.3f}")

    return {
        "authenticated": authenticated,
        "confidence": round(max_similarity, 3),
        "matchedLabel": matched_label if authenticated else None,
    }


@app.delete("/signature")
async def delete_signature(
    userId: str,
    label: str,
    x_api_key: str = Header(...),
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    embeddings = load_embeddings(userId)
    original_count = len(embeddings)
    embeddings = [e for e in embeddings if e["label"] != label]

    if len(embeddings) == original_count:
        raise HTTPException(status_code=404, detail="Signature not found")

    save_embeddings(userId, embeddings)
    print(f"[DELETE] Removed signature '{label}' for user {userId}")
    return {"success": True, "message": f"Signature '{label}' removed"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
