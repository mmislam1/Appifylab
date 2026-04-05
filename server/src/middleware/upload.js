import multer from "multer";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per image
const MAX_FILES = 10;

const storage = multer.memoryStorage(); // keep in memory → stream to Cloudinary

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        `Only ${ALLOWED_MIME.join(", ")} files are allowed`
      ),
      false
    );
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

/**
 * Express error handler for multer errors — call after multer middleware.
 */
export const handleUploadError = (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `Each image must be under ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      LIMIT_FILE_COUNT: `You can upload at most ${MAX_FILES} images per post.`,
      LIMIT_UNEXPECTED_FILE: err.message,
    };
    return res.status(400).json({
      success: false,
      message: messages[err.code] ?? err.message,
    });
  }
  next(err);
};