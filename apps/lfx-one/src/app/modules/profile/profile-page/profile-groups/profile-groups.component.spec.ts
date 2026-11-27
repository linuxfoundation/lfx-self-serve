// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FocusMonitor } from '@angular/cdk/a11y';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PROFILE_GROUP_GRID_LIMIT, PROFILE_GROUPS_COPY, PROFILE_GROUPS_PATH } from '@lfx-one/shared/constants';
import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileGroupsComponent } from './profile-groups.component';

const group = (n: number, extra: Partial<MyCommittee> = {}): MyCommittee => ({
  uid: `g${n}`,
  name: `Group ${n}`,
  category: 'Working Group',
  description: `What group ${n} does.`,
  enable_voting: false,
  public: true,
  sso_group_enabled: false,
  created_at: '',
  updated_at: '',
  total_members: 8,
  project_uid: 'p1',
  project_name: 'Acme Project',
  project_slug: 'acme',
  my_role: 'Member',
  ...extra,
});

@Component({
  selector: 'lfx-test-profile-groups-host',
  imports: [ProfileGroupsComponent],
  template: '<lfx-profile-groups (emptyChange)="empty.set($event)" />',
})
class HostComponent {
  public readonly empty = signal<boolean | null>(null);
}

describe('ProfileGroupsComponent', () => {
  async function render(read: () => Observable<MyCommittee[]>) {
    const getMyCommitteesOrError = vi.fn(read);
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: CommitteeService, useValue: { getMyCommitteesOrError } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      getMyCommitteesOrError,
      host,
      query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null,
      cards: () => Array.from(host.querySelectorAll('a[data-testid^="profile-groups-group-"]')) as HTMLAnchorElement[],
    };
  }

  it('heads the section with the hint and a way to find groups', async () => {
    const { query } = await render(() => of([]));

    expect(query('profile-groups-title')?.textContent?.trim()).toBe(PROFILE_GROUPS_COPY.heading);
    expect(query('profile-section-hint')?.textContent).toContain(PROFILE_GROUPS_COPY.missingLabel);
    expect(query('profile-groups-find')?.querySelector('a')?.getAttribute('href')).toBe(PROFILE_GROUPS_PATH);
  });

  it('shows the empty state with no groups, and tells the page it is empty', async () => {
    const { fixture, host, cards } = await render(() => of([]));

    expect(cards()).toHaveLength(0);
    expect(host.textContent).toContain(PROFILE_GROUPS_COPY.emptyTitle);
    expect(fixture.componentInstance.empty()).toBe(true);
  });

  it('shows four groups as cards that open the group, boards first', async () => {
    const { fixture, cards } = await render(() =>
      of([group(1), group(2, { category: 'Board', total_members: 1 }), group(3, { category: 'Technical Steering Committee' }), group(4)])
    );

    expect(cards().map((card) => card.getAttribute('data-testid'))).toEqual([
      'profile-groups-group-g2',
      'profile-groups-group-g3',
      'profile-groups-group-g1',
      'profile-groups-group-g4',
    ]);
    expect(cards()[0].getAttribute('href')).toContain('g2');
    expect(cards()[0].getAttribute('href')).toContain('project=acme');
    expect(cards()[0].textContent).toContain('Board');
    expect(cards()[0].textContent).toContain('1 member');
    expect(cards()[1].textContent).toContain('Technical');
    expect(fixture.componentInstance.empty()).toBe(false);
  });

  it('shows six of eight groups, then all of them', async () => {
    const { fixture, cards, query } = await render(() => of(Array.from({ length: 8 }, (_, index) => group(index + 1))));
    expect(cards()).toHaveLength(PROFILE_GROUP_GRID_LIMIT);

    query('profile-groups-grid-toggle')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(cards()).toHaveLength(8);
  });

  it('opens a card with the role, the description and the member count on keyboard focus', async () => {
    const { cards } = await render(() => of([group(5, { my_role: CommitteeMemberRole.CHAIR })]));

    TestBed.inject(FocusMonitor).focusVia(cards()[0], 'keyboard');
    await new Promise((resolve) => setTimeout(resolve));
    const card = document.querySelector('[data-testid="profile-groups-card-g5"]');

    expect(card?.textContent).toContain('Chair');
    expect(card?.textContent).toContain('What group 5 does.');
    expect(card?.textContent).toContain('8 members');
  });

  it('says the groups could not load, and tries again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fixture, getMyCommitteesOrError, query, cards } = await render(() => throwError(() => new Error('boom')));
    expect(query('profile-groups-error')?.textContent).toContain(PROFILE_GROUPS_COPY.loadFailed);
    expect(fixture.componentInstance.empty()).toBeNull();

    getMyCommitteesOrError.mockImplementation(() => of([group(1)]));
    query('profile-groups-retry')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(cards()).toHaveLength(1);
    warn.mockRestore();
  });
});
