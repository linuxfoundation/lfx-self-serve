// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Allowed MIME types for file uploads
 * @description Supported file types for meeting attachments and document uploads
 * @readonly
 * @example
 * // Check if a file type is allowed
 * const isAllowed = ALLOWED_FILE_TYPES.includes(file.type);
 */
export const ALLOWED_FILE_TYPES = [
  /** JPEG image files */
  'image/jpeg',
  /** JPG image files (alternative MIME type) */
  'image/jpg',
  /** PNG image files */
  'image/png',
  /** GIF image files */
  'image/gif',
  /** WebP image files */
  'image/webp',
  /** PDF documents */
  'application/pdf',
  /** Microsoft Word documents (.doc) */
  'application/msword',
  /** Microsoft Word documents (.docx) */
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  /** Microsoft Excel spreadsheets (.xls) */
  'application/vnd.ms-excel',
  /** Microsoft Excel spreadsheets (.xlsx) */
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  /** Microsoft PowerPoint presentations (.ppt) */
  'application/vnd.ms-powerpoint',
  /** Microsoft PowerPoint presentations (.pptx) */
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  /** Plain text files */
  'text/plain',
  /** Markdown files */
  'text/markdown',
] as const;

/**
 * Maximum file size in bytes (10MB)
 * @description File upload size limit to prevent server overload and ensure reasonable upload times
 * @example
 * // Check if file is within size limit
 * if (file.size > MAX_FILE_SIZE_BYTES) {
 *   throw new Error('File too large');
 * }
 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Maximum file size in megabytes (10MB)
 * @description Human-readable file size limit for display in UI
 * @example
 * // Display in UI
 * <p>Maximum file size: {MAX_FILE_SIZE_MB}MB</p>
 */
export const MAX_FILE_SIZE_MB = 10;
