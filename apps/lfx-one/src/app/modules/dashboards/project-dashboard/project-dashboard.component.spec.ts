// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContext, ProjectSettings } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { Observable, of, Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DashboardCastDrawerHostComponent } from '../components/dashboard-cast-drawer-host/dashboard-cast-drawer-host.component';
import { DashboardSidebarComponent } from '../components/dashboard-sidebar/dashboard-sidebar.component';
import { ProjectDashboardComponent } from './project-dashboard.component';

const CONTEXT: ProjectContext = { uid: 'proj-1', name: 'Project One', slug: 'project-one' };

@Component({ selector: 'lfx-dashboard-sidebar', standalone: true, template: '' })
class StubDashboardSidebarComponent {
  public readonly projectUid = input<string>('');
  public readonly staffHeading = input<string>('');
  public readonly showFormationCard = input<boolean>(false);
}

@Component({ selector: 'lfx-dashboard-cast-drawer-host', standalone: true, template: '' })
class StubDashboardCastDrawerHostComponent {}

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

  async function render(isFormation: boolean, settingsResult: Observable<ProjectSettings> = of(settings('2026-09-01'))): Promise<void> {
    flagEnabled = signal(true);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProjectDashboardComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => flagEnabled } },
        { provide: PermissionsService, useValue: { getProjectSettings: () => settingsResult } },
        { provide: ProjectService, useValue: { getPendingActions: () => of([]) } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: signal(CONTEXT),
            isActiveProjectInFormation: signal(isFormation),
            activeProjectFormationSubStage: signal(isFormation ? 'Engaged' : null),
          },
        },
      ],
    })
      .overrideComponent(ProjectDashboardComponent, {
        remove: { imports: [DashboardSidebarComponent, DashboardCastDrawerHostComponent] },
        add: { imports: [StubDashboardSidebarComponent, StubDashboardCastDrawerHostComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectDashboardComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('renders no badge or subtitle when the flag is off', async () => {
    await render(true);
    flagEnabled.set(false);
    fixture.detectChanges();

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

  it('omits the "Announcement date" clause entirely until the settings fetch resolves, rather than asserting "Not set" prematurely', async () => {
    const pending = new Subject<ProjectSettings>();
    await render(true, pending);

    const subtitle = () => fixture.nativeElement.querySelector('[data-testid="project-dashboard-formation-subtitle"]')?.textContent ?? '';
    expect(subtitle()).toContain('Stage Formation · Engaged');
    expect(subtitle()).not.toContain('Announcement date');

    pending.next(settings('2026-09-01'));
    fixture.detectChanges();

    expect(subtitle()).toContain('Announcement date Sep 1, 2026');
  });
});
