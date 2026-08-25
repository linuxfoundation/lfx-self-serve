// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { CommitteeMembersService } from '@modules/dashboards/org/org-people/services/committee-members.service';
import type { CommitteeMemberAssignment, CommitteeMemberPerson, OrgPeopleCommitteeMembersResponse } from '@lfx-one/shared/interfaces';
import { NEVER, of, throwError } from 'rxjs';
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
    return Array.from(document.querySelectorAll('[data-testid="group-seat-holders-list"] li')).map((li) => li.textContent?.trim() ?? '');
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
          of(response([assignment({ committeeUid: 'c-1' }), assignment({ seatId: 's-2', committeeUid: 'c-2', person: person({ email: 'john@example.org' }) })]))
        )
    );

    await open('org-1', 'c-1');
    expect(getCommitteeMembers).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('committeeUid', 'c-2');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getCommitteeMembers).toHaveBeenCalledTimes(1);
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
});
