// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE } from '@lfx-one/shared/constants';
import { MentorshipUpstreamUserProfile } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';

import { buildMentorshipUpstreamMenteeProfileUpdate, parseMentorshipMenteeProfileUpdate } from './mentorship-mentee-profile-update.helper';

const OPERATION = 'update_mentorship_mentee_profile';

const validationError = (body: unknown): ServiceValidationError => {
  try {
    parseMentorshipMenteeProfileUpdate(body, OPERATION);
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceValidationError);
    return error as ServiceValidationError;
  }
  throw new Error('Expected parseMentorshipMenteeProfileUpdate to throw');
};

const expectRejected = (body: unknown, field?: string): void => {
  const error = validationError(body);
  expect(error.validationErrors).toHaveLength(1);
  if (field !== undefined) expect(error.validationErrors[0].field).toBe(field);
};

describe('parseMentorshipMenteeProfileUpdate', () => {
  it('rejects null, a string, an array and an empty object', () => {
    expectRejected(null, 'body');
    expectRejected('introduction', 'body');
    expectRejected([{ introduction: 'x' }], 'body');
    expectRejected({}, 'body');
  });

  it('tags the failure with the operation', () => {
    expect(validationError({}).operation).toBe(OPERATION);
  });

  it('rejects an unknown top-level key, even next to a valid one', () => {
    expectRejected({ introduction: 'Hello', profile_links: {} }, 'body.profile_links');
    expectRejected({ resumeFileName: 'test.pdf' }, 'body.resumeFileName');
  });

  it('rejects an unknown nested key in each group', () => {
    expectRejected({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], extra: 'x' } }, 'skillSet.extra');
    expectRejected({ demographics: { age: '20-39', race: 'asian' } }, 'demographics.race');
    expectRejected({ socioeconomics: { income: 'workingClass', educationLevel: 'college' } }, 'socioeconomics.educationLevel');
  });

  it('rejects null and undefined for every allowlisted key', () => {
    for (const key of ['introduction', 'skillSet', 'demographics', 'socioeconomics']) {
      expectRejected({ [key]: null }, key);
      expectRejected({ [key]: undefined }, key);
    }
  });

  describe('introduction', () => {
    it('accepts an empty string as a clear and trims other text', () => {
      expect(parseMentorshipMenteeProfileUpdate({ introduction: '' }, OPERATION)).toEqual({ introduction: '' });
      expect(parseMentorshipMenteeProfileUpdate({ introduction: '  Hello there \n' }, OPERATION)).toEqual({ introduction: 'Hello there' });
    });

    it('rejects a non-string introduction', () => {
      expectRejected({ introduction: 42 }, 'introduction');
      expectRejected({ introduction: ['x'] }, 'introduction');
    });

    it('rejects text over 3000 code points and accepts exactly 3000', () => {
      expect(parseMentorshipMenteeProfileUpdate({ introduction: 'a'.repeat(3000) }, OPERATION).introduction).toHaveLength(3000);
      expectRejected({ introduction: 'a'.repeat(3001) }, 'introduction');
    });

    it('counts code points, not UTF-16 units', () => {
      expect(parseMentorshipMenteeProfileUpdate({ introduction: '\u{1F600}'.repeat(3000) }, OPERATION).introduction).toBeDefined();
    });

    it('rejects text whose generated HTML exceeds the raw max, with the specific message', () => {
      const error = validationError({ introduction: 'a\n\n'.repeat(1000) });
      expect(error.validationErrors[0].message).toBe(MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE);
    });

    it('accepts 3000 ampersands, which stay under the raw max once escaped', () => {
      expect(parseMentorshipMenteeProfileUpdate({ introduction: '&'.repeat(3000) }, OPERATION).introduction).toHaveLength(3000);
    });
  });

  describe('skillSet', () => {
    it('trims and case-insensitively de-duplicates skills, keeping the first spelling', () => {
      const request = parseMentorshipMenteeProfileUpdate({ skillSet: { skillsHave: [' Go ', 'go', 'Python'], skillsWant: ['Rust', 'RUST'] } }, OPERATION);
      expect(request).toEqual({ skillSet: { skillsHave: ['Go', 'Python'], skillsWant: ['Rust'] } });
    });

    it('requires both lists to be arrays with at least one skill', () => {
      expectRejected({ skillSet: { skillsWant: ['Rust'] } }, 'skillSet.skillsHave');
      expectRejected({ skillSet: { skillsHave: ['Go'] } }, 'skillSet.skillsWant');
      expectRejected({ skillSet: { skillsHave: [], skillsWant: ['Rust'] } }, 'skillSet.skillsHave');
      expectRejected({ skillSet: { skillsHave: 'Go', skillsWant: ['Rust'] } }, 'skillSet.skillsHave');
    });

    it('rejects non-string, blank and over-long items', () => {
      expectRejected({ skillSet: { skillsHave: [1], skillsWant: ['Rust'] } }, 'skillSet.skillsHave');
      expectRejected({ skillSet: { skillsHave: ['Go', '  '], skillsWant: ['Rust'] } }, 'skillSet.skillsHave');
      expectRejected({ skillSet: { skillsHave: ['x'.repeat(101)], skillsWant: ['Rust'] } }, 'skillSet.skillsHave');
      expect(parseMentorshipMenteeProfileUpdate({ skillSet: { skillsHave: ['x'.repeat(100)], skillsWant: ['Rust'] } }, OPERATION).skillSet).toBeDefined();
    });

    it('rejects more than 100 skills and accepts exactly 100', () => {
      const skills = (count: number): string[] => Array.from({ length: count }, (_, index) => `Skill ${index}`);
      expectRejected({ skillSet: { skillsHave: skills(101), skillsWant: ['Rust'] } }, 'skillSet.skillsHave');
      expect(parseMentorshipMenteeProfileUpdate({ skillSet: { skillsHave: skills(100), skillsWant: ['Rust'] } }, OPERATION).skillSet?.skillsHave).toHaveLength(
        100
      );
    });

    it('rejects additionalNotes over the max and a non-string, and treats blank notes as none', () => {
      expectRejected({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: 'n'.repeat(1001) } }, 'skillSet.additionalNotes');
      expectRejected({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: 5 } }, 'skillSet.additionalNotes');
      expectRejected({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: null } }, 'skillSet.additionalNotes');
      expect(parseMentorshipMenteeProfileUpdate({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: '   ' } }, OPERATION)).toEqual({
        skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] },
      });
      expect(parseMentorshipMenteeProfileUpdate({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: ' Evenings ' } }, OPERATION)).toEqual({
        skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: 'Evenings' },
      });
    });
  });

  describe('demographics and socioeconomics', () => {
    it('rejects an empty group and a non-object group', () => {
      expectRejected({ demographics: {} }, 'demographics');
      expectRejected({ socioeconomics: {} }, 'socioeconomics');
      expectRejected({ demographics: 'asian' }, 'demographics');
      expectRejected({ socioeconomics: ['workingClass'] }, 'socioeconomics');
    });

    it('rejects blank, non-string and over-long answers', () => {
      expectRejected({ demographics: { age: '  ' } }, 'demographics.age');
      expectRejected({ demographics: { age: 30 } }, 'demographics.age');
      expectRejected({ socioeconomics: { income: null } }, 'socioeconomics.income');
      expectRejected({ socioeconomics: { income: 'x'.repeat(101) } }, 'socioeconomics.income');
    });

    it('accepts any non-blank token, including preferNotToSay and a legacy value, and trims it', () => {
      expect(
        parseMentorshipMenteeProfileUpdate(
          {
            demographics: { age: 'preferNotToSay', gender: ' legacy-token ', raceEthnicity: 'asian' },
            socioeconomics: { income: 'workingClass', education: 'phd' },
          },
          OPERATION
        )
      ).toEqual({
        demographics: { age: 'preferNotToSay', gender: 'legacy-token', raceEthnicity: 'asian' },
        socioeconomics: { income: 'workingClass', education: 'phd' },
      });
    });
  });

  it('returns a new normalized object rather than the request body', () => {
    const body = { introduction: 'Hello', skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] } };
    const request = parseMentorshipMenteeProfileUpdate(body, OPERATION);
    expect(request).not.toBe(body);
    expect(request.skillSet).not.toBe(body.skillSet);
    expect(request.skillSet?.skillsHave).not.toBe(body.skillSet.skillsHave);
  });
});

describe('buildMentorshipUpstreamMenteeProfileUpdate', () => {
  it('maps skillSet to skill_set with skills, improvementSkills and comments', () => {
    expect(buildMentorshipUpstreamMenteeProfileUpdate({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: 'Evenings only' } })).toEqual({
      skill_set: { skills: ['Go'], improvementSkills: ['Rust'], comments: 'Evenings only' },
    });
  });

  it('omits comments when the notes are absent or blank', () => {
    expect(buildMentorshipUpstreamMenteeProfileUpdate({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] } })).toEqual({
      skill_set: { skills: ['Go'], improvementSkills: ['Rust'] },
    });
    expect(
      buildMentorshipUpstreamMenteeProfileUpdate({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: '  ' } }).skill_set
    ).not.toHaveProperty('comments');
  });

  it('maps raceEthnicity to race and education to educationLevel', () => {
    expect(
      buildMentorshipUpstreamMenteeProfileUpdate({
        demographics: { age: '20-39', gender: 'female', raceEthnicity: 'asian' },
        socioeconomics: { income: 'workingClass', education: 'college' },
      })
    ).toEqual({
      demographics: { age: '20-39', gender: 'female', race: 'asian' },
      socioeconomics: { income: 'workingClass', educationLevel: 'college' },
    });
  });

  it('leaves out rows a group does not carry', () => {
    expect(buildMentorshipUpstreamMenteeProfileUpdate({ demographics: { age: '61+' } })).toEqual({ demographics: { age: '61+' } });
  });

  it('converts the introduction to escaped Quill-shaped HTML', () => {
    expect(buildMentorshipUpstreamMenteeProfileUpdate({ introduction: `Hi <b>there</b> & 'you'\n\nSecond line` })).toEqual({
      introduction: '<p>Hi &lt;b&gt;there&lt;/b&gt; &amp; &#39;you&#39;</p><p><br></p><p>Second line</p>',
    });
  });

  it('sends an empty introduction as an empty string so upstream clears it', () => {
    expect(buildMentorshipUpstreamMenteeProfileUpdate({ introduction: '' })).toEqual({ introduction: '' });
  });

  it('emits only the present groups and never profile_links or null', () => {
    const upstream = buildMentorshipUpstreamMenteeProfileUpdate({ introduction: 'Hello' });
    expect(Object.keys(upstream)).toEqual(['introduction']);
    expect(JSON.stringify(buildMentorshipUpstreamMenteeProfileUpdate({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] } }))).not.toContain('null');
    expect(buildMentorshipUpstreamMenteeProfileUpdate({})).toEqual({});
  });

  describe('with the stored row', () => {
    const storedRow: MentorshipUpstreamUserProfile = {
      id: 'prof-1',
      user_id: 'user-1',
      profile_type: 'mentee',
      terms_and_conditions: true,
      number_of_projects: 0,
      skill_set: { skills: ['C'], improvementSkills: ['Zig'], comments: 'Old notes.', legacyLevel: 'beginner' },
      demographics: { age: 30, race: 'asian', legacyField: 'kept' },
      socioeconomics: { income: 'workingClass', legacyScore: 3 },
      created_on: '2026-01-01T00:00:00Z',
      updated_on: '2026-01-02T00:00:00Z',
    };

    it('keeps stored demographics and socioeconomics keys the update leaves out, including unmapped values', () => {
      expect(buildMentorshipUpstreamMenteeProfileUpdate({ demographics: { gender: 'female' }, socioeconomics: { education: 'college' } }, storedRow)).toEqual({
        demographics: { age: 30, race: 'asian', legacyField: 'kept', gender: 'female' },
        socioeconomics: { income: 'workingClass', legacyScore: 3, educationLevel: 'college' },
      });
    });

    it('lets a changed answer win over the stored one', () => {
      expect(buildMentorshipUpstreamMenteeProfileUpdate({ demographics: { raceEthnicity: 'preferNotToSay' } }, storedRow).demographics).toEqual({
        age: 30,
        race: 'preferNotToSay',
        legacyField: 'kept',
      });
    });

    it('keeps only the unmodelled skill_set keys, so blank notes still clear the stored comments', () => {
      expect(buildMentorshipUpstreamMenteeProfileUpdate({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] } }, storedRow).skill_set).toEqual({
        legacyLevel: 'beginner',
        skills: ['Go'],
        improvementSkills: ['Rust'],
      });
    });

    it('does not add a column the update leaves out', () => {
      expect(buildMentorshipUpstreamMenteeProfileUpdate({ introduction: 'Hi' }, storedRow)).toEqual({ introduction: '<p>Hi</p>' });
    });

    it('ignores a stored column that is not an object', () => {
      expect(buildMentorshipUpstreamMenteeProfileUpdate({ demographics: { age: '61+' } }, { ...storedRow, demographics: 'garbled' })).toEqual({
        demographics: { age: '61+' },
      });
    });
  });
});
