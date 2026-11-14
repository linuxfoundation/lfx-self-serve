// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { hasJoinApplicationAddress, isReviewableJoinApplication } from './join-application.utils';

describe('join application row guards', () => {
  const complete = { committeeUid: 'group-1', applicationUid: 'application-1', applicationApplicantEmail: 'applicant@example.com' };

  it('requires both UIDs for an address', () => {
    expect(hasJoinApplicationAddress(complete)).toBe(true);
    expect(hasJoinApplicationAddress({ ...complete, committeeUid: undefined })).toBe(false);
    expect(hasJoinApplicationAddress({ ...complete, applicationUid: '' })).toBe(false);
  });

  it('requires the applicant email on top of the address to be reviewable', () => {
    expect(isReviewableJoinApplication(complete)).toBe(true);
    expect(isReviewableJoinApplication({ ...complete, applicationApplicantEmail: undefined })).toBe(false);
    expect(isReviewableJoinApplication({ ...complete, applicationUid: undefined })).toBe(false);
  });
});
