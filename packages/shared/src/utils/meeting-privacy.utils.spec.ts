// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingVisibility } from '../enums';
import { shouldShowPrivateMeetingLabel, shouldShowRestrictedMeetingLabel } from './meeting-privacy.utils';

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
