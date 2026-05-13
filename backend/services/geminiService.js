const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "");
const GEMINI_MODEL_FALLBACKS = [
  process.env.GEMINI_MODEL,
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
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

const buildConversationContents = (conversationHistory = [], userMessage, context = {}) => {
  const recentHistory = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-10)
    : [];

  const contents = [];

  recentHistory.forEach((message) => {
    if (!message || !message.role || !message.content) {
      return;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message.content) }],
    });
  });

  const contextString = buildContextString(context);
  const finalUserPrompt = `User message: ${userMessage}${contextString}`;

  contents.push({
    role: "user",
    parts: [{ text: finalUserPrompt }],
  });

  return contents;
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

const buildSystemInstruction = (context = {}) => {
  const contextString = buildContextString(context);

  return `${NAVEXA_SYSTEM_PROMPT}${contextString}`;
};

const shouldTryNextModel = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("not found") || message.includes("not supported");
};

const generateWithFallbackModels = async ({ contents, systemInstruction, maxOutputTokens }) => {
  let lastError;

  for (const modelName of GEMINI_MODEL_FALLBACKS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });

      const result = await model.generateContent({
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens,
        },
        systemInstruction,
      });

      return result;
    } catch (error) {
      lastError = error;

      if (!shouldTryNextModel(error)) {
        throw error;
      }

      console.warn(`[GEMINI] Model '${modelName}' unavailable, trying fallback`);
    }
  }

  throw lastError || new Error("No Gemini model candidates available");
};

const generateResponse = async (userMessage, conversationHistory = [], context = {}) => {
  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const systemInstruction = buildSystemInstruction(context);
    const contents = buildConversationContents(conversationHistory, userMessage, context);

    const result = await generateWithFallbackModels({
      contents,
      systemInstruction,
      maxOutputTokens: 256,
    });

    const responseText = result.response.text();
    const parsed = parseResponse(responseText);

    console.log("[GEMINI] Intent:", parsed.intent);

    return parsed;
  } catch (error) {
    console.error("[GEMINI] Error generating response:", error.message);
    throw error;
  }
};

const generateProactiveMessage = async (context = {}) => {
  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const prompt = `Generate a short friendly proactive check-in message for
      the driver based on this context. Make it natural and contextual.
      Respond in JSON: { text: string, type: 'safety'|'entertainment'|'navigation'|'general' }`;

    const systemInstruction = `${NAVEXA_SYSTEM_PROMPT}\n\n${prompt}\n\nContext: ${JSON.stringify(context)}`;

    const result = await generateWithFallbackModels({
      contents: [
        {
          role: "user",
          parts: [{ text: "Generate a proactive check-in message." }],
        },
      ],
      systemInstruction,
      maxOutputTokens: 128,
    });

    const responseText = result.response.text();

    try {
      return JSON.parse(extractJsonPayload(responseText));
    } catch (parseError) {
      return {
        text: String(responseText || ""),
        type: "general",
      };
    }
  } catch (error) {
    console.error("[GEMINI] Error generating proactive message:", error.message);
    throw error;
  }
};

module.exports = {
  generateResponse,
  generateProactiveMessage,
};
