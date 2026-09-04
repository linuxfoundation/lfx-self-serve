// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it } from 'vitest';

import { DashboardQuicklinksComponent } from '../dashboard-quicklinks/dashboard-quicklinks.component';
import { FormationCardComponent } from '../formation-card/formation-card.component';
import { ProjectStaffCardComponent } from '../project-staff-card/project-staff-card.component';
import { DashboardSidebarComponent } from './dashboard-sidebar.component';

@Component({ selector: 'lfx-dashboard-quicklinks', standalone: true, template: '' })
class StubDashboardQuicklinksComponent {
  public readonly layout = input<'header' | 'sidebar'>('header');
}

@Component({ selector: 'lfx-project-staff-card', standalone: true, template: '' })
class StubProjectStaffCardComponent {
  public readonly projectUid = input<string>('');
  public readonly heading = input<string>('');
}

@Component({ selector: 'lfx-formation-card', standalone: true, template: 'formation-card-rendered' })
class StubFormationCardComponent {}

/**
 * GH-1955 — locks in the `showFormationCard` opt-in gate. `FormationCardComponent` reads
 * `ProjectContextService.activeProject` globally, ignoring this component's own `projectUid`
 * input — the executive-director and board-member dashboards pass a *different* entity's uid
 * here, so the card must stay opt-in (default `false`) rather than following `isFormation()` alone.
 */
describe('DashboardSidebarComponent — Formation card opt-in (GH-1955)', () => {
  let fixture: ComponentFixture<DashboardSidebarComponent>;

  async function render(showFormationCard: boolean | undefined, flagEnabled: boolean, isFormation: boolean): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DashboardSidebarComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(flagEnabled) } },
        { provide: ProjectContextService, useValue: { isActiveProjectInFormation: signal(isFormation) } },
      ],
    })
      .overrideComponent(DashboardSidebarComponent, {
        remove: { imports: [DashboardQuicklinksComponent, ProjectStaffCardComponent, FormationCardComponent] },
        add: { imports: [StubDashboardQuicklinksComponent, StubProjectStaffCardComponent, StubFormationCardComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DashboardSidebarComponent);
    fixture.componentRef.setInput('projectUid', 'proj-1');
    fixture.componentRef.setInput('staffHeading', 'Project Staff');
    if (showFormationCard !== undefined) {
      fixture.componentRef.setInput('showFormationCard', showFormationCard);
    }
    await fixture.whenStable();
  }

  it('hides the Formation card by default when showFormationCard is not set, even when flagged on and in Formation', async () => {
    await render(undefined, true, true);

    expect(fixture.nativeElement.textContent).not.toContain('formation-card-rendered');
  });

  it('hides the Formation card when showFormationCard is explicitly false (the ED/board-member dashboards)', async () => {
    await render(false, true, true);

    expect(fixture.nativeElement.textContent).not.toContain('formation-card-rendered');
  });

  it('shows the Formation card only when showFormationCard, the flag, and isFormation all agree', async () => {
    await render(true, true, true);

    expect(fixture.nativeElement.textContent).toContain('formation-card-rendered');
  });

  it('hides the Formation card when showFormationCard is true but the flag is off', async () => {
    await render(true, false, true);

    expect(fixture.nativeElement.textContent).not.toContain('formation-card-rendered');
  });

  it('hides the Formation card when showFormationCard is true but the project is not in Formation', async () => {
    await render(true, true, false);

    expect(fixture.nativeElement.textContent).not.toContain('formation-card-rendered');
  });
});
