const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const Trip = require("../models/Trip");
const User = require("../models/User");

const router = express.Router();

router.post("/start", protect, async (req, res) => {
	try {
		const { origin, destination } = req.body;

		if (!origin || !destination) {
			return res.status(400).json({
				success: false,
				message: "Origin and destination are required",
			});
		}

		const trip = await Trip.create({
			userId: req.user._id,
			origin,
			destination,
			status: "active",
		});

		console.log("[TRIP] Started for user:", req.user._id);

		return res.status(201).json({
			success: true,
			tripId: trip._id,
			startedAt: trip.startedAt,
		});
	} catch (error) {
		console.error("[TRIP] Start error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to start trip",
		});
	}
});

router.patch("/:tripId/complete", protect, async (req, res) => {
	try {
		const { tripId } = req.params;
		const { distanceKm = 0, durationMinutes = 0 } = req.body;

		const trip = await Trip.findOne({
			_id: tripId,
			userId: req.user._id,
		});

		if (!trip) {
			return res.status(404).json({
				success: false,
				message: "Trip not found",
			});
		}

		trip.status = "completed";
		trip.completedAt = new Date();
		trip.distanceKm = distanceKm;
		trip.durationMinutes = durationMinutes;

		await trip.save();

		await User.findByIdAndUpdate(req.user._id, {
			$inc: {
				"stats.totalKm": Number(distanceKm) || 0,
				"stats.totalTrips": 1,
			},
		});

		console.log("[TRIP] Completed, distance:", distanceKm, "km");

		return res.status(200).json({
			success: true,
			trip,
		});
	} catch (error) {
		console.error("[TRIP] Complete error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to complete trip",
		});
	}
});

router.patch("/:tripId/cancel", protect, async (req, res) => {
	try {
		const { tripId } = req.params;

		const trip = await Trip.findOne({
			_id: tripId,
			userId: req.user._id,
		});

		if (!trip) {
			return res.status(404).json({
				success: false,
				message: "Trip not found",
			});
		}

		trip.status = "cancelled";
		await trip.save();

		return res.status(200).json({
			success: true,
		});
	} catch (error) {
		console.error("[TRIP] Cancel error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to cancel trip",
		});
	}
});

router.get("/history", protect, async (req, res) => {
	try {
		const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
		const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
		const skip = (page - 1) * limit;

		const filter = {
			userId: req.user._id,
			status: "completed",
		};

		const totalTrips = await Trip.countDocuments(filter);
		const trips = await Trip.find(filter)
			.sort({ completedAt: -1 })
			.skip(skip)
			.limit(limit);

		return res.status(200).json({
			success: true,
			trips,
			page,
			totalPages: Math.ceil(totalTrips / limit),
			totalTrips,
		});
	} catch (error) {
		console.error("[TRIP] History error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch trip history",
		});
	}
});

router.get("/stats", protect, async (req, res) => {
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
			totalKm: user.stats?.totalKm || 0,
			totalTrips: user.stats?.totalTrips || 0,
			totalVoiceSignatures: user.voiceSignatures?.length || 0,
		});
	} catch (error) {
		console.error("[TRIP] Stats error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch trip stats",
		});
	}
});

module.exports = router;
