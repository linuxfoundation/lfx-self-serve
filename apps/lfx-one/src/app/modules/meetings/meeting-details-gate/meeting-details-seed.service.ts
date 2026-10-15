// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MEETING_JOIN_STATE_KEY } from '@lfx-one/shared/constants';
import { MeetingDetailsSeed, MeetingJoinPageState } from '@lfx-one/shared/interfaces';

/**
 * Holds the public meeting page's SSR seed for the V2 tree (E1-01, #1770).
 * @description Provided by {@link MeetingDetailsGateComponent} and injected in its field
 * initialisers, so it is constructed before the gate's template creates V1. On the browser it
 * reads the `meetingJoinState` TransferState key at that moment; V1 then reads and removes the
 * same key, as it always has. It never removes the key itself, so V1's first paint is unchanged.
 * On the server it holds nothing: the seed is written later, by whichever tree runs the lookup.
 */
@Injectable()
export class MeetingDetailsSeedService {
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly activatedRoute = inject(ActivatedRoute);

  private snapshot: MeetingDetailsSeed | null = this.initSnapshot();

  /**
   * Hands the snapshot to V2, once.
   * @description Returns it only when `routeId` is the meeting it was captured under, and clears
   * it either way, so a V2 instance created later (an in-app navigation to another meeting, or a
   * re-mount after the flag flips) fetches instead of painting a stale meeting.
   */
  public take(routeId: string | null): MeetingJoinPageState | null {
    const snapshot = this.snapshot;
    this.snapshot = null;
    return snapshot && snapshot.routeId === routeId ? snapshot.state : null;
  }

  private initSnapshot(): MeetingDetailsSeed | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const state = this.transferState.get(makeStateKey<MeetingJoinPageState>(MEETING_JOIN_STATE_KEY), null);
    return state ? { routeId: this.activatedRoute.snapshot.paramMap.get('id'), state } : null;
  }
}
