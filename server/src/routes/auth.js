import { Router } from "express";
import { signup, login, refresh, logout, me } from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

// Public routes
router.post("/signup", signup);
router.post("/login", login);
router.post("/refresh", refresh); // uses HttpOnly cookie — no auth header needed

// Protected routes
router.post("/logout", protect, logout);
router.get("/me", protect, me);

export default router;