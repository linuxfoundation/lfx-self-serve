// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupsRedesignComponent } from './groups-redesign.component';

const group = (uid: string, category: string, extra: Partial<MyCommittee> = {}): MyCommittee =>
  ({ uid, name: `Group ${uid}`, category, public: true, enable_voting: false, total_members: 4, my_role: 'Member', ...extra }) as MyCommittee;

describe('GroupsRedesignComponent', () => {
  let groups$: Subject<MyCommittee[]>;
  let openCreateDialog: ReturnType<typeof vi.fn>;

  const render = async (groups?: MyCommittee[]): Promise<ComponentFixture<GroupsRedesignComponent>> => {
    const fixture = TestBed.createComponent(GroupsRedesignComponent);
    fixture.detectChanges();
    if (groups) {
      groups$.next(groups);
      groups$.complete();
      await fixture.whenStable();
    }
    return fixture;
  };
  const all = (fixture: ComponentFixture<GroupsRedesignComponent>, testId: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
  const one = (fixture: ComponentFixture<GroupsRedesignComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (element: Element | null): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    groups$ = new Subject();
    openCreateDialog = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public unobserve = vi.fn();
        public disconnect = vi.fn();
      }
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: CommitteeService, useValue: { getMyCommitteesOrError: () => groups$, getGroupsEngagementStats: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: CreateArtifactDialogService, useValue: { open: openCreateDialog } },
        provideRouter([]),
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows skeleton cards and no metrics or tabs while loading', async () => {
    const fixture = await render();

    expect(one(fixture, 'groups-redesign-loading')).not.toBeNull();
    expect(one(fixture, 'groups-redesign-metrics')).toBeNull();
    expect(one(fixture, 'groups-redesign-tabs')).toBeNull();
    expect(one(fixture, 'groups-redesign-create')).toBeNull();
  });

  it('shows the empty state with Create Group, and hides the metrics, toolbar and header button, without groups', async () => {
    const fixture = await render([]);

    expect(text(one(fixture, 'groups-redesign-empty'))).toContain('No groups yet');
    expect(one(fixture, 'groups-redesign-metrics')).toBeNull();
    expect(one(fixture, 'groups-redesign-toolbar')).toBeNull();
    expect(one(fixture, 'groups-redesign-create')).toBeNull();

    one(fixture, 'groups-redesign-empty-create')?.querySelector('button')?.click();
    expect(openCreateDialog).toHaveBeenCalledWith('group');
  });

  it('shows a retry when the groups fail to load', async () => {
    const fixture = await render();
    groups$.error(new Error('offline'));
    await fixture.whenStable();

    expect(text(one(fixture, 'groups-redesign-error'))).toContain("Couldn't load your groups");
    expect(one(fixture, 'groups-redesign-empty')).toBeNull();
    expect(one(fixture, 'groups-redesign-create')).toBeNull();
  });

  it('opens the create dialog for a group from the header', async () => {
    const fixture = await render([group('a', 'Board')]);

    one(fixture, 'groups-redesign-create')?.querySelector('button')?.click();
    expect(openCreateDialog).toHaveBeenCalledWith('group');
  });

  it('shows the four metrics', async () => {
    const fixture = await render([group('a', 'Board', { enable_voting: true }), group('b', 'Working Group', { public: false })]);

    expect(all(fixture, 'groups-redesign-metric').map(text)).toEqual(['Total Groups 2', 'Public Groups 1', 'Voting Enabled Groups 1', 'Active Members —']);
  });

  it('shows All plus a tab for each type the viewer has, with counts', async () => {
    const fixture = await render([group('a', 'Board'), group('b', 'Working Group'), group('c', 'Working Group')]);
    const tabs = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[role="tab"]')).map(text);

    expect(tabs).toEqual(['All3', 'Boards1', 'Working Groups2']);
  });
});
