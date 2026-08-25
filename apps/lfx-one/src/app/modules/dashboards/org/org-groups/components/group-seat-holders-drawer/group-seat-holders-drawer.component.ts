// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  type AfterRenderRef,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  Injector,
  model,
  PLATFORM_ID,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { toDrawerGovernanceSeats } from '@modules/dashboards/org/org-people/helpers/governance-seats.helper';
import { CommitteeMembersService } from '@modules/dashboards/org/org-people/services/committee-members.service';
import { votingStatusPillClass, votingStatusRank } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, CommitteeMemberSeatHolderVm } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { catchError, EMPTY, map, of, shareReplay, switchMap, tap, throwError, type Observable } from 'rxjs';

import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';

/** Org Lens — Groups list drill-down (GH-1780). Shows the org's seat holders for one committee, without leaving the roster. */
@Component({
  selector: 'lfx-group-seat-holders-drawer',
  imports: [DrawerModule, PersonAvatarComponent, RouterLink],
  templateUrl: './group-seat-holders-drawer.component.html',
})
export class GroupSeatHoldersDrawerComponent {
  private readonly committeeMembersService = inject(CommitteeMembersService);
  private readonly personDetailDrawer = inject(PersonDetailDrawerService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);

  public readonly visible = model<boolean>(false);
  public readonly orgUid = input<string>('');
  public readonly committeeUid = input<string>('');
  public readonly groupName = input<string>('');

  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  private readonly retryTick = signal(0);

  // The drawer's real panel is PrimeNG-managed and moved to document.body (appendTo: 'body'), so
  // it isn't reachable as a child of this component's own host element — this is a template ref
  // into our own #header ng-template (which PrimeNG embeds into that panel), not a DOM query.
  private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('titleRef');
  private previouslyFocusedElement: HTMLElement | null = null;

  // Gates the live region's real text (see statusMessage()'s comment and the template). Reset to
  // false on every close (initSeatHolders()'s !visible branch — the one path every close goes
  // through), not on show: PrimeNG's onShow fires after *ngIf="visible" has already inserted the
  // node for that open, so resetting only there would leave a stale `true` from the previous open
  // sitting on the very first paint of every reopen. Flips true via afterNextRender() after the
  // next render, so the real text always arrives as a mutation on an already-painted node.
  protected readonly contentRevealed = signal(false);
  private revealRef: AfterRenderRef | null = null;

  // getCommitteeMembers(orgUid) always drains the org's FULL, non-truncated committee roster —
  // there's no server-side committeeUid filter (committee-service's seats endpoint doesn't offer
  // one). The OSPO persona this drawer serves opens it for several groups in one sitting, so a
  // fresh fetch per open would re-trigger that full drain every time — cache the observable, keyed
  // by orgUid so an in-place org switch (OrgGroupsComponent isn't destroyed/recreated on switch,
  // see its orgUid$ subscription) rebuilds it instead of replaying the previous org's roster.
  private cache: { orgUid: string; assignments$: Observable<CommitteeMemberAssignment[]> } | null = null;

  // The org's full, unfiltered roster — same array cache.assignments$ resolves to, mirrored into a
  // signal so onPersonClick() can read it synchronously (a click handler can't await an Observable).
  // Populated by the same cache-building tap() below, so it's never stale relative to `cache` and
  // never re-fetches on its own. Used to find a clicked person's seats on every committee they hold,
  // not just the one whose drawer is open — see onPersonClick()'s comment for why that matters.
  private readonly fullOrgAssignments = signal<CommitteeMemberAssignment[]>([]);

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

  // Text for the sr-only live region (see the template). Lives inside <p-drawer>'s content
  // deliberately, not hoisted out — the panel is aria-modal="true", and AT is specified to treat
  // content outside an open modal's subtree as unreachable, so a sibling region would be
  // unreliable in a different way than the problem it would fix. Being inside means this node is
  // destroyed and recreated on every open (see contentRevealed's comment for how that's handled).
  // Once revealed, covers all three state transitions, including the ones a "Try again" click can
  // cause (failure -> success, or failure -> failure again) — the button the user activated is
  // removed from the DOM either way, and the visible content between a repeat error and a fresh
  // one looks identical without reading it.
  protected readonly statusMessage: Signal<string> = computed(() => {
    if (this.loading()) return 'Loading seat holders…';
    if (this.error()) return 'Unable to load seat holders.';
    const count = this.seatHolderVms().length;
    return `${count} seat holder${count === 1 ? '' : 's'} loaded.`;
  });

  protected retry(): void {
    this.retryTick.update((n) => n + 1);
  }

  // Opens the shared person-detail drawer stacked on top of this one (drawer-over-drawer — proven
  // by training-employees-drawer, no "close this drawer first" dance needed since [modal]="true"
  // gives both drawers their own focus trap). Governance seats are the person's FULL org roster,
  // not just this committee's assignments filtered to committeeUid — a row here is one committee by
  // construction, but the same person likely holds seats on others, and the drawer's Governance tab
  // is meant to show all of them, matching what the People page's own opener does for the same
  // person. fullOrgAssignments (not seatHolders/seatHolderVms, both committeeUid-filtered) is the
  // one place this component already holds that full list.
  protected onPersonClick(vm: CommitteeMemberSeatHolderVm): void {
    const normalizedEmail = (vm.person.email ?? '').trim().toLowerCase();
    // Mirrors initSeatHolderVms()'s own grouping key: match by email when there is one, otherwise
    // fall back to this exact seat's memberUid — never bucket two blank-email people together.
    const seats = this.fullOrgAssignments().filter((a) =>
      normalizedEmail ? (a.person.email ?? '').trim().toLowerCase() === normalizedEmail : a.memberUid === vm.memberUid
    );
    // vm.person.email is the grouping key and can itself be blank — source the real email from
    // whichever seat actually carries one, mirroring committee-members.component.ts's onPersonClick.
    const email = seats.find((a) => a.person.email)?.person.email;
    this.personDetailDrawer.open({
      name: vm.person.fullName,
      title: vm.person.jobTitle,
      initials: vm.person.initials,
      avatarUrl: vm.person.avatarUrl,
      defaultTab: 'governance',
      governanceSeats: toDrawerGovernanceSeats(seats),
      email,
    });
  }

  // PrimeNG's p-drawer doesn't move focus into the panel on open or restore it on close — it only
  // traps Tab/Shift+Tab once focus is already inside (pFocusTrap, applied unconditionally on its
  // container). Captures the triggering element before moving focus in, so it can be restored on
  // (onHide) — which fires for Escape and the close button, not for an externally-driven close
  // (e.g. `visible.set(false)` on an org switch), where "restore focus to the trigger" wouldn't
  // mean anything since the org, and likely the trigger itself, has changed.
  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleRef()?.nativeElement.focus();

    // Belt-and-braces, not the sole guarantee — see contentRevealed's own comment.
    this.contentRevealed.set(false);
    this.revealRef?.destroy();
    this.revealRef = afterNextRender(() => this.contentRevealed.set(true), { injector: this.injector });
  }

  protected onDrawerHide(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.revealRef?.destroy();
    this.revealRef = null;
    if (this.previouslyFocusedElement?.isConnected) {
      this.previouslyFocusedElement.focus();
    }
    this.previouslyFocusedElement = null;
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
          if (!visible) {
            // Keeps the last-loaded state on screen through p-drawer's leave animation instead of
            // flashing to an empty result and a false "0 seat holders" announcement.
            //
            // Also where contentRevealed resets — the one path every close goes through, unlike
            // (onHide) (see its own comment). See contentRevealed's own comment for why. Destroys
            // any pending reveal too, so an externally-driven close (no onHide) can't have its
            // afterNextRender callback fire after this reset and re-set contentRevealed to true.
            this.contentRevealed.set(false);
            this.revealRef?.destroy();
            this.revealRef = null;
            return EMPTY;
          }
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
                tap((assignments) => this.fullOrgAssignments.set(assignments)),
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
