// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Basic regex pattern to identify potential URLs in text
 * This is used for initial detection only, followed by proper URL validation.
 * Pattern matches http:// or https:// followed by non-whitespace/control characters.
 * We intentionally exclude common dangerous characters: <>"{}|\^`[]
 */
const URL_DETECTION_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

/**
 * List of additional dangerous URL patterns to reject
 */
const DANGEROUS_URL_PATTERNS = [/javascript:/i, /data:/i, /vbscript:/i, /file:/i, /ftp:/i];

/**
 * Validates if a string is a valid and safe URL
 * @param urlString - The URL string to validate
 * @returns true if the URL is valid and safe
 */
export function isValidUrl(urlString: string): boolean {
  // Check for dangerous URL patterns first
  for (const pattern of DANGEROUS_URL_PATTERNS) {
    if (pattern.test(urlString)) {
      console.debug(`Rejected dangerous URL pattern: ${urlString}`);
      return false;
    }
  }

  try {
    const url = new URL(urlString);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      console.debug(`Invalid URL protocol: ${url.protocol} for URL: ${urlString}`);
      return false;
    }

    // Basic hostname validation
    if (!url.hostname || url.hostname.length < 3) {
      console.debug(`Invalid hostname: ${url.hostname} for URL: ${urlString}`);
      return false;
    }

    // Reject localhost and private IP ranges for security
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname.startsWith('192.168.') ||
      hostname === '0.0.0.0'
    ) {
      console.debug(`Rejected private/local URL: ${urlString}`);
      return false;
    }

    return true;
  } catch (error) {
    console.debug(`URL validation failed for: ${urlString}`, error);
    return false;
  }
}

/**
 * Extracts all valid URLs from a given text string
 * @param text - The text to extract URLs from
 * @returns Array of validated URL strings found in the text
 */
export function extractUrls(text: string): string[] {
  if (!text) {
    return [];
  }

  const potentialUrls = [...text.matchAll(URL_DETECTION_REGEX)];
  const validUrls: string[] = [];

  potentialUrls.forEach((match) => {
    const url = match[0];
    if (isValidUrl(url)) {
      validUrls.push(url);
    }
  });

  return validUrls;
}

/**
 * Extracts unique valid URLs with their domain names from text
 * @param text - The text to extract URLs from
 * @returns Array of objects containing validated URL and domain
 */
export function extractUrlsWithDomains(text: string): { url: string; domain: string }[] {
  if (!text) {
    return [];
  }

  const urls = extractUrls(text);
  const uniqueUrls = new Map<string, { url: string; domain: string }>();

  urls.forEach((url) => {
    if (!uniqueUrls.has(url)) {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace(/^www\./, '');
        uniqueUrls.set(url, { url, domain });
      } catch (error) {
        // This should not happen after isValidUrl check, but log it for debugging
        console.warn(`Unexpected error parsing validated URL: ${url}`, error);
      }
    }
  });

  return Array.from(uniqueUrls.values());
}

/**
 * URL regex pattern for linkification (kept for backward compatibility)
 * @deprecated Use extractUrls() function instead for safer URL detection
 */
export const URL_REGEX = URL_DETECTION_REGEX;
