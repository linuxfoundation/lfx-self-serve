// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Formation, FormationChecklistResponse, Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { FormationCardComponent } from '../../components/formation-card/formation-card.component';
import { FormationChecklistSectionComponent } from '../../components/formation-checklist-section/formation-checklist-section.component';
import { FormationPageComponent } from './formation-page.component';

/**
 * Stubbed out so this spec's failure mode stays about the page shell's own wiring (heading +
 * hosting the section and sidebar card), not the children's own data/rendering logic — that's
 * covered by their own specs.
 */
@Component({ selector: 'lfx-formation-checklist-section', standalone: true, template: '<div data-testid="stub-formation-checklist-section"></div>' })
class StubFormationChecklistSectionComponent {
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
      parent_project_uid: 'proj-1',
      parent_project_slug: 'test-project',
      sub_stage_raw: 'Formation - Engaged',
      announcement_date: null,
    } as Formation,
    template: null,
    items: [],
    can_write: false,
    can_set_status: false,
  };
}

describe('FormationPageComponent', () => {
  let fixture: ComponentFixture<FormationPageComponent>;
  const activeContext = signal<ProjectContext | null>({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });
  // Only truthiness matters to the page — the stubbed card never reads the fields.
  const activeProject = signal<Project | null>({ uid: 'proj-1', slug: 'test-project' } as Project);

  const render = async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [FormationPageComponent],
      providers: [{ provide: ProjectContextService, useValue: { activeContext, activeProject } }],
    })
      .overrideComponent(FormationPageComponent, {
        remove: { imports: [FormationChecklistSectionComponent, FormationCardComponent] },
        add: { imports: [StubFormationChecklistSectionComponent, StubFormationCardComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FormationPageComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    activeContext.set({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });
    activeProject.set({ uid: 'proj-1', slug: 'test-project' } as Project);
  });

  it('renders the active project name as the page heading', async () => {
    await render();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Test Project');
  });

  it('always hosts the formation checklist section', async () => {
    await render();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).not.toBeNull();
  });

  it('omits the heading block when there is no active project context', async () => {
    activeContext.set(null);
    await render();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).not.toBeNull();
  });

  // GH-2702: the formation card (stage, announcement date, slug) renders in a right rail beside
  // the checklist. JSDOM doesn't evaluate breakpoint media queries, so the responsive classes are
  // asserted rather than the visual column placement.
  describe('sidebar (GH-2702, #2719)', () => {
    /** Drives the stubbed section's output, the page's only source for the rail since #2719. */
    const emitChecklist = (response: FormationChecklistResponse | null): void => {
      const section = fixture.debugElement.query((node) => node.componentInstance instanceof StubFormationChecklistSectionComponent);
      (section.componentInstance as StubFormationChecklistSectionComponent).responseLoaded.emit(response);
      fixture.detectChanges();
    };

    it('hosts the formation card inside the sidebar once the checklist has loaded', async () => {
      await render();
      emitChecklist(checklistResponse());

      const sidebar = fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]');
      expect(sidebar?.querySelector('[data-testid="stub-formation-card"]')).not.toBeNull();
    });

    it('stacks the columns below xl: and restores the side-by-side row at xl:', async () => {
      await render();
      emitChecklist(checklistResponse());

      const columns = fixture.nativeElement.querySelector('[data-testid="formation-page-columns"]');
      expect(columns?.className).toContain('flex-col');
      expect(columns?.className).toContain('xl:flex-row');

      const sidebar = fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]');
      expect(sidebar?.className).toContain('w-full');
      expect(sidebar?.className).toContain('xl:w-64');
    });

    it('omits the rail until the checklist arrives — the card would render nothing into a reserved blank column', async () => {
      await render();

      expect(fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).not.toBeNull();
    });

    it('drops the rail again when a reload fails, rather than pairing a stale card with an errored checklist', async () => {
      await render();
      emitChecklist(checklistResponse());
      emitChecklist(null);

      expect(fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]')).toBeNull();
    });

    // #2719: the rail used to gate on ProjectContextService.activeProject — a separate
    // GET /api/projects/:slug that degrades to null with no retry, so the card could vanish beside
    // a checklist that had loaded fine for the same caller.
    it('renders the rail from the checklist alone, even with no resolved active project', async () => {
      activeProject.set(null);
      await render();
      emitChecklist(checklistResponse());

      expect(fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]')).not.toBeNull();
    });

    it('passes the checklist formation down to the card', async () => {
      await render();
      emitChecklist(checklistResponse());

      const card = fixture.debugElement.query((node) => node.componentInstance instanceof StubFormationCardComponent);
      expect((card.componentInstance as StubFormationCardComponent).formation()?.parent_project_slug).toBe('test-project');
    });
  });
});
