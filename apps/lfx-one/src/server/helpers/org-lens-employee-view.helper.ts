// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_EMPLOYEE_VIEW, ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS, ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS } from '@lfx-one/shared/constants';
import type { StripPersonalFieldsOptions } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { getOrgLensViewMode } from './org-lens-read-access.helper';

/** Case- and separator-insensitive field key: `first_name`, `firstName` and `FIRST-NAME` are one. */
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');

const PERSONAL_FIELD_KEYS: ReadonlySet<string> = new Set(ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS.map(normalizeKey));

// A real address in free text: a local part (any letters, digits and `._%+-`, so `ünal@x.com` and `josé@x.com` go whole), a dotted host and an
// alphabetic or punycode TLD; the host may be Unicode or punycode. It must not run on into a word, so a version spec (`pkg@1.2.3`) survives.
// The one ambiguity is unspaced CJK text glued to an ASCII local part (`联系ada@x.com`): {@link splitLeadingCjk} leaves the CJK words and
// removes only the address. A git SSH remote (`git@github.com:org/repo.git`) is the one address-shaped token kept on purpose, and only by
// {@link isGitRemote}: an address followed by a path or a colon is otherwise still an address.
const EMBEDDED_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:xn--[A-Za-z0-9-]{2,}|\p{L}{2,})(?![A-Za-z0-9_-]|\.[\p{L}\p{N}_])/gu;

/** Scripts written without spaces, whose words are not part of an address when they sit directly before an ASCII local part. */
const CJK_THEN_ASCII_LOCAL = /^(.*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])([A-Za-z0-9._%+-]+)$/u;

/** Splits a matched address into the CJK words glued in front of an ASCII local part (kept) and the address itself (removed). */
function splitLeadingCjk(match: string): { keep: string; address: string } {
  const at = match.indexOf('@');
  const split = CJK_THEN_ASCII_LOCAL.exec(match.slice(0, at));
  return split ? { keep: split[1], address: split[2] + match.slice(at) } : { keep: '', address: match };
}

/** A recognized git remote: the user is exactly `git` and a path follows (`git@host:org/repo.git`, `ssh://git@host/org/repo.git`). */
function isGitRemote(address: string, following: string): boolean {
  return address.slice(0, address.indexOf('@')).toLowerCase() === 'git' && /^[:/][\p{L}\p{N}_~]/u.test(following);
}

/** A whole value that is an address, by the same rule as {@link EMBEDDED_EMAIL}: `git@git.example.com:org/repo.git` and `pkg@1.2.3` are not. */
const EMAIL_SHAPE = /^[^\s@]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:xn--[A-Za-z0-9-]{2,}|\p{L}{2,})$/u;

/** A URL that names a person: a `mailto:` link, or a LinkedIn / X / Twitter profile path. */
const PERSONAL_URL = /(?:mailto:\S+|https?:\/\/(?:[\w-]+\.)?(?:linkedin\.com\/(?:in|pub)\/|(?:x|twitter)\.com\/(?!i\/|intent\/|share)[\w]+)\S*)/gi;

/**
 * Removes personal data embedded in free text: an email address inside a sentence (a commit message's
 * `Signed-off-by: A <a@b.co>`), a `mailto:` link, and personal-profile URLs. Strings only; use
 * {@link stripPersonalFields} for whole payloads, which applies this to every string value.
 */
export function scrubFreeText(text: string): string {
  return text.replace(PERSONAL_URL, '').replace(EMBEDDED_EMAIL, (match, offset: number, whole: string) => {
    const { keep, address } = splitLeadingCjk(match);
    return isGitRemote(address, whole.slice(offset + match.length, offset + match.length + 2)) ? match : keep;
  });
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
 * A field the route lists in `extraFields` is removed even when an exception names it: the route's explicit removal wins.
 *
 * It removes fields, it does not decide what a page may show: a page story still decides which endpoints to
 * `blockEmployeeView` outright, and whether a count derived from people is itself revealing.
 */
export function stripPersonalFields<T>(data: T, options: StripPersonalFieldsOptions): T {
  const exceptions = options.exceptions ?? ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS;
  // A field a route removes explicitly always wins: a page exception covers the default personal-field list only, never an `extraFields` entry.
  const routeRemoved = new Set((options.extraFields ?? []).map(normalizeKey));
  const allowed = new Set(
    exceptions
      .filter((entry) => entry.page === options.page)
      .map((entry) => normalizeKey(entry.field))
      .filter((key) => !routeRemoved.has(key))
  );
  const removed = new Set([...PERSONAL_FIELD_KEYS, ...routeRemoved]);
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
