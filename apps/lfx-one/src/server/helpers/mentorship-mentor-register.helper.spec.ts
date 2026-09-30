// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MENTORSHIP_MENTOR_INTRODUCTION_MAX } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';

import { buildMentorshipUpstreamMentorProfile, parseMentorshipMentorRegisterRequest } from './mentorship-mentor-register.helper';

const VALID_BODY = {
  introduction: '<p>Test intro</p>',
  skills: ['Kubernetes'],
  complianceAccepted: true,
  termsAccepted: true,
};

const LFX_PROFILE = { firstName: 'Test', lastName: 'User', email: 'test.user@example.com', logoUrl: 'https://example.com/avatar.png' };

/** The per-field error keys a rejected body reports. */
const rejectedFields = (body: unknown): string[] => {
  try {
    parseMentorshipMentorRegisterRequest(body);
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceValidationError);
    return (error as ServiceValidationError).validationErrors.map((entry) => entry.field);
  }
  throw new Error('Expected the body to be rejected');
};

describe('parseMentorshipMentorRegisterRequest', () => {
  it('returns the request for a valid body', () => {
    expect(parseMentorshipMentorRegisterRequest(VALID_BODY)).toEqual(VALID_BODY);
  });

  it('copies only known keys, so a resume or program list never reaches upstream', () => {
    const request = parseMentorshipMentorRegisterRequest({
      ...VALID_BODY,
      slug: 'test-slug',
      resumeFileName: 'resume.pdf',
      programIds: ['mp_test'],
      email: 'user-1@example.org',
    });

    expect(Object.keys(request).sort()).toEqual(Object.keys(VALID_BODY).sort());
  });

  it('keeps the LFX profile fields, trimmed, and drops an empty LFX profile', () => {
    expect(parseMentorshipMentorRegisterRequest({ ...VALID_BODY, lfxProfile: { ...LFX_PROFILE, firstName: '  Test ' } }).lfxProfile).toEqual(LFX_PROFILE);
    expect(parseMentorshipMentorRegisterRequest({ ...VALID_BODY, lfxProfile: {} })).not.toHaveProperty('lfxProfile');
  });

  it('rejects a bad LFX profile by field', () => {
    expect(rejectedFields({ ...VALID_BODY, lfxProfile: 'text' })).toEqual(['lfxProfile']);
    expect(rejectedFields({ ...VALID_BODY, lfxProfile: { firstName: 1, email: 'not-an-email', logoUrl: 'http://example.com/avatar.png' } }).sort()).toEqual([
      'lfxProfile.email',
      'lfxProfile.firstName',
      'lfxProfile.logoUrl',
    ]);
  });

  it.each([undefined, null, 'text', 42, ['a']])('rejects the non-object body %j', (body) => {
    expect(rejectedFields(body)).toEqual(['body']);
  });

  it('reports each wrong type by field', () => {
    expect(rejectedFields({ introduction: 1, skills: [1], complianceAccepted: 'yes', termsAccepted: undefined })).toEqual([
      'introduction',
      'skills',
      'complianceAccepted',
      'termsAccepted',
    ]);
  });

  it('applies the form rules to the values, in form order', () => {
    expect(rejectedFields({ introduction: '<p></p>', skills: [], complianceAccepted: false, termsAccepted: false })).toEqual([
      'introduction',
      'skills',
      'complianceAccepted',
      'termsAccepted',
    ]);
  });

  it.each(['complianceAccepted', 'termsAccepted'])('requires %s to be true', (flag) => {
    expect(rejectedFields({ ...VALID_BODY, [flag]: false })).toEqual([flag]);
  });

  it('rejects a skill the picker does not offer', () => {
    expect(rejectedFields({ ...VALID_BODY, skills: ['Kubernetes', 'Not A Skill'] })).toEqual(['skills']);
  });

  it('rejects an introduction over the cap', () => {
    expect(rejectedFields({ ...VALID_BODY, introduction: `<p>${'a'.repeat(MENTORSHIP_MENTOR_INTRODUCTION_MAX + 1)}</p>` })).toEqual(['introduction']);
  });

  it('drops case-insensitive repeats of a skill, keeping the first', () => {
    const request = parseMentorshipMentorRegisterRequest({ ...VALID_BODY, skills: ['Kubernetes', 'kubernetes', 'Linux', 'KUBERNETES'] });

    expect(request.skills).toEqual(['Kubernetes', 'Linux']);
  });
});

describe('buildMentorshipUpstreamMentorProfile', () => {
  const request = parseMentorshipMentorRegisterRequest(VALID_BODY);

  it('maps the request to the upstream columns', () => {
    expect(buildMentorshipUpstreamMentorProfile(request)).toEqual({
      introduction: '<p>Test intro</p>',
      terms_and_conditions: true,
      skill_set: { skills: ['Kubernetes'] },
    });
  });

  it('sends no compliance column, identity, slug, logo or resume', () => {
    expect(Object.keys(buildMentorshipUpstreamMentorProfile(request)).sort()).toEqual(['introduction', 'skill_set', 'terms_and_conditions']);
  });

  it('sends the LFX profile fields in the upstream column names', () => {
    expect(buildMentorshipUpstreamMentorProfile({ ...request, lfxProfile: LFX_PROFILE })).toMatchObject({
      first_name: 'Test',
      last_name: 'User',
      email: 'test.user@example.com',
      logo_url: 'https://example.com/avatar.png',
    });
  });
});
