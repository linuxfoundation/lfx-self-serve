// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Strips non-ASCII / quotes / backslashes from the ASCII fallback to block CR/LF header injection.
export function contentDispositionAttachment(fileName: string): string {
  const safeAscii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeRfc5987ValueChars(fileName)}`;
}

// encodeURIComponent leaves !'()* unescaped but RFC 5987 attr-char excludes them — extend the encoding.
function encodeRfc5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
