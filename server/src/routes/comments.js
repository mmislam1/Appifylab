import { Router } from "express";
import {
  createComment,
  getTopComments,
  getReplies,
  updateComment,
  deleteComment,
} from "../controllers/commentController.js";
import { protect } from "../middleware/auth.js";

// mergeParams lets us read :postId from the parent posts router
const router = Router({ mergeParams: true });

router.use(protect);

// ── /api/posts/:postId/comments ──────────────────────────────────────────────
router
  .route("/")
  .post(createComment)     // add a comment or reply (replyToId in body)
  .get(getTopComments);    // top-level comments only, with repliesCount

// ── /api/posts/:postId/comments/:commentId ───────────────────────────────────
router
  .route("/:commentId")
  .patch(updateComment)
  .delete(deleteComment);

// ── /api/posts/:postId/comments/:commentId/replies ───────────────────────────
// All replies in the thread (direct + nested), paginated
router.get("/:commentId/replies", getReplies);

export default router;
