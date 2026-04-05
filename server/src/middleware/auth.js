import { verifyAccessToken } from "../utils/jwt.js";
import User from "../models/User.js";

/**
 * protect  — attach req.user for authenticated routes.
 *
 * Reads the token from:
 *   1. Authorization: Bearer <token>   (standard, used by Axios)
 *   2. x-access-token header           (legacy fallback)
 *
 * On success: attaches lean user object to req.user and calls next().
 * On failure: responds 401 — client should use refresh token flow.
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.headers["x-access-token"]) {
      token = req.headers["x-access-token"];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. No token provided.",
      });
    }

    const decoded = verifyAccessToken(token); // throws if invalid / expired

    // Lightweight DB check — confirms user still exists and is active.
    // Use .lean() for speed; select only what downstream handlers need.
    const user = await User.findById(decoded.sub)
      .select("_id firstName lastName email avatar isActive")
      .lean();

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account not found or deactivated.",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        code: "TOKEN_EXPIRED",
        message: "Access token expired. Please refresh.",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

/**
 * optionalAuth — same as protect but doesn't block unauthenticated requests.
 * Useful for public feed endpoints that show extra data to logged-in users.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return next();

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.sub)
      .select("_id firstName lastName email avatar isActive")
      .lean();

    if (user?.isActive) req.user = user;
  } catch {
    // swallow errors — treat as unauthenticated
  }
  next();
};