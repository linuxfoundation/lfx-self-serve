// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MeetingService } from '@services/meeting.service';
import { concatMap, debounceTime, groupBy, map, mergeMap, Subject } from 'rxjs';

/**
 * Saves the user's meetings roll-up project choice per root (GH-5566).
 * @description App-wide rather than per dashboard, so a choice made just before leaving the page is
 * still saved. Each root waits for its own pause (a change on another root never drops it), and saves
 * go out one at a time in the order they were made, so an older choice can never land after a newer one.
 * It also remembers each root's latest choice for the session, so returning to a root before its save
 * lands shows that choice rather than the older one still stored. A save that fails drops that remembered
 * choice (unless a newer one replaced it), so a later visit reads what is actually stored.
 */
@Injectable({ providedIn: 'root' })
export class MeetingRollupPreferenceService {
  private readonly meetingService = inject(MeetingService);
  private readonly changes$ = new Subject<{ rootUid: string; projectUids: string[] }>();
  private readonly latest = new Map<string, string[]>();

  public constructor() {
    this.changes$
      .pipe(
        groupBy((change) => change.rootUid),
        mergeMap((changesForRoot) => changesForRoot.pipe(debounceTime(600))),
        concatMap(({ rootUid, projectUids }) =>
          this.meetingService.saveRollupProjectsPreference(rootUid, projectUids).pipe(map((saved) => ({ rootUid, projectUids, saved })))
        ),
        // Ends with the app's (or, during server rendering, the request's) root injector.
        takeUntilDestroyed()
      )
      .subscribe(({ rootUid, projectUids, saved }) => {
        if (!saved && this.latest.get(rootUid) === projectUids) {
          this.latest.delete(rootUid);
        }
      });
  }

  /** Queues `projectUids` as the user's choice for `rootUid` (empty = all projects); the latest per root wins. */
  public save(rootUid: string, projectUids: string[]): void {
    this.latest.set(rootUid, projectUids);
    this.changes$.next({ rootUid, projectUids });
  }

  /** The user's latest choice for `rootUid` made in this session, saved or still pending; `undefined` when none. */
  public latestChoice(rootUid: string): string[] | undefined {
    return this.latest.get(rootUid);
  }
}
