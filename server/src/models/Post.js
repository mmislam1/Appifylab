import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },       // Cloudinary secure_url
    publicId: { type: String, required: true },  // Cloudinary public_id (for deletion/transforms)
    width: { type: Number },
    height: { type: Number },
    format: { type: String },                    // e.g. "jpg", "png", "webp"
    altText: { type: String, default: "" },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Post must belong to a user"],
      index: true,
    },
    text: {
      type: String,
      trim: true,
      maxlength: [2000, "Post text cannot exceed 2000 characters"],
      default: "",
    },
    images: {
      type: [imageSchema],
      validate: {
        validator: (arr) => arr.length <= 10,
        message: "A post cannot have more than 10 images",
      },
      default: [],
    },
    accessibility: {
      type: String,
      enum: {
        values: ["public", "private"],
        message: "Accessibility must be either 'public' or 'private'",
      },
      default: "public",
    },
    
    reactionsCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },

    isDeleted: { type: Boolean, default: false, index: true }, 
  },
  {
    timestamps: true,
  }
);

// Compound index for feed queries: user's public posts sorted by newest
postSchema.index({ userId: 1, accessibility: 1, createdAt: -1 });
// Global public feed
postSchema.index({ accessibility: 1, createdAt: -1 });

// Filter out soft-deleted posts by default
postSchema.pre(/^find/, function (next) {
  if (!this.getOptions().includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

const Post = mongoose.model("Post", postSchema);
export default Post;
