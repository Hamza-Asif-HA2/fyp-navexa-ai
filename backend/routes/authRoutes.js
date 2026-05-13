const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");

const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const {
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
} = require("../services/emailService");

const router = express.Router();

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many registration attempts. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    console.log("Register attempt for email:", email);

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required",
      });
    }

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      console.warn("Email already registered:", email);
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const newUser = new User({
      name,
      email: email.toLowerCase(),
      password,
      emailOTP: otp,
      emailOTPExpiry: otpExpiry,
    });

    await newUser.save();
    console.log("New user registered:", email);

    await sendOTPEmail(newUser.email, otp, newUser.name);

    return res.status(201).json({
      success: true,
      message: "OTP sent to email",
      userId: newUser._id,
    });
  } catch (error) {
    console.error("Register error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { userId, otp } = req.body;

    console.log("Verify OTP attempt for userId:", userId);

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "User ID and OTP are required",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      console.error("User not found:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.emailOTP !== otp) {
      console.warn("Invalid OTP for user:", userId);
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (user.emailOTPExpiry < new Date()) {
      console.warn("OTP expired for user:", userId);
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    user.isVerified = true;
    user.emailOTP = null;
    user.emailOTPExpiry = null;

    await user.save();
    console.log("Email verified for user:", user.email);

    await sendWelcomeEmail(user.email, user.name);

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("Verify OTP error:", error.message);
    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
    });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const { userId } = req.body;

    console.log("Resend OTP attempt for userId:", userId);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      console.error("User not found:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.isVerified) {
      console.warn("User already verified:", user.email);
      return res.status(400).json({
        success: false,
        message: "User already verified",
      });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    user.emailOTP = otp;
    user.emailOTPExpiry = otpExpiry;

    await user.save();
    console.log("New OTP generated for user:", user.email);

    await sendOTPEmail(user.email, otp, user.name);

    return res.status(200).json({
      success: true,
      message: "New OTP sent",
    });
  } catch (error) {
    console.error("Resend OTP error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to resend OTP",
    });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log("Login attempt for email:", email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.warn("User not found for login:", email);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (!user.isVerified) {
      console.warn("User email not verified:", email);
      return res.status(401).json({
        success: false,
        message: "Please verify your email first",
      });
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      console.warn("Invalid password for user:", email);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    console.log("User logged in:", email);

    return res.status(200).json({
      success: true,
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    console.log("Forgot password attempt for email:", email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

      user.emailOTP = otp;
      user.emailOTPExpiry = otpExpiry;

      await user.save();
      console.log("Password reset OTP generated for user:", user.email);

      await sendPasswordResetEmail(user.email, otp, user.name);
    } else {
      console.warn("No user found for forgot password:", email);
    }

    return res.status(200).json({
      success: true,
      message: "If email exists, OTP has been sent",
    });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Forgot password failed",
    });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { userId, otp, newPassword } = req.body;

    console.log("Reset password attempt for userId:", userId);

    if (!userId || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "User ID, OTP, and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      console.error("User not found:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.emailOTP !== otp) {
      console.warn("Invalid OTP for reset:", userId);
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (user.emailOTPExpiry < new Date()) {
      console.warn("OTP expired for reset:", userId);
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    user.password = newPassword;
    user.emailOTP = null;
    user.emailOTPExpiry = null;

    await user.save();
    console.log("Password reset successfully for user:", user.email);

    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Password reset failed",
    });
  }
});

module.exports = router;
