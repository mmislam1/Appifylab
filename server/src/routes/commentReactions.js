import { Router } from "express";
import {
  toggleCommentReaction,
  getCommentReactionSummary,
  getCommentReactingUsers,
} from "../controllers/commentReactionController.js";
import { protect } from "../middleware/auth.js";

const router = Router({ mergeParams: true }); // exposes :commentId from parent

router.use(protect);

router
  .route("/")
  .post(toggleCommentReaction)     // like / unlike a comment or reply
  .get(getCommentReactionSummary); // { likesCount, viewerHasLiked }

router.get("/users", getCommentReactingUsers); // paginated list of usernames who liked

export default router;
