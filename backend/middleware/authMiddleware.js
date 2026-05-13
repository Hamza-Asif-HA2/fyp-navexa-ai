const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("No token provided in Authorization header");
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];
    console.log("Verifying token...");

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.error("JWT verification failed:", jwtError.message);
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    console.log("Token verified for userId:", decoded.userId);

    const user = await User.findById(decoded.userId);

    if (!user) {
      console.error("User not found for decoded userId:", decoded.userId);
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.isVerified) {
      console.warn("User email not verified:", user.email);
      return res.status(401).json({
        success: false,
        message: "Email not verified",
      });
    }

    console.log("User authenticated:", user.email);
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Authentication error",
    });
  }
};

module.exports = { protect };
