// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingVisibility } from '../enums';
import { getMeetingPrivacyIcon, getMeetingPrivacyLabel } from './meeting-privacy.utils';

describe('getMeetingPrivacyLabel', () => {
  it('returns "Public" for public + unrestricted', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PUBLIC, false)).toBe('Public');
  });

  it('returns "Private" for private + unrestricted', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PRIVATE, false)).toBe('Private');
  });

  it('returns "Private (Restricted)" for private + restricted', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PRIVATE, true)).toBe('Private (Restricted)');
  });

  it('returns "Public" when visibility is null', () => {
    expect(getMeetingPrivacyLabel(null, false)).toBe('Public');
  });

  it('returns "Public" when both fields are null', () => {
    expect(getMeetingPrivacyLabel(null, null)).toBe('Public');
  });

  it('returns "Public (Restricted)" for public + restricted (edge case)', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PUBLIC, true)).toBe('Public (Restricted)');
  });
});

describe('getMeetingPrivacyIcon', () => {
  it('returns globe icon for public + unrestricted', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PUBLIC, false)).toBe('fa-light fa-globe');
  });

  it('returns shield icon for private + unrestricted', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PRIVATE, false)).toBe('fa-light fa-shield');
  });

  it('returns lock icon when restricted is true', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PRIVATE, true)).toBe('fa-light fa-lock');
  });

  it('returns lock icon when public + restricted (edge case)', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PUBLIC, true)).toBe('fa-light fa-lock');
  });
});
