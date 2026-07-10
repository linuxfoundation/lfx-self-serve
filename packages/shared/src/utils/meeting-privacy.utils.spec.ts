// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingPrivacyType, MeetingVisibility } from '../enums';
import { fieldsToPrivacyType, privacyTypeToFields, shouldShowPrivateMeetingLabel, shouldShowRestrictedMeetingLabel } from './meeting-privacy.utils';

describe('privacyTypeToFields', () => {
  it('maps Public to public visibility with unrestricted join', () => {
    expect(privacyTypeToFields(MeetingPrivacyType.PUBLIC)).toEqual({
      visibility: MeetingVisibility.PUBLIC,
      restricted: false,
    });
  });

  it('maps Private to private visibility with unrestricted join', () => {
    expect(privacyTypeToFields(MeetingPrivacyType.PRIVATE)).toEqual({
      visibility: MeetingVisibility.PRIVATE,
      restricted: false,
    });
  });

  it('maps Restricted to private visibility with invite-only join', () => {
    expect(privacyTypeToFields(MeetingPrivacyType.RESTRICTED)).toEqual({
      visibility: MeetingVisibility.PRIVATE,
      restricted: true,
    });
  });

  it('falls back to Private when privacy type is missing or unknown', () => {
    expect(privacyTypeToFields(null)).toEqual({
      visibility: MeetingVisibility.PRIVATE,
      restricted: false,
    });
    expect(privacyTypeToFields(undefined)).toEqual({
      visibility: MeetingVisibility.PRIVATE,
      restricted: false,
    });
  });
});

describe('fieldsToPrivacyType', () => {
  it('derives Public from public + unrestricted', () => {
    expect(fieldsToPrivacyType(MeetingVisibility.PUBLIC, false)).toBe(MeetingPrivacyType.PUBLIC);
  });

  it('derives Private from private + unrestricted', () => {
    expect(fieldsToPrivacyType(MeetingVisibility.PRIVATE, false)).toBe(MeetingPrivacyType.PRIVATE);
  });

  it('derives Restricted from private + invite-only', () => {
    expect(fieldsToPrivacyType(MeetingVisibility.PRIVATE, true)).toBe(MeetingPrivacyType.RESTRICTED);
  });

  it('derives Public from public + invite-only (legacy enum cannot encode join restriction)', () => {
    expect(fieldsToPrivacyType(MeetingVisibility.PUBLIC, true)).toBe(MeetingPrivacyType.PUBLIC);
  });
});

describe('shouldShowPrivateMeetingLabel', () => {
  it('shows Private for private visibility and null/unknown legacy values', () => {
    expect(shouldShowPrivateMeetingLabel(MeetingVisibility.PRIVATE)).toBe(true);
    expect(shouldShowPrivateMeetingLabel(null)).toBe(true);
    expect(shouldShowPrivateMeetingLabel(undefined)).toBe(true);
  });

  it('hides Private for explicit public visibility', () => {
    expect(shouldShowPrivateMeetingLabel(MeetingVisibility.PUBLIC)).toBe(false);
    expect(shouldShowPrivateMeetingLabel('public')).toBe(false);
  });
});

describe('shouldShowRestrictedMeetingLabel', () => {
  it('shows Restricted only when restricted is true', () => {
    expect(shouldShowRestrictedMeetingLabel(true)).toBe(true);
    expect(shouldShowRestrictedMeetingLabel(false)).toBe(false);
    expect(shouldShowRestrictedMeetingLabel(null)).toBe(false);
  });
});
