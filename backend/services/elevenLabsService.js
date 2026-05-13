const axios = require("axios");

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

const getVoiceId = (voiceId) => {
  const selectedVoiceId = voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  return selectedVoiceId || DEFAULT_VOICE_ID;
};

const textToSpeech = async (text, voiceId) => {
  try {
    if (!text) {
      throw new Error("Text is required for text-to-speech");
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    const selectedVoiceId = getVoiceId(voiceId);
    const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${selectedVoiceId}`;

    const response = await axios.post(
      url,
      {
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
      }
    );

    console.log("[ELEVENLABS] Generated speech for:", text.substring(0, 50));

    return Buffer.from(response.data);
  } catch (error) {
    const statusText = error.response?.status ? ` (status ${error.response.status})` : "";
    if (error.response?.status === 401 || error.response?.status === 403) {
      console.warn(`[ELEVENLABS] Auth failed${statusText}; falling back to device TTS on the client.`);
    } else {
      console.error(`[ELEVENLABS] Error generating speech${statusText}:`, error.message);
    }
    throw error;
  }
};

const getVoices = async () => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    const response = await axios.get(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
    });

    return response.data;
  } catch (error) {
    const statusText = error.response?.status ? ` (status ${error.response.status})` : "";
    console.error(`[ELEVENLABS] Error fetching voices${statusText}:`, error.message);
    throw error;
  }
};

module.exports = {
  textToSpeech,
  getVoices,
};
