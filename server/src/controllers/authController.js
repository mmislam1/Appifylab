import User from "../models/User.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshCookieOptions,
} from "../utils/jwt.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const safeUser = (user) => ({
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  avatar: user.avatar,
  bio: user.bio,
  createdAt: user.createdAt,
});

// ─── controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/signup
 * Body: { firstName, lastName, email, password }
 */
export const signup = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Duplicate email check with a friendly message
    const existing = await User.findOne({ email: email?.toLowerCase().trim() }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const user = await User.create({ firstName, lastName, email, password });

    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);

    // Persist refresh token (rotation strategy)
    user.refreshTokens = [refreshToken];
    await user.save({ validateBeforeSave: false });

    res.cookie("refreshToken", refreshToken, refreshCookieOptions);

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      accessToken,
      user: safeUser(user),
    });
  } catch (err) {
    // Mongoose validation errors
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: errors[0], errors });
    }
    console.error("[signup]", err);
    return res.status(500).json({ success: false, message: "Server error during signup." });
  }
};

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await User.findByEmailWithPassword(email);

    if (!user || !(await user.comparePassword(password))) {
      // Generic message — don't leak whether the email exists
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated.",
      });
    }

    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);

    // Append new refresh token; cap list to 5 devices
    user.refreshTokens = [...(user.refreshTokens ?? []).slice(-4), refreshToken];
    await user.save({ validateBeforeSave: false });

    res.cookie("refreshToken", refreshToken, refreshCookieOptions);

    return res.status(200).json({
      success: true,
      message: "Logged in successfully.",
      accessToken,
      user: safeUser(user),
    });
  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
};

/**
 * POST /api/auth/refresh
 * Reads HttpOnly cookie `refreshToken`.
 * Issues new access + refresh token pair (rotation).
 */
export const refresh = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({ success: false, message: "No refresh token." });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired refresh token." });
    }

    const user = await User.findById(decoded.sub).select("+refreshTokens");

    if (!user || !user.refreshTokens?.includes(token)) {
      // Possible token reuse — revoke all tokens (security measure)
      if (user) {
        user.refreshTokens = [];
        await user.save({ validateBeforeSave: false });
      }
      return res.status(401).json({
        success: false,
        message: "Refresh token reuse detected. Please log in again.",
      });
    }

    const newAccessToken = signAccessToken(user._id);
    const newRefreshToken = signRefreshToken(user._id);

    // Rotate: replace old token
    user.refreshTokens = [
      ...user.refreshTokens.filter((t) => t !== token).slice(-4),
      newRefreshToken,
    ];
    await user.save({ validateBeforeSave: false });

    res.cookie("refreshToken", newRefreshToken, refreshCookieOptions);

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
    });
  } catch (err) {
    console.error("[refresh]", err);
    return res.status(500).json({ success: false, message: "Server error during token refresh." });
  }
};

/**
 * POST /api/auth/logout
 * Clears the refresh token from DB and cookie.
 */
export const logout = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;

    if (token) {
      // Remove this specific device's refresh token
      await User.findByIdAndUpdate(req.user._id, {
        $pull: { refreshTokens: token },
      });
    }

    res.clearCookie("refreshToken", { path: "/api/auth" });

    return res.status(200).json({ success: true, message: "Logged out successfully." });
  } catch (err) {
    console.error("[logout]", err);
    return res.status(500).json({ success: false, message: "Server error during logout." });
  }
};

/**
 * GET /api/auth/me
 * Returns the current authenticated user's profile.
 */
export const me = async (req, res) => {
  return res.status(200).json({ success: true, user: safeUser(req.user) });
};
