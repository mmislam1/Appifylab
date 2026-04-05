import mongoose from "mongoose";
import CommentReaction from "../models/CommentReaction.js";
import Comment from "../models/Comment.js";
import Post from "../models/Post.js";

const assertCommentAccess = async (commentId, userId) => {
  if (!mongoose.isValidObjectId(commentId)) return { error: "Invalid comment ID.", status: 400 };

  const comment = await Comment.findById(commentId).lean();
  if (!comment) return { error: "Comment not found.", status: 404 };

  const post = await Post.findOne({
    _id: comment.postId,
    isDeleted: false,
    $or: [{ accessibility: "public" }, { accessibility: "private", userId }],
  }).lean();

  if (!post) return { error: "Post not found or not accessible.", status: 404 };
  return { comment };
};

/**
 * POST /api/comments/:commentId/reactions
 * No body. Liked → unlike. Not liked → like.
 */
export const toggleCommentReaction = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const { error, status } = await assertCommentAccess(commentId, userId);
    if (error) return res.status(status).json({ success: false, message: error });

    const existing = await CommentReaction.findOne({ commentId, userId });

    if (existing) {
      await CommentReaction.findByIdAndDelete(existing._id);
      const likesCount = await CommentReaction.countDocuments({ commentId });
      return res.status(200).json({ success: true, liked: false, likesCount });
    }

    await CommentReaction.create({ commentId, userId });
    const likesCount = await CommentReaction.countDocuments({ commentId });
    return res.status(200).json({ success: true, liked: true, likesCount });
  } catch (err) {
    console.error("[toggleCommentReaction]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/comments/:commentId/reactions
 * Returns: { likesCount, viewerHasLiked }
 */
export const getCommentReactionSummary = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const { error, status } = await assertCommentAccess(commentId, userId);
    if (error) return res.status(status).json({ success: false, message: error });

    const [likesCount, viewerReaction] = await Promise.all([
      CommentReaction.countDocuments({ commentId }),
      CommentReaction.findOne({ commentId, userId }).lean(),
    ]);

    return res.status(200).json({
      success: true,
      likesCount,
      viewerHasLiked: !!viewerReaction,
    });
  } catch (err) {
    console.error("[getCommentReactionSummary]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/comments/:commentId/reactions/users?cursor=<_id>&limit=20
 * Paginated list of usernames who liked the comment, latest first.
 */
export const getCommentReactingUsers = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const { error, status } = await assertCommentAccess(commentId, userId);
    if (error) return res.status(status).json({ success: false, message: error });

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { cursor } = req.query;

    const filter = { commentId: new mongoose.Types.ObjectId(commentId) };
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor))
        return res.status(400).json({ success: false, message: "Invalid cursor." });
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const reactions = await CommentReaction.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate("userId", "firstName lastName")
      .lean();

    const hasNextPage = reactions.length > limit;
    const data        = hasNextPage ? reactions.slice(0, limit) : reactions;
    const nextCursor  = hasNextPage ? data[data.length - 1]._id : null;

    return res.status(200).json({
      success: true,
      users: data.map((r) => ({
        _id:       r.userId._id,
        firstName: r.userId.firstName,
        lastName:  r.userId.lastName,
        likedAt:   r.createdAt,
      })),
      pagination: { limit, hasNextPage, nextCursor },
    });
  } catch (err) {
    console.error("[getCommentReactingUsers]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
