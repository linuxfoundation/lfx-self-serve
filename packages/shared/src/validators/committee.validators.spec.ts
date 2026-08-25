// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { MEMBER_FORM_VOTING_STATUSES } from '../constants/committees.constants';
import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { acceptedMemberVotingStatus } from './committee.validators';

// ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl.
function control(value: unknown): AbstractControl {
  return { value } as AbstractControl;
}

describe('acceptedMemberVotingStatus', () => {
  const validate = acceptedMemberVotingStatus();

  it('passes for null, undefined, and empty string (optional field)', () => {
    expect(validate(control(null))).toBeNull();
    expect(validate(control(undefined))).toBeNull();
    expect(validate(control(''))).toBeNull();
  });

  it('passes for every status in the member form option set', () => {
    for (const { value } of MEMBER_FORM_VOTING_STATUSES) {
      expect(validate(control(value))).toBeNull();
    }
  });

  it('rejects the legacy None status with the legacyVotingStatus error (LFXV2-2075)', () => {
    expect(validate(control(CommitteeMemberVotingStatus.NONE))).toEqual({
      legacyVotingStatus: { value: CommitteeMemberVotingStatus.NONE },
    });
  });

  it('rejects unknown values with the same error shape', () => {
    expect(validate(control('Chair'))).toEqual({ legacyVotingStatus: { value: 'Chair' } });
  });
});
