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
  public readonly groupName = input<string>('');

  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  private readonly retryTick = signal(0);

  // getCommitteeMembers(orgUid) always drains the org's FULL, non-truncated committee roster —
  // there's no server-side committeeUid filter (committee-service's seats endpoint doesn't offer
  // one). The OSPO persona this drawer serves opens it for several groups in one sitting, so a
  // fresh fetch per open would re-trigger that full drain every time — cache the observable, keyed
  // by orgUid so an in-place org switch (OrgGroupsComponent isn't destroyed/recreated on switch,
  // see its orgUid$ subscription) rebuilds it instead of replaying the previous org's roster.
  private cache: { orgUid: string; assignments$: Observable<CommitteeMemberAssignment[]> } | null = null;

  private readonly seatHolders: Signal<CommitteeMemberAssignment[] | null> = this.initSeatHolders();

  // Grouped by person (email, falling back to memberUid when blank) and sorted by display name —
  // a person holding two roles on this committee renders as one row with both roles joined,
  // instead of an identical avatar/name row repeated. This is also what keeps the header count
  // (below) matching the row's own org_seat_count (distinct people, deduped by email
  // server-side — see org-lens-groups.service.ts): both now count the same thing. Precomputes the
  // voting-status pill class per row so the template stays a flat binding.
  protected readonly seatHolderVms: Signal<CommitteeMemberSeatHolderVm[]> = computed(() => {
    const byPerson = new Map<string, { assignment: CommitteeMemberAssignment; roles: string[] }>();
    for (const a of this.seatHolders() ?? []) {
      const key = a.person.email || a.memberUid;
      const existing = byPerson.get(key);
      if (existing) {
        if (a.role && !existing.roles.includes(a.role)) existing.roles.push(a.role);
      } else {
        byPerson.set(key, { assignment: a, roles: a.role ? [a.role] : [] });
      }
    }
    return Array.from(byPerson.values())
      .map(({ assignment, roles }) => ({ ...assignment, role: roles.join(', '), votingStatusPillClass: votingStatusPillClass(assignment.votingStatus) }))
      .sort((a, b) => (a.person.fullName || a.person.email).localeCompare(b.person.fullName || b.person.email));
  });

  // null while loading or on error — there's no trustworthy number to show in either case, so the
  // header renders a bare "Seat holders" placeholder rather than asserting a count next to a
  // spinner or an error message. The real, deduped-by-person row count otherwise.
  protected readonly displayedCount: Signal<number | null> = computed(() => (this.loading() || this.error() ? null : this.seatHolderVms().length));

  protected retry(): void {
    this.retryTick.update((n) => n + 1);
  }

  private initSeatHolders(): Signal<CommitteeMemberAssignment[] | null> {
    const trigger$ = toObservable(
      computed(() => ({ visible: this.visible(), orgUid: this.orgUid(), committeeUid: this.committeeUid(), retryTick: this.retryTick() }))
    );

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
                  // next drawer open (or Try again click) retries the fetch instead of replaying the
                  // same error forever.
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
