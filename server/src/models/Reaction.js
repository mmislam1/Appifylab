import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: [true, "Reaction must reference a post"],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reaction must belong to a user"],
    },
  },
  { timestamps: true }
);

// One like per user per post
reactionSchema.index({ postId: 1, userId: 1 }, { unique: true });

// Who liked — latest first
reactionSchema.index({ postId: 1, _id: -1 });

// Sync Post.reactionsCount
async function syncCount(postId) {
  const count = await mongoose.model("Reaction").countDocuments({ postId });
  await mongoose.model("Post").findByIdAndUpdate(postId, { reactionsCount: count });
}

reactionSchema.post("save",             function ()    { syncCount(this.postId); });
reactionSchema.post("findOneAndDelete", function (doc) { if (doc) syncCount(doc.postId); });

const Reaction = mongoose.model("Reaction", reactionSchema);
export default Reaction;
