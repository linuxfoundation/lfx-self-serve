// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MeetingService } from '@services/meeting.service';
import { concatMap, debounceTime, groupBy, mergeMap, Subject } from 'rxjs';

/**
 * Saves the user's meetings roll-up project choice per root (GH-5566).
 * @description App-wide rather than per dashboard, so a choice made just before leaving the page is
 * still saved. Each root waits for its own pause (a change on another root never drops it), and saves
 * go out one at a time in the order they were made, so an older choice can never land after a newer one.
 */
@Injectable({ providedIn: 'root' })
export class MeetingRollupPreferenceService {
  private readonly meetingService = inject(MeetingService);
  private readonly changes$ = new Subject<{ rootUid: string; projectUids: string[] }>();

  public constructor() {
    this.changes$
      .pipe(
        groupBy((change) => change.rootUid),
        mergeMap((changesForRoot) => changesForRoot.pipe(debounceTime(600))),
        concatMap(({ rootUid, projectUids }) => this.meetingService.saveRollupProjectsPreference(rootUid, projectUids))
      )
      .subscribe();
  }

  /** Queues `projectUids` as the user's choice for `rootUid` (empty = all projects); the latest per root wins. */
  public save(rootUid: string, projectUids: string[]): void {
    this.changes$.next({ rootUid, projectUids });
  }
}
