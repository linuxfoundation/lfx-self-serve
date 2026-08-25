// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { CommitteeMembersService } from '@modules/dashboards/org/org-people/services/committee-members.service';
import type { CommitteeMemberAssignment, OrgPeopleCommitteeMembersResponse } from '@lfx-one/shared/interfaces';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupSeatHoldersDrawerComponent } from './group-seat-holders-drawer.component';

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
    person: { email: 'jane@example.org', firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', jobTitle: null, initials: 'JD' },
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

  async function open(orgUid: string, committeeUid: string, groupName = 'Storage Working Group', seatCount = 1): Promise<void> {
    fixture.componentRef.setInput('orgUid', orgUid);
    fixture.componentRef.setInput('committeeUid', committeeUid);
    fixture.componentRef.setInput('groupUid', committeeUid);
    fixture.componentRef.setInput('groupName', groupName);
    fixture.componentRef.setInput('seatCount', seatCount);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return document.body.textContent ?? '';
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
              assignment({ seatId: 's-1', committeeUid: 'c-1', person: { ...assignment().person, fullName: 'Jane Doe' } }),
              assignment({ seatId: 's-2', committeeUid: 'c-2', person: { ...assignment().person, fullName: 'John Smith' } }),
            ])
          )
        )
    );

    await open('org-1', 'c-1');

    expect(text()).toContain('Jane Doe');
    expect(text()).not.toContain('John Smith');
  });

  it('fetches once per org and reuses the cached roster for a different committee', async () => {
    await setup(vi.fn().mockReturnValue(of(response([assignment({ committeeUid: 'c-1' }), assignment({ seatId: 's-2', committeeUid: 'c-2' })]))));

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
        .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1', person: { ...assignment().person, fullName: 'Org One Person' } })])))
        .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1', person: { ...assignment().person, fullName: 'Org Two Person' } })])))
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

  it('shows the loaded row count in the header, not the possibly-stale seatCount input', async () => {
    // Deliberately mismatched: seatCount() (deduped-by-person) says 1, but two seat rows match.
    await setup(
      vi.fn().mockReturnValue(of(response([assignment({ seatId: 's-1', committeeUid: 'c-1' }), assignment({ seatId: 's-2', committeeUid: 'c-1' })])))
    );

    await open('org-1', 'c-1', 'Storage Working Group', 1);

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent).toContain('2 seats');
  });

  it('renders the pre-loaded seatCount in the header before the fetch resolves', async () => {
    // NEVER: the fetch stays pending, so seatHolders() stays null and displayedCount() must fall
    // back to the row's precomputed seatCount() rather than reading 0 while still loading.
    await setup(vi.fn().mockReturnValue(NEVER));

    fixture.componentRef.setInput('orgUid', 'org-1');
    fixture.componentRef.setInput('committeeUid', 'c-1');
    fixture.componentRef.setInput('seatCount', 7);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent).toContain('7 seats');
  });

  // A failed fetch resolves seatHolders() to [] (see the outer catchError), not null — without
  // excluding the error() branch from displayedCount's fallback, the header would read "0 seats"
  // instead of the row's already-known count right next to the "Unable to load" panel.
  it('keeps the pre-loaded seatCount in the header on a failed fetch, not 0', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(vi.fn().mockReturnValue(throwError(() => new Error('boom'))));

    await open('org-1', 'c-1', 'Storage Working Group', 7);

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent).toContain('7 seats');
  });

  // Closing the drawer (visible: false) routes through the `!visible` branch of initSeatHolders,
  // which resets seatHolders() to null — so this retry path was already covered by the plain
  // `?? seatCount()` fallback even before the loading() guard existed. It's kept as a regression
  // test for the retry flow itself (error clears, correct count reappears), not as coverage for
  // the loading() guard specifically — see the next test for the scenario that actually needs it.
  it('recovers cleanly on retry after a failure: error clears, count comes back', async () => {
    const impl = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('boom')))
      .mockReturnValueOnce(of(response([assignment({ committeeUid: 'c-1' })])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(impl);

    await open('org-1', 'c-1', 'Storage Working Group', 7);
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeTruthy();

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent).toContain('1 seat');
  });

  // The scenario the loading() guard actually protects: the drawer stays OPEN across an org
  // switch (visible never goes false, so seatHolders() never resets to null). The cache rebuilds
  // for the new orgUid and a real refetch starts, but toSignal keeps emitting the previous org's
  // array until the new fetch resolves — without the loading() guard, displayedCount would read
  // the stale previous-org row count instead of the new row's seatCount().
  it('keeps the new row seatCount in the header while an org-switch refetch is in flight, not the previous org roster length', async () => {
    const impl = vi
      .fn()
      .mockReturnValueOnce(
        of(
          response([
            assignment({ seatId: 's-1', committeeUid: 'c-1' }),
            assignment({ seatId: 's-2', committeeUid: 'c-1' }),
            assignment({ seatId: 's-3', committeeUid: 'c-1' }),
          ])
        )
      )
      .mockReturnValueOnce(NEVER);
    await setup(impl);

    await open('org-1', 'c-1', 'Storage Working Group', 3);
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent).toContain('3 seats');

    fixture.componentRef.setInput('seatCount', 9);
    fixture.componentRef.setInput('orgUid', 'org-2');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent).toContain('9 seats');
    expect(document.querySelector('[data-testid="group-seat-holders-drawer-subtitle"]')?.textContent).not.toContain('3 seats');
  });
});
