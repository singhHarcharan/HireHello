// Vercel Functions accept at most 4.5 MB per request. Keep multipart uploads
// below that ceiling, including form fields and multipart boundaries.
export const MAX_RESUME_UPLOAD_BYTES = 4 * 1024 * 1024;
