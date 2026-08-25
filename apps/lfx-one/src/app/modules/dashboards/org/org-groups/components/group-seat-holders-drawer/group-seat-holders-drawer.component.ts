// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CommitteeMembersService } from '@modules/dashboards/org/org-people/services/committee-members.service';
import { votingStatusPillClass } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, CommitteeMemberSeatHolderVm } from '@lfx-one/shared/interfaces';
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

  // getCommitteeMembers(orgUid) always drains the org's FULL, non-truncated committee roster —
  // there's no server-side committeeUid filter (committee-service's seats endpoint doesn't offer
  // one). The OSPO persona this drawer serves opens it for several groups in one sitting, so a
  // fresh fetch per open would re-trigger that full drain every time — cache the observable, keyed
  // by orgUid so an in-place org switch (OrgGroupsComponent isn't destroyed/recreated on switch,
  // see its orgUid$ subscription) rebuilds it instead of replaying the previous org's roster.
  private cache: { orgUid: string; assignments$: Observable<CommitteeMemberAssignment[]> } | null = null;

  private readonly seatHolders: Signal<CommitteeMemberAssignment[] | null> = this.initSeatHolders();

  // Filtered-list length once loaded, falling back to the row's precomputed seatCount() before
  // that — keeps the header in sync with the rendered rows (each row is one seat/assignment, same
  // unit the header counts) instead of drifting from a separately-sourced number. loading() and
  // error() each bypass that fallback for a different reason:
  //  - loading(): a trigger change that keeps the drawer open (an org switch — see the cache
  //    rebuild below) starts a real refetch, but toSignal keeps emitting the LAST value until the
  //    new one arrives — seatHolders() briefly holds the *previous* org's array, not null. Without
  //    this guard the header would show the previous org's seat count under the new org's name.
  //    (A committeeUid-only change replays synchronously from the cached shareReplay and never
  //    observably hits this window; closing the drawer resets seatHolders() to null via the
  //    `!visible` branch below, which the ?? fallback already handles on its own.)
  //  - error(): the outer catchError resolves seatHolders() to [] (not null), which would
  //    otherwise read "0 seats" next to the error panel instead of the row's already-known count.
  protected readonly displayedCount: Signal<number> = computed(() =>
    this.loading() || this.error() ? this.seatCount() : (this.seatHolders()?.length ?? this.seatCount())
  );

  // Precomputes the voting-status pill class per row so the template stays a flat binding
  // (no function call on every change-detection pass).
  protected readonly seatHolderVms: Signal<CommitteeMemberSeatHolderVm[]> = computed(() =>
    (this.seatHolders() ?? []).map((a) => ({ ...a, votingStatusPillClass: votingStatusPillClass(a.votingStatus) }))
  );

  private initSeatHolders(): Signal<CommitteeMemberAssignment[] | null> {
    const trigger$ = toObservable(computed(() => ({ visible: this.visible(), orgUid: this.orgUid(), committeeUid: this.committeeUid() })));

    return toSignal(
      trigger$.pipe(
        switchMap(({ visible, orgUid, committeeUid }) => {
          if (!visible || !orgUid || !committeeUid) return of(null);
          this.error.set(false);
          this.loading.set(true);

          if (!this.cache || this.cache.orgUid !== orgUid) {
            this.cache = {
              orgUid,
              assignments$: this.committeeMembersService.getCommitteeMembers(orgUid).pipe(
                map((response) => response.assignments),
                catchError((err: unknown) => {
                  // Drop the cache — but only if it's still this orgUid's entry, so a fetch for a
                  // since-switched-to org can't be clobbered by a slower, now-stale failure — so the
                  // next drawer open retries the fetch instead of replaying the same error forever.
                  if (this.cache?.orgUid === orgUid) {
                    this.cache = null;
                  }
                  return throwError(() => err);
                }),
                shareReplay(1)
              ),
            };
          }

          return this.cache.assignments$.pipe(
            map((assignments) => assignments.filter((a) => a.committeeUid === committeeUid)),
            catchError((err: unknown) => {
              console.error('Failed to load group seat holders:', err);
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
