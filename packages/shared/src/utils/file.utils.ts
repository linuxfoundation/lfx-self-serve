// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ALLOWED_FILE_TYPES } from '../constants/file-upload.constants';

/**
 * Map of MIME types to file extensions
 */
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  // Image files
  'image/jpeg': ['.jpeg', '.jpg'],
  'image/jpg': ['.jpg'],
  'image/pjpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/x-png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
  // Document files
  'application/pdf': ['.pdf'],
  'application/x-pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/x-msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  // Spreadsheet files
  'application/vnd.ms-excel': ['.xls'],
  'application/x-excel': ['.xls'],
  'application/x-msexcel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  // Presentation files
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/x-mspowerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  // Text files
  'text/plain': ['.txt'],
  'text/markdown': ['.md', '.markdown'],
  'text/x-markdown': ['.md', '.markdown'],
  // Data files
  'text/csv': ['.csv'],
  'application/csv': ['.csv'],
  // Rich text files
  'application/rtf': ['.rtf'],
  'text/rtf': ['.rtf'],
};

/**
 * Generate HTML accept attribute string from allowed MIME types
 * Converts MIME types to both MIME and extension formats for better browser compatibility
 * @returns Comma-separated string of accepted file types
 * @example
 * // Returns: ".pdf,.doc,.docx,...,application/pdf,application/msword,..."
 * const acceptString = generateAcceptString();
 */
export function generateAcceptString(): string {
  // Build arrays for MIME types and unique extensions in a single pass
  const mimeTypes: string[] = [];
  const uniqueExtensions = new Set<string>();

  // Process all MIME types and collect unique extensions
  ALLOWED_FILE_TYPES.forEach((mimeType) => {
    mimeTypes.push(mimeType);

    const extensions = MIME_TO_EXTENSIONS[mimeType];
    if (extensions) {
      extensions.forEach((ext) => uniqueExtensions.add(ext));
    }
  });

  // Combine MIME types and extensions into final accept string
  return [...mimeTypes, ...uniqueExtensions].join(',');
}

/**
 * Generate user-friendly display string of accepted file types
 * @returns Human-readable string of accepted file types
 * @example
 * // Returns: "PDF, Word (DOC, DOCX), Excel (XLS, XLSX), PowerPoint (PPT, PPTX), Images (JPG, PNG, GIF, WebP), Text (TXT, MD)"
 * const displayString = getAcceptedFileTypesDisplay();
 */
export function getAcceptedFileTypesDisplay(): string {
  const fileTypeGroups: { [key: string]: Set<string> } = {
    PDF: new Set(),
    Documents: new Set(),
    Spreadsheets: new Set(),
    Presentations: new Set(),
    Images: new Set(),
    Text: new Set(),
  };

  // Single pass through MIME types to categorize extensions
  ALLOWED_FILE_TYPES.forEach((mimeType) => {
    const extensions = MIME_TO_EXTENSIONS[mimeType];
    if (!extensions) return;

    // Convert extensions to uppercase display format
    const displayExtensions = extensions.map((ext) => ext.substring(1).toUpperCase());

    // Categorize based on MIME type
    if (mimeType.includes('pdf')) {
      displayExtensions.forEach((ext) => fileTypeGroups['PDF'].add(ext));
    } else if (mimeType.includes('word') || mimeType.includes('rtf')) {
      displayExtensions.forEach((ext) => fileTypeGroups['Documents'].add(ext));
    } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType.includes('csv')) {
      displayExtensions.forEach((ext) => fileTypeGroups['Spreadsheets'].add(ext));
    } else if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) {
      displayExtensions.forEach((ext) => fileTypeGroups['Presentations'].add(ext));
    } else if (mimeType.startsWith('image/')) {
      displayExtensions.forEach((ext) => fileTypeGroups['Images'].add(ext));
    } else if (mimeType.startsWith('text/')) {
      displayExtensions.forEach((ext) => fileTypeGroups['Text'].add(ext));
    }
  });

  // Build display string from categorized groups
  const displayParts: string[] = [];
  Object.entries(fileTypeGroups).forEach(([groupName, extensionSet]) => {
    if (extensionSet.size > 0) {
      if (groupName === 'PDF') {
        displayParts.push('PDF');
      } else {
        const extensions = Array.from(extensionSet);
        displayParts.push(`${groupName} (${extensions.join(', ')})`);
      }
    }
  });

  return displayParts.join(', ');
}

/**
 * Map of file extensions to their MIME types for fallback validation
 * Used when browser reports empty or generic MIME type
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.rtf': 'application/rtf',
};

/**
 * Check if a file type is allowed, with fallback to extension-based validation
 * Handles cases where browsers report empty or generic MIME types
 * @param mimeType - The MIME type reported by the browser
 * @param fileName - The file name to extract extension from as fallback
 * @param allowedTypes - Array of allowed MIME types
 * @returns true if the file type is allowed
 */
export function isFileTypeAllowed(mimeType: string, fileName: string, allowedTypes: readonly string[]): boolean {
  // First, check if the MIME type is directly in the allowed list
  if (mimeType && allowedTypes.includes(mimeType)) {
    return true;
  }

  // If MIME type is empty or generic, fall back to extension-based validation
  if (!mimeType || mimeType === 'application/octet-stream') {
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return false; // No extension found
    }
    const extension = fileName.toLowerCase().substring(lastDotIndex);
    const inferredMime = EXTENSION_TO_MIME[extension];
    if (inferredMime && allowedTypes.includes(inferredMime)) {
      return true;
    }
  }

  return false;
}

/**
 * Get user-friendly file extension from MIME type with optional filename fallback
 * @param mimeType - The MIME type to convert (e.g., 'application/pdf', 'image/jpeg')
 * @param fileName - Optional filename to extract extension from when MIME type is empty/unknown
 * @returns User-friendly extension (e.g., 'PDF', 'JPG') or 'Unknown' if not determinable
 * @example
 * getMimeTypeDisplayName('application/pdf'); // Returns: "PDF"
 * getMimeTypeDisplayName('', 'document.docx'); // Returns: "DOCX"
 * getMimeTypeDisplayName('application/octet-stream', 'file.md'); // Returns: "MD"
 */
export function getMimeTypeDisplayName(mimeType: string, fileName?: string): string {
  // Try to get extension from MIME type mapping
  if (mimeType) {
    const extensions = MIME_TO_EXTENSIONS[mimeType];
    if (extensions && extensions.length > 0) {
      return extensions[0].substring(1).toUpperCase();
    }
  }

  // Fallback to filename extension if MIME type is empty, unknown, or generic
  if (fileName && (!mimeType || mimeType === 'application/octet-stream' || !MIME_TO_EXTENSIONS[mimeType])) {
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex > 0) {
      return fileName.substring(lastDotIndex + 1).toUpperCase();
    }
  }

  // Last resort: try to extract something from MIME type
  if (mimeType) {
    const parts = mimeType.split('/');
    if (parts.length === 2) {
      return parts[1].toUpperCase();
    }
  }

  return 'Unknown';
}

/**
 * Comprehensive filename sanitization to prevent security issues
 * and ensure cross-platform compatibility
 */
export function sanitizeFilename(filename: string, maxLength: number = 255): string {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed_file';
  }

  // Normalize Unicode characters
  let sanitized = filename.normalize('NFD');

  // Split filename into name and extension
  const lastDotIndex = sanitized.lastIndexOf('.');
  let name = lastDotIndex > 0 ? sanitized.substring(0, lastDotIndex) : sanitized;
  let extension = lastDotIndex > 0 ? sanitized.substring(lastDotIndex) : '';

  // Remove path traversal patterns
  name = name.replace(/\.{2,}/g, '_'); // Replace ".." and "..."
  extension = extension.replace(/\.{2,}/g, '_');

  // Remove control characters and other dangerous characters
  const dangerousChars = /[\x00-\x1f\x80-\x9f<>:"/\\|?*]/g;
  name = name.replace(dangerousChars, '_');
  extension = extension.replace(dangerousChars, '_');

  // Replace spaces and other problematic characters
  name = name.replace(/\s+/g, '_'); // Replace whitespace with underscores
  extension = extension.replace(/\s+/g, '_');

  // Remove leading/trailing periods and spaces from name
  name = name.replace(/^[.\s]+|[.\s]+$/g, '');

  // Handle Windows reserved names (case-insensitive)
  const windowsReserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (windowsReserved.test(name)) {
    name = `${name}_file`;
  }

  // Ensure name is not empty
  if (!name) {
    name = 'unnamed';
  }

  // Combine name and extension
  sanitized = name + extension;

  // Limit length while preserving extension
  if (sanitized.length > maxLength) {
    const extensionLength = extension.length;
    const nameLength = Math.max(1, maxLength - extensionLength);
    name = name.substring(0, nameLength);
    sanitized = name + extension;
  }

  // Final safety check - ensure it doesn't start with dot (hidden file)
  if (sanitized.startsWith('.')) {
    sanitized = 'file' + sanitized;
  }

  return sanitized;
}
