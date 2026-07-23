// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// isHostKeyVisibleForJoinWindow pulls meeting.utils, which transitively imports
// @angular/common/http (HttpParams) — its declarations need the Angular JIT compiler when loaded
// outside an Angular bootstrap (as under Vitest). Importing the compiler first provides that facade.
import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingVisibility } from '../enums';
import type { Meeting } from '../interfaces';
import { getMeetingPrivacyIcon, getMeetingPrivacyLabel, isHostKeyVisible, isHostKeyVisibleForJoinWindow } from './meeting-privacy.utils';

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

describe('isHostKeyVisible', () => {
  it('is true when the viewer is authorized and a key is present', () => {
    expect(isHostKeyVisible({ can_view_host_key: true, host_key: '123456' })).toBe(true);
  });

  it('is false when authorized but no key was supplied', () => {
    expect(isHostKeyVisible({ can_view_host_key: true, host_key: undefined })).toBe(false);
    expect(isHostKeyVisible({ can_view_host_key: true, host_key: '' })).toBe(false);
  });

  it('is false when a key is present but the viewer is not authorized (defense in depth)', () => {
    expect(isHostKeyVisible({ can_view_host_key: false, host_key: '123456' })).toBe(false);
    expect(isHostKeyVisible({ host_key: '123456' })).toBe(false);
  });

  it('is false for null/undefined meetings', () => {
    expect(isHostKeyVisible(null)).toBe(false);
    expect(isHostKeyVisible(undefined)).toBe(false);
  });
});

describe('isHostKeyVisibleForJoinWindow', () => {
  // Fixed meeting: starts 12:00Z, 60 min long, 10 min early-join.
  // Join window (per canJoinMeeting) = [11:50Z, 13:40Z] (end + 40 min buffer).
  const START = '2026-01-01T12:00:00.000Z';

  function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
    return {
      start_time: START,
      duration: 60,
      early_join_time_minutes: 10,
      can_view_host_key: true,
      host_key: '123456',
      ...overrides,
    } as Meeting;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is hidden before the early-join window opens', () => {
    vi.setSystemTime(new Date('2026-01-01T11:00:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(false);
  });

  it('is visible during the early-join window (before start)', () => {
    vi.setSystemTime(new Date('2026-01-01T11:55:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(true);
  });

  it('is visible while the meeting is in progress', () => {
    vi.setSystemTime(new Date('2026-01-01T12:30:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(true);
  });

  it('is hidden after the meeting ends', () => {
    vi.setSystemTime(new Date('2026-01-01T14:00:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(false);
  });

  it('is hidden inside the window when the viewer is not authorized', () => {
    vi.setSystemTime(new Date('2026-01-01T12:30:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting({ can_view_host_key: false }))).toBe(false);
  });

  it('is hidden inside the window when no host_key was supplied', () => {
    vi.setSystemTime(new Date('2026-01-01T12:30:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting({ host_key: undefined }))).toBe(false);
  });

  it('is false for null/undefined meetings', () => {
    expect(isHostKeyVisibleForJoinWindow(null)).toBe(false);
    expect(isHostKeyVisibleForJoinWindow(undefined)).toBe(false);
  });
});
