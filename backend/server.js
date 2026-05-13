const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const authRoutes = require("./routes/authRoutes");
const voiceRoutes = require("./routes/voiceRoutes");
const aiRoutes = require("./routes/aiRoutes");
const tripRoutes = require("./routes/tripRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const mediaRoutes = require("./routes/mediaRoutes");
const navigationRoutes = require("./routes/navigationRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

const configureMiddleware = () => {
  console.log("Configuring middleware...");

  if (process.env.NODE_ENV === "development") {
    app.use(cors());
  } else {
    app.use(
      cors({
        origin: process.env.FRONTEND_URL || false,
      })
    );
  }

  app.use(helmet());
  app.use(express.json());
};

const connectDatabase = async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }
};

const mountRoutes = () => {
  console.log("Mounting routes...");
  app.use("/api/auth", authRoutes);
  app.use("/api/voice", voiceRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/trips", tripRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/media", mediaRoutes);
  app.use("/api/navigation", navigationRoutes);
};

app.get("/health", async (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date(),
    service: "NavexaAI Backend",
  });
});

const startServer = async () => {
  configureMiddleware();
  await connectDatabase();
  mountRoutes();

  app.use((error, req, res, next) => {
    console.error("Unhandled error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  });

  app.listen(PORT, () => {
    console.log(`NavexaAI Backend running on port ${PORT}`);
  });
};

startServer();
