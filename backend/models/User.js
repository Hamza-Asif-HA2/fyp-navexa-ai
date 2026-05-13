const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    emailOTP: {
      type: String,
      default: null,
    },
    emailOTPExpiry: {
      type: Date,
      default: null,
    },
    voiceSignatures: [
      {
        label: String,
        enrolledAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    settings: {
      proactiveIntervalMinutes: {
        type: Number,
        default: 5,
      },
      ttsVoiceId: {
        type: String,
        default: "",
      },
      isProactiveEnabled: {
        type: Boolean,
        default: true,
      },
    },
    stats: {
      totalKm: {
        type: Number,
        default: 0,
      },
      totalTrips: {
        type: Number,
        default: 0,
      },
    },
    spotifyAuth: {
      accessToken: String,
      refreshToken: String,
      expiresAt: Date,
      isConnected: {
        type: Boolean,
        default: false,
      },
    },
    resetPasswordToken: String,
    resetPasswordExpiry: Date,
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    const saltRounds = 12;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error("Password comparison failed");
  }
};

userSchema.methods.toSafeObject = function () {
  const user = this.toObject();
  delete user.password;
  delete user.emailOTP;
  delete user.emailOTPExpiry;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpiry;
  return user;
};

module.exports = mongoose.model("User", userSchema);
