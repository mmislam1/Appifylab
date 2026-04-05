import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // always return https URLs
});

export default cloudinary;

/**
 * Upload a single file buffer to Cloudinary.
 * @param {Buffer} buffer  - File buffer from multer memoryStorage
 * @param {object} options - Cloudinary upload options override
 * @returns {Promise<object>} Cloudinary upload result
 */
export const uploadBuffer = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "social-app/posts",
        resource_type: "image",
        transformation: [
          { quality: "auto:good" },
          { fetch_format: "auto" },      // serve webp/avif where supported
          { width: 1200, crop: "limit" }, // cap max width, preserve aspect
        ],
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
};

/**
 * Delete a Cloudinary asset by its public_id.
 * @param {string} publicId
 */
export const deleteAsset = (publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: "image" });

/**
 * Delete multiple Cloudinary assets.
 * @param {string[]} publicIds
 */
export const deleteAssets = (publicIds) =>
  cloudinary.api.delete_resources(publicIds, { resource_type: "image" });