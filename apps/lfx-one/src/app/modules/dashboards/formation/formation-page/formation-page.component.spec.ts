// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Project, ProjectContext } from '@lfx-one/shared/interfaces';
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
class StubFormationChecklistSectionComponent {}

@Component({ selector: 'lfx-formation-card', standalone: true, template: '<div data-testid="stub-formation-card"></div>' })
class StubFormationCardComponent {}

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
  describe('sidebar (GH-2702)', () => {
    it('hosts the formation card inside the sidebar', async () => {
      await render();
      const sidebar = fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]');
      expect(sidebar?.querySelector('[data-testid="stub-formation-card"]')).not.toBeNull();
    });

    it('stacks the columns below xl: and restores the side-by-side row at xl:', async () => {
      await render();
      const columns = fixture.nativeElement.querySelector('[data-testid="formation-page-columns"]');
      expect(columns?.className).toContain('flex-col');
      expect(columns?.className).toContain('xl:flex-row');

      const sidebar = fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]');
      expect(sidebar?.className).toContain('w-full');
      expect(sidebar?.className).toContain('xl:w-64');
    });

    it('omits the rail entirely while the project is unresolved — the card would render nothing into a reserved blank column', async () => {
      activeProject.set(null);
      await render();
      expect(fixture.nativeElement.querySelector('[data-testid="formation-page-sidebar"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="stub-formation-checklist-section"]')).not.toBeNull();
    });
  });
});
