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

  // seatCount() (the row's org_seat_count) and this drawer's list count genuinely DIFFERENT
  // things: org_seat_count is distinct PEOPLE, deduped by email server-side (see
  // apps/lfx-one/src/server/services/org-lens-groups.service.ts's seenEmails/org_seat_count —
  // NOT the client-side org-lens-groups.service.ts under app/shared/services, which is a thin
  // HTTP wrapper with no dedup logic), while seatHolders() is one row per SEAT/role assignment —
  // a person holding two roles on this committee, or two blank-email seats, makes them disagree
  // for real, not just "not loaded yet". The template branches its wording on which case this is,
  // not just on the number, so the label always matches the actual unit: "N seat holders" only
  // for the error-state seatCount() (genuinely distinct people), "N seat assignments" once loaded
  // for real (this list, one row per role — "seat holders" would misdescribe a person who holds
  // two roles as two seat holders), and a bare "Seat holders" placeholder while loading (no number
  // at all, so there's nothing to mislabel).
  protected readonly displayedCount: Signal<number | null> = computed(() => {
    if (this.loading()) return null;
    if (this.error()) return this.seatCount();
    return this.seatHolders()?.length ?? null;
  });

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
