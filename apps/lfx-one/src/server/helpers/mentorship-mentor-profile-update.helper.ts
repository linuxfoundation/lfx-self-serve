// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTOR_PROFILE_UPDATE_KEYS } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileUpdateRequest, MentorshipUpstreamMentorProfileUpdate, MentorshipUpstreamUserProfile } from '@lfx-one/shared/interfaces';
// Deep import, not the `@lfx-one/shared/utils` barrel: the barrel transitively pulls in Angular, which does not load in plain Node.
import { getMentorshipMentorProfileErrors } from '@lfx-one/shared/utils/mentorship.utils';

import { ServiceValidationError } from '../errors';
import { asRecord } from './mentorship-profile-columns.helper';

const fail = (field: string, message: string, operation: string): never => {
  throw ServiceValidationError.forField(field, message, { operation });
};

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
 * Validates the body of `PATCH /api/mentorship/mentor/profile` and returns a NEW normalised object, never the
 * request body itself. Upstream ignores unknown fields, so this is the only allowlist: an unknown key, a null
 * value or an empty body is a 400. Once the types are right, the rules the edit drawer and the register form
 * apply (`getMentorshipMentorProfileErrors`) run on the present fields, so the browser and the BFF cannot
 * drift. Repeated skills are dropped first. The introduction HTML is stored as sent, capped but not
 * sanitised: every render path sanitises it.
 */
export const parseMentorshipMentorProfileUpdate = (body: unknown, operation: string): MentorshipMentorProfileUpdateRequest => {
  const source = asRecord(body);
  if (!source) return fail('body', 'Request body must be a JSON object.', operation);

  const keys = Object.keys(source);
  const unknown = keys.find((key) => !(MENTORSHIP_MENTOR_PROFILE_UPDATE_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return fail(`body.${unknown}`, `${unknown} is not a supported field`, operation);
  if (keys.length === 0) return fail('body', 'At least one profile field is required', operation);

  const nullish = keys.find((key) => source[key] === null || source[key] === undefined);
  if (nullish !== undefined) return fail(nullish, `${nullish} must not be null`, operation);

  const request: MentorshipMentorProfileUpdateRequest = {};
  if ('introduction' in source) {
    const introduction = source['introduction'];
    if (typeof introduction !== 'string') return fail('introduction', 'Introduction must be a string.', operation);
    request.introduction = introduction;
  }
  if ('skills' in source) {
    const skills = source['skills'];
    if (!Array.isArray(skills) || !skills.every((skill) => typeof skill === 'string')) {
      return fail('skills', 'Skills must be a list of strings.', operation);
    }
    request.skills = withoutDuplicateSkills(skills);
  }

  const fieldErrors = getMentorshipMentorProfileErrors(request);
  if (Object.keys(fieldErrors).length > 0) {
    throw ServiceValidationError.fromFieldErrors(fieldErrors as Record<string, string>, 'Validation failed', { operation });
  }
  return request;
};

/**
 * Maps a validated update to the upstream `PATCH /mentorship/v1/me/profiles/mentor` body. Only the present
 * fields are emitted, since upstream keeps every column the body leaves out, and `profile_links` is never sent.
 * Upstream replaces `skill_set` whole, so the new skills are layered over `stored`, the row as it was read
 * before the save: keys the BFF does not model survive the edit.
 */
export const buildMentorshipUpstreamMentorProfileUpdate = (
  request: MentorshipMentorProfileUpdateRequest,
  stored?: MentorshipUpstreamUserProfile
): MentorshipUpstreamMentorProfileUpdate => {
  const upstream: MentorshipUpstreamMentorProfileUpdate = {};
  if (request.introduction !== undefined) upstream.introduction = request.introduction;
  if (request.skills !== undefined) upstream.skill_set = { ...asRecord(stored?.skill_set), skills: request.skills };
  return upstream;
};
