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
      profile_links: { resumeLink: 'https://example.com/files/test%20resume.pdf' },
      demographics: { age: '20-39', gender: 'prefer-not-to-say', race: 'prefer-not-to-say' },
      socioeconomics: { income: 'prefer-not-to-say', educationLevel: 'college' },
    });

    expect(result).toEqual({
      profile: {
        aboutMe: 'Test mentee introduction.',
        skillsHave: ['Go', 'Python'],
        skillsWant: ['Code Review'],
        additionalNotes: 'Test notes.',
        resumeUrl: 'https://example.com/files/test%20resume.pdf',
        resumeFileName: 'test resume.pdf',
      },
      history: [],
      demographics: { age: '20-39', gender: 'prefer-not-to-say', raceEthnicity: 'prefer-not-to-say', income: 'prefer-not-to-say', education: 'college' },
    });
  });

  it('returns an empty profile for a row with no answers', () => {
    expect(mapMentorshipMenteeProfile(baseProfile)).toEqual({
      profile: { aboutMe: '', skillsHave: [], skillsWant: [], additionalNotes: undefined, resumeUrl: undefined, resumeFileName: undefined },
      history: [],
      demographics: undefined,
    });
  });

  it('treats blank and non-string values as unanswered', () => {
    const result = mapMentorshipMenteeProfile({
      ...baseProfile,
      introduction: '   ',
      skill_set: { skills: ['Go', '', 42, null], improvementSkills: 'Code Review', comments: '' },
      profile_links: { resumeLink: 7 },
      demographics: { age: '', gender: 3 },
    });

    expect(result.profile).toEqual({
      aboutMe: '',
      skillsHave: ['Go'],
      skillsWant: [],
      additionalNotes: undefined,
      resumeUrl: undefined,
      resumeFileName: undefined,
    });
    expect(result.demographics).toBeUndefined();
  });

  it('ignores JSON columns that are not objects', () => {
    const result = mapMentorshipMenteeProfile({ ...baseProfile, skill_set: ['Go'], demographics: 'college', socioeconomics: null });

    expect(result.profile.skillsHave).toEqual([]);
    expect(result.demographics).toBeUndefined();
  });

  it('keeps only the demographic answers that were given, across both columns', () => {
    const result = mapMentorshipMenteeProfile({ ...baseProfile, demographics: { age: '20-39' }, socioeconomics: { educationLevel: 'college' } });

    expect(result.demographics).toEqual({ age: '20-39', education: 'college' });
  });

  it('leaves the resume file name empty when the link has no file segment or is not a URL', () => {
    expect(mapMentorshipMenteeProfile({ ...baseProfile, profile_links: { resumeLink: 'https://example.com/' } }).profile).toMatchObject({
      resumeUrl: 'https://example.com/',
      resumeFileName: undefined,
    });
    expect(mapMentorshipMenteeProfile({ ...baseProfile, profile_links: { resumeLink: 'not a url' } }).profile).toMatchObject({
      resumeUrl: 'not a url',
      resumeFileName: undefined,
    });
  });
});
