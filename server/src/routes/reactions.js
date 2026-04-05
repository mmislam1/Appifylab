import { Router } from "express";
import { toggleReaction, getReactionSummary, getReactingUsers } from "../controllers/reactionController.js";
import { protect } from "../middleware/auth.js";

// Merged into /api/posts/:postId/reactions via app.js mergeParams
const router = Router({ mergeParams: true });

router.use(protect);

router
  .route("/")
  .post(toggleReaction)          // add / change / remove my reaction
  .get(getReactionSummary);      // total count + breakdown + my reaction

router.get("/users", getReactingUsers); // paginated list of who reacted

export default router;
