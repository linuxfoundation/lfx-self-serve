// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CommitteeMembersService } from '@modules/dashboards/org/org-people/services/committee-members.service';
import { votingStatusPillClass, votingStatusRank } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, CommitteeMemberSeatHolderVm } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { catchError, EMPTY, map, of, shareReplay, switchMap, tap, throwError, type Observable } from 'rxjs';

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

  // Grouped by person and sorted by display name — a person holding two roles on this committee
  // renders as one row with both roles joined, instead of an identical avatar/name row repeated.
  // This also keeps the header count (below) matching the row's own org_seat_count (distinct
  // people, deduped by email server-side — see org-lens-groups.service.ts) for the common case:
  // seats that carry an email. It does NOT match for multiple blank-email seats on the same
  // committee — org_seat_count collapses all of those into one server-side, while this groups
  // each by memberUid instead (a shared bucket would merge unrelated people under one "Unknown
  // member" row, which is worse than the rarer count mismatch it would avoid).
  protected readonly seatHolderVms: Signal<CommitteeMemberSeatHolderVm[]> = this.initSeatHolderVms();

  // null while loading or on error — there's no trustworthy number to show in either case, so the
  // header renders a bare "Seat holders" placeholder rather than asserting a count next to a
  // spinner or an error message. The real, deduped-by-person row count otherwise.
  protected readonly displayedCount: Signal<number | null> = computed(() => (this.loading() || this.error() ? null : this.seatHolderVms().length));

  // Text for a single persistent sr-only live region (see the template) — covers all three state
  // transitions, including the ones a "Try again" click can cause (failure -> success, or failure
  // -> failure again). A screen-reader user gets no other signal that anything changed: the button
  // they activated is removed from the DOM either way, and the visible content between a repeat
  // error and a fresh one looks identical without reading it.
  protected readonly statusMessage: Signal<string> = computed(() => {
    if (this.loading()) return 'Loading seat holders…';
    if (this.error()) return 'Unable to load seat holders.';
    const count = this.seatHolderVms().length;
    return `${count} seat holder${count === 1 ? '' : 's'} loaded.`;
  });

  protected retry(): void {
    this.retryTick.update((n) => n + 1);
  }

  private initSeatHolderVms(): Signal<CommitteeMemberSeatHolderVm[]> {
    return computed(() => {
      const byPerson = new Map<string, { assignment: CommitteeMemberAssignment; roles: string[] }>();
      for (const a of this.seatHolders() ?? []) {
        // The BFF mapper already normalizes person.email to trim+lowercase before this drawer
        // ever sees it (committee-seat-assignment.mapper.ts) — this repeats that normalization
        // defensively, mirroring the server's own org_seat_count dedupe key, so a future mapper
        // change can't silently split one person's seats into separate rows here.
        const key = (a.person.email ?? '').trim().toLowerCase() || a.memberUid;
        const existing = byPerson.get(key);
        if (!existing) {
          byPerson.set(key, { assignment: a, roles: a.role ? [a.role] : [] });
          continue;
        }
        if (a.role && !existing.roles.includes(a.role)) existing.roles.push(a.role);
        // The merged row's other fields (voting status, seatId, ...) come from one representative
        // assignment — rank by the shared VOTING_STATUS_PRIORITY order (lower is better) rather
        // than array order, so the pill can't flip between loads for a person holding two
        // differently-ranked seats on this committee.
        if (votingStatusRank(a.votingStatus) < votingStatusRank(existing.assignment.votingStatus)) {
          existing.assignment = a;
        }
      }
      return Array.from(byPerson.values())
        .map(({ assignment, roles }) => ({
          ...assignment,
          // Sorted so the label can't flip between loads based on upstream seat ordering — the
          // same determinism the voting-status pill above already gets from votingStatusRank.
          role: [...roles].sort((a, b) => a.localeCompare(b)).join(', '),
          votingStatusPillClass: votingStatusPillClass(assignment.votingStatus),
        }))
        .sort((a, b) => (a.person.fullName || a.person.email).localeCompare(b.person.fullName || b.person.email));
    });
  }

  private initSeatHolders(): Signal<CommitteeMemberAssignment[] | null> {
    const trigger$ = toObservable(
      computed(() => ({ visible: this.visible(), orgUid: this.orgUid(), committeeUid: this.committeeUid(), retryTick: this.retryTick() }))
    );

    return toSignal(
      trigger$.pipe(
        switchMap(({ visible, orgUid, committeeUid }) => {
          // Keeps the last-loaded state on screen through p-drawer's leave animation instead of
          // flashing to an empty result and a false "0 seat holders" announcement.
          if (!visible) return EMPTY;
          if (!orgUid || !committeeUid) {
            // Emits (unlike !visible above), so it resets loading/error itself — tap below only
            // clears loading on a real fetch emission, which this branch never reaches.
            this.error.set(false);
            this.loading.set(false);
            return of(null);
          }
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
            // tap, not finalize — finalize also fires on unsubscribe (a mid-fetch close), which
            // would clear `loading` before any real result exists, defeating the EMPTY guard above.
            tap(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
