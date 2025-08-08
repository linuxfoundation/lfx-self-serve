// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
