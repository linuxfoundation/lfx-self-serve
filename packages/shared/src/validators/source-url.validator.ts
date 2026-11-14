// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { FOUNDATION_MESSAGE_NONE_ANSWER } from '../constants/foundation-message.constants';

/**
 * A source link an agent fetches itself: blank, the agent's "none", or one
 * `https://` link — with `list`, one such link per line, blank lines ignored;
 * with `none: false`, "none" is refused like any other non-link (a REQUIRED
 * source, the Messaging Framework's website, has to be a real page). Raises
 * `{ sourceUrl: { reason: 'unrecognized' } }` for anything else, including a
 * plain `http://` link: a source is a public page, and a mistyped scheme is
 * the mistake worth catching while the user is looking.
 */
export function sourceUrlValidator(options: { list?: boolean; none?: boolean } = {}): ValidatorFn {
  const acceptsNone = !options.list && options.none !== false;
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (!value || (acceptsNone && value.toLowerCase() === FOUNDATION_MESSAGE_NONE_ANSWER)) {
      return null;
    }
    const entries = options.list
      ? value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== '')
      : [value];
    return entries.every(isHttpsLink) ? null : { sourceUrl: { reason: 'unrecognized' } };
  };
}

/**
 * One `https://` link with no whitespace inside it. The prefix is checked on
 * the value as typed, because that is what is submitted: `new URL` repairs
 * `https:example.org` to a valid URL, but the BFF reads the literal value and
 * refuses it.
 */
function isHttpsLink(value: string): boolean {
  if (!value.startsWith('https://') || /\s/.test(value)) {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
