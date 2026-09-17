// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { of, Subject, throwError } from 'rxjs';
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
  const getProjectStrict = vi.fn();

  const render = async (slug: string | null = 'child-project'): Promise<void> => {
    const paramMap = convertToParamMap(slug ? { projectSlug: slug } : {});
    await TestBed.configureTestingModule({
      imports: [FormationDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
        { provide: ProjectService, useValue: { getProjectStrict } },
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
    getProjectStrict.mockReset();
  });

  it('renders the resolved project name as the heading and hosts the checklist section with the path slug', async () => {
    getProjectStrict.mockReturnValue(of(buildProject()));

    await render('child-project');

    expect(getProjectStrict).toHaveBeenCalledWith('child-project');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Durable Agents');

    const stub = fixture.debugElement.children[0].query((node) => node.componentInstance instanceof StubFormationChecklistSectionComponent);
    expect(stub?.componentInstance.projectSlug()).toBe('child-project');
  });

  it('shows the loading skeleton while the project lookup is in flight', async () => {
    getProjectStrict.mockReturnValue(new Subject<Project>());

    await render('child-project');

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).toBeNull();
  });

  // 400/404 is the expected "no such slug" path (newsletter-reader classification) — the permanent
  // not-found branch, never the retryable error banner.
  it.each([400, 404])('shows the not-found state when the lookup fails with %s', async (status) => {
    getProjectStrict.mockReturnValue(throwError(() => ({ status })));

    await render('unknown-project');

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-not-found"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).toBeNull();
  });

  // A transient failure (gateway 5xx, network) must NOT masquerade as a permanent 404 (#2690
  // review): it renders the retryable error state, and Retry re-fetches and recovers.
  it('shows a retryable error state on a transient failure, and Retry recovers', async () => {
    getProjectStrict.mockReturnValueOnce(throwError(() => ({ status: 500 }))).mockReturnValueOnce(of(buildProject()));

    await render('child-project');

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-not-found"]')).toBeNull();

    (fixture.nativeElement.querySelector('[data-testid="formation-detail-retry"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Durable Agents');
  });

  // The gate is the exact complement of the queue's isPostFormationStage predicate (LFXV2-3386): a
  // stale deep link to a since-activated project explains itself in place instead of bouncing (and
  // context-switching) to that project's overview.
  it.each(['Active', 'Archived'])('shows the not-in-formation state for a post-Formation (%s) project', async (stage) => {
    getProjectStrict.mockReturnValue(of(buildProject({ stage })));

    await render('child-project');

    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-not-in-formation"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });

  // The queue deliberately keeps Disengaged and unrecognized-stage rows visible (GH-2366 fail-open)
  // — this page must open every row the queue links, so those render the checklist, not a dead end.
  it.each(['Formation - Disengaged', 'Some Unrecognized Stage'])('renders the checklist for a queue-visible %s project', async (stage) => {
    getProjectStrict.mockReturnValue(of(buildProject({ stage })));

    await render('child-project');

    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-not-in-formation"]')).toBeNull();
  });

  it('keeps the back link pointed at the formations queue', async () => {
    getProjectStrict.mockReturnValue(of(buildProject()));

    await render('child-project');

    const back = fixture.nativeElement.querySelector('[data-testid="formation-detail-back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/foundation/formations');
  });
});
