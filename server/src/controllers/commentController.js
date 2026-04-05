import mongoose from "mongoose";
import Comment from "../models/Comment.js";
import Post from "../models/Post.js";

const AUTHOR_FIELDS = "firstName lastName avatar";

const assertPostAccess = async (postId, userId) => {
  if (!mongoose.isValidObjectId(postId)) return { error: "Invalid post ID.", status: 400 };
  const post = await Post.findOne({
    _id: postId,
    isDeleted: false,
    $or: [{ accessibility: "public" }, { accessibility: "private", userId }],
  }).lean();
  if (!post) return { error: "Post not found.", status: 404 };
  return { post };
};

/**
 * POST /api/posts/:postId/comments
 * Body: { text, replyToId? }
 * Omit replyToId for top-level comment; include it for any depth of reply.
 */
export const createComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const { text, replyToId = null } = req.body;

    if (!text?.trim()) return res.status(400).json({ success: false, message: "Comment text is required." });

    const { error, status } = await assertPostAccess(postId, userId);
    if (error) return res.status(status).json({ success: false, message: error });

    if (replyToId) {
      if (!mongoose.isValidObjectId(replyToId)) return res.status(400).json({ success: false, message: "Invalid replyToId." });
      const parent = await Comment.findById(replyToId).lean();
      if (!parent) return res.status(404).json({ success: false, message: "Parent comment not found." });
      if (parent.postId.toString() !== postId) return res.status(400).json({ success: false, message: "Parent comment is on a different post." });
    }

    const comment = await Comment.create({ postId, userId, text: text.trim(), replyToId });
    await comment.populate("userId", AUTHOR_FIELDS);

    return res.status(201).json({ success: true, message: "Comment added.", comment });
  } catch (err) {
    if (err.name === "ValidationError") return res.status(400).json({ success: false, message: Object.values(err.errors)[0].message });
    console.error("[createComment]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/posts/:postId/comments?cursor=<_id>&limit=10
 * Top-level comments only (replyToId === null), latest first.
 * Each comment includes repliesCount.
 */
export const getTopComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { error, status } = await assertPostAccess(postId, req.user._id);
    if (error) return res.status(status).json({ success: false, message: error });

    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const { cursor } = req.query;

    const filter = {
      postId: new mongoose.Types.ObjectId(postId),
      replyToId: null,
    };
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor)) return res.status(400).json({ success: false, message: "Invalid cursor." });
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const comments = await Comment.find(filter)
      .sort({ _id: -1 })             // latest first
      .limit(limit + 1)
      .populate("userId", AUTHOR_FIELDS)
      .lean();

    const hasNextPage = comments.length > limit;
    const data = hasNextPage ? comments.slice(0, limit) : comments;
    const nextCursor = hasNextPage ? data[data.length - 1]._id : null;

    // Batch fetch reply counts for all returned comments
    const commentIds = data.map((c) => c._id);
    const replyCounts = await Comment.aggregate([
      { $match: { rootId: { $in: commentIds }, isDeleted: false } },
      { $group: { _id: "$rootId", count: { $sum: 1 } } },
    ]);
    const replyCountMap = replyCounts.reduce((acc, { _id, count }) => {
      acc[_id.toString()] = count;
      return acc;
    }, {});

    const enriched = data.map((c) => ({
      ...c,
      repliesCount: replyCountMap[c._id.toString()] ?? 0,
    }));

    return res.status(200).json({
      success: true,
      comments: enriched,
      pagination: { limit, hasNextPage, nextCursor },
    });
  } catch (err) {
    console.error("[getTopComments]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/posts/:postId/comments/:commentId/replies?cursor=<_id>&limit=20
 *
 * Full thread under a top-level comment — direct replies AND replies-to-replies,
 * sorted latest first (newest replies at top, mirroring most social apps).
 *
 * Each reply includes a nested replyToId.userId so the client can render
 * "@firstName" mentions without extra requests.
 */
export const getReplies = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    if (!mongoose.isValidObjectId(commentId)) return res.status(400).json({ success: false, message: "Invalid comment ID." });

    const { error, status } = await assertPostAccess(postId, req.user._id);
    if (error) return res.status(status).json({ success: false, message: error });

    const rootComment = await Comment.findById(commentId).lean();
    if (!rootComment || rootComment.postId.toString() !== postId) {
      return res.status(404).json({ success: false, message: "Comment not found on this post." });
    }
    if (rootComment.replyToId !== null) {
      return res.status(400).json({ success: false, message: "Provide the root comment's ID to fetch its thread." });
    }

    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { cursor } = req.query;

    const filter = { rootId: new mongoose.Types.ObjectId(commentId) };
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor)) return res.status(400).json({ success: false, message: "Invalid cursor." });
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const replies = await Comment.find(filter)
      .sort({ _id: -1 })             // latest first
      .limit(limit + 1)
      .populate("userId", AUTHOR_FIELDS)
      .populate({ path: "replyToId", select: "userId text", populate: { path: "userId", select: "firstName lastName" } })
      .lean();

    const hasNextPage = replies.length > limit;
    const data = hasNextPage ? replies.slice(0, limit) : replies;
    const nextCursor = hasNextPage ? data[data.length - 1]._id : null;

    return res.status(200).json({
      success: true,
      rootComment: { _id: rootComment._id, text: rootComment.text, createdAt: rootComment.createdAt },
      replies: data,
      pagination: { limit, hasNextPage, nextCursor },
    });
  } catch (err) {
    console.error("[getReplies]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * PATCH /api/posts/:postId/comments/:commentId
 * Body: { text }
 */
export const updateComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    if (!mongoose.isValidObjectId(commentId)) return res.status(400).json({ success: false, message: "Invalid comment ID." });

    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: "Text is required." });

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found." });
    if (comment.userId.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Not authorised." });

    comment.text = text.trim();
    await comment.save();
    await comment.populate("userId", AUTHOR_FIELDS);

    return res.status(200).json({ success: true, message: "Comment updated.", comment });
  } catch (err) {
    console.error("[updateComment]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * DELETE /api/posts/:postId/comments/:commentId
 * Soft delete — preserves thread structure, blanks content.
 */
export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    if (!mongoose.isValidObjectId(commentId)) return res.status(400).json({ success: false, message: "Invalid comment ID." });

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found." });
    if (comment.userId.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Not authorised." });

    comment.isDeleted = true;
    comment.text = "[deleted]";
    await comment.save();

    return res.status(200).json({ success: true, message: "Comment deleted." });
  } catch (err) {
    console.error("[deleteComment]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
