// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { buildMentorshipUpstreamLfxProfileFields, readMentorshipLfxProfileFields } from './mentorship-lfx-profile.helper';

const VALID_FIELDS = { firstName: 'Test', lastName: 'User', email: 'test.user@example.com', logoUrl: 'https://example.com/avatar.png' };

describe('readMentorshipLfxProfileFields', () => {
  it('reads the four known keys, trimmed, and nothing else', () => {
    const { fields, errors } = readMentorshipLfxProfileFields({ ...VALID_FIELDS, firstName: '  Test ', phone: '555-0100', slug: 'test-slug' });

    expect(errors).toEqual({});
    expect(fields).toEqual(VALID_FIELDS);
  });

  it('keeps only the keys that were sent', () => {
    expect(readMentorshipLfxProfileFields({ email: 'test.user@example.com' })).toEqual({ fields: { email: 'test.user@example.com' }, errors: {} });
    expect(readMentorshipLfxProfileFields({})).toEqual({ fields: {}, errors: {} });
  });

  it.each([null, 'text', 42, ['a']])('rejects the non-object value %j', (value) => {
    expect(readMentorshipLfxProfileFields(value).errors).toEqual({ body: 'The LFX profile must be a JSON object.' });
    expect(readMentorshipLfxProfileFields(value, 'lfxProfile').errors).toEqual({ lfxProfile: 'The LFX profile must be a JSON object.' });
  });

  it('reports a wrong type and a bad value by key, prefixed with the field when given', () => {
    const value = { firstName: 1, lastName: '', email: 'not-an-email', logoUrl: 'http://example.com/avatar.png' };

    expect(Object.keys(readMentorshipLfxProfileFields(value).errors).sort()).toEqual(['email', 'firstName', 'lastName', 'logoUrl']);
    expect(Object.keys(readMentorshipLfxProfileFields(value, 'lfxProfile').errors).sort()).toEqual([
      'lfxProfile.email',
      'lfxProfile.firstName',
      'lfxProfile.lastName',
      'lfxProfile.logoUrl',
    ]);
  });
});

describe('buildMentorshipUpstreamLfxProfileFields', () => {
  it('maps the fields to the upstream column names', () => {
    expect(buildMentorshipUpstreamLfxProfileFields(VALID_FIELDS)).toEqual({
      first_name: 'Test',
      last_name: 'User',
      email: 'test.user@example.com',
      logo_url: 'https://example.com/avatar.png',
    });
  });

  it('leaves an absent field out, so its column is not touched', () => {
    expect(buildMentorshipUpstreamLfxProfileFields({ lastName: 'User' })).toEqual({ last_name: 'User' });
    expect(buildMentorshipUpstreamLfxProfileFields(undefined)).toEqual({});
  });
});
