// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipMenteeDemographics, MentorshipMenteeProfileResponse, MentorshipUpstreamUserProfile } from '@lfx-one/shared/interfaces';

/** The mentorship service stores its JSON columns free-form, so each one is narrowed before use. */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A blank string is an unanswered field, the same as a missing one. */
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => asString(item) !== undefined) : []);

/** Display name for a stored resume link: the last path segment, or nothing when the URL has none. */
const resumeFileNameFromUrl = (url: string): string | undefined => {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Demographic answers split across two upstream columns: `demographics` holds age, gender and
 * race; `socioeconomics` holds income and education. Returns `undefined` when neither holds an answer.
 */
const mapDemographics = (profile: MentorshipUpstreamUserProfile): MentorshipMenteeDemographics | undefined => {
  const demographics = asRecord(profile.demographics);
  const socioeconomics = asRecord(profile.socioeconomics);
  const answers = Object.entries({
    age: asString(demographics?.['age']),
    gender: asString(demographics?.['gender']),
    raceEthnicity: asString(demographics?.['race']),
    income: asString(socioeconomics?.['income']),
    education: asString(socioeconomics?.['educationLevel']),
  }).filter(([, answer]) => answer !== undefined);

  return answers.length > 0 ? (Object.fromEntries(answers) as MentorshipMenteeDemographics) : undefined;
};

/**
 * Maps the caller's `user_profiles` row (`profile_type = mentee`) to the profile page payload.
 * Application history is not on this row; it comes from the caller's applications, so it is
 * empty here and the service fills it in.
 */
export const mapMentorshipMenteeProfile = (profile: MentorshipUpstreamUserProfile): MentorshipMenteeProfileResponse => {
  const skillSet = asRecord(profile.skill_set);
  const resumeUrl = asString(asRecord(profile.profile_links)?.['resumeLink']);

  return {
    profile: {
      aboutMe: asString(profile.introduction) ?? '',
      skillsHave: asStringArray(skillSet?.['skills']),
      skillsWant: asStringArray(skillSet?.['improvementSkills']),
      additionalNotes: asString(skillSet?.['comments']),
      resumeUrl,
      resumeFileName: resumeUrl ? resumeFileNameFromUrl(resumeUrl) : undefined,
    },
    history: [],
    demographics: mapDemographics(profile),
  };
};
