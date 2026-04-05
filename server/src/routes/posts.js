import { Router } from "express";
import { getFeed, getPost, createPost, updatePost, deletePost } from "../controllers/postController.js";
import { protect } from "../middleware/auth.js";
import { upload, handleUploadError } from "../middleware/upload.js";

const router = Router();

router.use(protect);

const uploadImages = upload.array("images", 10);

router.route("/")
  .get(getFeed)
  .post(uploadImages, handleUploadError, createPost);

router.route("/:id")
  .get(getPost)
  .patch(uploadImages, handleUploadError, updatePost)
  .delete(deletePost);

export default router;
