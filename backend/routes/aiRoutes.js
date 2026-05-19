const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const geminiService = require("../services/geminiService");
const groqService = require("../services/groqService");
const elevenLabsService = require("../services/elevenLabsService");
const { protect } = require("../middleware/authMiddleware");
const ConversationHistory = require("../models/ConversationHistory");
const User = require("../models/User");

const router = express.Router();

const audioUploadDir = path.resolve("/tmp/audio");

if (!fs.existsSync(audioUploadDir)) {
	fs.mkdirSync(audioUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, audioUploadDir);
	},
	filename: (req, file, cb) => {
		const extension = path.extname(file.originalname || ".webm") || ".webm";
		cb(null, `${Date.now()}${extension}`);
	},
});

const upload = multer({ storage });

const getTodayRange = () => {
	const start = new Date();
	start.setHours(0, 0, 0, 0);

	const end = new Date();
	end.setHours(23, 59, 59, 999);

	return { start, end };
};

const findOrCreateConversationHistory = async (userId) => {
	const { start, end } = getTodayRange();

	let history = await ConversationHistory.findOne({
		userId,
		createdAt: {
			$gte: start,
			$lte: end,
		},
	});

	if (!history) {
		history = await ConversationHistory.create({
			userId,
			messages: [],
			createdAt: new Date(),
		});
	}

	return history;
};

router.post("/chat", protect, async (req, res) => {
	try {
		const { message, conversationHistory = [], context = {} } = req.body;

		if (!message) {
			return res.status(400).json({
				success: false,
				message: "Message is required",
			});
		}

		let result;
		let provider = "gemini";

		try {
			result = await geminiService.generateResponse(message, conversationHistory, context);
		} catch (geminiError) {
			console.error("[AI] Gemini failed, falling back to Groq:", geminiError.message);
			provider = "groq";
			result = await groqService.generateResponse(message, conversationHistory, context);
		}

		const history = await findOrCreateConversationHistory(req.user._id);

		history.messages.push(
			{
				role: "user",
				content: message,
				intent: "GENERAL_CHAT",
				timestamp: new Date(),
			},
			{
				role: "assistant",
				content: result.text,
				intent: result.intent,
				timestamp: new Date(),
			}
		);

		await history.save();

		console.log("[AI] Message processed, intent:", result.intent);

		return res.status(200).json({
			success: true,
			response: result.text,
			intent: result.intent,
			action: result.action,
			provider,
		});
	} catch (error) {
		console.error("[AI] Chat error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to process AI chat",
		});
	}
});

router.post("/transcribe", protect, upload.single("audio"), async (req, res) => {
	let tempFilePath = null;

	try {
		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Audio file is required",
			});
		}

		tempFilePath = req.file.path;
		const audioBuffer = fs.readFileSync(tempFilePath);
		const mimeType = req.file.mimetype;

		const result = await groqService.transcribeAudio(audioBuffer, mimeType);

		if (!result.transcript || !result.transcript.trim()) {
			return res.status(200).json({
				success: false,
				message: "Could not understand audio",
			});
		}

		return res.status(200).json({
			success: true,
			transcript: result.transcript,
		});
	} catch (error) {
		console.error("[AI] Transcribe error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to transcribe audio",
		});
	} finally {
		if (tempFilePath && fs.existsSync(tempFilePath)) {
			fs.unlinkSync(tempFilePath);
		}
	}
});

router.post("/stream-transcribe", protect, upload.single("audio"), async (req, res) => {
	let tempFilePath = null;

	try {
		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Audio chunk is required",
			});
		}

		tempFilePath = req.file.path;
		const audioBuffer = fs.readFileSync(tempFilePath);
		const mimeType = req.file.mimetype;

		const result = await groqService.transcribeAudio(audioBuffer, mimeType);

		if (!result.transcript || !result.transcript.trim()) {
			return res.status(200).json({
				success: true,
				transcript: "", // empty chunk is ok
			});
		}

		return res.status(200).json({
			success: true,
			transcript: result.transcript,
		});
	} catch (error) {
		console.error("[AI] Stream transcribe error:", error.message);
		return res.status(200).json({
			success: true,
			transcript: "", // return empty instead of error to not break streaming
		});
	} finally {
		if (tempFilePath && fs.existsSync(tempFilePath)) {
			fs.unlinkSync(tempFilePath);
		}
	}
});

router.post("/speak", protect, async (req, res) => {
	try {
		const { text, voiceId } = req.body;

		if (!text) {
			return res.status(400).json({
				success: false,
				message: "Text is required",
			});
		}

		if (text.length > 500) {
			return res.status(400).json({
				success: false,
				message: "Text must be 500 characters or fewer",
			});
		}

		const audioBuffer = await elevenLabsService.textToSpeech(text, voiceId);

		res.setHeader("Content-Type", "audio/mpeg");
		res.setHeader("Content-Disposition", 'inline; filename="speech.mp3"');

		return res.status(200).send(audioBuffer);
	} catch (error) {
		console.error("[AI] Speak error:", error.message);
		const status = error.response?.status;
		const isAuthError = status === 401 || status === 403;

		return res.status(isAuthError ? status : 503).json({
			success: false,
			code: isAuthError ? "TTS_AUTH_FAILED" : "TTS_UNAVAILABLE",
			message: isAuthError ? "TTS auth failed, use device TTS" : "TTS unavailable, use device TTS",
		});
	}
});

router.post("/proactive", protect, async (req, res) => {
	try {
		const { context = {} } = req.body;

		try {
			const result = await geminiService.generateProactiveMessage(context);
			return res.status(200).json({
				success: true,
				message: result.text,
				type: result.type || "general",
			});
		} catch (geminiError) {
			console.error("[AI] Gemini proactive failed, falling back to Groq:", geminiError.message);

			const fallbackResult = await groqService.generateResponse(
				"Generate a short proactive check-in message for the driver.",
				[],
				context
			);

			return res.status(200).json({
				success: true,
				message: fallbackResult.text,
				type: "general",
			});
		}
	} catch (error) {
		console.error("[AI] Proactive error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to generate proactive message",
		});
	}
});

module.exports = router;
