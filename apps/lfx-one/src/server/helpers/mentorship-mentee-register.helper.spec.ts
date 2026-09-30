// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import {
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX,
  MENTORSHIP_MENTEE_INTRODUCTION_MAX,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_SKILL_OPTIONS,
} from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';

import { buildMentorshipUpstreamMenteeProfile, parseMentorshipMenteeRegisterRequest } from './mentorship-mentee-register.helper';

const VALID_BODY = {
  introduction: '<p>Test intro</p>',
  skillsHave: ['Java'],
  skillsWant: ['Python'],
  additionalNotes: 'Test notes',
  ageEligible: true,
  workAuthorized: true,
  noDuplicateProfile: true,
  complianceAccepted: true,
  termsAccepted: true,
};

/** The per-field error keys a rejected body reports. */
const rejectedFields = (body: unknown): string[] => {
  try {
    parseMentorshipMenteeRegisterRequest(body);
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceValidationError);
    return (error as ServiceValidationError).validationErrors.map((entry) => entry.field);
  }
  throw new Error('Expected the body to be rejected');
};

describe('parseMentorshipMenteeRegisterRequest', () => {
  it('returns the request for a valid body', () => {
    expect(parseMentorshipMenteeRegisterRequest(VALID_BODY)).toEqual(VALID_BODY);
  });

  it('trims the additional notes and keeps the demographics answers', () => {
    const request = parseMentorshipMenteeRegisterRequest({
      ...VALID_BODY,
      additionalNotes: '  Test notes  ',
      demographics: { age: '20-39', gender: 'preferNotToSay', education: 'college' },
    });

    expect(request.additionalNotes).toBe('Test notes');
    expect(request.demographics).toEqual({ age: '20-39', gender: 'preferNotToSay', education: 'college' });
  });

  it('copies only known keys', () => {
    const request = parseMentorshipMenteeRegisterRequest({ ...VALID_BODY, slug: 'test-slug', name: 'Test User 1', email: 'user-1@example.com' });

    expect(Object.keys(request).sort()).toEqual(Object.keys(VALID_BODY).sort());
  });

  it('drops an empty demographics object', () => {
    expect(parseMentorshipMenteeRegisterRequest({ ...VALID_BODY, demographics: {} })).not.toHaveProperty('demographics');
  });

  it.each([undefined, null, 'text', 42, ['a']])('rejects the non-object body %j', (body) => {
    expect(rejectedFields(body)).toEqual(['body']);
  });

  it('reports each wrong type by field', () => {
    expect(
      rejectedFields({
        introduction: 1,
        skillsHave: 'Java',
        skillsWant: [1],
        additionalNotes: null,
        ageEligible: 'yes',
        workAuthorized: 1,
        noDuplicateProfile: undefined,
        complianceAccepted: null,
        termsAccepted: [],
      })
    ).toEqual([
      'introduction',
      'skillsHave',
      'skillsWant',
      'additionalNotes',
      'ageEligible',
      'workAuthorized',
      'noDuplicateProfile',
      'complianceAccepted',
      'termsAccepted',
    ]);
  });

  it('rejects additional notes over the cap', () => {
    expect(rejectedFields({ ...VALID_BODY, additionalNotes: 'a'.repeat(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX + 1) })).toEqual(['additionalNotes']);
    expect(() => parseMentorshipMenteeRegisterRequest({ ...VALID_BODY, additionalNotes: 'a'.repeat(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX) })).not.toThrow();
  });

  it.each([
    ['a non-object', 'young'],
    ['an array', ['20-39']],
    ['an unknown key', { shoeSize: '9' }],
    ['a value outside the options', { age: '200' }],
    ['a non-string value', { age: 30 }],
  ])('rejects demographics that are %s', (_label, demographics) => {
    expect(rejectedFields({ ...VALID_BODY, demographics })).toEqual(['demographics']);
  });

  it('applies the form rules to the values, in form order', () => {
    expect(
      rejectedFields({
        ...VALID_BODY,
        introduction: '',
        skillsHave: ['Not A Skill'],
        skillsWant: [],
        termsAccepted: false,
      })
    ).toEqual(['introduction', 'skillsHave', 'skillsWant', 'termsAccepted']);
  });

  it('rejects an introduction over the cap', () => {
    expect(rejectedFields({ ...VALID_BODY, introduction: `<p>${'a'.repeat(MENTORSHIP_MENTEE_INTRODUCTION_MAX + 1)}</p>` })).toEqual(['introduction']);
  });

  it('drops case-insensitive repeats of a skill, keeping the first', () => {
    const request = parseMentorshipMenteeRegisterRequest({ ...VALID_BODY, skillsHave: ['Java', 'java', 'Rust', 'Java'], skillsWant: ['Python', 'PYTHON'] });

    expect(request.skillsHave).toEqual(['Java', 'Rust']);
    expect(request.skillsWant).toEqual(['Python']);
  });

  it('rejects either skills list over the profile edit cap', () => {
    const overCap = MENTORSHIP_SKILL_OPTIONS.slice(0, MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS + 1);

    expect(rejectedFields({ ...VALID_BODY, skillsHave: overCap })).toEqual(['skillsHave']);
    expect(rejectedFields({ ...VALID_BODY, skillsWant: overCap })).toEqual(['skillsWant']);
  });

  it('counts the cap after repeats are dropped', () => {
    const atCap = MENTORSHIP_SKILL_OPTIONS.slice(0, MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS);

    expect(parseMentorshipMenteeRegisterRequest({ ...VALID_BODY, skillsHave: [...atCap, atCap[0]] }).skillsHave).toEqual(atCap);
  });
});

describe('buildMentorshipUpstreamMenteeProfile', () => {
  const request = parseMentorshipMenteeRegisterRequest(VALID_BODY);

  it('maps the request to the upstream columns, with no demographics or socioeconomics when none were given', () => {
    expect(buildMentorshipUpstreamMenteeProfile(request)).toEqual({
      introduction: '<p>Test intro</p>',
      terms_and_conditions: true,
      age_eligible: true,
      work_eligible: true,
      skill_set: { skills: ['Java'], improvementSkills: ['Python'], comments: 'Test notes' },
    });
  });

  it('splits the answers between demographics and socioeconomics', () => {
    const body = buildMentorshipUpstreamMenteeProfile({
      ...request,
      demographics: { age: '20-39', gender: 'female', raceEthnicity: 'asian', income: 'workingClass', education: 'masters' },
    });

    expect(body.demographics).toEqual({ age: '20-39', gender: 'female', race: 'asian' });
    expect(body.socioeconomics).toEqual({ income: 'workingClass', educationLevel: 'masters' });
  });

  it('omits a column whose answers were all declined', () => {
    const body = buildMentorshipUpstreamMenteeProfile({ ...request, demographics: { income: 'workingClass' } });

    expect(body).not.toHaveProperty('demographics');
    expect(body.socioeconomics).toEqual({ income: 'workingClass' });
  });

  it('sends the eligibility flags as given and no identity, slug, logo or resume', () => {
    const body = buildMentorshipUpstreamMenteeProfile({ ...request, ageEligible: false, workAuthorized: false });

    expect(body).toMatchObject({ age_eligible: false, work_eligible: false });
    expect(Object.keys(body).sort()).toEqual(['age_eligible', 'introduction', 'skill_set', 'terms_and_conditions', 'work_eligible']);
  });
});
