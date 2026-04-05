import mongoose from "mongoose";

// Supported reaction types — easily extensible
export const REACTION_TYPES = ["like", "love", "haha", "wow", "sad", "angry"];

const reactionSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: [true, "Reaction must reference a post"],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reaction must belong to a user"],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: REACTION_TYPES,
        message: `Reaction type must be one of: ${REACTION_TYPES.join(", ")}`,
      },
      default: "like",
    },
  },
  {
    timestamps: true, // createdAt acts as the reaction timestamp; updatedAt tracks type changes
  }
);

// One reaction per user per post — upsert on type change
reactionSchema.index({ postId: 1, userId: 1 }, { unique: true });

// After a reaction is saved/removed, update Post.reactionsCount
async function syncReactionCount(postId) {
  const Post = mongoose.model("Post");
  const count = await mongoose.model("Reaction").countDocuments({ postId });
  await Post.findByIdAndUpdate(postId, { reactionsCount: count });
}

reactionSchema.post("save", function () {
  syncReactionCount(this.postId);
});

reactionSchema.post("findOneAndDelete", function (doc) {
  if (doc) syncReactionCount(doc.postId);
});

const Reaction = mongoose.model("Reaction", reactionSchema);
export default Reaction;
