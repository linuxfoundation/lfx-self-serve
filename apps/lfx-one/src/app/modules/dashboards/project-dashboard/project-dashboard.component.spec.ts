// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, DeferBlockState, TestBed } from '@angular/core/testing';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { PendingActionItem, ProjectContext, ProjectSettings } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { catchError, map, Observable, of, Subject, tap, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardCastDrawerHostComponent } from '../components/dashboard-cast-drawer-host/dashboard-cast-drawer-host.component';
import { DashboardSidebarComponent } from '../components/dashboard-sidebar/dashboard-sidebar.component';
import { FormationEntryCardComponent } from '../components/formation-entry-card/formation-entry-card.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';
import { ProjectDashboardComponent } from './project-dashboard.component';

@Component({ selector: 'lfx-dashboard-sidebar', standalone: true, template: '' })
class StubDashboardSidebarComponent {
  public readonly projectUid = input<string>('');
  public readonly staffHeading = input<string>('');
  public readonly showFormationCard = input<boolean>(false);
}

@Component({ selector: 'lfx-dashboard-cast-drawer-host', standalone: true, template: '' })
class StubDashboardCastDrawerHostComponent {
  public readonly voteSubmitted = output<string>();

  public open(voteUid: string): void {
    // no-op: exercised only by real vote-casting flows, not these specs
  }
}

@Component({ selector: 'lfx-formation-entry-card', standalone: true, template: '<div data-testid="stub-formation-entry-card"></div>' })
class StubFormationEntryCardComponent {}

// The `@defer (on idle)` children below are stubbed out too — `await fixture.whenStable()`
// (unlike a bare `detectChanges()`) waits for the idle callback that resolves those blocks, so
// without stubs their real, service-heavy implementations would instantiate and need a full DI tree.
@Component({ selector: 'lfx-recent-progress', standalone: true, template: '' })
class StubRecentProgressComponent {}

@Component({ selector: 'lfx-my-meetings', standalone: true, template: '' })
class StubMyMeetingsComponent {}

@Component({ selector: 'lfx-pending-actions', standalone: true, template: '' })
class StubPendingActionsComponent {
  public readonly pendingActions = input<PendingActionItem[]>([]);
  public readonly actionClick = output<void>();
  public readonly castVoteRequested = output<string>();
}

function settings(announcementDate: string): ProjectSettings {
  return {
    uid: 'proj-1',
    announcement_date: announcementDate,
    writers: [],
    auditors: [],
    executive_director: null,
    program_manager: null,
    opportunity_owner: null,
    created_at: '',
    updated_at: '',
  };
}

describe('ProjectDashboardComponent — Formation badge/subtitle (GH-1955)', () => {
  let fixture: ComponentFixture<ProjectDashboardComponent>;
  let flagEnabled: WritableSignal<boolean>;

  async function render(isFormation: boolean, settingsResult: Observable<ProjectSettings> = of(settings('2026-09-01')), subStage = 'Engaged'): Promise<void> {
    flagEnabled = signal(true);
    TestBed.resetTestingModule();

    // Mirrors ProjectContextService's own tri-state pipeline so the mock behaves like the real
    // shared signals (loading flips false, hasError flips true) rather than hardcoding both false.
    const announcementDateLoading = signal(true);
    const announcementDateHasError = signal(false);
    const announcementDate = signal<string | null>(null);
    settingsResult
      .pipe(
        map((s) => s.announcement_date || null),
        tap((date) => {
          announcementDate.set(date);
          announcementDateLoading.set(false);
        }),
        catchError(() => {
          announcementDateLoading.set(false);
          announcementDateHasError.set(true);
          return of(null);
        })
      )
      .subscribe();

    await TestBed.configureTestingModule({
      imports: [ProjectDashboardComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => flagEnabled } },
        { provide: ProjectService, useValue: { getPendingActions: () => of([]) } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: signal<ProjectContext | null>({ uid: 'proj-1', name: 'Project One', slug: 'project-one' }),
            // Not under test here — kept false so the formation entry card (GH-1958) never renders
            // and these badge/subtitle assertions stay about the header only.
            activeProjectStage: signal<string | null>(null),
            isActiveProjectInFormation: signal(isFormation),
            activeProjectFormationSubStage: signal(isFormation ? subStage : null),
            isActiveProjectConfidential: signal(isFormation && subStage === 'Confidential'),
            activeProjectAnnouncementDate: announcementDate,
            activeProjectAnnouncementDateLoading: announcementDateLoading,
            activeProjectAnnouncementDateHasError: announcementDateHasError,
          },
        },
      ],
    })
      .overrideComponent(ProjectDashboardComponent, {
        remove: {
          imports: [
            DashboardSidebarComponent,
            DashboardCastDrawerHostComponent,
            RecentProgressComponent,
            MyMeetingsComponent,
            PendingActionsComponent,
            FormationEntryCardComponent,
          ],
        },
        add: {
          imports: [
            StubDashboardSidebarComponent,
            StubDashboardCastDrawerHostComponent,
            StubRecentProgressComponent,
            StubMyMeetingsComponent,
            StubPendingActionsComponent,
            StubFormationEntryCardComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectDashboardComponent);
    await fixture.whenStable();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('renders no badge or subtitle when the flag is off', async () => {
    await render(true);
    flagEnabled.set(false);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="project-dashboard-formation-subtitle"]')).toBeNull();
  });

  it('renders no badge or subtitle when the project is not in Formation', async () => {
    await render(false);

    expect(fixture.nativeElement.querySelector('[data-testid="project-dashboard-formation-subtitle"]')).toBeNull();
    expect(text()).not.toContain('FORMATION');
  });

  it('renders the badge and subtitle when flagged on and in Formation', async () => {
    await render(true);

    expect(text()).toContain('FORMATION · Engaged');
    expect(fixture.nativeElement.querySelector('[data-testid="project-dashboard-formation-subtitle"]')).not.toBeNull();
  });

  it('shows an em dash placeholder, not "Not set", until the settings fetch resolves', async () => {
    const pending = new Subject<ProjectSettings>();
    await render(true, pending);

    const subtitle = () => fixture.nativeElement.querySelector('[data-testid="project-dashboard-formation-subtitle"]')?.textContent ?? '';
    expect(subtitle()).toContain('Stage Formation · Engaged');
    expect(subtitle()).toContain('Announcement date —');
    expect(subtitle()).not.toContain('Not set');

    pending.next(settings('2026-09-01'));
    await fixture.whenStable();

    expect(subtitle()).toContain('Announcement date Sep 1, 2026');
  });

  it('omits the "Announcement date" clause on a failed settings fetch, rather than falsely asserting "Not set"', async () => {
    await render(
      true,
      throwError(() => new Error('network error'))
    );

    const subtitle = () => fixture.nativeElement.querySelector('[data-testid="project-dashboard-formation-subtitle"]')?.textContent ?? '';
    expect(subtitle()).toContain('Stage Formation · Engaged');
    expect(subtitle()).not.toContain('Announcement date');
  });

  it('gives the Confidential sub-stage a distinct amber/lock tag and appends the visibility caption', async () => {
    await render(true, of(settings('2026-09-01')), 'Confidential');

    const tagEl = fixture.nativeElement.querySelector('.p-tag');
    expect(tagEl.className).toContain('amber');
    expect(tagEl.className).not.toContain('violet');
    expect(fixture.nativeElement.querySelector('.fa-lock')).not.toBeNull();
    expect(text()).toContain('Not visible outside LF Formation and LF Legal until invited');
  });

  it('keeps the violet tag and omits the caption for a non-Confidential sub-stage', async () => {
    await render(true, of(settings('2026-09-01')), 'Engaged');

    const tagEl = fixture.nativeElement.querySelector('.p-tag');
    expect(tagEl.className).toContain('violet');
    expect(tagEl.className).not.toContain('amber');
    expect(fixture.nativeElement.querySelector('.fa-lock')).toBeNull();
    expect(text()).not.toContain('Not visible outside LF Formation and LF Legal until invited');
  });
});

/**
 * GH-1958 moved the formation checklist off this dashboard onto its own route. This spec proves
 * the negative (the checklist section is gone) and the replacement (a gated teaser card), stubbing
 * every other child so the spec's failure mode stays about this component's own wiring.
 */
describe('ProjectDashboardComponent — formation entry card', () => {
  let fixture: ComponentFixture<ProjectDashboardComponent>;
  const activeContext = signal<ProjectContext | null>({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });
  const activeProjectStage = signal<string | null>(null);
  const formationEnabled = signal(false);

  const render = async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [ProjectDashboardComponent],
      providers: [
        {
          provide: ProjectContextService,
          useValue: {
            activeContext,
            activeProjectStage,
            // Not under test here — kept false/null so the GH-1955 header badge never renders and
            // these entry-card assertions stay about the teaser card only.
            isActiveProjectInFormation: signal(false),
            activeProjectFormationSubStage: signal(null),
            isActiveProjectConfidential: signal(false),
            activeProjectAnnouncementDate: signal(null),
            activeProjectAnnouncementDateLoading: signal(false),
            activeProjectAnnouncementDateHasError: signal(false),
          },
        },
        { provide: ProjectService, useValue: { getPendingActions: vi.fn(() => of([])) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: (key: string) => (key === FORMATION_ENABLED_FLAG ? formationEnabled : signal(false)) } },
      ],
    })
      .overrideComponent(ProjectDashboardComponent, {
        remove: {
          imports: [
            RecentProgressComponent,
            MyMeetingsComponent,
            PendingActionsComponent,
            DashboardSidebarComponent,
            DashboardCastDrawerHostComponent,
            FormationEntryCardComponent,
          ],
        },
        add: {
          imports: [
            StubRecentProgressComponent,
            StubMyMeetingsComponent,
            StubPendingActionsComponent,
            StubDashboardSidebarComponent,
            StubDashboardCastDrawerHostComponent,
            StubFormationEntryCardComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectDashboardComponent);
    fixture.detectChanges();
    // @defer(on idle) blocks default to manual rendering in tests — force each to completion so
    // the gated content (present or absent) actually reaches the DOM to assert against.
    const deferBlocks = await fixture.getDeferBlocks();
    await Promise.all(deferBlocks.map((block) => block.render(DeferBlockState.Complete)));
    fixture.detectChanges();
  };

  const entryCard = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="stub-formation-entry-card"]');

  beforeEach(() => {
    activeContext.set({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });
    activeProjectStage.set(null);
    formationEnabled.set(false);
  });

  it('never renders the formation checklist section — it moved to its own route', async () => {
    formationEnabled.set(true);
    activeProjectStage.set('Formation - Exploratory');
    await render();

    expect(fixture.nativeElement.querySelector('lfx-formation-checklist-section')).toBeNull();
  });

  it('hides the formation entry card when the flag is off, even in a Formation stage', async () => {
    activeProjectStage.set('Formation - Exploratory');
    await render();

    expect(entryCard()).toBeNull();
  });

  it('hides the formation entry card when the flag is on but the project is not in a Formation stage', async () => {
    formationEnabled.set(true);
    activeProjectStage.set('Active');
    await render();

    expect(entryCard()).toBeNull();
  });

  it('renders the formation entry card when the flag is on and the project is in a Formation stage', async () => {
    formationEnabled.set(true);
    activeProjectStage.set('Formation - Exploratory');
    await render();

    expect(entryCard()).not.toBeNull();
  });
});
