// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CommitteeMembersService } from '@modules/dashboards/org/org-people/services/committee-members.service';
import { votingStatusPillClass } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { catchError, finalize, map, of, shareReplay, switchMap, throwError, type Observable } from 'rxjs';

import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';

/** Org Lens — Groups list drill-down (GH-1780). Shows the org's seat holders for one committee, without leaving the roster. */
@Component({
  selector: 'lfx-group-seat-holders-drawer',
  imports: [DrawerModule, PersonAvatarComponent, RouterLink],
  templateUrl: './group-seat-holders-drawer.component.html',
})
export class GroupSeatHoldersDrawerComponent {
  private readonly committeeMembersService = inject(CommitteeMembersService);

  public readonly visible = model<boolean>(false);
  public readonly orgUid = input<string>('');
  public readonly committeeUid = input<string>('');
  public readonly groupUid = input<string>('');
  public readonly groupName = input<string>('');
  public readonly seatCount = input<number>(0);

  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly votingStatusPillClass = votingStatusPillClass;

  // getCommitteeMembers(orgUid) always drains the org's FULL, non-truncated committee roster —
  // there's no server-side committeeUid filter (committee-service's seats endpoint doesn't offer
  // one). The OSPO persona this drawer serves opens it for several groups in one sitting, so a
  // fresh fetch per open would re-trigger that full drain every time — cache the observable per
  // orgUid (stable for the page's lifetime) and just re-filter it client-side on each open.
  private assignments$: Observable<CommitteeMemberAssignment[]> | null = null;

  protected readonly seatHolders: Signal<CommitteeMemberAssignment[] | null> = this.initSeatHolders();

  private initSeatHolders(): Signal<CommitteeMemberAssignment[] | null> {
    const trigger$ = toObservable(computed(() => ({ visible: this.visible(), orgUid: this.orgUid(), committeeUid: this.committeeUid() })));

    return toSignal(
      trigger$.pipe(
        switchMap(({ visible, orgUid, committeeUid }) => {
          if (!visible || !orgUid || !committeeUid) return of(null);
          this.error.set(false);
          this.loading.set(true);

          if (!this.assignments$) {
            this.assignments$ = this.committeeMembersService.getCommitteeMembers(orgUid).pipe(
              map((response) => response.assignments),
              catchError((err: unknown) => {
                // Drop the cache on failure so the next drawer open retries the fetch instead of
                // replaying the same error forever.
                this.assignments$ = null;
                return throwError(() => err);
              }),
              shareReplay(1)
            );
          }

          return this.assignments$.pipe(
            map((assignments) => assignments.filter((a) => a.committeeUid === committeeUid)),
            catchError(() => {
              this.error.set(true);
              return of([] as CommitteeMemberAssignment[]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
