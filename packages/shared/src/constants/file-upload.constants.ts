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
  // === Image Files ===
  /** JPEG image files */
  'image/jpeg',
  /** JPEG image files (legacy MIME type) */
  'image/jpg',
  /** JPEG image files (IE legacy MIME type) */
  'image/pjpeg',
  /** PNG image files */
  'image/png',
  /** PNG image files (legacy MIME type) */
  'image/x-png',
  /** GIF image files */
  'image/gif',
  /** WebP image files */
  'image/webp',
  /** SVG image files */
  'image/svg+xml',

  // === Document Files ===
  /** PDF documents */
  'application/pdf',
  /** PDF documents (legacy MIME type) */
  'application/x-pdf',
  /** Microsoft Word documents (.doc) */
  'application/msword',
  /** Microsoft Word documents (.doc) - legacy */
  'application/x-msword',
  /** Microsoft Word documents (.docx) */
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

  // === Spreadsheet Files ===
  /** Microsoft Excel spreadsheets (.xls) */
  'application/vnd.ms-excel',
  /** Microsoft Excel spreadsheets (.xls) - legacy */
  'application/x-excel',
  /** Microsoft Excel spreadsheets (.xls) - legacy */
  'application/x-msexcel',
  /** Microsoft Excel spreadsheets (.xlsx) */
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  // === Presentation Files ===
  /** Microsoft PowerPoint presentations (.ppt) */
  'application/vnd.ms-powerpoint',
  /** Microsoft PowerPoint presentations (.ppt) - legacy */
  'application/x-mspowerpoint',
  /** Microsoft PowerPoint presentations (.pptx) */
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // === Text Files ===
  /** Plain text files */
  'text/plain',
  /** Markdown files (RFC 7763) */
  'text/markdown',
  /** Markdown files (legacy MIME type) */
  'text/x-markdown',

  // === Data Files ===
  /** CSV files (RFC 4180) */
  'text/csv',
  /** CSV files (legacy MIME type) */
  'application/csv',

  // === Rich Text Files ===
  /** RTF documents */
  'application/rtf',
  /** RTF documents (legacy MIME type) */
  'text/rtf',
] as const;

/**
 * Maximum file size in bytes (100MB)
 * @description File upload size limit to prevent server overload and ensure reasonable upload times
 * @example
 * // Check if file is within size limit
 * if (file.size > MAX_FILE_SIZE_BYTES) {
 *   throw new Error('File too large');
 * }
 */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Maximum file size in megabytes
 * @description Human-readable file size limit for display in UI, derived from MAX_FILE_SIZE_BYTES
 * @example
 * // Display in UI
 * <p>Maximum file size: {MAX_FILE_SIZE_MB}MB</p>
 */
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
