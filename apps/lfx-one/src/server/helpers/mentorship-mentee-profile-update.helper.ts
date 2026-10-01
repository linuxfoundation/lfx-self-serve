// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_VALUE_MAX_LENGTH,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX,
  MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_MENTEE_PROFILE_UPDATE_KEYS,
  MENTORSHIP_MENTEE_SKILL_SET_KEYS,
  MENTORSHIP_UPSTREAM_MENTEE_SKILL_SET_KEYS,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeDemographicGroupName,
  MentorshipMenteeProfileUpdateRequest,
  MentorshipMenteeSkillSetUpdate,
  MentorshipUpstreamMenteeProfileUpdate,
  MentorshipUpstreamUserProfile,
} from '@lfx-one/shared/interfaces';
// Deep imports, not the `@lfx-one/shared/utils` barrel: the barrel transitively pulls in Angular, which does not load in plain Node.
import { isMentorshipRichTextOverRawMax, mentorshipPlainTextToHtml } from '@lfx-one/shared/utils/mentorship.utils';
import { codePointLength } from '@lfx-one/shared/utils/string.utils';

import { ServiceValidationError } from '../errors';

const fail = (field: string, message: string, operation: string): never => {
  throw ServiceValidationError.forField(field, message, { operation });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The stored JSON column as a plain object without the `dropped` keys, or `{}` when it is absent or not an object. */
const storedColumn = (value: unknown, dropped: readonly string[] = []): Record<string, unknown> =>
  isPlainObject(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => !dropped.includes(key))) : {};

/** The object at `field`, or a 400 when it is not a plain object whose keys are all in `allowed`. */
const requireObject = (value: unknown, field: string, allowed: readonly string[], operation: string): Record<string, unknown> => {
  if (!isPlainObject(value)) return fail(field, `${field} must be an object`, operation);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) return fail(`${field}.${unknown}`, `${field}.${unknown} is not a supported field`, operation);
  return value;
};

const parseIntroduction = (value: unknown, operation: string): string => {
  if (typeof value !== 'string') return fail('introduction', 'introduction must be a string', operation);
  const text = value.trim();
  if (codePointLength(text) > MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX) {
    return fail('introduction', `introduction must be at most ${MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX} characters`, operation);
  }
  if (isMentorshipRichTextOverRawMax(mentorshipPlainTextToHtml(text))) {
    return fail('introduction', MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE, operation);
  }
  return text;
};

/** Trimmed, case-insensitively de-duplicated skills. A list needs at least one item, and items must be non-blank strings. */
const parseSkillList = (value: unknown, field: string, operation: string): string[] => {
  if (!Array.isArray(value)) return fail(field, `${field} must be an array`, operation);
  if (value.length === 0) return fail(field, `${field} must contain at least one skill`, operation);
  if (value.length > MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS) {
    return fail(field, `${field} must contain at most ${MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS} skills`, operation);
  }

  const seen = new Set<string>();
  const skills: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return fail(field, `${field} must only contain strings`, operation);
    const skill = item.trim();
    if (skill === '') return fail(field, `${field} must not contain blank skills`, operation);
    if (skill.length > MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH) {
      return fail(field, `Each skill in ${field} must be at most ${MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH} characters`, operation);
    }
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  return skills;
};

const parseSkillSet = (value: unknown, operation: string): MentorshipMenteeSkillSetUpdate => {
  const skillSet = requireObject(value, 'skillSet', MENTORSHIP_MENTEE_SKILL_SET_KEYS, operation);
  const skillsHave = parseSkillList(skillSet['skillsHave'], 'skillSet.skillsHave', operation);
  const skillsWant = parseSkillList(skillSet['skillsWant'], 'skillSet.skillsWant', operation);

  const rawNotes = skillSet['additionalNotes'];
  if (rawNotes === undefined) return { skillsHave, skillsWant };
  if (typeof rawNotes !== 'string') return fail('skillSet.additionalNotes', 'skillSet.additionalNotes must be a string', operation);

  const additionalNotes = rawNotes.trim();
  if (additionalNotes.length > MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX) {
    return fail('skillSet.additionalNotes', `skillSet.additionalNotes must be at most ${MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX} characters`, operation);
  }
  return additionalNotes === '' ? { skillsHave, skillsWant } : { skillsHave, skillsWant, additionalNotes };
};

/**
 * One demographics column. Values are bounded non-blank strings and are deliberately not checked against
 * the option lists: upstream validates nothing, and a stored legacy or `preferNotToSay` token must round-trip.
 */
const parseAnswerGroup = (value: unknown, field: MentorshipMenteeDemographicGroupName, operation: string): Record<string, string> => {
  const group = requireObject(value, field, MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS[field], operation);
  const entries = Object.entries(group);
  if (entries.length === 0) return fail(field, `${field} must contain at least one answer`, operation);

  const answers: Record<string, string> = {};
  for (const [key, answer] of entries) {
    if (typeof answer !== 'string') return fail(`${field}.${key}`, `${field}.${key} must be a string`, operation);
    const trimmed = answer.trim();
    if (trimmed === '') return fail(`${field}.${key}`, `${field}.${key} must not be blank`, operation);
    if (trimmed.length > MENTORSHIP_MENTEE_DEMOGRAPHIC_VALUE_MAX_LENGTH) {
      return fail(`${field}.${key}`, `${field}.${key} must be at most ${MENTORSHIP_MENTEE_DEMOGRAPHIC_VALUE_MAX_LENGTH} characters`, operation);
    }
    answers[key] = trimmed;
  }
  return answers;
};

/**
 * Validates the body of `PATCH /api/mentorship/mentee/profile` and returns a NEW normalized object, never the
 * request body itself. Upstream ignores unknown fields and validates nothing, so this is the only allowlist:
 * an unknown key, a null value, an empty group or an empty body is a 400. Every failure is a
 * `ServiceValidationError` carrying the field and a readable reason.
 */
export const parseMentorshipMenteeProfileUpdate = (body: unknown, operation: string): MentorshipMenteeProfileUpdateRequest => {
  const source = requireObject(body, 'body', MENTORSHIP_MENTEE_PROFILE_UPDATE_KEYS, operation);
  const keys = Object.keys(source);
  if (keys.length === 0) return fail('body', 'At least one profile field is required', operation);

  const nullish = keys.find((key) => source[key] === null || source[key] === undefined);
  if (nullish !== undefined) return fail(nullish, `${nullish} must not be null`, operation);

  const request: MentorshipMenteeProfileUpdateRequest = {};
  if ('introduction' in source) request.introduction = parseIntroduction(source['introduction'], operation);
  if ('skillSet' in source) request.skillSet = parseSkillSet(source['skillSet'], operation);
  if ('demographics' in source) request.demographics = parseAnswerGroup(source['demographics'], 'demographics', operation);
  if ('socioeconomics' in source) request.socioeconomics = parseAnswerGroup(source['socioeconomics'], 'socioeconomics', operation);
  return request;
};

/**
 * Maps a validated update to the upstream `PATCH /mentorship/v1/me/profiles/mentee` body. Only the present groups
 * are emitted (an omitted column is kept upstream), the introduction becomes escaped HTML, blank notes leave
 * `comments` out, and `profile_links` is never sent.
 *
 * Upstream replaces a present JSON column whole, so each emitted column is layered over `stored`, the row as it
 * was read before the save: keys the BFF does not model (and values it cannot map, such as a numeric `age`)
 * survive the edit. In `demographics` and `socioeconomics` a key the update leaves out means "unchanged", so the
 * whole stored column is kept underneath; in `skill_set` a left-out `comments` means "cleared", so only its
 * unmodelled keys are.
 */
export const buildMentorshipUpstreamMenteeProfileUpdate = (
  request: MentorshipMenteeProfileUpdateRequest,
  stored?: MentorshipUpstreamUserProfile
): MentorshipUpstreamMenteeProfileUpdate => {
  const upstream: MentorshipUpstreamMenteeProfileUpdate = {};

  if (request.introduction !== undefined) {
    upstream.introduction = mentorshipPlainTextToHtml(request.introduction);
  }

  if (request.skillSet) {
    const { skillsHave, skillsWant, additionalNotes } = request.skillSet;
    upstream.skill_set = {
      ...storedColumn(stored?.skill_set, MENTORSHIP_UPSTREAM_MENTEE_SKILL_SET_KEYS),
      skills: skillsHave,
      improvementSkills: skillsWant,
      ...(additionalNotes?.trim() ? { comments: additionalNotes.trim() } : {}),
    };
  }

  if (request.demographics) {
    const { age, gender, raceEthnicity } = request.demographics;
    upstream.demographics = {
      ...storedColumn(stored?.demographics),
      ...(age !== undefined ? { age } : {}),
      ...(gender !== undefined ? { gender } : {}),
      ...(raceEthnicity !== undefined ? { race: raceEthnicity } : {}),
    };
  }

  if (request.socioeconomics) {
    const { income, education } = request.socioeconomics;
    upstream.socioeconomics = {
      ...storedColumn(stored?.socioeconomics),
      ...(income !== undefined ? { income } : {}),
      ...(education !== undefined ? { educationLevel: education } : {}),
    };
  }

  return upstream;
};
