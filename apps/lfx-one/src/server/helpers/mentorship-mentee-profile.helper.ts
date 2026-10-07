// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipMenteeDemographics, MentorshipMenteeProfileResponse, MentorshipUpstreamUserProfile } from '@lfx-one/shared/interfaces';

import { asRecord, asString, asStringArray } from './mentorship-profile-columns.helper';

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
  const country = asString(asRecord(profile.address)?.['country']);

  return {
    profile: {
      aboutMe: asString(profile.introduction) ?? '',
      skillsHave: asStringArray(skillSet?.['skills']),
      skillsWant: asStringArray(skillSet?.['improvementSkills']),
      additionalNotes: asString(skillSet?.['comments']),
      ...(country !== undefined ? { country } : {}),
    },
    history: [],
    demographics: mapDemographics(profile),
  };
};
