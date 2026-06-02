// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { LINUX_ALIAS_BANNED_CHARS, LINUX_ALIAS_MAX_LENGTH, LINUX_ALIAS_RESERVED_NAMES } from '../constants/linux-email.constants';

/**
 * Validates a Linux.com alias local part against the same rules the v2
 * auth-service / forwards-service enforce, so bad input is rejected before the
 * NATS round-trip. The server's `check_alias` remains the source of truth.
 *
 * Returns one of: `{ required }`, `{ aliasMaxLength }`,
 * `{ aliasInvalidChars }`, or `{ aliasReserved }`.
 */
export function linuxAliasValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null; // defer to required validator

    if (typeof value !== 'string') return { aliasInvalidChars: true };

    const normalized = value.trim().toLowerCase();

    if (normalized.length === 0) return { required: true };
    if (normalized.length > LINUX_ALIAS_MAX_LENGTH) return { aliasMaxLength: { requiredLength: LINUX_ALIAS_MAX_LENGTH, actualLength: normalized.length } };

    if (LINUX_ALIAS_BANNED_CHARS.some((char) => normalized.includes(char))) return { aliasInvalidChars: true };

    if (LINUX_ALIAS_RESERVED_NAMES.includes(normalized as (typeof LINUX_ALIAS_RESERVED_NAMES)[number])) return { aliasReserved: true };

    return null;
  };
}
