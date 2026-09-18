// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Formation, FormationChecklistResponse, Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationCardComponent } from '../../dashboards/components/formation-card/formation-card.component';
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
  public readonly responseLoaded = output<FormationChecklistResponse | null>();
}

@Component({ selector: 'lfx-formation-card', standalone: true, template: '<div data-testid="stub-formation-card"></div>' })
class StubFormationCardComponent {
  public readonly formation = input<Formation | null>(null);
}

/** Only the `formation` block matters here — the stubbed card never reads the rest. */
function checklistResponse(): FormationChecklistResponse {
  return {
    formation: {
      parent_project_uid: 'child-uid',
      parent_project_slug: 'child-project',
      sub_stage_raw: 'Formation - Engaged',
      announcement_date: '2026-10-25',
    } as Formation,
    template: null,
    items: [],
    can_write: false,
    can_set_status: false,
  };
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
        remove: { imports: [FormationChecklistSectionComponent, FormationCardComponent] },
        add: { imports: [StubFormationChecklistSectionComponent, StubFormationCardComponent] },
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

  // #2719: this page shipped without the rail that `/project/formation` has, so staff saw a
  // checklist with no project info card beside it. The card is fed from the checklist response the
  // section here already fetched — never from ProjectContextService, which on this page describes
  // the parent foundation, not this child project.
  describe('sidebar (#2719)', () => {
    const emitChecklist = (response: FormationChecklistResponse | null): void => {
      const section = fixture.debugElement.query((node) => node.componentInstance instanceof StubFormationChecklistSectionComponent);
      (section.componentInstance as StubFormationChecklistSectionComponent).responseLoaded.emit(response);
      fixture.detectChanges();
    };

    it('hosts the formation card in a right rail once the checklist has loaded', async () => {
      getProjectStrict.mockReturnValue(of(buildProject()));
      await render('child-project');
      emitChecklist(checklistResponse());

      const sidebar = fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]');
      expect(sidebar?.querySelector('[data-testid="stub-formation-card"]')).not.toBeNull();
    });

    it('passes the checklist formation — the CHILD project, not the foundation — down to the card', async () => {
      getProjectStrict.mockReturnValue(of(buildProject()));
      await render('child-project');
      emitChecklist(checklistResponse());

      const card = fixture.debugElement.query((node) => node.componentInstance instanceof StubFormationCardComponent);
      expect((card.componentInstance as StubFormationCardComponent).formation()?.parent_project_slug).toBe('child-project');
    });

    it('stacks the columns below xl: and restores the side-by-side row at xl:', async () => {
      getProjectStrict.mockReturnValue(of(buildProject()));
      await render('child-project');
      emitChecklist(checklistResponse());

      const columns = fixture.nativeElement.querySelector('[data-testid="formation-detail-columns"]');
      expect(columns?.className).toContain('flex-col');
      expect(columns?.className).toContain('xl:flex-row');

      const sidebar = fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]');
      expect(sidebar?.className).toContain('w-full');
      expect(sidebar?.className).toContain('xl:w-64');
    });

    it('omits the rail until the checklist arrives, and again if a reload fails', async () => {
      getProjectStrict.mockReturnValue(of(buildProject()));
      await render('child-project');

      expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]')).toBeNull();

      emitChecklist(checklistResponse());
      expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]')).not.toBeNull();

      emitChecklist(null);
      expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]')).toBeNull();
    });

    // A route-param change tears the resolved branch — section included — out of the template, so
    // the remounted section is a fresh instance and emits no switch-time clear. Without the slug
    // tag on the host's copy, the rail would keep rendering the previous child's slug, date and
    // admin-tool link beside the new project's heading and loading checklist.
    it('drops the previous project’s card when the route slug changes', async () => {
      const paramMap$ = new BehaviorSubject(convertToParamMap({ projectSlug: 'child-project' }));
      getProjectStrict.mockImplementation((slug: string) => of(buildProject({ slug, name: slug })));

      await TestBed.configureTestingModule({
        imports: [FormationDetailComponent],
        providers: [
          provideRouter([]),
          { provide: ActivatedRoute, useValue: { paramMap: paramMap$, snapshot: { paramMap: paramMap$.value } } },
          { provide: ProjectService, useValue: { getProjectStrict } },
        ],
      })
        .overrideComponent(FormationDetailComponent, {
          remove: { imports: [FormationChecklistSectionComponent, FormationCardComponent] },
          add: { imports: [StubFormationChecklistSectionComponent, StubFormationCardComponent] },
        })
        .compileComponents();

      fixture = TestBed.createComponent(FormationDetailComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      emitChecklist(checklistResponse());
      expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]')).not.toBeNull();

      paramMap$.next(convertToParamMap({ projectSlug: 'second-project' }));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('second-project');
      expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]')).toBeNull();

      // …and the rail comes back once the new project's own checklist lands.
      emitChecklist({ ...checklistResponse(), formation: { ...checklistResponse().formation, parent_project_slug: 'second-project' } as Formation });
      expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]')).not.toBeNull();
    });

    it.each([
      ['not-found', 404, buildProject()],
      ['post-Formation', null, buildProject({ stage: 'Active' })],
    ])('renders no rail on the %s branch, which hosts no checklist either', async (_label, status, resolved) => {
      getProjectStrict.mockReturnValue(status ? throwError(() => ({ status })) : of(resolved));

      await render('child-project');

      expect(fixture.nativeElement.querySelector('[data-testid="formation-detail-sidebar"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-card"]')).toBeNull();
    });
  });

  it('keeps the back link pointed at the formations queue', async () => {
    getProjectStrict.mockReturnValue(of(buildProject()));

    await render('child-project');

    const back = fixture.nativeElement.querySelector('[data-testid="formation-detail-back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/foundation/formations');
  });
});
