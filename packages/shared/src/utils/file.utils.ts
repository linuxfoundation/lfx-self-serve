// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ALLOWED_FILE_TYPES } from '../constants/file-upload.constants';

/**
 * Map of MIME types to file extensions
 */
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpeg', '.jpg'],
  'image/jpg': ['.jpg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md', '.markdown'],
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
    Word: new Set(),
    Excel: new Set(),
    PowerPoint: new Set(),
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
    } else if (mimeType.includes('word')) {
      displayExtensions.forEach((ext) => fileTypeGroups['Word'].add(ext));
    } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
      displayExtensions.forEach((ext) => fileTypeGroups['Excel'].add(ext));
    } else if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) {
      displayExtensions.forEach((ext) => fileTypeGroups['PowerPoint'].add(ext));
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
