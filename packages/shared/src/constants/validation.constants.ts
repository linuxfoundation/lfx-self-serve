// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Validation constants for form field validation
 * @description Regular expression patterns and validation rules used across the application
 */

/**
 * LinkedIn profile URL validation pattern
 * @description Validates LinkedIn profile URLs with the following rules:
 * - Optional http:// or https:// protocol
 * - Optional subdomain (2-3 lowercase letters followed by dot, e.g., "www.", "uk.")
 * - Must contain "linkedin.com/"
 * - Must have content after the domain
 *
 * @example Valid URLs:
 * - https://www.linkedin.com/in/username
 * - https://linkedin.com/in/username
 * - http://www.linkedin.com/company/example
 * - linkedin.com/in/username
 * - uk.linkedin.com/in/username
 *
 * @example Invalid URLs:
 * - https://google.com
 * - https://linkedin.net/in/username
 * - linkedin.com (missing path)
 */
export const LINKEDIN_PROFILE_PATTERN = /^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/.*$/;
