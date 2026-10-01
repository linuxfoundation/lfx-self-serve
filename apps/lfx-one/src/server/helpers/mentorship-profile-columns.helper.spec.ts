// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { asRecord, asString, asStringArray, mapMentorshipProfileResume } from './mentorship-profile-columns.helper';

describe('mentorship profile column narrowers', () => {
  it('treats only a plain object as a record', () => {
    expect(asRecord({ skills: [] })).toEqual({ skills: [] });
    expect(asRecord(['a'])).toBeUndefined();
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord('text')).toBeUndefined();
  });

  it('treats a blank string as missing', () => {
    expect(asString('Go')).toBe('Go');
    expect(asString('   ')).toBeUndefined();
    expect(asString(3)).toBeUndefined();
  });

  it('keeps only the non-blank strings of a list', () => {
    expect(asStringArray(['Go', '', 4, ' ', 'Rust'])).toEqual(['Go', 'Rust']);
    expect(asStringArray('Go')).toEqual([]);
  });
});

describe('mapMentorshipProfileResume', () => {
  it('names the resume after the last path segment of its link', () => {
    expect(mapMentorshipProfileResume({ profile_links: { resumeLink: 'https://files.example.org/resumes/My%20CV.pdf' } } as never)).toEqual({
      resumeUrl: 'https://files.example.org/resumes/My%20CV.pdf',
      resumeFileName: 'My CV.pdf',
    });
  });

  it('keeps the link but no name when the link has no path or does not parse', () => {
    expect(mapMentorshipProfileResume({ profile_links: { resumeLink: 'https://files.example.org/' } } as never)).toEqual({
      resumeUrl: 'https://files.example.org/',
      resumeFileName: undefined,
    });
    expect(mapMentorshipProfileResume({ profile_links: { resumeLink: 'not a url' } } as never)).toEqual({ resumeUrl: 'not a url', resumeFileName: undefined });
  });

  it('has no resume when the profile stores none', () => {
    expect(mapMentorshipProfileResume({} as never)).toEqual({ resumeUrl: undefined, resumeFileName: undefined });
  });
});
