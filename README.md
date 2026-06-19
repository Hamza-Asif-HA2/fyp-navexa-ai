# NavexaAI 🚗🎙️

**A voice-first AI driving assistant** that lets drivers interact with their phone hands-free — navigation, calls, messages, and general queries — triggered by a custom wake word ("Hey Navexa") and powered by state-of-the-art LLMs.

Built as a Final Year Project at Lahore Garrison University.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running the App](#running-the-app)
- [How It Works](#how-it-works)
- [Roadmap](#roadmap)
- [Author](#author)

---

## Overview

NavexaAI is a mobile driving assistant designed to minimize driver distraction by enabling fully voice-driven interaction. Instead of touching the screen, drivers say **"Hey Navexa"** to activate the assistant, then speak naturally — asking for directions, sending messages, making calls, or asking general questions — and get a spoken response back.

The system combines:
- A custom-trained **wake word detection model** running locally for low-latency, always-on listening.
- **Speech-to-text** via Groq's Whisper API for fast transcription.
- **LLM-powered intent understanding and conversation** via Gemini (primary) with a Groq LLaMA fallback.
- **Text-to-speech** via Android's built-in TTS engine for spoken responses.

---

## Features

- 🎤 **Hands-free wake word activation** — "Hey Navexa" triggers listening without touching the device.
- 🗣️ **Natural voice conversations** — ask questions, give commands, and get spoken answers.
- 🧭 **Navigation assistance** — voice-driven directions and route queries.
- 💬 **Messaging & calling support** — send messages and place calls via voice.
- 🔄 **Dual-LLM fallback system** — Gemini 2.0 Flash as the primary model, with automatic fallback to Groq LLaMA for reliability.
- ⚡ **Low-latency STT** — Groq-hosted Whisper for near-real-time transcription.
- 🔌 **Real-time backend** — Python WebSocket server handles continuous audio streaming and wake word inference.
- 🎨 **Custom mobile UI** — built with React Native/Expo for a deep-space cockpit-style interface.

---

## Architecture

```
┌─────────────────────┐
│   Mobile App (RN)    │
│  - Audio capture      │
│  - UI / Voice pipeline│
│  - Zustand state mgmt │
└──────────┬───────────┘
           │ WebSocket (audio stream)
           ▼
┌─────────────────────┐
│ Python WebSocket Svr  │
│ - Wake word detection │
│   (hey_navexa.onnx)   │
│ - Streams audio frames │
└──────────┬───────────┘
           │ triggers on wake word
           ▼
┌─────────────────────┐
│  Node.js / Express    │
│       Backend         │
│ - Auth & session mgmt │
│ - Routes STT → LLM →  │
│   response             │
│ - MongoDB Atlas        │
└──────────┬───────────┘
           │
   ┌───────┴────────┐
   ▼                ▼
Groq Whisper     Gemini 2.0 Flash
  (STT)          (primary LLM)
                     │
                     ▼ (fallback)
                Groq LLaMA
                     │
                     ▼
            Android built-in TTS
              (spoken response)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile App | React Native, Expo |
| State Management | Zustand |
| Backend API | Node.js, Express.js |
| Database | MongoDB Atlas |
| Wake Word Detection | Custom ONNX model (`hey_navexa.onnx`), Python WebSocket server |
| Speech-to-Text | Groq Whisper API |
| LLM (Primary) | Gemini 2.0 Flash |
| LLM (Fallback) | Groq LLaMA |
| Text-to-Speech | Android built-in TTS |
| Deployment | Render (backend) |

---

## Project Structure

```
fyp-navexa-ai/
├── mobile-app/              # React Native / Expo frontend
│   ├── src/
│   │   ├── components/
│   │   ├── screens/
│   │   ├── store/            # Zustand state
│   │   └── hooks/             # voice pipeline hooks
│   └── app.json
├── backend/                  # Node.js / Express API server
│   ├── routes/
│   ├── controllers/
│   ├── models/                # MongoDB schemas
│   └── server.js
├── wakeword-server/           # Python WebSocket server
│   ├── hey_navexa.onnx        # custom wake word model
│   ├── server.py
│   └── requirements.txt
└── README.md
```

> Note: adjust folder names above to match your actual repo layout if it differs.

---

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm or yarn
- Python 3.9+
- Expo CLI (`npm install -g expo-cli`)
- MongoDB Atlas account (or local MongoDB instance)
- API keys for:
  - Gemini API
  - Groq API (Whisper STT + LLaMA fallback)
- Android device/emulator (for testing TTS and mic input)

### Installation

Clone the repository:

```bash
git clone https://github.com/Hamza-Asif-HA2/fyp-navexa-ai.git
cd fyp-navexa-ai
```

**1. Backend setup**

```bash
cd backend
npm install
```

**2. Mobile app setup**

```bash
cd ../mobile-app
npm install
```

**3. Wake word server setup**

```bash
cd ../wakeword-server
python -m venv venv
source venv/bin/activate      # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Environment Variables

Create a `.env` file in the **backend** directory:

```env
PORT=5000
MONGODB_URI=your_mongodb_atlas_connection_string
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
JWT_SECRET=your_jwt_secret
```

Create a `.env` file in the **mobile-app** directory:

```env
EXPO_PUBLIC_BACKEND_URL=http://your-backend-url:5000
EXPO_PUBLIC_WAKEWORD_WS_URL=ws://your-wakeword-server:8765
```

Create a `.env` file in the **wakeword-server** directory (if applicable):

```env
WS_PORT=8765
MODEL_PATH=./hey_navexa.onnx
```

### Running the App

**1. Start the backend:**

```bash
cd backend
npm start
```

**2. Start the wake word WebSocket server:**

```bash
cd wakeword-server
source venv/bin/activate
python server.py
```

**3. Start the mobile app:**

```bash
cd mobile-app
npx expo start
```

Scan the QR code with the Expo Go app, or run on an Android emulator, to launch NavexaAI.

---

## How It Works

1. The mobile app continuously streams microphone audio frames to the **Python WebSocket server**.
2. The server runs the custom **`hey_navexa.onnx`** model on incoming audio to detect the wake word in real time.
3. Once "Hey Navexa" is detected, the app begins capturing the user's spoken command and sends the audio to the **Node.js backend**.
4. The backend forwards the audio to **Groq Whisper** for transcription.
5. The transcribed text is sent to **Gemini 2.0 Flash** for intent understanding and response generation, with automatic fallback to **Groq LLaMA** if Gemini is unavailable.
6. The generated response is sent back to the mobile app and spoken aloud using **Android's built-in TTS** engine.
7. Relevant session/user data is persisted in **MongoDB Atlas**.

---

## Roadmap

- [ ] iOS TTS/STT support
- [ ] Offline wake word fallback mode
- [ ] Multi-language support
- [ ] Improved navigation integration (turn-by-turn voice guidance)
- [ ] On-device LLM option for low-connectivity scenarios

---

## Author

**Hamza Asif**
Final Year CS Student, Lahore Garrison University
📧 hamzaasif0726@gmail.com
🔗 [github.com/Hamza-Asif-HA2](https://github.com/Hamza-Asif-HA2)
