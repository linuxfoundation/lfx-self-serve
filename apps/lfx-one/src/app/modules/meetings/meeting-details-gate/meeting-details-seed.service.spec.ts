// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MEETING_JOIN_STATE_KEY } from '@lfx-one/shared/constants';
import { MeetingJoinPageState } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MeetingDetailsSeedService } from './meeting-details-seed.service';

const stateKey = makeStateKey<MeetingJoinPageState>(MEETING_JOIN_STATE_KEY);
const seeded: MeetingJoinPageState = { meeting: null, loadedViaPastMeetingId: false, pastMeetingFullAccess: false, meetingLoadFailed: true };

describe('MeetingDetailsSeedService', () => {
  function create(platform: 'browser' | 'server', state: MeetingJoinPageState | null): { service: MeetingDetailsSeedService; transferState: TransferState } {
    TestBed.configureTestingModule({
      providers: [
        MeetingDetailsSeedService,
        { provide: PLATFORM_ID, useValue: platform },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'meeting-1' }) } } },
      ],
    });
    const transferState = TestBed.inject(TransferState);
    if (state) {
      transferState.set(stateKey, state);
    }
    return { service: TestBed.inject(MeetingDetailsSeedService), transferState };
  }

  it('snapshots the seed without removing the key, so V1 still reads it', () => {
    const { service, transferState } = create('browser', seeded);

    expect(transferState.hasKey(stateKey)).toBe(true);
    expect(service.take('meeting-1')).toEqual(seeded);
  });

  it('keeps the snapshot after the key is removed, which is what V1 does on mount', () => {
    const { service, transferState } = create('browser', seeded);
    transferState.remove(stateKey);

    expect(service.take('meeting-1')).toEqual(seeded);
  });

  it('hands the snapshot over once', () => {
    const { service } = create('browser', seeded);

    service.take('meeting-1');

    expect(service.take('meeting-1')).toBeNull();
  });

  it('withholds the snapshot from another meeting', () => {
    const { service } = create('browser', seeded);

    expect(service.take('meeting-2')).toBeNull();
  });

  it('holds nothing when there is no seed', () => {
    const { service } = create('browser', null);

    expect(service.take('meeting-1')).toBeNull();
  });

  it('holds nothing on the server', () => {
    const { service } = create('server', seeded);

    expect(service.take('meeting-1')).toBeNull();
  });
});
