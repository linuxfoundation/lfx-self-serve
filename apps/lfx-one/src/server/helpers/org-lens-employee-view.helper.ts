// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_EMPLOYEE_VIEW, ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS, ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS } from '@lfx-one/shared/constants';
import type { StripPersonalFieldsOptions } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { getOrgLensViewMode } from './org-lens-read-access.helper';

/** Case- and separator-insensitive field key: `first_name`, `firstName` and `FIRST-NAME` are one. */
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');

const PERSONAL_FIELD_KEYS: ReadonlySet<string> = new Set(ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS.map(normalizeKey));

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A real address: a plain local part, a dotted host and an alphabetic TLD. It must not run on into a path or a word, so
// technical identifiers survive: a git SSH remote (`git@github.com:org/repo.git`), a version spec (`pkg@1.2.3`).
const EMBEDDED_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-]|[:/][\w~])/g;

/** A URL that names a person: a `mailto:` link, or a LinkedIn / X / Twitter profile path. */
const PERSONAL_URL = /(?:mailto:\S+|https?:\/\/(?:[\w-]+\.)?(?:linkedin\.com\/(?:in|pub)\/|(?:x|twitter)\.com\/(?!i\/|intent\/|share)[\w]+)\S*)/gi;

/**
 * Removes personal data embedded in free text: an email address inside a sentence (a commit message's
 * `Signed-off-by: A <a@b.co>`), a `mailto:` link, and personal-profile URLs. Strings only; use
 * {@link stripPersonalFields} for whole payloads, which applies this to every string value.
 */
export function scrubFreeText(text: string): string {
  return text.replace(PERSONAL_URL, '').replace(EMBEDDED_EMAIL, '');
}

/**
 * Returns a deep copy of `data` with every personal field removed: the keys in
 * `ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS`, the route's `extraFields`, and any value that is shaped like an email
 * address (a defence against an address arriving under a key nobody listed), and an email address or personal-profile
 * URL embedded in free text (replaced with nothing, see {@link scrubFreeText}). Works through nested objects and
 * arrays; never mutates its input; leaves primitives, `null` and dates as they are.
 *
 * Nothing is exposed by default. A field survives only when `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS` holds an entry for
 * this `page` and that exact field name (an email-shaped value under an excepted key stays too). The list is empty at launch.
 *
 * It removes fields, it does not decide what a page may show: a page story still decides which endpoints to
 * `blockEmployeeView` outright, and whether a count derived from people is itself revealing.
 */
export function stripPersonalFields<T>(data: T, options: StripPersonalFieldsOptions): T {
  const exceptions = options.exceptions ?? ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS;
  const allowed = new Set(exceptions.filter((entry) => entry.page === options.page).map((entry) => normalizeKey(entry.field)));
  const removed = new Set([...PERSONAL_FIELD_KEYS, ...(options.extraFields ?? []).map(normalizeKey)]);
  for (const key of allowed) removed.delete(key);
  return strip(data, removed, allowed) as T;
}

function strip(value: unknown, removed: ReadonlySet<string>, allowed: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    // An email-shaped string inside an array of values (`['a@b.co']`) has no key to match, so it is dropped here.
    return value.filter((item) => !(typeof item === 'string' && EMAIL_SHAPE.test(item))).map((item) => strip(item, removed, allowed));
  }
  if (typeof value === 'string') {
    return scrubFreeText(value);
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (removed.has(normalized)) continue;
    if (typeof entry === 'string' && EMAIL_SHAPE.test(entry) && !allowed.has(normalized)) continue;
    result[key] = allowed.has(normalized) && typeof entry === 'string' ? entry : strip(entry, removed, allowed);
  }
  return result;
}

/**
 * The one call a page story adds to a handler: the response unchanged in the full view, stripped in the all
 * employee view. Fails closed through {@link getOrgLensViewMode} (an unresolved gate redacts).
 *
 * ```ts
 * res.json(redactForEmployeeView(req, orgUid, result, { page: 'projects' }));
 * ```
 */
export function redactForEmployeeView<T>(req: Request, orgUid: string, data: T, options: StripPersonalFieldsOptions): T {
  return getOrgLensViewMode(req, orgUid) === ORG_LENS_EMPLOYEE_VIEW ? stripPersonalFields(data, options) : data;
}
