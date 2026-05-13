const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const User = require("../models/User");

const router = express.Router();

router.get("/", protect, async (req, res) => {
	try {
		const user = await User.findById(req.user._id);

		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User not found",
			});
		}

		return res.status(200).json({
			success: true,
			settings: user.settings,
			profile: user.toSafeObject(),
		});
	} catch (error) {
		console.error("[SETTINGS] Get error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch settings",
		});
	}
});

router.patch("/", protect, async (req, res) => {
	try {
		const { proactiveIntervalMinutes, ttsVoiceId, isProactiveEnabled } = req.body;

		if (typeof proactiveIntervalMinutes !== "undefined") {
			req.user.settings.proactiveIntervalMinutes = proactiveIntervalMinutes;
		}

		if (typeof ttsVoiceId !== "undefined") {
			req.user.settings.ttsVoiceId = ttsVoiceId;
		}

		if (typeof isProactiveEnabled !== "undefined") {
			req.user.settings.isProactiveEnabled = isProactiveEnabled;
		}

		await req.user.save();

		return res.status(200).json({
			success: true,
			settings: req.user.settings,
		});
	} catch (error) {
		console.error("[SETTINGS] Update error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to update settings",
		});
	}
});

router.patch("/profile", protect, async (req, res) => {
	try {
		const { name, email } = req.body;

		if (typeof name !== "undefined") {
			req.user.name = name;
		}

		if (typeof email !== "undefined") {
			const normalizedEmail = String(email).toLowerCase().trim();

			if (normalizedEmail !== req.user.email) {
				const existingUser = await User.findOne({
					email: normalizedEmail,
					_id: { $ne: req.user._id },
				});

				if (existingUser) {
					return res.status(400).json({
						success: false,
						message: "Email already in use",
					});
				}

				req.user.email = normalizedEmail;
			}
		}

		await req.user.save();

		return res.status(200).json({
			success: true,
			user: req.user.toSafeObject(),
		});
	} catch (error) {
		console.error("[SETTINGS] Profile update error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to update profile",
		});
	}
});

router.patch("/password", protect, async (req, res) => {
	try {
		const { currentPassword, newPassword } = req.body;

		if (!currentPassword || !newPassword) {
			return res.status(400).json({
				success: false,
				message: "Current password and new password are required",
			});
		}

		const isCurrentPasswordValid = await req.user.comparePassword(currentPassword);

		if (!isCurrentPasswordValid) {
			return res.status(401).json({
				success: false,
				message: "Current password incorrect",
			});
		}

		req.user.password = newPassword;
		await req.user.save();

		return res.status(200).json({
			success: true,
			message: "Password updated",
		});
	} catch (error) {
		console.error("[SETTINGS] Password update error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to update password",
		});
	}
});

router.delete("/spotify", protect, async (req, res) => {
	try {
		req.user.spotifyAuth = {
			accessToken: undefined,
			refreshToken: undefined,
			expiresAt: undefined,
			isConnected: false,
		};

		await req.user.save();

		return res.status(200).json({
			success: true,
			message: "Spotify disconnected",
		});
	} catch (error) {
		console.error("[SETTINGS] Spotify disconnect error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to disconnect Spotify",
		});
	}
});

module.exports = router;
