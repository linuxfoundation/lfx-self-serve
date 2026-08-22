// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Validation constants
 * @description Regular expression patterns and validation rules used across the application, plus the
 * two values that form the contract between the server's validation error envelope and the frontend
 * readers that decide what of it a user is shown.
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

/** Matches a non-negative whole number (no decimals, no sign). Used for fields like accommodationNumberOfNights. */
export const WHOLE_NUMBER_PATTERN = /^\d+$/;

/** Validates YYYY-MM month format with valid month ranges (01-12). Used for server-side month query parameter validation. */
export const MONTH_FORMAT_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The prefix `ServiceValidationError` puts on a validation message it built itself, rather than one a
 * caller wrote for a person to read. `forField` appends the *wire key* to it ("Validation failed for
 * invitee_email"), so the frontend uses this prefix to know the readable reason lives in `errors[]`
 * instead — see `readErrorBodyMessage`, which both frontend error readers share.
 *
 * It lives here because both ends of that contract depend on the exact string: reword it on the server
 * without this constant and every affected toast silently falls back to showing a wire key.
 */
export const VALIDATION_FAILED_MESSAGE_PREFIX = 'Validation failed';

/**
 * Longest plain-text error body `readErrorBodyMessage` will put in front of a user. Angular returns the
 * raw response text for any non-2xx body that isn't JSON, so what arrives can be a proxy's HTML page or
 * a stack trace rather than a message; this is the length half of the check that keeps a document out
 * of a toast. Generous for a real sentence, well short of any document.
 */
export const MAX_PLAIN_TEXT_BODY_LENGTH = 200;
