import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

// Route modules
import authRoutes     from "./routes/auth.js";
import postRoutes     from "./routes/posts.js";
import commentRoutes  from "./routes/comments.js";
import reactionRoutes from "./routes/reactions.js";

// ─── App ────────────────────────────────────────────────────────────────────

const app = express();

// ─── Security & parsing middleware ──────────────────────────────────────────

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow Cloudinary images
  })
);

const allowedOrigins = (process.env.CLIENT_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin && process.env.NODE_ENV !== "production") return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-access-token"],
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many auth attempts, please wait." },
});

app.use(globalLimiter);
app.use("/api/auth", authLimiter);

// ─── Routes ─────────────────────────────────────────────────────────────────

app.use("/api/auth",                          authRoutes);
app.use("/api/posts",                         postRoutes);
app.use("/api/posts/:postId/comments",        commentRoutes);   // mergeParams: true in comments router
app.use("/api/posts/:postId/reactions",       reactionRoutes);  // mergeParams: true in reactions router

// Health check
app.get("/api/health", (_req, res) =>
  res.json({ success: true, uptime: process.uptime(), timestamp: Date.now() })
);

// ─── 404 ────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// ─── Global error handler ───────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[Global Error]", err);

  if (err.name === "CastError") {
    return res.status(400).json({ success: false, message: "Invalid ID format." });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? "field";
    return res.status(409).json({ success: false, message: `${field} already exists.` });
  }

  const status = err.status ?? err.statusCode ?? 500;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Internal server error."
      : err.message;

  res.status(status).json({ success: false, message });
});

// ─── DB + Server bootstrap ──────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { tls: true });
    console.log(" MongoDB connected");

    app.listen(PORT, () =>
      console.log(` Server running on port ${PORT} [${process.env.NODE_ENV ?? "development"}]`)
    );
  } catch (err) {
    console.error(" Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }
};

mongoose.connection.on("disconnected", () => console.warn("  MongoDB disconnected"));
mongoose.connection.on("reconnected", () => console.log(" MongoDB reconnected"));

start();

export default app;