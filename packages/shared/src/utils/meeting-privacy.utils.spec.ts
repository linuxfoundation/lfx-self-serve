// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingPrivacyType, MeetingVisibility } from '../enums';
import { fieldsToPrivacyType, privacyTypeToFields } from './meeting-privacy.utils';

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
});

describe('fieldsToPrivacyType', () => {
  it('derives Public from public + unrestricted', () => {
    expect(fieldsToPrivacyType(MeetingVisibility.PUBLIC, false)).toBe(MeetingPrivacyType.PUBLIC);
  });

  it('derives Private from private + unrestricted', () => {
    expect(fieldsToPrivacyType(MeetingVisibility.PRIVATE, false)).toBe(MeetingPrivacyType.PRIVATE);
  });

  it('derives Restricted when restricted is true regardless of visibility', () => {
    expect(fieldsToPrivacyType(MeetingVisibility.PRIVATE, true)).toBe(MeetingPrivacyType.RESTRICTED);
    expect(fieldsToPrivacyType(MeetingVisibility.PUBLIC, true)).toBe(MeetingPrivacyType.RESTRICTED);
  });
});
