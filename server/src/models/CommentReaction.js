import mongoose from "mongoose";

const commentReactionSchema = new mongoose.Schema(
  {
    commentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      required: [true, "CommentReaction must reference a comment"],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "CommentReaction must belong to a user"],
    },
  },
  { timestamps: true }
);

// One like per user per comment
commentReactionSchema.index({ commentId: 1, userId: 1 }, { unique: true });

// Who liked — latest first
commentReactionSchema.index({ commentId: 1, _id: -1 });

// Sync Comment.reactionsCount
async function syncCount(commentId) {
  const count = await mongoose.model("CommentReaction").countDocuments({ commentId });
  await mongoose.model("Comment").findByIdAndUpdate(commentId, { reactionsCount: count });
}

commentReactionSchema.post("save",             function ()    { syncCount(this.commentId); });
commentReactionSchema.post("findOneAndDelete", function (doc) { if (doc) syncCount(doc.commentId); });

const CommentReaction = mongoose.model("CommentReaction", commentReactionSchema);
export default CommentReaction;
