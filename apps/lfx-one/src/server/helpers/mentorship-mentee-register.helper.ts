// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX, MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS } from '@lfx-one/shared/constants';
import { MentorshipMenteeDemographics, MentorshipMenteeRegisterRequest, MentorshipUpstreamMenteeProfileInput } from '@lfx-one/shared/interfaces';
import { getMentorshipMenteeRegisterRequestErrors } from '@lfx-one/shared/utils';

import { ServiceValidationError } from '../errors';
import { buildMentorshipUpstreamLfxProfileFields, buildMentorshipUpstreamProfileLinks, readMentorshipLfxProfileFields } from './mentorship-lfx-profile.helper';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Keeps the first of each case-insensitive repeat, as the skills picker and the profile update do, so a repeat is never stored. */
const withoutDuplicateSkills = (skills: string[]): string[] => {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = skill.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Drops unset and blank answers; `undefined` when nothing is left, so the upstream column stays unset. */
const withoutBlanks = <T extends Record<string, string | undefined>>(value: T): Partial<T> | undefined => {
  const entries = Object.entries(value).filter(([, answer]) => answer !== undefined && answer !== '');
  return entries.length > 0 ? (Object.fromEntries(entries) as Partial<T>) : undefined;
};

/**
 * Reads the optional demographics object. Only the five known answers are accepted, each exactly
 * one of its question's option values, so a stray key or value is refused rather than stored.
 * Returns `undefined` for a missing or empty object, or a message when the shape is wrong.
 */
const parseDemographics = (value: unknown): { demographics?: MentorshipMenteeDemographics; error?: string } => {
  if (value === undefined) return {};
  if (!isRecord(value)) return { error: 'Demographics must be an object.' };

  const demographics: MentorshipMenteeDemographics = {};
  for (const [key, answer] of Object.entries(value)) {
    const row = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS.find((candidate) => candidate.answerControl === key);
    if (!row) return { error: `Demographics contain an unknown answer: ${key}.` };
    if (typeof answer !== 'string' || !row.options.some((option) => option.value === answer)) {
      return { error: `Demographics contain an unknown value for ${key}.` };
    }
    demographics[key as keyof MentorshipMenteeDemographics] = answer;
  }
  return Object.keys(demographics).length > 0 ? { demographics } : {};
};

/**
 * Turns the `POST /api/mentorship/mentee/profile` body into a normalised request, or throws a 400
 * naming each bad field. Wrong types are reported first; once the shape is right the same rules
 * the register form applies (`getMentorshipMenteeRegisterRequestErrors`) run on the values, so the
 * browser and the BFF cannot drift. Repeated skills are dropped before those rules run, so the
 * skills cap counts what is stored. Only known keys are copied. The introduction HTML is stored as
 * sent, capped but not sanitised: every render path sanitises it. The optional `lfxProfile` is read
 * by `readMentorshipLfxProfileFields`, so a bad name or logo URL is a 400 too.
 */
export const parseMentorshipMenteeRegisterRequest = (body: unknown): MentorshipMenteeRegisterRequest => {
  if (!isRecord(body)) {
    throw ServiceValidationError.fromFieldErrors({ body: 'Request body must be a JSON object.' });
  }

  const typeErrors: Record<string, string> = {};
  const { introduction, skillsHave, skillsWant, additionalNotes, country } = body;
  if (typeof introduction !== 'string') typeErrors['introduction'] = 'Introduction must be a string.';
  if (!isStringArray(skillsHave)) typeErrors['skillsHave'] = 'Skills you currently have must be a list of strings.';
  if (!isStringArray(skillsWant)) typeErrors['skillsWant'] = 'Skills you would like to improve must be a list of strings.';
  if (typeof additionalNotes !== 'string') {
    typeErrors['additionalNotes'] = 'Additional notes must be a string.';
  } else if (additionalNotes.trim().length > MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX) {
    typeErrors['additionalNotes'] = `Additional notes must be ${MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX} characters or fewer.`;
  }
  if (typeof country !== 'string') typeErrors['country'] = 'Country must be a string.';
  for (const flag of ['ageEligible', 'workAuthorized', 'noDuplicateProfile', 'complianceAccepted', 'termsAccepted'] as const) {
    if (typeof body[flag] !== 'boolean') typeErrors[flag] = 'This confirmation must be true or false.';
  }
  const { demographics, error: demographicsError } = parseDemographics(body['demographics']);
  if (demographicsError) typeErrors['demographics'] = demographicsError;
  const lfxProfile = body['lfxProfile'] === undefined ? undefined : readMentorshipLfxProfileFields(body['lfxProfile'], 'lfxProfile');
  if (lfxProfile) Object.assign(typeErrors, lfxProfile.errors);

  if (Object.keys(typeErrors).length > 0) {
    throw ServiceValidationError.fromFieldErrors(typeErrors);
  }

  const request: MentorshipMenteeRegisterRequest = {
    introduction: introduction as string,
    skillsHave: withoutDuplicateSkills(skillsHave as string[]),
    skillsWant: withoutDuplicateSkills(skillsWant as string[]),
    additionalNotes: (additionalNotes as string).trim(),
    country: country as string,
    ...(demographics ? { demographics } : {}),
    ageEligible: body['ageEligible'] as boolean,
    workAuthorized: body['workAuthorized'] as boolean,
    noDuplicateProfile: body['noDuplicateProfile'] as boolean,
    complianceAccepted: body['complianceAccepted'] as boolean,
    termsAccepted: body['termsAccepted'] as boolean,
    ...(lfxProfile && Object.keys(lfxProfile.fields).length > 0 ? { lfxProfile: lfxProfile.fields } : {}),
  };

  const fieldErrors = getMentorshipMenteeRegisterRequestErrors(request);
  if (Object.keys(fieldErrors).length > 0) {
    throw ServiceValidationError.fromFieldErrors(fieldErrors as Record<string, string>);
  }
  return request;
};

/**
 * The `PUT /mentorship/v1/me/profiles/mentee` body. The JSON columns mirror what
 * `mapMentorshipMenteeProfile` reads back: `skill_set` carries both skill lists and the notes,
 * `address` the country code, `demographics` the age band, gender and race, `socioeconomics` the
 * income and education.
 * The name and logo are the LFX profile's, each sent only when the card had it; `email` is the
 * resolved primary email and `profile_links` the resolved GitHub link, each sent only when there is
 * one. The profile is new, so there are no stored links to keep. Phone and slug are not sent: an
 * unset slug cannot collide with another profile's.
 */
export const buildMentorshipUpstreamMenteeProfile = (
  request: MentorshipMenteeRegisterRequest,
  email?: string,
  githubProfileLink?: string
): MentorshipUpstreamMenteeProfileInput => {
  const profileLinks = buildMentorshipUpstreamProfileLinks(undefined, githubProfileLink);
  const demographics = withoutBlanks({ age: request.demographics?.age, gender: request.demographics?.gender, race: request.demographics?.raceEthnicity });
  const socioeconomics = withoutBlanks({ income: request.demographics?.income, educationLevel: request.demographics?.education });

  return {
    ...buildMentorshipUpstreamLfxProfileFields(request.lfxProfile, email),
    ...(profileLinks ? { profile_links: profileLinks } : {}),
    introduction: request.introduction,
    terms_and_conditions: request.termsAccepted,
    age_eligible: request.ageEligible,
    work_eligible: request.workAuthorized,
    skill_set: { skills: request.skillsHave, improvementSkills: request.skillsWant, comments: request.additionalNotes },
    address: { country: request.country },
    ...(demographics ? { demographics } : {}),
    ...(socioeconomics ? { socioeconomics } : {}),
  };
};
