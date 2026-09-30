// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_LFX_PROFILE_EMAIL_MAX } from '@lfx-one/shared/constants';
import { MentorshipLfxProfileFields, MentorshipUpstreamLfxProfileFields } from '@lfx-one/shared/interfaces';
import { getMentorshipLfxProfileFieldErrors, isValidEmail } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { EmailVerificationService } from '../services/email-verification.service';
import { getEffectiveSub } from '../utils/auth-helper';

/**
 * Reads an LFX profile object: the name and avatar a mentorship profile copies from the browser.
 * Only the three known keys are read, each a string, trimmed, then held to the rules the browser
 * applies (`getMentorshipLfxProfileFieldErrors`). Upstream stores these as sent, so a bad value is
 * refused here rather than dropped. Any other key is ignored, `email` included: the email comes
 * from `resolveMentorshipPrimaryEmail`. Errors are keyed `<field>.<key>` (`lfxProfile.logoUrl`), or
 * by the bare key when `field` is empty because the object is the whole body. `fields` holds only
 * the keys sent.
 */
export const readMentorshipLfxProfileFields = (value: unknown, field = ''): { fields: MentorshipLfxProfileFields; errors: Record<string, string> } => {
  const keyFor = (key: string): string => (field ? `${field}.${key}` : key);

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { fields: {}, errors: { [field || 'body']: 'The LFX profile must be a JSON object.' } };
  }

  const record = value as Record<string, unknown>;
  const fields: MentorshipLfxProfileFields = {};
  const errors: Record<string, string> = {};
  for (const key of ['firstName', 'lastName', 'logoUrl'] as const) {
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

/**
 * The caller's verified primary email, read from the auth service, for the mentorship profile's
 * `email` column. The browser's copy is never used: upstream stores the column as sent, so a
 * crafted body could otherwise store an address the caller does not own. `undefined` when there is
 * no signed-in user, the lookup fails, or the address is not email-shaped within its cap, so the
 * column is left as it is rather than blanked.
 */
export const resolveMentorshipPrimaryEmail = async (req: Request, emailService: EmailVerificationService): Promise<string | undefined> => {
  const userSub = getEffectiveSub(req);
  if (!userSub) return undefined;

  const email = (await emailService.getUserEmails(req, userSub))?.primary_email?.trim();
  return email && email.length <= MENTORSHIP_LFX_PROFILE_EMAIL_MAX && isValidEmail(email) ? email : undefined;
};

/**
 * The same fields in the upstream profile's column names, with the resolved primary `email`. An
 * absent field stays absent, so its column is left as it is.
 */
export const buildMentorshipUpstreamLfxProfileFields = (
  fields: MentorshipLfxProfileFields | undefined,
  email?: string
): MentorshipUpstreamLfxProfileFields => ({
  ...(fields?.firstName !== undefined ? { first_name: fields.firstName } : {}),
  ...(fields?.lastName !== undefined ? { last_name: fields.lastName } : {}),
  ...(email !== undefined ? { email } : {}),
  ...(fields?.logoUrl !== undefined ? { logo_url: fields.logoUrl } : {}),
});
