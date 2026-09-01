// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectContext } from '@lfx-one/shared/interfaces';

import { FoundationProjectsComponent } from './foundation-projects.component';

// Covers only the two pieces GH-1962 added — the "Add a project" CTA's visibility and its
// navigation — not the page's pre-existing analytics/table rendering, which has no spec at all
// today and is out of scope for this change.
describe('FoundationProjectsComponent — "Add a project" entry point (GH-1962)', () => {
  let fixture: ComponentFixture<FoundationProjectsComponent>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let selectedFoundation: WritableSignal<ProjectContext | null>;
  let formationEnabled: WritableSignal<boolean>;

  beforeEach(() => {
    selectedFoundation = signal<ProjectContext | null>({ uid: 'f1', name: 'The Linux Foundation', slug: 'tlf' });
    formationEnabled = signal(true);
    router = { navigate: vi.fn() };
  });

  async function render(): Promise<void> {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [FoundationProjectsComponent],
      providers: [
        { provide: ProjectContextService, useValue: { selectedFoundation, setProject: vi.fn() } },
        { provide: AnalyticsService, useValue: { getFoundationProjectsDetailGrouped: vi.fn().mockReturnValue(of({ groups: [], totalCount: 0 })) } },
        { provide: CommitteeService, useValue: { getCommitteesByProject: vi.fn().mockReturnValue(of([])) } },
        { provide: MailingListService, useValue: { getMailingListsCount: vi.fn().mockReturnValue(of(0)) } },
        { provide: ProjectService, useValue: { getProjects: vi.fn().mockReturnValue(of([])) } },
        { provide: LensService, useValue: { setLens: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => formationEnabled } },
        { provide: Router, useValue: router },
        // Only needed because ButtonComponent (lfx-button, used by the "Add a project" CTA
        // itself) binds a `routerLink` input internally — Angular's RouterLink directive
        // requires ActivatedRoute even when routerLink is never set on this page.
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FoundationProjectsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function addProjectButton(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="foundation-projects-add-project"]');
  }

  it('shows the "Add a project" CTA when a foundation is selected and the flag is on', async () => {
    await render();

    expect(addProjectButton()).not.toBeNull();
  });

  it('hides the CTA when the flag is off, even with a foundation selected', async () => {
    formationEnabled.set(false);
    await render();

    expect(addProjectButton()).toBeNull();
  });

  it('hides the CTA when no foundation is selected, even with the flag on', async () => {
    selectedFoundation.set(null);
    await render();

    expect(addProjectButton()).toBeNull();
  });

  it('proposeProject() navigates to /propose with the selected foundation as the parent query param', async () => {
    await render();

    (fixture.componentInstance as unknown as { proposeProject: () => void }).proposeProject();

    expect(router.navigate).toHaveBeenCalledWith(['/propose'], { queryParams: { parent: 'tlf' } });
  });
});
