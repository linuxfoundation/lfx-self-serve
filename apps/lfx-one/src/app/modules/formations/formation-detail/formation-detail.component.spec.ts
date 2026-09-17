// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationChecklistSectionComponent } from '../../dashboards/components/formation-checklist-section/formation-checklist-section.component';
import { FormationDetailComponent } from './formation-detail.component';

/**
 * Stubbed out (the `formation-page.component.spec.ts` pattern) so this spec's failure mode stays
 * about the drill-down page's own wiring — slug resolution, state branches, and the `projectSlug`
 * binding — not the section's data/rendering logic, which the section's own specs cover.
 */
@Component({ selector: 'lfx-formation-checklist-section', standalone: true, template: '<div data-testid="stub-formation-checklist-section"></div>' })
class StubFormationChecklistSectionComponent {
  public readonly projectSlug = input<string | null>(null);
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    uid: 'child-uid',
    slug: 'child-project',
    name: 'Durable Agents',
    stage: 'Formation - Engaged',
    ...overrides,
  } as Project;
}

describe('FormationDetailComponent', () => {
  let fixture: ComponentFixture<FormationDetailComponent>;
  const getProject = vi.fn();

  const render = async (slug: string | null = 'child-project'): Promise<void> => {
    const paramMap = convertToParamMap(slug ? { projectSlug: slug } : {});
    await TestBed.configureTestingModule({
      imports: [FormationDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
        { provide: ProjectService, useValue: { getProject } },
      ],
    })
      .overrideComponent(FormationDetailComponent, {
        remove: { imports: [FormationChecklistSectionComponent] },
        add: { imports: [StubFormationChecklistSectionComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FormationDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    getProject.mockReset();
  });

  it('renders the resolved project name as the heading and hosts the checklist section with the path slug', async () => {
    getProject.mockReturnValue(of(buildProject()));

    await render('child-project');

    expect(getProject).toHaveBeenCalledWith('child-project', false);
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Durable Agents');

    const stub = fixture.debugElement.children[0].query((node) => node.componentInstance instanceof StubFormationChecklistSectionComponent);
    expect(stub?.componentInstance.projectSlug()).toBe('child-project');
  });

  it('shows the loading skeleton while the project lookup is in flight', async () => {
    getProject.mockReturnValue(new Subject<Project | null>());

    await render('child-project');

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).toBeNull();
  });

  it('shows the not-found state when the project cannot be loaded', async () => {
    getProject.mockReturnValue(of(null));

    await render('unknown-project');

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-not-found"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).toBeNull();
  });

  // Mirrors formationProjectEnabledGuard's stage gate without its redirect (LFXV2-3386): a stale
  // deep link to a since-activated project explains itself in place instead of bouncing (and
  // context-switching) to that project's overview.
  it('shows the not-in-formation state for a post-Formation project', async () => {
    getProject.mockReturnValue(of(buildProject({ stage: 'Active' })));

    await render('child-project');

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-not-in-formation"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });

  it('keeps the back link pointed at the formations queue', async () => {
    getProject.mockReturnValue(of(buildProject()));

    await render('child-project');

    const back = fixture.nativeElement.querySelector('[data-testid="formation-detail-back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/foundation/formations');
  });
});
