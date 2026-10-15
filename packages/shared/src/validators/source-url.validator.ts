// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { FOUNDATION_MESSAGE_NONE_ANSWER } from '../constants/foundation-message.constants';

/**
 * A source LFX One fetches to text for an agent: blank, Paul's "none", or one
 * `https://` link. Raises `{ sourceUrl: { reason: 'unrecognized' } }` for
 * anything else — including a plain `http://` link, because the BFF fetches
 * over HTTPS only and would otherwise leave the source silently unread.
 */
export function sourceUrlValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (!value || value.toLowerCase() === FOUNDATION_MESSAGE_NONE_ANSWER) {
      return null;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:' && !/\s/.test(value)) {
        return null;
      }
    } catch {
      // Not a URL at all — reported below.
    }
    return { sourceUrl: { reason: 'unrecognized' } };
  };
}
