// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { CommitteeMembersService } from '@modules/dashboards/org/org-people/services/committee-members.service';
import type { CommitteeMemberAssignment, CommitteeMemberPerson, OrgPeopleCommitteeMembersResponse } from '@lfx-one/shared/interfaces';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupSeatHoldersDrawerComponent } from './group-seat-holders-drawer.component';

function person(overrides: Partial<CommitteeMemberPerson> = {}): CommitteeMemberPerson {
  return { email: 'jane@example.org', firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', jobTitle: null, initials: 'JD', ...overrides };
}

function assignment(overrides: Partial<CommitteeMemberAssignment> = {}): CommitteeMemberAssignment {
  return {
    seatId: 'seat-1',
    memberUid: 'seat-1',
    committeeUid: 'c-1',
    committeeName: 'Steering Committee',
    committeeCategory: 'Committee',
    projectUid: 'p-1',
    foundationSlug: 'cncf',
    foundationName: 'CNCF',
    role: 'Chair',
    votingStatus: 'Voting Rep',
    appointedBy: 'Membership Entitlement',
    isOrgEditable: true,
    reason: null,
    person: person(),
    ...overrides,
  };
}

function response(assignments: CommitteeMemberAssignment[]): OrgPeopleCommitteeMembersResponse {
  return { orgUid: 'org-1', assignments, stats: { individualCount: assignments.length, committeeCount: 1, foundationsCovered: 1 } };
}

describe('GroupSeatHoldersDrawerComponent', () => {
  let fixture: ComponentFixture<GroupSeatHoldersDrawerComponent>;
  let getCommitteeMembers: ReturnType<typeof vi.fn>;

  // p-drawer renders into document.body, not the fixture host, and a previous test's overlay
  // otherwise survives into the next one — mirrors event-detail-drawer.component.spec.ts.
  // restoreAllMocks undoes the console.error spies a couple of tests below install — without it
  // those spies leak into every later test in the file and silently swallow real console errors.
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function setup(impl: ReturnType<typeof vi.fn>): Promise<void> {
    getCommitteeMembers = impl;

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [GroupSeatHoldersDrawerComponent],
      providers: [{ provide: CommitteeMembersService, useValue: { getCommitteeMembers } }, provideNoopAnimations(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupSeatHoldersDrawerComponent);
  }

  async function open(orgUid: string, committeeUid: string, groupName = 'Storage Working Group'): Promise<void> {
    fixture.componentRef.setInput('orgUid', orgUid);
    fixture.componentRef.setInput('committeeUid', committeeUid);
    fixture.componentRef.setInput('groupName', groupName);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return document.body.textContent ?? '';
  }

  // Normalized + exact, not a substring `.toContain` — the wording is singular/plural sensitive
  // ("1 seat holder" vs "1 seat holders"), and a substring check on the singular form stays green
  // even if the code always renders the plural.
  function subtitleText(): string {
    return (document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function rowNames(): string[] {
    return Array.from(document.querySelectorAll('[data-testid^="group-seat-holder-"]')).map((li) => li.textContent?.trim() ?? '');
  }

  function statusMessage(): string | null {
    return document.querySelector('[data-testid="group-seat-holders-drawer-status"]')?.textContent?.trim() ?? null;
  }

  it('does not fetch until the drawer is opened', async () => {
    await setup(vi.fn().mockReturnValue(of(response([]))));

    fixture.componentRef.setInput('orgUid', 'org-1');
    fixture.componentRef.setInput('committeeUid', 'c-1');
    await fixture.whenStable();

    expect(getCommitteeMembers).not.toHaveBeenCalled();
  });

  it('filters the roster to the requested committee', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', person: person({ fullName: 'Jane Doe' }) }),
              assignment({ seatId: 's-2', committeeUid: 'c-2', person: person({ email: 'john@example.org', fullName: 'John Smith' }) }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(text()).toContain('Jane Doe');
    expect(text()).not.toContain('John Smith');
  });

  it('fetches once per org and reuses the cached roster for a different committee', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ committeeUid: 'c-1', person: person({ fullName: 'Jane Doe' }) }),
              assignment({ seatId: 's-2', committeeUid: 'c-2', person: person({ email: 'john@example.org', fullName: 'John Smith' }) }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');
    expect(getCommitteeMembers).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Jane Doe');
    expect(text()).not.toContain('John Smith');

    fixture.componentRef.setInput('committeeUid', 'c-2');
    await fixture.whenStable();
    fixture.detectChanges();

    // No second fetch, but the cached roster still gets re-filtered to the new committee — proves
    // the cache-reuse path actually serves the right rows, not just that it skips the HTTP call.
    expect(getCommitteeMembers).toHaveBeenCalledTimes(1);
    expect(text()).toContain('John Smith');
    expect(text()).not.toContain('Jane Doe');
  });

  it('refetches when the org changes, so a switched-to org never renders the previous org roster', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1', person: person({ fullName: 'Org One Person' }) })])))
        .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1', person: person({ fullName: 'Org Two Person' }) })])))
    );

    await open('org-1', 'c-1');
    expect(text()).toContain('Org One Person');

    fixture.componentRef.setInput('orgUid', 'org-2');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getCommitteeMembers).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Org Two Person');
    expect(text()).not.toContain('Org One Person');
  });

  // shareReplay(1)'s default refCount:false keeps org-1's underlying fetch subscribed even after
  // switchMap moves on to org-2 — so a slow org-1 failure can still land after the switch. Its
  // catchError guard (`if (this.cache?.orgUid === orgUid)`) must recognize it's stale and leave
  // org-2's cache entry alone; without the guard this would null out the org-2 entry currently in
  // `this.cache`, forcing an unnecessary refetch on the next open.
  it("does not let a stale, since-superseded org's fetch failure clobber the current org's cache", async () => {
    const orgOneSubject = new Subject<OrgPeopleCommitteeMembersResponse>();
    const orgTwoSubject = new Subject<OrgPeopleCommitteeMembersResponse>();
    const impl = vi.fn((orgUid: string) => (orgUid === 'org-1' ? orgOneSubject.asObservable() : orgTwoSubject.asObservable()));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(impl as unknown as ReturnType<typeof vi.fn>);

    await open('org-1', 'c-1');
    expect(impl).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('orgUid', 'org-2');
    await fixture.whenStable();
    expect(impl).toHaveBeenCalledTimes(2);

    // Org-1's now-orphaned fetch fails after the switch away from it.
    orgOneSubject.error(new Error('stale org-1 failure'));
    await fixture.whenStable();

    orgTwoSubject.next(response([assignment({ committeeUid: 'c-1', person: person({ fullName: 'Org Two Person' }) })]));
    orgTwoSubject.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text()).toContain('Org Two Person');
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeNull();

    // Close and reopen for the same (org-2) committee — a third call would mean the stale org-1
    // failure wrongly nulled org-2's cache entry.
    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('renders the empty state when no assignment matches the committee', async () => {
    await setup(vi.fn().mockReturnValue(of(response([assignment({ committeeUid: 'other-committee' })]))));

    await open('org-1', 'c-1');

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-empty"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeNull();
  });

  it('shows a distinct error state on fetch failure and logs it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(vi.fn().mockReturnValue(throwError(() => new Error('boom'))));

    await open('org-1', 'c-1');

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-empty"]')).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('retries the fetch on the next open after a failure', async () => {
    const impl = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('boom')))
      .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1' })])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(impl);

    await open('org-1', 'c-1');
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeTruthy();

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(impl).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeNull();
  });

  it('the "Try again" button in the error state retries the fetch without closing the drawer', async () => {
    const impl = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('boom')))
      .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1' })])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(impl);

    await open('org-1', 'c-1');
    const retryButton = document.querySelector('[data-testid="group-seat-holders-drawer-retry"]') as HTMLButtonElement | null;
    expect(retryButton).toBeTruthy();

    retryButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(impl).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeNull();
    expect(subtitleText()).toBe('1 seat holder');
  });

  it('stays in the error state across a retry that also fails, and a later retry can still recover', async () => {
    const impl = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('first failure')))
      .mockReturnValueOnce(throwError(() => new Error('second failure')))
      .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1' })])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(impl);

    await open('org-1', 'c-1');
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeTruthy();
    expect(statusMessage()).toBe('Unable to load seat holders.');

    let retryButton = document.querySelector('[data-testid="group-seat-holders-drawer-retry"]') as HTMLButtonElement | null;
    retryButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(impl).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeTruthy();
    expect(statusMessage()).toBe('Unable to load seat holders.');

    // A third retry succeeds — the error -> error transition didn't leave the pipeline stuck.
    retryButton = document.querySelector('[data-testid="group-seat-holders-drawer-retry"]') as HTMLButtonElement | null;
    retryButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(impl).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeNull();
  });

  // The single persistent role="status" region is the only signal a screen-reader user gets that
  // a retry changed anything — the button they activated is removed from the DOM either way, and
  // a repeat error looks identical to the first one without reading it.
  it('announces the loaded count through the persistent status region after a successful retry', async () => {
    const impl = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('boom')))
      .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1' })])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(impl);

    await open('org-1', 'c-1');
    expect(statusMessage()).toBe('Unable to load seat holders.');

    (document.querySelector('[data-testid="group-seat-holders-drawer-retry"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(statusMessage()).toBe('1 seat holder loaded.');
  });

  it('announces the loading state through the persistent status region', async () => {
    await setup(vi.fn().mockReturnValue(NEVER));

    await open('org-1', 'c-1');

    expect(statusMessage()).toBe('Loading seat holders…');
  });

  it('shows a blank "Seat holders" placeholder while the fetch is pending', async () => {
    await setup(vi.fn().mockReturnValue(NEVER));

    await open('org-1', 'c-1');

    expect(subtitleText()).toBe('Seat holders');
  });

  it('shows a blank "Seat holders" placeholder on error too, not a stale count', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(vi.fn().mockReturnValue(throwError(() => new Error('boom'))));

    await open('org-1', 'c-1');

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeTruthy();
    expect(subtitleText()).toBe('Seat holders');
  });

  it('shows the loaded row count once settled', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', person: person({ fullName: 'Jane Doe' }) }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', person: person({ email: 'john@example.org', fullName: 'John Smith' }) }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(subtitleText()).toBe('2 seat holders');
  });

  // org_seat_count (the row's badge) dedupes by email server-side, so a person holding two seats
  // on the same committee counts once there — the drawer's list must match, both in the header
  // count and in the rendered rows, or the row's "1 seat" and the drawer's "2 seat holders" (plus
  // two identical-looking rows) would read as a bug rather than the same fact stated twice.
  it('groups multiple assignments for the same person into one row with both roles joined', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Chair' }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Member', memberUid: 'seat-2' }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(subtitleText()).toBe('1 seat holder');
    const names = rowNames();
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Jane Doe');
    expect(names[0]).toContain('Chair, Member');
  });

  it('sorts the joined role label alphabetically, independent of upstream seat order', async () => {
    await setup(
      vi.fn().mockReturnValue(
        of(
          response([
            // Deliberately reversed alphabetical order — the merged label must not just mirror it.
            assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Vice Chair' }),
            assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Alternate', memberUid: 'seat-2' }),
          ])
        )
      )
    );

    await open('org-1', 'c-1');

    expect(rowNames()[0]).toContain('Alternate, Vice Chair');
  });

  // Which of a merged person's two seats "wins" for the voting-status pill must not depend on
  // upstream array order — pin it explicitly by putting the non-voting seat first.
  it("prefers a voting seat over a non-voting one when merging a person's voting-status pill", async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Member', votingStatus: 'Non-voting' }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Chair', votingStatus: 'Voting Rep', memberUid: 'seat-2' }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(text()).toContain('Voting Rep');
    expect(text()).not.toContain('Non-voting');
  });

  // isVotingStatus() alone treats "Observer" as voting (same as "Voting Rep"), so a plain
  // voting/non-voting boolean tie-break would still depend on array order between two seats that
  // are both "voting" by that measure but read differently to a user. Put Observer first so this
  // only passes if the merge ranks by status, not by array order.
  it('prefers a true voting seat over an Observer seat, not just any isVotingStatus() match', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Alternate', votingStatus: 'Observer' }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Chair', votingStatus: 'Voting Rep', memberUid: 'seat-2' }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    // Roles always join regardless of merge winner ("Alternate, Chair" is expected here); it's
    // the voting-status pill specifically that must not be "Observer".
    expect(text()).toContain('Voting Rep');
    expect(text()).not.toContain('Observer');
  });

  // These two pin the exact pairs the old bespoke 3-tier rank got wrong: it tied Emeritus with
  // Voting Rep (both mapped to isVotingStatus()=true), and ranked Emeritus ahead of Observer —
  // the reverse of VOTING_STATUS_PRIORITY. Both tests fail under that old rank and pass only
  // under the shared VOTING_STATUS_PRIORITY-driven one.
  it('prefers Voting Rep over Emeritus when merging (not tied, per VOTING_STATUS_PRIORITY)', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Past Chair', votingStatus: 'Emeritus' }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Chair', votingStatus: 'Voting Rep', memberUid: 'seat-2' }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(text()).toContain('Voting Rep');
    expect(text()).not.toContain('Emeritus');
  });

  it('prefers Observer over Emeritus when merging (Emeritus ranks below Observer, not above)', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Past Chair', votingStatus: 'Emeritus' }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Alternate', votingStatus: 'Observer', memberUid: 'seat-2' }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(text()).toContain('Observer');
    expect(text()).not.toContain('Emeritus');
  });

  it('prefers an unrecognized-but-voting status over an explicit "None" seat when merging', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Member', votingStatus: 'None' }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Delegate', votingStatus: 'Proxy Rep', memberUid: 'seat-2' }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(text()).toContain('Proxy Rep');
    expect(text()).not.toContain('None');
  });

  // The server dedupes org_seat_count on a trimmed, lowercased email — two seats for the same
  // person differing only in casing/whitespace must merge here too, or the header count would
  // overcount relative to the row's own badge for this case.
  it('merges two seats for the same person whose emails differ only in case or whitespace', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', role: 'Chair', person: person({ email: 'Jane@Example.org  ' }) }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', role: 'Member', memberUid: 'seat-2', person: person({ email: '  jane@example.org' }) }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(subtitleText()).toBe('1 seat holder');
    expect(rowNames()).toHaveLength(1);
  });

  // org_seat_count collapses every blank-email seat into one bucket server-side; this drawer
  // deliberately does not mirror that (see the seatHolderVms comment) because merging two
  // unrelated people under one "Unknown member" row would be a worse bug than the resulting
  // header/badge mismatch for this rare case.
  it('does not merge two different blank-email seats into one row', async () => {
    await setup(
      vi.fn().mockReturnValue(
        of(
          response([
            assignment({ seatId: 's-1', committeeUid: 'c-1', person: { email: '', firstName: '', lastName: '', fullName: '', jobTitle: null, initials: '' } }),
            assignment({
              seatId: 's-2',
              committeeUid: 'c-1',
              memberUid: 'seat-2',
              person: { email: '', firstName: '', lastName: '', fullName: '', jobTitle: null, initials: '' },
            }),
          ])
        )
      )
    );

    await open('org-1', 'c-1');

    expect(subtitleText()).toBe('2 seat holders');
    expect(rowNames()).toHaveLength(2);
  });

  it('sorts seat holders by display name', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', person: person({ email: 'zeb@example.org', fullName: 'Zeb Ashe' }) }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', person: person({ email: 'amy@example.org', fullName: 'Amy Zorn' }) }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    const names = rowNames();
    expect(names[0]).toContain('Amy Zorn');
    expect(names[1]).toContain('Zeb Ashe');
  });

  // Defensive coverage, not a currently-reachable path: org-groups.component.ts closes this
  // drawer on every org switch (its orgUid$ subscription), so today a trigger change shouldn't
  // arrive with the drawer still open. IF one ever did, the cache would rebuild for the new orgUid
  // and start a real refetch — this proves the header falls back to the blank placeholder rather
  // than leaking the previous org's stale row count while that refetch is in flight. Awaits
  // stability twice: the orgUid write has to propagate through toObservable's effect before the
  // switchMap/loading() write lands, and asserting after only one flush was observed to
  // occasionally race ahead of it.
  it('shows the blank placeholder, not the previous org roster length, while an org-switch refetch is in flight', async () => {
    const impl = vi
      .fn()
      .mockReturnValueOnce(
        of(
          response([
            assignment({ seatId: 's-1', committeeUid: 'c-1', person: person({ fullName: 'Person One' }) }),
            assignment({ seatId: 's-2', committeeUid: 'c-1', person: person({ email: 'two@example.org', fullName: 'Person Two' }) }),
            assignment({ seatId: 's-3', committeeUid: 'c-1', person: person({ email: 'three@example.org', fullName: 'Person Three' }) }),
          ])
        )
      )
      .mockReturnValueOnce(NEVER);
    await setup(impl);

    await open('org-1', 'c-1');
    expect(subtitleText()).toBe('3 seat holders');

    fixture.componentRef.setInput('orgUid', 'org-2');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The loading testid is the deterministic signal that the refetch actually started
    // (loading() true) before checking the header text it gates — the header assertion alone
    // previously proved vulnerable to running ahead of that write.
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-loading"]')).toBeTruthy();
    expect(subtitleText()).toBe('Seat holders');
  });

  // p-drawer keeps the panel mounted through its leave animation — real-world, the roster and
  // header must survive that window rather than flash to "0 seat holders" (and announce it as
  // such) while the panel is still sliding out. This test's harness runs noop animations, under
  // which *ngIf unmounts the panel content synchronously — so the DOM itself can't be used to
  // observe the race here; it asserts on the underlying signal state that feeds that content
  // instead (protected fields read directly, the way the DOM would see them if still mounted).
  it('keeps the loaded roster and count signals intact when the drawer closes, instead of clearing to zero', async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', person: person({ fullName: 'Person One' }) }),
              assignment({ seatId: 's-2', committeeUid: 'c-1', person: person({ email: 'two@example.org', fullName: 'Person Two' }) }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');
    const instance = fixture.componentInstance as unknown as {
      displayedCount: () => number | null;
      seatHolderVms: () => unknown[];
      statusMessage: () => string;
    };
    expect(instance.displayedCount()).toBe(2);

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();

    expect(instance.displayedCount()).toBe(2);
    expect(instance.seatHolderVms()).toHaveLength(2);
    expect(instance.statusMessage()).toBe('2 seat holders loaded.');
  });

  // The close-preserves-state fix above (EMPTY, not null, while `visible` is false) must not leak
  // the closed drawer's roster into a *different* group opened next — closing only defers the
  // clear, it doesn't skip it forever.
  it("does not carry a closed committee's roster into a reopen for a different committee", async () => {
    await setup(
      vi
        .fn()
        .mockReturnValue(
          of(
            response([
              assignment({ seatId: 's-1', committeeUid: 'c-1', person: person({ fullName: 'Committee One Person' }) }),
              assignment({ seatId: 's-2', committeeUid: 'c-2', person: person({ email: 'two@example.org', fullName: 'Committee Two Person' }) }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');
    expect(text()).toContain('Committee One Person');

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();

    fixture.componentRef.setInput('committeeUid', 'c-2');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text()).toContain('Committee Two Person');
    expect(text()).not.toContain('Committee One Person');
  });

  // The first-ever open for an org is always mid-fetch when the leave animation could start (the
  // cache doesn't exist yet). `finalize` fires on unsubscribe as well as completion, so it would
  // clear `loading` when switchMap tears the pipeline down on close — with `seatHolders` still
  // null, that renders the empty state and a false "0 seat holders" announcement during the same
  // close animation the EMPTY guard exists to protect. `tap` (used instead) only runs on a real
  // emission, so closing mid-fetch must leave `loading` — and therefore the blank placeholder
  // state, not a false empty result — exactly as it was.
  it('does not clear the loading state to a false empty result when the drawer closes mid-fetch', async () => {
    await setup(vi.fn().mockReturnValue(NEVER));

    fixture.componentRef.setInput('orgUid', 'org-1');
    fixture.componentRef.setInput('committeeUid', 'c-1');
    fixture.componentRef.setInput('groupName', 'Storage Working Group');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();

    const instance = fixture.componentInstance as unknown as { loading: () => boolean; displayedCount: () => number | null };
    expect(instance.loading()).toBe(true);
    expect(instance.displayedCount()).toBeNull();

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();

    expect(instance.loading()).toBe(true);
    expect(instance.displayedCount()).toBeNull();
  });

  // tap only clears `loading` on a real fetch emission — the missing-identifier branch emits
  // `of(null)` without going through that fetch pipeline at all, so it has to clear the flag
  // itself. Otherwise a drawer left `loading` by a mid-fetch close (previous test) that reopens
  // with a since-cleared identifier would render a permanent spinner instead of falling through
  // to the empty state (what a null `seatHolders` actually renders here).
  it('clears a loading flag left by a mid-fetch close if the drawer reopens with a missing identifier', async () => {
    await setup(vi.fn().mockReturnValue(NEVER));

    fixture.componentRef.setInput('orgUid', 'org-1');
    fixture.componentRef.setInput('committeeUid', 'c-1');
    fixture.componentRef.setInput('groupName', 'Storage Working Group');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();

    const instance = fixture.componentInstance as unknown as { loading: () => boolean };
    expect(instance.loading()).toBe(true);

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    expect(instance.loading()).toBe(true);

    fixture.componentRef.setInput('committeeUid', '');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(instance.loading()).toBe(false);
    // The DOM-visible half of the same claim: no permanent spinner, not the internal flag alone —
    // and the positive control (the empty state that should replace it) so this can't pass on a
    // template regression that drops the whole @if chain rather than actually clearing loading.
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-loading"]')).toBeNull();
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-empty"]')).toBeTruthy();
  });

  it('renders a member with no name and no email as "Unknown member", not a blank row', async () => {
    await setup(
      vi.fn().mockReturnValue(
        of(
          response([
            assignment({
              role: '',
              person: { email: '', firstName: '', lastName: '', fullName: '', jobTitle: null, initials: '' },
            }),
          ])
        )
      )
    );

    await open('org-1', 'c-1');

    expect(text()).toContain('Unknown member');
    expect(text()).toContain('—');
  });

  // PrimeNG's p-drawer sets role="complementary" on its panel and doesn't manage focus at all —
  // no autofocus on open, no restore on close. These pin the fix layered on top: dialog semantics
  // via [pt], and focus movement via (onShow)/(onHide). document.activeElement, not a class token
  // or a testid's mere presence, is the only thing that actually proves focus moved.
  describe('focus management', () => {
    function dialogPanel(): Element | null {
      return document.querySelector('[role="dialog"]');
    }

    function closeButton(): HTMLElement | null {
      return document.querySelector('[data-testid="group-seat-holders-drawer-close"]');
    }

    it('marks the panel as a labelled modal dialog', async () => {
      await setup(vi.fn().mockReturnValue(of(response([]))));

      await open('org-1', 'c-1');

      const panel = dialogPanel();
      expect(panel).toBeTruthy();
      expect(panel?.getAttribute('aria-modal')).toBe('true');

      // Resolves the id, not just matches the attribute string — a dangling aria-labelledby (no
      // element with that id) leaves the dialog with no accessible name and would pass a check
      // that only compares the attribute's text.
      const labelledById = panel?.getAttribute('aria-labelledby') ?? '';
      const labelElement = document.getElementById(labelledById);
      expect(labelElement).toBeTruthy();
      expect(labelElement?.textContent?.trim()).toBe('Storage Working Group');
    });

    it('moves focus into the panel on open, away from the element that triggered it', async () => {
      await setup(vi.fn().mockReturnValue(of(response([]))));
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      await open('org-1', 'c-1');

      const title = document.querySelector('[data-testid="group-seat-holders-drawer-title"]');
      expect(document.activeElement).toBe(title);
      expect(document.activeElement).not.toBe(trigger);

      document.body.removeChild(trigger);
    });

    it('restores focus to the triggering element when the close button is activated', async () => {
      await setup(vi.fn().mockReturnValue(of(response([]))));
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      await open('org-1', 'c-1');
      expect(document.activeElement).not.toBe(trigger);

      closeButton()!.click();
      await fixture.whenStable();

      expect(document.activeElement).toBe(trigger);

      document.body.removeChild(trigger);
    });
  });
});
