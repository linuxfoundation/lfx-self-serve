// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { FormationChecklistSectionComponent } from '../../components/formation-checklist-section/formation-checklist-section.component';
import { FormationPageComponent } from './formation-page.component';

/**
 * Stubbed out so this spec's failure mode stays about the page shell's own wiring (heading +
 * hosting the section), not the section's own data/rendering logic — that's covered by the
 * section's own specs.
 */
@Component({ selector: 'lfx-formation-checklist-section', standalone: true, template: '<div data-testid="stub-formation-checklist-section"></div>' })
class StubFormationChecklistSectionComponent {}

describe('FormationPageComponent', () => {
  let fixture: ComponentFixture<FormationPageComponent>;
  const activeContext = signal<ProjectContext | null>({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });

  const render = async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [FormationPageComponent],
      providers: [{ provide: ProjectContextService, useValue: { activeContext } }],
    })
      .overrideComponent(FormationPageComponent, {
        remove: { imports: [FormationChecklistSectionComponent] },
        add: { imports: [StubFormationChecklistSectionComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FormationPageComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    activeContext.set({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });
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
});
