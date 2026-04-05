import mongoose from "mongoose";
import Post from "../models/Post.js";
import { uploadBuffer, deleteAssets } from "../config/cloudinary.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const uploadImages = async (files = []) => {
  const results = await Promise.all(
    files.map((file) =>
      uploadBuffer(file.buffer, {
        folder: "social-app/posts",
        public_id_prefix: file.originalname.replace(/\.[^/.]+$/, ""),
      })
    )
  );
  return results.map((r) => ({
    url: r.secure_url,
    publicId: r.public_id,
    width: r.width,
    height: r.height,
    format: r.format,
  }));
};

/**
 * Builds the visibility filter for the authenticated viewer.
 *
 * A post is visible when:
 *   - It is public                          (everyone can see)
 *   - It is private AND owned by the viewer (only the author sees their own)
 *
 * This single $or replaces all previous role-checking at query time.
 */
const visibilityFilter = (viewerId) => ({
  isDeleted: false,
  $or: [
    { accessibility: "public" },
    { accessibility: "private", userId: viewerId },
  ],
});

// ─── FEED ────────────────────────────────────────────────────────────────────

/**
 * GET /api/posts
 *
 * Unified feed — one endpoint, one rule:
 *   • Public posts from everyone
 *   • Viewer's own private posts
 *
 * Optional filters via query params:
 *   userId   {ObjectId}  — scope to a specific author's posts
 *
 * Cursor-based pagination (efficient on millions of records):
 *   cursor   {ObjectId}  — _id of the last post received (omit on first page)
 *   limit    {number}    — default 10, max 50
 *
 * MongoDB ObjectId encodes the creation timestamp, so sorting by
 * { _id: -1 } is equivalent to newest-first and index-friendly.
 * Skip/limit is O(offset) — cursor pagination is O(log n).
 */
export const getFeed = async (req, res) => {
  try {
    const viewerId = req.user._id;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const { cursor, userId } = req.query;

    // Base visibility filter
    const filter = visibilityFilter(viewerId);

    // Optional: scope to a single user's posts
    if (userId) {
      if (!mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "Invalid userId." });
      }
      filter.userId = new mongoose.Types.ObjectId(userId);
    }

    // Cursor: fetch posts older than the last seen _id
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor)) {
        return res.status(400).json({ success: false, message: "Invalid cursor." });
      }
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    // Fetch limit + 1 to know if a next page exists without a COUNT query
    const posts = await Post.find(filter)
      .sort({ _id: -1 })               // newest first — uses the _id index
      .limit(limit + 1)
      .populate("userId", "firstName lastName avatar")
      .lean();

    const hasNextPage = posts.length > limit;
    const data = hasNextPage ? posts.slice(0, limit) : posts;
    const nextCursor = hasNextPage ? data[data.length - 1]._id : null;

    return res.status(200).json({
      success: true,
      posts: data,
      pagination: {
        limit,
        hasNextPage,
        nextCursor, // pass as ?cursor= on the next request
      },
    });
  } catch (err) {
    console.error("[getFeed]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─── SINGLE POST ─────────────────────────────────────────────────────────────

/**
 * GET /api/posts/:id
 * Applies the same visibility rule — 404 for private posts not owned by viewer.
 */
export const getPost = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }

    const post = await Post.findOne({
      _id: req.params.id,
      ...visibilityFilter(req.user._id),
    }).populate("userId", "firstName lastName avatar");

    // Return 404 whether not found OR not accessible — never leak existence of private posts
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    return res.status(200).json({ success: true, post });
  } catch (err) {
    console.error("[getPost]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─── CREATE ──────────────────────────────────────────────────────────────────

/**
 * POST /api/posts
 * multipart/form-data: text?, accessibility?, images[] (up to 10)
 */
export const createPost = async (req, res) => {
  let uploadedImages = [];
  try {
    const { text = "", accessibility = "public" } = req.body;
    const files = req.files ?? [];

    if (!text.trim() && files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "A post must have text, at least one image, or both.",
      });
    }

    if (files.length > 0) uploadedImages = await uploadImages(files);

    const post = await Post.create({
      userId: req.user._id,
      text: text.trim(),
      accessibility,
      images: uploadedImages,
    });

    await post.populate("userId", "firstName lastName avatar");

    return res.status(201).json({ success: true, message: "Post created.", post });
  } catch (err) {
    if (uploadedImages.length > 0) {
      await deleteAssets(uploadedImages.map((i) => i.publicId)).catch(console.error);
    }
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: errors[0], errors });
    }
    console.error("[createPost]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────

/**
 * PATCH /api/posts/:id
 * multipart/form-data: text?, accessibility?, removeImageIds? (JSON array), images[]
 */
export const updatePost = async (req, res) => {
  let newlyUploaded = [];
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found." });

    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }

    const { text, accessibility } = req.body;
    const files = req.files ?? [];

    let removeImageIds = [];
    if (req.body.removeImageIds) {
      try { removeImageIds = JSON.parse(req.body.removeImageIds); }
      catch { return res.status(400).json({ success: false, message: "removeImageIds must be a JSON array." }); }
    }

    const remainingImages = post.images.filter((img) => !removeImageIds.includes(img.publicId));

    if (remainingImages.length + files.length > 10) {
      return res.status(400).json({
        success: false,
        message: `Cannot exceed 10 images. Current: ${remainingImages.length}, adding: ${files.length}.`,
      });
    }

    if (files.length > 0) newlyUploaded = await uploadImages(files);
    if (text !== undefined) post.text = text.trim();
    if (accessibility !== undefined) post.accessibility = accessibility;
    post.images = [...remainingImages, ...newlyUploaded];

    await post.save();

    if (removeImageIds.length > 0) await deleteAssets(removeImageIds).catch(console.error);
    await post.populate("userId", "firstName lastName avatar");

    return res.status(200).json({ success: true, message: "Post updated.", post });
  } catch (err) {
    if (newlyUploaded.length > 0) {
      await deleteAssets(newlyUploaded.map((i) => i.publicId)).catch(console.error);
    }
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: errors[0], errors });
    }
    console.error("[updatePost]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────

/**
 * DELETE /api/posts/:id
 */
export const deletePost = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found." });

    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }

    post.isDeleted = true;
    await post.save();

    const publicIds = post.images.map((i) => i.publicId).filter(Boolean);
    if (publicIds.length > 0) await deleteAssets(publicIds).catch(console.error);

    return res.status(200).json({ success: true, message: "Post deleted." });
  } catch (err) {
    console.error("[deletePost]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
