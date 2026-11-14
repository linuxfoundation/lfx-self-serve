// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamUserProfile } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapMentorshipMenteeProfile } from './mentorship-mentee-profile.helper';

const baseProfile: MentorshipUpstreamUserProfile = {
  id: 'prof-1',
  user_id: 'user-1',
  profile_type: 'mentee',
  terms_and_conditions: true,
  number_of_projects: 0,
  created_on: '2026-01-01T00:00:00Z',
  updated_on: '2026-01-01T00:00:00Z',
};

describe('mapMentorshipMenteeProfile', () => {
  it('maps every stored field onto the profile page payload', () => {
    const result = mapMentorshipMenteeProfile({
      ...baseProfile,
      introduction: 'Test mentee introduction.',
      skill_set: { skills: ['Go', 'Python'], improvementSkills: ['Code Review'], comments: 'Test notes.' },
      demographics: { age: '20-39', gender: 'prefer-not-to-say', race: 'prefer-not-to-say' },
      socioeconomics: { income: 'prefer-not-to-say', educationLevel: 'college' },
      address: { country: 'KE', city: 'Test City' },
    });

    expect(result).toEqual({
      profile: {
        aboutMe: 'Test mentee introduction.',
        skillsHave: ['Go', 'Python'],
        skillsWant: ['Code Review'],
        additionalNotes: 'Test notes.',
        country: 'KE',
      },
      history: [],
      demographics: { age: '20-39', gender: 'prefer-not-to-say', raceEthnicity: 'prefer-not-to-say', income: 'prefer-not-to-say', education: 'college' },
    });
  });

  it('returns an empty profile for a row with no answers', () => {
    expect(mapMentorshipMenteeProfile(baseProfile)).toEqual({
      profile: { aboutMe: '', skillsHave: [], skillsWant: [], additionalNotes: undefined },
      history: [],
      demographics: undefined,
    });
  });

  it('treats blank and non-string values as unanswered', () => {
    const result = mapMentorshipMenteeProfile({
      ...baseProfile,
      introduction: '   ',
      skill_set: { skills: ['Go', '', 42, null], improvementSkills: 'Code Review', comments: '' },
      demographics: { age: '', gender: 3 },
    });

    expect(result.profile).toEqual({
      aboutMe: '',
      skillsHave: ['Go'],
      skillsWant: [],
      additionalNotes: undefined,
    });
    expect(result.demographics).toBeUndefined();
  });

  it('ignores JSON columns that are not objects', () => {
    const result = mapMentorshipMenteeProfile({ ...baseProfile, skill_set: ['Go'], demographics: 'college', socioeconomics: null, address: 'KE' });

    expect(result.profile.skillsHave).toEqual([]);
    expect(result.profile).not.toHaveProperty('country');
    expect(result.demographics).toBeUndefined();
  });

  it('keeps only the demographic answers that were given, across both columns', () => {
    const result = mapMentorshipMenteeProfile({ ...baseProfile, demographics: { age: '20-39' }, socioeconomics: { educationLevel: 'college' } });

    expect(result.demographics).toEqual({ age: '20-39', education: 'college' });
  });
});
