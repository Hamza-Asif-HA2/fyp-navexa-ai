const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { protect } = require("../middleware/authMiddleware");
const User = require("../models/User");

const router = express.Router();

// Spotify API configuration
const SPOTIFY_BASE_URL = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const DEFAULT_SPOTIFY_APP_REDIRECT_URI = "navexa://spotify/callback";
const DEFAULT_SPOTIFY_CALLBACK_REDIRECT_URI = "http://localhost:5000/api/media/spotify/callback";

/**
 * Helper: Get valid Spotify access token, refresh if needed
 */
const getValidToken = async (userId) => {
	const user = await User.findById(userId).select("spotifyAuth");
	if (!user || !user.spotifyAuth?.accessToken) {
		throw new Error("Spotify not connected");
	}

	const { accessToken, refreshToken, expiresAt } = user.spotifyAuth;

	// Check if token is expired
	if (new Date() > new Date(expiresAt)) {
		if (!refreshToken) {
			throw new Error("Refresh token not available");
		}

		try {
			const refreshResponse = await axios.post(
				SPOTIFY_TOKEN_URL,
				new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
				}),
				{
					headers: {
						Authorization: `Basic ${Buffer.from(
							`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
						).toString("base64")}`,
						"Content-Type": "application/x-www-form-urlencoded",
					},
					timeout: 10000,
				}
			);

			const newTokens = refreshResponse.data;
			await User.findByIdAndUpdate(userId, {
				$set: {
					"spotifyAuth.accessToken": newTokens.access_token,
					"spotifyAuth.expiresAt": new Date(Date.now() + (newTokens.expires_in || 3600) * 1000),
				},
			});

			return newTokens.access_token;
		} catch (error) {
			console.error("[MEDIA] Spotify token refresh failed:", error.message);
			throw new Error("Failed to refresh Spotify token");
		}
	}

	return accessToken;
};

const createSpotifyStateToken = (userId, appRedirectUri) => {
	return jwt.sign(
		{ userId, provider: "spotify", appRedirectUri },
		process.env.JWT_SECRET,
		{ expiresIn: "10m" }
	);
};

const readSpotifyStateToken = (state) => {
	const decoded = jwt.verify(state, process.env.JWT_SECRET);
	if (!decoded?.userId) {
		throw new Error("Invalid Spotify state token");
	}
	return {
		userId: decoded.userId,
		appRedirectUri: decoded.appRedirectUri,
	};
};

const buildAppRedirect = (targetUri, query = {}) => {
	const params = new URLSearchParams(query);
	const suffix = params.toString();
	const redirectTarget = targetUri || DEFAULT_SPOTIFY_APP_REDIRECT_URI;
	return suffix ? `${redirectTarget}${redirectTarget.includes("?") ? "&" : "?"}${suffix}` : redirectTarget;
};

const resolveSpotifyRedirectUri = (requestedRedirectUri) => {
	const configuredRedirectUri = process.env.SPOTIFY_REDIRECT_URI;
	const redirectUri = String(requestedRedirectUri || configuredRedirectUri || DEFAULT_SPOTIFY_CALLBACK_REDIRECT_URI).trim();

	if (
		!redirectUri ||
		redirectUri.startsWith("undefined") ||
		redirectUri.startsWith("null") ||
		redirectUri.includes("localhost") ||
		redirectUri.includes("127.0.0.1")
	) {
		return configuredRedirectUri && !configuredRedirectUri.includes("localhost")
			? configuredRedirectUri
			: DEFAULT_SPOTIFY_CALLBACK_REDIRECT_URI;
	}

	return redirectUri;
};

const resolveAppRedirectUri = (requestedAppRedirectUri) => {
	const appRedirectUri = String(requestedAppRedirectUri || "").trim();

	if (!appRedirectUri || appRedirectUri === "undefined" || appRedirectUri === "null") {
		return DEFAULT_SPOTIFY_APP_REDIRECT_URI;
	}

	return appRedirectUri;
};

const persistSpotifyTokens = async (userId, tokens = {}) => {
	await User.findByIdAndUpdate(userId, {
		$set: {
			"spotifyAuth.accessToken": tokens.access_token,
			"spotifyAuth.refreshToken": tokens.refresh_token || "",
			"spotifyAuth.expiresAt": new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
			"spotifyAuth.isConnected": true,
		},
	});
};

/**
 * GET /api/media/spotify/auth-url
 * Build Spotify OAuth authorization URL
 */
router.get("/spotify/auth-url", protect, async (req, res) => {
	try {
		const clientId = process.env.SPOTIFY_CLIENT_ID;
		const redirectUri = resolveSpotifyRedirectUri();
		const appRedirectUri = resolveAppRedirectUri(req.query?.appRedirectUri);
		const scopes = [
			"user-read-private",
			"user-read-email",
			"user-modify-playback-state",
			"user-read-playback-state",
			"user-read-currently-playing",
			"streaming",
			"playlist-read-private",
			"user-read-recently-played",
		].join(" ");
		const state = createSpotifyStateToken(req.user._id, appRedirectUri);

		if (!clientId || !redirectUri) {
			return res.status(503).json({
				success: false,
				message: "Spotify OAuth not configured",
			});
		}

		const authUrl = `${SPOTIFY_AUTH_URL}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;

		return res.status(200).json({
			success: true,
			url: authUrl,
		});
	} catch (error) {
		console.error("[MEDIA] auth-url error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to build authorization URL",
		});
	}
});

/**
 * POST /api/media/spotify/exchange
 * Exchange an authorization code returned to the app for Spotify tokens.
 */
router.post("/spotify/exchange", protect, async (req, res) => {
	try {
		const { code, redirectUri } = req.body;

		if (!code) {
			return res.status(400).json({
				success: false,
				message: "code is required",
			});
		}

		const clientId = process.env.SPOTIFY_CLIENT_ID;
		const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
		// IMPORTANT: Always use the web callback URI for Spotify's token exchange,
		// not custom app redirect URIs. Spotify only accepts http/https URIs.
		const resolvedRedirectUri = process.env.SPOTIFY_REDIRECT_URI || DEFAULT_SPOTIFY_CALLBACK_REDIRECT_URI;

		if (!clientId || !clientSecret) {
			return res.status(503).json({
				success: false,
				message: "Spotify OAuth not configured",
			});
		}

		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code: String(code),
			redirect_uri: resolvedRedirectUri,
			client_id: clientId,
			client_secret: clientSecret,
		});

		const tokenResponse = await axios.post(SPOTIFY_TOKEN_URL, body, {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			timeout: 10000,
		});

		if (!tokenResponse.data.access_token) {
			return res.status(500).json({
				success: false,
				message: "Failed to exchange Spotify code",
			});
		}

		await persistSpotifyTokens(req.user._id, tokenResponse.data);

		return res.status(200).json({
			success: true,
			connected: true,
		});
	} catch (error) {
		const spotifyError = error.response?.data || error.message;
		console.error("[MEDIA] spotify exchange error:", JSON.stringify(spotifyError, null, 2));
		return res.status(500).json({
			success: false,
			message: "Failed to exchange Spotify code",
			error: spotifyError,
		});
	}
});

/**
 * GET /api/media/spotify/callback (PUBLIC)
 * Exchange authorization code for tokens
 */
router.get("/spotify/callback", async (req, res) => {
	try {
		const { code, error, state } = req.query || {};
		const fallbackAppRedirectUri = DEFAULT_SPOTIFY_APP_REDIRECT_URI;

		if (error) {
			const appRedirectUri = state ? readSpotifyStateToken(String(state)).appRedirectUri : fallbackAppRedirectUri;
			return res.redirect(buildAppRedirect(appRedirectUri, { error: String(error) }));
		}

		if (!code || !state) {
			return res.redirect(buildAppRedirect(fallbackAppRedirectUri, { error: "missing_code_or_state" }));
		}

		const { userId, appRedirectUri } = readSpotifyStateToken(String(state));
		const clientId = process.env.SPOTIFY_CLIENT_ID;
		const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
		const redirectUri = resolveSpotifyRedirectUri();

		if (!clientId || !clientSecret) {
			console.error("[MEDIA] Spotify credentials not configured");
			return res.redirect(buildAppRedirect(appRedirectUri, { error: "spotify_not_configured" }));
		}

		// Exchange code for tokens
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code: String(code),
			redirect_uri: redirectUri,
			client_id: clientId,
			client_secret: clientSecret,
		});

		const tokenResponse = await axios.post(SPOTIFY_TOKEN_URL, body, {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			timeout: 10000,
		});

		if (!tokenResponse.data.access_token) {
			console.error("[MEDIA] Spotify callback: no access token");
			return res.redirect(buildAppRedirect(appRedirectUri, { error: "spotify_no_token" }));
		}

		// Save tokens to user
		await persistSpotifyTokens(userId, tokenResponse.data);

		return res.redirect(buildAppRedirect(appRedirectUri, { connected: "1" }));
	} catch (error) {
		console.error("[MEDIA] spotify callback error:", error.message);
		return res.redirect(buildAppRedirect(DEFAULT_SPOTIFY_APP_REDIRECT_URI, { error: "spotify_callback_failed" }));
	}
});

/**
 * POST /api/media/spotify/connect
 * Programmatically save Spotify tokens
 */
router.post("/spotify/connect", protect, async (req, res) => {
	try {
		const { accessToken, refreshToken, expiresIn } = req.body;

		if (!accessToken) {
			return res.status(400).json({
				success: false,
				message: "accessToken is required",
			});
		}

		await User.findByIdAndUpdate(req.user._id, {
			$set: {
				"spotifyAuth.accessToken": accessToken,
				"spotifyAuth.refreshToken": refreshToken || "",
				"spotifyAuth.expiresAt": new Date(Date.now() + (expiresIn || 3600) * 1000),
				"spotifyAuth.isConnected": true,
			},
		});

		return res.status(200).json({
			success: true,
		});
	} catch (error) {
		console.error("[MEDIA] spotify connect error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to connect Spotify",
		});
	}
});

/**
 * GET /api/media/now-playing
 * Get currently playing track from Spotify
 */
router.get("/now-playing", protect, async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(200).json({
				success: true,
				isConnected: false,
				track: null,
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			const response = await axios.get(`${SPOTIFY_BASE_URL}/me/player/currently-playing`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
				timeout: 10000,
			});

			if (response.status === 204 || !response.data?.item) {
				return res.status(200).json({
					success: true,
					isConnected: true,
					track: null,
				});
			}

			const item = response.data.item;
			const artists = item.artists?.map((a) => a.name).join(", ") || "Unknown Artist";
			const albumArt = item.album?.images?.[0]?.url || "";

			return res.status(200).json({
				success: true,
				isConnected: true,
				track: {
					name: item.name,
					artist: artists,
					albumArt: albumArt,
					duration: item.duration_ms,
					position: response.data.progress_ms,
					isPlaying: response.data.is_playing,
					uri: item.uri,
				},
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				// Token invalid, mark as disconnected
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify now-playing error:", spotifyError.message);
			return res.status(200).json({
				success: true,
				isConnected: false,
				track: null,
			});
		}
	} catch (error) {
		console.error("[MEDIA] now-playing error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to load current track",
		});
	}
});

/**
 * GET /api/media/search
 * Search for tracks on Spotify
 */
router.get("/search", protect, async (req, res) => {
	try {
		const { q } = req.query;

		if (!q || q.trim().length === 0) {
			return res.status(200).json({
				success: true,
				tracks: [],
			});
		}

		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(200).json({
				success: true,
				tracks: [],
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			const searchQuery = String(q).trim();
			
			// Construct query string
			const encoded_q = encodeURIComponent(searchQuery);
			const queryString = `q=${encoded_q}&type=track&limit=10`;
			const fullUrl = `${SPOTIFY_BASE_URL}/search?${queryString}`;
			
			const response = await axios.get(fullUrl, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
				timeout: 10000,
			});


			const tracks = (response.data.tracks?.items || []).map((track) => ({
				id: track.id,
				name: track.name,
				artist: track.artists?.map((a) => a.name).join(", ") || "Unknown",
				albumArt: track.album?.images?.[0]?.url || "",
				uri: track.uri,
				duration: track.duration_ms,
			}));

			return res.status(200).json({
				success: true,
				tracks: tracks,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			// Search failed silently
			return res.status(200).json({
				success: true,
				tracks: [],
			});
		}
	} catch (error) {
		console.error("[MEDIA] search error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to search tracks",
		});
	}
});

/**
 * POST /api/media/play
 * Play a track or resume playback
 */
router.post("/play", protect, async (req, res) => {
	try {
		const { trackUri, query } = req.body;

		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(400).json({
				success: false,
				message: "Spotify not connected",
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			
			let uris = [];
			if (trackUri) {
				uris = [trackUri];
			} else if (query) {
				// Search for track first
				const encoded_q = encodeURIComponent(query);
				const searchUrl = `${SPOTIFY_BASE_URL}/search?q=${encoded_q}&type=track&limit=1`;
				
				const searchResponse = await axios.get(searchUrl, {
					headers: {
						Authorization: `Bearer ${token}`,
					},
					timeout: 10000,
				});

				if (searchResponse.data.tracks?.items?.[0]?.uri) {
					uris = [searchResponse.data.tracks.items[0].uri];
				}
			}

			if (uris.length === 0) {
				return res.status(400).json({
					success: false,
					message: "No track to play",
				});
			}

			// Play the track
			await axios.put(
				`${SPOTIFY_BASE_URL}/me/player/play`,
				{ uris: uris },
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					timeout: 10000,
				}
			);

			return res.status(200).json({
				success: true,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify play error:", spotifyError.message);
			return res.status(502).json({
				success: false,
				message: "Failed to play track",
			});
		}
	} catch (error) {
		console.error("[MEDIA] play error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to play track",
		});
	}
});

/**
 * POST /api/media/pause
 * Pause playback
 */
router.post("/pause", protect, async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(400).json({
				success: false,
				message: "Spotify not connected",
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			await axios.put(`${SPOTIFY_BASE_URL}/me/player/pause`, {}, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
				timeout: 10000,
			});

			return res.status(200).json({
				success: true,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify pause error:", spotifyError.message);
			return res.status(502).json({
				success: false,
				message: "Failed to pause playback",
			});
		}
	} catch (error) {
		console.error("[MEDIA] pause error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to pause playback",
		});
	}
});

/**
 * POST /api/media/resume
 * Resume playback
 */
router.post("/resume", protect, async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(400).json({
				success: false,
				message: "Spotify not connected",
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			await axios.put(`${SPOTIFY_BASE_URL}/me/player/play`, {}, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
				timeout: 10000,
			});

			return res.status(200).json({
				success: true,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify resume error:", spotifyError.message);
			return res.status(502).json({
				success: false,
				message: "Failed to resume playback",
			});
		}
	} catch (error) {
		console.error("[MEDIA] resume error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to resume playback",
		});
	}
});

/**
 * POST /api/media/skip-next
 * Skip to next track
 */
router.post("/skip-next", protect, async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(400).json({
				success: false,
				message: "Spotify not connected",
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			await axios.post(`${SPOTIFY_BASE_URL}/me/player/next`, {}, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
				timeout: 10000,
			});

			return res.status(200).json({
				success: true,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify skip-next error:", spotifyError.message);
			return res.status(502).json({
				success: false,
				message: "Failed to skip to next track",
			});
		}
	} catch (error) {
		console.error("[MEDIA] skip-next error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to skip to next track",
		});
	}
});

/**
 * POST /api/media/skip-previous
 * Skip to previous track
 */
router.post("/skip-previous", protect, async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(400).json({
				success: false,
				message: "Spotify not connected",
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			await axios.post(`${SPOTIFY_BASE_URL}/me/player/previous`, {}, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
				timeout: 10000,
			});

			return res.status(200).json({
				success: true,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify skip-previous error:", spotifyError.message);
			return res.status(502).json({
				success: false,
				message: "Failed to skip to previous track",
			});
		}
	} catch (error) {
		console.error("[MEDIA] skip-previous error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to skip to previous track",
		});
	}
});

/**
 * POST /api/media/volume
 * Set playback volume (0-100)
 */
router.post("/volume", protect, async (req, res) => {
	try {
		const { volume } = req.body;

		if (volume === undefined || volume === null) {
			return res.status(400).json({
				success: false,
				message: "volume is required (0-100)",
			});
		}

		const vol = Number(volume);
		if (isNaN(vol) || vol < 0 || vol > 100) {
			return res.status(400).json({
				success: false,
				message: "volume must be between 0 and 100",
			});
		}

		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(400).json({
				success: false,
				message: "Spotify not connected",
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			await axios.put(
				`${SPOTIFY_BASE_URL}/me/player/volume`,
				{},
				{
					params: {
						volume_percent: vol,
					},
					headers: {
						Authorization: `Bearer ${token}`,
					},
					timeout: 10000,
				}
			);

			return res.status(200).json({
				success: true,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify volume error:", spotifyError.message);
			return res.status(502).json({
				success: false,
				message: "Failed to set volume",
			});
		}
	} catch (error) {
		console.error("[MEDIA] volume error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to set volume",
		});
	}
});

/**
 * GET /api/media/playlists
 * Get user's playlists
 */
router.get("/playlists", protect, async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("spotifyAuth");
		if (!user?.spotifyAuth?.isConnected) {
			return res.status(200).json({
				success: true,
				playlists: [],
			});
		}

		try {
			const token = await getValidToken(req.user._id);
			const response = await axios.get(`${SPOTIFY_BASE_URL}/me/playlists`, {
				params: {
					limit: 50,
				},
				headers: {
					Authorization: `Bearer ${token}`,
				},
				timeout: 10000,
			});

			const playlists = (response.data.items || []).map((playlist) => {
				const trackCount = playlist.tracks?.total || 0;
				console.log("[MEDIA] Playlist:", playlist.name, "tracks:", trackCount);
				return {
					id: playlist.id,
					name: playlist.name,
					trackCount: trackCount,
					imageUrl: playlist.images?.[0]?.url || "",
				};
			});

			console.log("[MEDIA] Returning playlists:", playlists);
			return res.status(200).json({
				success: true,
				playlists: playlists,
			});
		} catch (spotifyError) {
			if (spotifyError.response?.status === 401) {
				await User.findByIdAndUpdate(req.user._id, {
					$set: { "spotifyAuth.isConnected": false },
				});
			}
			console.error("[MEDIA] Spotify playlists error:", spotifyError.message);
			return res.status(200).json({
				success: true,
				playlists: [],
			});
		}
	} catch (error) {
		console.error("[MEDIA] playlists error:", error.message);
		return res.status(500).json({
			success: false,
			message: "Failed to load playlists",
		});
	}
});

module.exports = router;
