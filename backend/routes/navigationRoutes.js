const express = require("express");
const axios = require("axios");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Google Maps API configuration
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const GOOGLE_MAPS_BASE_URL = "https://maps.googleapis.com/maps/api";

/**
 * GET /api/navigation/autocomplete
 * Search for places using Google Places Autocomplete API
 */
router.get("/autocomplete", protect, async (req, res) => {
	try {
		const { input } = req.query;

		if (!input || input.length < 2) {
			return res.status(400).json({
				success: false,
				message: "Input must be at least 2 characters",
			});
		}

		if (!GOOGLE_MAPS_API_KEY) {
			console.warn("[NAVIGATION] Google Maps API key not configured");
			return res.status(503).json({
				success: false,
				message: "Navigation service unavailable",
			});
		}

		// Call Google Places Autocomplete API
		const response = await axios.get(
			`${GOOGLE_MAPS_BASE_URL}/place/autocomplete/json`,
			{
				params: {
					input: input,
					key: GOOGLE_MAPS_API_KEY,
					components: "country:pk", // Restrict to Pakistan
					language: "en",
				},
				timeout: 10000,
			}
		);

		if (response.data.status !== "OK" && response.data.status !== "ZERO_RESULTS") {
			console.error("[NAVIGATION] Autocomplete API error:", response.data.status, response.data.error_message);
			return res.status(500).json({
				success: false,
				message: "Failed to fetch autocomplete predictions",
			});
		}

		const predictions = (response.data.predictions || []).map((pred) => ({
			description: pred.description,
			placeId: pred.place_id,
		}));

		return res.status(200).json({
			success: true,
			predictions: predictions,
		});
	} catch (error) {
		console.error("[NAVIGATION] Autocomplete error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch autocomplete suggestions",
		});
	}
});

/**
 * POST /api/navigation/geocode
 * Convert address or coordinates to lat/lng using Google Geocoding API
 */
router.post("/geocode", protect, async (req, res) => {
	try {
		const { address } = req.body;

		if (!address || address.trim().length === 0) {
			return res.status(400).json({
				success: false,
				message: "Address is required",
			});
		}

		if (!GOOGLE_MAPS_API_KEY) {
			console.warn("[NAVIGATION] Google Maps API key not configured");
			return res.status(503).json({
				success: false,
				message: "Navigation service unavailable",
			});
		}

		// Call Google Geocoding API
		const response = await axios.get(
			`${GOOGLE_MAPS_BASE_URL}/geocode/json`,
			{
				params: {
					address: address,
					key: GOOGLE_MAPS_API_KEY,
					components: "country:pk", // Restrict to Pakistan
				},
				timeout: 10000,
			}
		);

		if (response.data.status !== "OK") {
			console.warn("[NAVIGATION] Geocoding API returned:", response.data.status);
			return res.status(404).json({
				success: false,
				message: "Address not found",
			});
		}

		const result = response.data.results[0];
		if (!result) {
			return res.status(404).json({
				success: false,
				message: "Address not found",
			});
		}

		const { lat, lng } = result.geometry.location;
		const formattedAddress = result.formatted_address;

		return res.status(200).json({
			success: true,
			location: {
				lat: lat,
				lng: lng,
				address: formattedAddress,
			},
		});
	} catch (error) {
		console.error("[NAVIGATION] Geocode error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to geocode address",
		});
	}
});

/**
 * POST /api/navigation/calculate-route
 * Calculate route between two points using Google Directions API
 */
router.post("/calculate-route", protect, async (req, res) => {
	try {
		const { origin, destination } = req.body;

		if (!origin || !destination) {
			return res.status(400).json({
				success: false,
				message: "Origin and destination are required",
			});
		}

		// Parse origin coordinates or address
		let originString;
		if (origin.lat && origin.lng) {
			originString = `${origin.lat},${origin.lng}`;
		} else if (origin.address) {
			originString = origin.address;
		} else {
			return res.status(400).json({
				success: false,
				message: "Origin must have coordinates (lat, lng) or address",
			});
		}

		// Parse destination coordinates or address
		let destinationString;
		if (destination.lat && destination.lng) {
			destinationString = `${destination.lat},${destination.lng}`;
		} else if (destination.address) {
			destinationString = destination.address;
		} else {
			return res.status(400).json({
				success: false,
				message: "Destination must have coordinates (lat, lng) or address",
			});
		}

		if (!GOOGLE_MAPS_API_KEY) {
			console.warn("[NAVIGATION] Google Maps API key not configured");
			return res.status(503).json({
				success: false,
				message: "Navigation service unavailable",
			});
		}

		// Call Google Directions API
		const response = await axios.get(
			`${GOOGLE_MAPS_BASE_URL}/directions/json`,
			{
				params: {
					origin: originString,
					destination: destinationString,
					key: GOOGLE_MAPS_API_KEY,
					alternatives: false,
				},
				timeout: 10000,
			}
		);

		if (response.data.status !== "OK") {
			console.error("[NAVIGATION] Directions API error:", response.data.status);
			return res.status(500).json({
				success: false,
				message: "Failed to calculate route",
			});
		}

		const route = response.data.routes[0];
		if (!route) {
			return res.status(500).json({
				success: false,
				message: "No route found",
			});
		}

		// Extract route information
		const leg = route.legs[0]; // First and only leg for single origin-destination
		const distance = leg.distance.value / 1000; // Convert meters to km
		const duration = Math.ceil(leg.duration.value / 60); // Convert seconds to minutes

		// Extract polyline (encoded route line for map display)
		const polyline = route.overview_polyline.points;

		// Extract steps (turn-by-turn directions)
		const steps = leg.steps.map((step) => ({
			instruction: step.html_instructions
				.replace(/<[^>]*>/g, "") // Remove HTML tags
				.trim(),
			distance: (step.distance.value / 1000).toFixed(2), // in km
			duration: Math.ceil(step.duration.value / 60), // in minutes
			maneuver: step.maneuver || "continue",
		}));

		// Calculate ETA
		const eta = new Date(Date.now() + duration * 60 * 1000).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
		});

		return res.status(200).json({
			success: true,
			polyline: polyline,
			steps: steps,
			distanceKm: parseFloat(distance.toFixed(2)),
			durationMinutes: duration,
			eta: eta,
		});
	} catch (error) {
		console.error("[NAVIGATION] Calculate route error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to calculate route",
		});
	}
});

module.exports = router;
