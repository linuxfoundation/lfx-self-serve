// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTOR_INTRODUCTION_MAX } from '@lfx-one/shared/constants';
import { MentorshipUpstreamUserProfile } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';

import { buildMentorshipUpstreamMentorProfileUpdate, parseMentorshipMentorProfileUpdate } from './mentorship-mentor-profile-update.helper';

const OPERATION = 'update_mentorship_mentor_profile';

const validationError = (body: unknown): ServiceValidationError => {
  try {
    parseMentorshipMentorProfileUpdate(body, OPERATION);
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceValidationError);
    return error as ServiceValidationError;
  }
  throw new Error('Expected parseMentorshipMentorProfileUpdate to throw');
};

const rejectedFields = (body: unknown): string[] => validationError(body).validationErrors.map((entry) => entry.field);

describe('parseMentorshipMentorProfileUpdate', () => {
  it('rejects null, a string, an array and an empty object', () => {
    expect(rejectedFields(null)).toEqual(['body']);
    expect(rejectedFields('introduction')).toEqual(['body']);
    expect(rejectedFields([{ introduction: '<p>Hi</p>' }])).toEqual(['body']);
    expect(rejectedFields({})).toEqual(['body']);
  });

  it('tags the failure with the operation', () => {
    expect(validationError({}).operation).toBe(OPERATION);
  });

  it('rejects an unknown key, even next to a valid one', () => {
    expect(rejectedFields({ introduction: '<p>Hi</p>', profile_links: {} })).toEqual(['body.profile_links']);
    expect(rejectedFields({ resumeFileName: 'cv.pdf' })).toEqual(['body.resumeFileName']);
  });

  it('rejects null and undefined for each field', () => {
    for (const key of ['introduction', 'skills']) {
      expect(rejectedFields({ [key]: null })).toEqual([key]);
      expect(rejectedFields({ [key]: undefined })).toEqual([key]);
    }
  });

  it('rejects a field of the wrong type', () => {
    expect(rejectedFields({ introduction: 42 })).toEqual(['introduction']);
    expect(rejectedFields({ skills: 'Kubernetes' })).toEqual(['skills']);
    expect(rejectedFields({ skills: ['Kubernetes', 7] })).toEqual(['skills']);
  });

  it('holds the present fields to the register rules', () => {
    expect(rejectedFields({ introduction: '<p></p>' })).toEqual(['introduction']);
    expect(rejectedFields({ introduction: `<p>${'a'.repeat(MENTORSHIP_MENTOR_INTRODUCTION_MAX + 1)}</p>` })).toEqual(['introduction']);
    expect(rejectedFields({ skills: [] })).toEqual(['skills']);
    expect(rejectedFields({ skills: ['Not A Real Skill'] })).toEqual(['skills']);
    expect(rejectedFields({ introduction: '<p></p>', skills: [] }).sort()).toEqual(['introduction', 'skills']);
  });

  it('returns a new object with only the present fields, keeping the introduction as sent', () => {
    const body = { introduction: '<p>Hello <strong>there</strong></p>' };
    const request = parseMentorshipMentorProfileUpdate(body, OPERATION);

    expect(request).toEqual({ introduction: '<p>Hello <strong>there</strong></p>' });
    expect(request).not.toBe(body);
  });

  it('drops case-insensitive repeats of a skill, keeping the first', () => {
    expect(parseMentorshipMentorProfileUpdate({ skills: ['Kubernetes', 'kubernetes', 'Angular'] }, OPERATION)).toEqual({ skills: ['Kubernetes', 'Angular'] });
  });
});

describe('buildMentorshipUpstreamMentorProfileUpdate', () => {
  it('sends only the introduction when only it changed', () => {
    expect(buildMentorshipUpstreamMentorProfileUpdate({ introduction: '<p>Hi</p>' })).toEqual({ introduction: '<p>Hi</p>' });
  });

  it('layers the skills over the stored skill_set, keeping the keys the BFF does not model', () => {
    const stored = { skill_set: { skills: ['Go'], comments: 'kept', improvementSkills: ['Rust'] } } as unknown as MentorshipUpstreamUserProfile;

    expect(buildMentorshipUpstreamMentorProfileUpdate({ skills: ['Kubernetes'] }, stored)).toEqual({
      skill_set: { skills: ['Kubernetes'], comments: 'kept', improvementSkills: ['Rust'] },
    });
  });

  it('sends a fresh skill_set when nothing usable is stored', () => {
    expect(buildMentorshipUpstreamMentorProfileUpdate({ skills: ['Kubernetes'] })).toEqual({ skill_set: { skills: ['Kubernetes'] } });
    expect(buildMentorshipUpstreamMentorProfileUpdate({ skills: ['Kubernetes'] }, { skill_set: ['bad'] } as unknown as MentorshipUpstreamUserProfile)).toEqual({
      skill_set: { skills: ['Kubernetes'] },
    });
  });

  it('never sends profile_links', () => {
    expect(buildMentorshipUpstreamMentorProfileUpdate({ introduction: '<p>Hi</p>', skills: ['Go'] })).not.toHaveProperty('profile_links');
  });
});
