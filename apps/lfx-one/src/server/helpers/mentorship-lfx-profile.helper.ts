// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipLfxProfileFields, MentorshipUpstreamLfxProfileFields } from '@lfx-one/shared/interfaces';
import { getMentorshipLfxProfileFieldErrors } from '@lfx-one/shared/utils';

/**
 * Reads an LFX profile object: the name, email and avatar a mentorship profile copies. Only the four
 * known keys are read, each a string, trimmed, then held to the rules the browser applies
 * (`getMentorshipLfxProfileFieldErrors`). Upstream stores these as sent, so a bad value is refused
 * here rather than dropped. Errors are keyed `<field>.<key>` (`lfxProfile.email`), or by the bare key
 * when `field` is empty because the object is the whole body. `fields` holds only the keys sent.
 */
export const readMentorshipLfxProfileFields = (value: unknown, field = ''): { fields: MentorshipLfxProfileFields; errors: Record<string, string> } => {
  const keyFor = (key: string): string => (field ? `${field}.${key}` : key);

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { fields: {}, errors: { [field || 'body']: 'The LFX profile must be a JSON object.' } };
  }

  const record = value as Record<string, unknown>;
  const fields: MentorshipLfxProfileFields = {};
  const errors: Record<string, string> = {};
  for (const key of ['firstName', 'lastName', 'email', 'logoUrl'] as const) {
    const raw = record[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') {
      errors[keyFor(key)] = 'This field must be a string.';
      continue;
    }
    fields[key] = raw.trim();
  }
  for (const [key, message] of Object.entries(getMentorshipLfxProfileFieldErrors(fields))) {
    errors[keyFor(key)] = message;
  }
  return { fields, errors };
};

/** The same fields in the upstream profile's column names. An absent field stays absent, so its column is left as it is. */
export const buildMentorshipUpstreamLfxProfileFields = (fields: MentorshipLfxProfileFields | undefined): MentorshipUpstreamLfxProfileFields => ({
  ...(fields?.firstName !== undefined ? { first_name: fields.firstName } : {}),
  ...(fields?.lastName !== undefined ? { last_name: fields.lastName } : {}),
  ...(fields?.email !== undefined ? { email: fields.email } : {}),
  ...(fields?.logoUrl !== undefined ? { logo_url: fields.logoUrl } : {}),
});
