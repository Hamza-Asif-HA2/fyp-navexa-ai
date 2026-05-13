const express = require("express");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { protect } = require("../middleware/authMiddleware");
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

const getFormDataConstructor = () => {
	if (typeof FormData !== "undefined") {
		return FormData;
	}

	throw new Error("FormData is not available in this runtime");
};

const getBlobConstructor = () => {
	if (typeof Blob !== "undefined") {
		return Blob;
	}

	throw new Error("Blob is not available in this runtime");
};

const callVoiceAuthService = async (endpoint, formData) => {
	const url = `${process.env.VOICE_AUTH_SERVICE_URL}${endpoint}`;
	const maxRetries = 3;

	for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
		try {
			const response = await axios.post(url, formData, {
				headers: {
					...formData.getHeaders?.(),
					"X-API-Key": process.env.VOICE_AUTH_API_KEY,
				},
				timeout: 15000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
			});

			return response.data;
		} catch (error) {
			const status = error.response?.status;
			const data = error.response?.data;
			console.error(
				`[VOICE] Service call failed (attempt ${attempt}/${maxRetries}):`,
				error.message,
				status ? `status=${status}` : "",
				data ? `data=${JSON.stringify(data)}` : ""
			);

			if (attempt === maxRetries) {
				throw error;
			}
		}
	}

	throw new Error("Voice auth service request failed");
};

router.post("/enroll", protect, upload.single("audio"), async (req, res) => {
	let tempFilePath = null;

	try {
		const { label } = req.body;

		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Audio file is required",
			});
		}

		if (!label) {
			return res.status(400).json({
				success: false,
				message: "Label is required",
			});
		}

		tempFilePath = req.file.path;
		const audioBuffer = fs.readFileSync(tempFilePath);

		const FormDataCtor = getFormDataConstructor();
		const BlobCtor = getBlobConstructor();
		const formData = new FormDataCtor();
		const audioBlob = new BlobCtor([audioBuffer], { type: req.file.mimetype || "audio/webm" });

		formData.append("audio", audioBlob, req.file.originalname || "audio.webm");
		formData.append("userId", String(req.user._id));
		formData.append("label", label);

		const result = await callVoiceAuthService("/enroll", formData);

		req.user.voiceSignatures.push({
			label,
			enrolledAt: new Date(),
		});

		await req.user.save();

		console.log("[VOICE] Enrolled voice for user:", req.user._id, "label:", label);

		return res.status(200).json({
			success: true,
			label,
			message: result.message || "Voice enrolled successfully",
		});
	} catch (error) {
		console.error("[VOICE] Enroll error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to enroll voice",
		});
	} finally {
		if (tempFilePath && fs.existsSync(tempFilePath)) {
			fs.unlinkSync(tempFilePath);
		}
	}
});

router.post("/verify", protect, upload.single("audio"), async (req, res) => {
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

		const FormDataCtor = getFormDataConstructor();
		const BlobCtor = getBlobConstructor();
		const formData = new FormDataCtor();
		const audioBlob = new BlobCtor([audioBuffer], { type: req.file.mimetype || "audio/webm" });

		formData.append("audio", audioBlob, req.file.originalname || "audio.webm");
		formData.append("userId", String(req.user._id));

		const result = await callVoiceAuthService("/verify", formData);

		console.log("[VOICE] Verification result:", result.authenticated, "confidence:", result.confidence);

		return res.status(200).json({
			success: true,
			authenticated: result.authenticated,
			confidence: result.confidence,
		});
	} catch (error) {
		console.error("[VOICE] Verify error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to verify voice",
		});
	} finally {
		if (tempFilePath && fs.existsSync(tempFilePath)) {
			fs.unlinkSync(tempFilePath);
		}
	}
});

router.get("/signatures", protect, async (req, res) => {
	try {
		return res.status(200).json({
			success: true,
			signatures: req.user.voiceSignatures || [],
		});
	} catch (error) {
		console.error("[VOICE] Get signatures error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch voice signatures",
		});
	}
});

router.delete("/signature/:label", protect, async (req, res) => {
	try {
		const { label } = req.params;

		const signatureIndex = req.user.voiceSignatures.findIndex(
			(signature) => signature.label === label
		);

		if (signatureIndex === -1) {
			return res.status(404).json({
				success: false,
				message: "Voice signature not found",
			});
		}

		req.user.voiceSignatures.splice(signatureIndex, 1);
		await req.user.save();

		try {
			await axios.delete(`${process.env.VOICE_AUTH_SERVICE_URL}/signature`, {
				data: {
					userId: String(req.user._id),
					label,
				},
				headers: {
					"X-API-Key": process.env.VOICE_AUTH_API_KEY,
					"Content-Type": "application/json",
				},
				timeout: 15000,
			});
		} catch (serviceError) {
			console.error("[VOICE] Failed to delete remote signature:", serviceError.message);
		}

		return res.status(200).json({
			success: true,
			message: "Voice signature removed",
		});
	} catch (error) {
		console.error("[VOICE] Delete signature error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to remove voice signature",
		});
	}
});

module.exports = router;
