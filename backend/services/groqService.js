const Groq = require("groq-sdk");
const { File } = require("buffer");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: GROQ_API_KEY || "" });
const GROQ_MODEL_FALLBACKS = [
  process.env.GROQ_MODEL,
  "llama-3.3-70b-versatile",
  "mixtral-8x7b-32768",
].filter(Boolean);

const NAVEXA_SYSTEM_PROMPT = `You are Navexa, a friendly AI vehicle companion.
You help drivers navigate, control music, and have casual conversation
— all through voice while they drive.

RESPONSE RULES:
1. Always respond in JSON format ONLY — no markdown, no extra text
2. Keep responses SHORT (1-2 sentences max) — driver is on the road
3. Be warm, friendly, and casual like a co-pilot friend
4. Never mention you are an AI unless directly asked
5. Prioritize driver safety in all responses

ALWAYS respond with this exact JSON structure:
{
  'text': 'your spoken response here',
  'intent': 'one of: GENERAL_CHAT | NAVIGATE_TO | PLAY_MUSIC | NEXT_TRACK | PREV_TRACK | PAUSE_MUSIC | RESUME_MUSIC | VOLUME_UP | VOLUME_DOWN | GET_ETA | CANCEL_NAVIGATION',
  'action': null OR { 'destination': string } OR { 'query': string } OR { 'level': number }
}

INTENT RULES:
- NAVIGATE_TO: user wants directions → action: { destination: 'place name' }
- PLAY_MUSIC: user wants specific song/artist → action: { query: 'search query' }
- VOLUME_UP/DOWN: action: { level: 20 } (change amount)
- GET_ETA: user asking about arrival time → action: null
- All others: action: null`;

const buildContextString = (context = {}) => {
  const contextLines = [];

  if (context.currentLocation) {
    contextLines.push(`Current location: ${JSON.stringify(context.currentLocation)}`);
  }

  if (typeof context.isNavigating !== "undefined") {
    contextLines.push(`Is navigating: ${context.isNavigating}`);
  }

  if (context.currentTrack) {
    contextLines.push(`Current track: ${JSON.stringify(context.currentTrack)}`);
  }

  if (typeof context.drivingMinutes !== "undefined") {
    contextLines.push(`Driving minutes: ${context.drivingMinutes}`);
  }

  if (context.timeOfDay) {
    contextLines.push(`Time of day: ${context.timeOfDay}`);
  }

  return contextLines.length > 0 ? `\n\nCONTEXT:\n${contextLines.join("\n")}` : "";
};

const buildMessages = (userMessage, conversationHistory = [], context = {}) => {
  const recentHistory = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-10)
    : [];

  const messages = [{ role: "system", content: `${NAVEXA_SYSTEM_PROMPT}${buildContextString(context)}` }];

  recentHistory.forEach((message) => {
    if (!message || !message.role || !message.content) {
      return;
    }

    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content),
    });
  });

  messages.push({
    role: "user",
    content: `User message: ${userMessage}`,
  });

  return messages;
};

const extractJsonPayload = (responseText) => {
  const trimmed = String(responseText || "").trim();
  const cleaned = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
};

const parseResponse = (responseText) => {
  const payload = extractJsonPayload(responseText);

  try {
    return JSON.parse(payload);
  } catch (error) {
    return {
      text: String(responseText || ""),
      intent: "GENERAL_CHAT",
      action: null,
    };
  }
};

const shouldTryNextModel = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("decommissioned") || message.includes("not found");
};

const generateWithFallbackModels = async (messages) => {
  let lastError;

  for (const modelName of GROQ_MODEL_FALLBACKS) {
    try {
      const result = await groq.chat.completions.create({
        model: modelName,
        messages,
        temperature: 0.7,
        max_tokens: 256,
      });

      return result;
    } catch (error) {
      lastError = error;

      if (!shouldTryNextModel(error)) {
        throw error;
      }

      console.warn(`[GROQ] Model '${modelName}' unavailable, trying fallback`);
    }
  }

  throw lastError || new Error("No Groq model candidates available");
};

const generateResponse = async (userMessage, conversationHistory = [], context = {}) => {
  try {
    if (!GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    const messages = buildMessages(userMessage, conversationHistory, context);

    const result = await generateWithFallbackModels(messages);

    const responseText = result.choices?.[0]?.message?.content || "";
    const parsed = parseResponse(responseText);

    console.log("[GROQ] Intent:", parsed.intent);

    return parsed;
  } catch (error) {
    console.error("[GROQ] Error generating response:", error.message);
    throw error;
  }
};

const transcribeAudio = async (audioBuffer, mimeType) => {
  try {
    if (!GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    if (!audioBuffer || !audioBuffer.length) {
      throw new Error("Audio buffer is required for transcription");
    }

    const file = new File([audioBuffer], `audio-${Date.now()}.webm`, {
      type: mimeType || "audio/webm",
    });

    const result = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
    });

    const transcript = result.text || "";
    console.log("[WHISPER] Transcript:", transcript);

    return { transcript };
  } catch (error) {
    console.error("[WHISPER] Error transcribing audio:", error.message);
    throw error;
  }
};

module.exports = {
  generateResponse,
  transcribeAudio,
};
