import mongoose from "mongoose";
import Reaction from "../models/Reaction.js";
import Post from "../models/Post.js";

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
 * POST /api/posts/:postId/reactions
 * Body: { type }  — like | love | haha | wow | sad | angry
 * Toggle: same type = remove, different type = switch, none = add.
 */
export const toggleReaction = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const { type = "like" } = req.body;

    const { error, status } = await assertPostAccess(postId, userId);
    if (error) return res.status(status).json({ success: false, message: error });

    const existing = await Reaction.findOne({ postId, userId });

    if (existing && existing.type === type) {
      await Reaction.findByIdAndDelete(existing._id);
      const count = await Reaction.countDocuments({ postId });
      return res.status(200).json({ success: true, action: "removed", reactionType: null, reactionsCount: count });
    }

    const reaction = await Reaction.findOneAndUpdate(
      { postId, userId },
      { type },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const count = await Reaction.countDocuments({ postId });
    return res.status(200).json({
      success: true,
      action: existing ? "changed" : "added",
      reactionType: reaction.type,
      reactionsCount: count,
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ success: false, message: err.errors.type?.message ?? err.message });
    }
    console.error("[toggleReaction]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/posts/:postId/reactions
 * Returns total, per-type breakdown, and viewer's own reaction.
 */
export const getReactionSummary = async (req, res) => {
  try {
    const { postId } = req.params;
    const { error, status } = await assertPostAccess(postId, req.user._id);
    if (error) return res.status(status).json({ success: false, message: error });

    const [breakdown, viewerReaction] = await Promise.all([
      Reaction.aggregate([
        { $match: { postId: new mongoose.Types.ObjectId(postId) } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
      Reaction.findOne({ postId, userId: req.user._id }).lean(),
    ]);

    const counts = breakdown.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});
    const total  = Object.values(counts).reduce((s, n) => s + n, 0);

    return res.status(200).json({
      success: true,
      total,
      breakdown: counts,
      viewerReaction: viewerReaction?.type ?? null,
    });
  } catch (err) {
    console.error("[getReactionSummary]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/posts/:postId/reactions/users?type=like&cursor=<_id>&limit=20
 * Cursor-paginated list of who reacted, latest first.
 * Optional ?type= filter.
 */
export const getReactingUsers = async (req, res) => {
  try {
    const { postId } = req.params;
    const { error, status } = await assertPostAccess(postId, req.user._id);
    if (error) return res.status(status).json({ success: false, message: error });

    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { cursor, type } = req.query;

    const filter = { postId: new mongoose.Types.ObjectId(postId) };
    if (type) filter.type = type;
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor)) return res.status(400).json({ success: false, message: "Invalid cursor." });
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const reactions = await Reaction.find(filter)
      .sort({ _id: -1 })             // latest first
      .limit(limit + 1)
      .populate("userId", "firstName lastName avatar")
      .lean();

    const hasNextPage = reactions.length > limit;
    const data = hasNextPage ? reactions.slice(0, limit) : reactions;
    const nextCursor = hasNextPage ? data[data.length - 1]._id : null;

    return res.status(200).json({
      success: true,
      users: data.map((r) => ({ user: r.userId, reactionType: r.type, reactedAt: r.createdAt })),
      pagination: { limit, hasNextPage, nextCursor },
    });
  } catch (err) {
    console.error("[getReactingUsers]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
