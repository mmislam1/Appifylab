import jwt from "jsonwebtoken";

const {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES = "15m",
  JWT_REFRESH_EXPIRES = "7d",
} = process.env;

/**
 * Sign a short-lived access token.
 * Payload is kept minimal — only what middleware needs (no sensitive data).
 */
export const signAccessToken = (userId) =>
  jwt.sign({ sub: userId }, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES,
    issuer: "social-app",
  });

/**
 * Sign a long-lived refresh token.
 */
export const signRefreshToken = (userId) =>
  jwt.sign({ sub: userId }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES,
    issuer: "social-app",
  });

/**
 * Verify an access token. Throws on failure.
 * @returns {object} decoded payload
 */
export const verifyAccessToken = (token) =>
  jwt.verify(token, JWT_ACCESS_SECRET, { issuer: "social-app" });

/**
 * Verify a refresh token. Throws on failure.
 * @returns {object} decoded payload
 */
export const verifyRefreshToken = (token) =>
  jwt.verify(token, JWT_REFRESH_SECRET, { issuer: "social-app" });

/**
 * Build the cookie options for the refresh token HttpOnly cookie.
 * sameSite "strict" prevents CSRF; adjust to "lax" if you use OAuth redirects.
 */
export const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: "/api/auth",                // scoped — not sent on every request
};