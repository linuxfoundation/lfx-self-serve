// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipMentorRegisterRequest, MentorshipUpstreamMentorProfileInput } from '@lfx-one/shared/interfaces';
import { getMentorshipMentorRegisterErrors } from '@lfx-one/shared/utils';

import { ServiceValidationError } from '../errors';
import { buildMentorshipUpstreamLfxProfileFields, readMentorshipLfxProfileFields } from './mentorship-lfx-profile.helper';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Keeps the first of each case-insensitive repeat, as the skills picker does, so a repeat is never stored. */
const withoutDuplicateSkills = (skills: string[]): string[] => {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = skill.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Turns the `POST /api/mentorship/mentor/profile` body into a normalised request, or throws a 400
 * naming each bad field. Wrong types are reported first; once the shape is right the same rules
 * the register form applies (`getMentorshipMentorRegisterErrors`) run on the values, so the
 * browser and the BFF cannot drift. Both confirmations must be `true`. Repeated skills are dropped
 * before those rules run. Only known keys are copied. The introduction HTML is stored as sent,
 * capped but not sanitised: every render path sanitises it. The optional `lfxProfile` is read by
 * `readMentorshipLfxProfileFields`, so a bad name or logo URL is a 400 too.
 */
export const parseMentorshipMentorRegisterRequest = (body: unknown): MentorshipMentorRegisterRequest => {
  if (!isRecord(body)) {
    throw ServiceValidationError.fromFieldErrors({ body: 'Request body must be a JSON object.' });
  }

  const typeErrors: Record<string, string> = {};
  const { introduction, skills } = body;
  if (typeof introduction !== 'string') typeErrors['introduction'] = 'Introduction must be a string.';
  if (!isStringArray(skills)) typeErrors['skills'] = 'Skills must be a list of strings.';
  for (const flag of ['complianceAccepted', 'termsAccepted'] as const) {
    if (typeof body[flag] !== 'boolean') typeErrors[flag] = 'This confirmation must be true or false.';
  }

  const lfxProfile = body['lfxProfile'] === undefined ? undefined : readMentorshipLfxProfileFields(body['lfxProfile'], 'lfxProfile');
  if (lfxProfile) Object.assign(typeErrors, lfxProfile.errors);

  if (Object.keys(typeErrors).length > 0) {
    throw ServiceValidationError.fromFieldErrors(typeErrors);
  }

  const request: MentorshipMentorRegisterRequest = {
    introduction: introduction as string,
    skills: withoutDuplicateSkills(skills as string[]),
    complianceAccepted: body['complianceAccepted'] as boolean,
    termsAccepted: body['termsAccepted'] as boolean,
    ...(lfxProfile && Object.keys(lfxProfile.fields).length > 0 ? { lfxProfile: lfxProfile.fields } : {}),
  };

  const fieldErrors = getMentorshipMentorRegisterErrors(request);
  if (Object.keys(fieldErrors).length > 0) {
    throw ServiceValidationError.fromFieldErrors(fieldErrors as Record<string, string>);
  }
  return request;
};

/**
 * The `PUT /mentorship/v1/me/profiles/mentor` body. `skill_set` carries the skills under the same
 * key the mentee register writes. Upstream has no compliance column, so that confirmation is
 * checked by `parseMentorshipMentorRegisterRequest` and goes no further. The name and logo are the
 * LFX profile's, each sent only when the card had it; `email` is the resolved primary email, sent
 * only when there is one. Phone and slug are not sent: an unset slug cannot collide with another
 * profile's.
 */
export const buildMentorshipUpstreamMentorProfile = (request: MentorshipMentorRegisterRequest, email?: string): MentorshipUpstreamMentorProfileInput => ({
  ...buildMentorshipUpstreamLfxProfileFields(request.lfxProfile, email),
  introduction: request.introduction,
  terms_and_conditions: request.termsAccepted,
  skill_set: { skills: request.skills },
});
