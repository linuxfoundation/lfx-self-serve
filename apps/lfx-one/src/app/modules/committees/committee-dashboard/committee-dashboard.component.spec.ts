// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyCommittee, MyGroupsFilterKey, ProjectContext } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { InvitationService } from '@services/invitation.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeInvitationsComponent } from '../components/committee-invitations/committee-invitations.component';
import { CommitteePendingApplicationsComponent } from '../components/committee-pending-applications/committee-pending-applications.component';
import { CommitteeDashboardComponent } from './committee-dashboard.component';

function group(uid: string, overrides: Partial<MyCommittee> = {}): MyCommittee {
  return {
    uid,
    name: 'Alpha working group',
    category: 'Working Group',
    description: 'Synthetic governance fixture',
    project_uid: 'project-a',
    project_name: 'Project A',
    parent_project_uid: 'foundation-a',
    is_foundation: false,
    enable_voting: true,
    public: true,
    sso_group_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    total_members: 3,
    my_role: 'Member',
    ...overrides,
  };
}

const groups: MyCommittee[] = [
  group('a-enabled'),
  group('a-disabled', { enable_voting: false }),
  group('a-board', { category: 'Board', name: 'Alpha board' }),
  group('b-enabled', { project_uid: 'project-b', project_name: 'Project B', parent_project_uid: 'foundation-b' }),
  group('foundation-a', { project_uid: 'foundation-a', project_name: 'Foundation A', is_foundation: true, parent_project_uid: undefined }),
  group('foundation-b', { project_uid: 'foundation-b', project_name: 'Foundation B', is_foundation: true, parent_project_uid: undefined }),
];
const allIds = groups.map((item) => item.uid);

describe('My Groups effective filters', () => {
  let fixture: ComponentFixture<CommitteeDashboardComponent>;
  let pending: Subject<MyCommittee[]>;

  beforeEach(async () => {
    localStorage.clear();
    pending = new Subject<MyCommittee[]>();
    await TestBed.configureTestingModule({
      imports: [CommitteeDashboardComponent],
      providers: [
        provideRouter([]),
        ConfirmationService,
        MessageService,
        { provide: LensService, useValue: { activeLens: signal('me') } },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal<ProjectContext | null>(null), isFoundationContext: signal(false), canWrite: signal(false) },
        },
        {
          provide: PersonaService,
          useValue: { currentPersona: signal('contributor'), personaLoaded: signal(true), hasBoardRole: signal(true), hasProjectRole: signal(true) },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: InvitationService, useValue: { loadPendingInvitations: () => of([]) } },
        { provide: CommitteeService, useValue: { getMyCommittees: () => pending } },
      ],
    })
      .overrideComponent(CommitteeDashboardComponent, {
        remove: { imports: [CommitteeInvitationsComponent, CommitteePendingApplicationsComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    fixture = TestBed.createComponent(CommitteeDashboardComponent);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    await fixture.whenStable();
    pending.next(groups);
    pending.complete();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  function ids(): string[] {
    return fixture.componentInstance.filteredMyCommittees().map((item) => item.uid);
  }

  function element(testId: string): HTMLElement {
    const result = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    expect(result, testId).not.toBeNull();
    return result!;
  }

  async function click(testId: string): Promise<void> {
    const host = element(testId);
    (host.matches('button') ? host : host.querySelector('button')!).click();
    await fixture.whenStable();
  }

  async function search(value: string): Promise<void> {
    // RxJS debounce uses asyncScheduler's interval and clock, not Angular's rendering timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      fixture.componentInstance.searchForm.get('search')!.setValue(value);
      vi.advanceTimersByTime(300);
    } finally {
      vi.useRealTimers();
    }
    await fixture.whenStable();
  }

  function selectScopes(): void {
    fixture.componentInstance.onFoundationFilterChange('foundation-a');
    fixture.componentInstance.onProjectFilterChange('project-a');
  }

  it('intersects effective search, category, scope and strict voting without changing raw summaries', async () => {
    const component = fixture.componentInstance;
    const summary = component.myStatCards();
    selectScopes();
    component.selectBehavioralClass('working-group');
    component.searchForm.get('votingStatus')!.setValue('enabled');
    await search('alpha');
    expect(ids()).toEqual(['a-enabled']);
    expect(component.activeMyGroupFilters().map((chip) => chip.key)).toEqual(['search', 'category', 'foundation', 'project', 'voting']);
    expect(component.myStatCards()).toEqual(summary);
    expect(component.myTotalGroups()).toBe(6);
    expect(component.myPublicGroups()).toBe(6);
    expect(component.myActiveVoting()).toBe(5);
    await search('governance');
    expect(ids()).toEqual(['a-enabled']);
  });

  it('counts only literal enabled capability while keeping malformed groups in the inventory', async () => {
    const malformed = group('malformed');
    Reflect.set(malformed, 'enable_voting', 'true');
    vi.spyOn(TestBed.inject(CommitteeService), 'getMyCommittees').mockReturnValue(
      of([group('enabled'), group('disabled', { enable_voting: false }), malformed])
    );
    fixture.componentInstance.refresh.update((value) => value + 1);
    await fixture.whenStable();
    expect(fixture.componentInstance.myTotalGroups()).toBe(3);
    expect(fixture.componentInstance.myStatCards().find((card) => card.label === 'Voting Enabled Groups')?.value).toBe(1);
    fixture.componentInstance.searchForm.get('votingStatus')!.setValue('enabled');
    await fixture.whenStable();
    expect(ids()).toEqual(['enabled']);
  });

  it.each<MyGroupsFilterKey>(['search', 'category', 'voting'])('removes only the %s constraint', async (key) => {
    const component = fixture.componentInstance;
    selectScopes();
    component.selectBehavioralClass('working-group');
    component.searchForm.get('votingStatus')!.setValue('enabled');
    await search('no-match');
    if (key === 'search') {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      element('groups-remove-filter-search').click();
      vi.advanceTimersByTime(300);
      vi.useRealTimers();
      await fixture.whenStable();
      expect(ids()).toEqual(['a-enabled']);
    } else {
      await search('alpha');
      await click(`groups-remove-filter-${key}`);
      expect(ids()).toEqual(key === 'category' ? ['a-enabled', 'a-board'] : ['a-enabled', 'a-disabled']);
    }
    expect(component.activeMyGroupFilters().map((chip) => chip.key)).not.toContain(key);
    expect(component.foundationFilter()).toBe('foundation-a');
    expect(component.projectFilter()).toBe('project-a');
  });

  it('clears Project on Foundation removal and synchronizes both dropdowns with results', async () => {
    const component = fixture.componentInstance;
    selectScopes();
    await fixture.whenStable();
    expect(component.projectOptions().map((option) => option.value)).toEqual([null, 'project-a']);
    await click('groups-remove-filter-foundation');
    expect(component.searchForm.get('foundationFilter')!.value).toBeNull();
    expect(component.searchForm.get('projectFilter')!.value).toBeNull();
    expect(component.foundationFilter()).toBeNull();
    expect(component.projectFilter()).toBeNull();
    expect(ids()).toEqual(allIds);
    component.onProjectFilterChange('project-a');
    component.onFoundationFilterChange('foundation-b');
    expect(component.searchForm.get('projectFilter')!.value).toBeNull();
    expect(ids()).toEqual(['b-enabled', 'foundation-b']);
  });

  it('retains Foundation when Project is removed, revealing the foundation-owned group', async () => {
    selectScopes();
    await fixture.whenStable();
    await click('groups-remove-filter-project');
    const component = fixture.componentInstance;
    expect(component.searchForm.get('foundationFilter')!.value).toBe('foundation-a');
    expect(component.searchForm.get('projectFilter')!.value).toBeNull();
    expect(ids()).toEqual(['a-enabled', 'a-disabled', 'a-board', 'foundation-a']);
  });

  it.each(['toolbar', 'list', 'card'] as const)('fully resets from %s without changing the selected view', async (entry) => {
    const component = fixture.componentInstance;
    component.setViewMode(entry === 'card' ? 'card' : 'list');
    selectScopes();
    component.selectBehavioralClass('working-group');
    component.searchForm.get('votingStatus')!.setValue('disabled');
    component.searchForm.get('joinModeFilter')!.setValue('closed');
    await search('no-match');
    expect(ids()).toEqual([]);
    const resetHost =
      entry === 'toolbar'
        ? element('groups-reset-filters')
        : fixture.nativeElement.querySelector(entry === 'card' ? 'lfx-my-groups-card-grid lfx-empty-state' : 'lfx-committee-table lfx-empty-state');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    resetHost.querySelector('button').click();
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    await fixture.whenStable();
    expect(component.searchForm.value).toEqual({ search: '', votingStatus: null, joinModeFilter: null, foundationFilter: null, projectFilter: null });
    expect(component.activeMyGroupFilters()).toEqual([]);
    expect(ids()).toEqual(allIds);
    expect(component.viewMode()).toBe(entry === 'card' ? 'card' : 'list');
  });
});
