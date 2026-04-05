import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: [true, "Comment must reference a post"],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Comment must belong to a user"],
      index: true,
    },
    // null  → top-level comment
    // ObjectId → reply to another comment (one level deep is standard;
    //             for deeper threading, resolve the root via `rootId`)
    replyToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    // Denormalised root comment id so you can fetch all replies to
    // a top-level comment in a single query (avoid recursive lookups)
    rootId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    text: {
      type: String,
      required: [true, "Comment text is required"],
      trim: true,
      minlength: [1, "Comment cannot be empty"],
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
    },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true, // createdAt = timestamp
  }
);

// Fetch top-level comments for a post, newest first
commentSchema.index({ postId: 1, replyToId: 1, createdAt: -1 });

// Auto-populate rootId for replies
commentSchema.pre("save", async function (next) {
  if (this.replyToId && !this.rootId) {
    const parent = await mongoose.model("Comment").findById(this.replyToId).lean();
    // If parent is itself a reply, use its rootId; otherwise parent IS the root
    this.rootId = parent?.rootId ?? parent?._id ?? null;
  }
  next();
});

// Sync Post.commentsCount (only top-level, or all — your product decision)
async function syncCommentCount(postId) {
  const count = await mongoose.model("Comment").countDocuments({
    postId,
    isDeleted: false,
  });
  await mongoose.model("Post").findByIdAndUpdate(postId, { commentsCount: count });
}

commentSchema.post("save", function () {
  syncCommentCount(this.postId);
});

commentSchema.post("findOneAndUpdate", function (doc) {
  if (doc) syncCommentCount(doc.postId);
});

// Soft-delete filter
commentSchema.pre(/^find/, function (next) {
  if (!this.getOptions().includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

const Comment = mongoose.model("Comment", commentSchema);
export default Comment;
