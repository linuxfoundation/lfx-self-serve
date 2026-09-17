// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { FormationService } from '@services/formation.service';
import { ProjectContextService } from '@services/project-context.service';
import { Formation, FormationChecklistResponse, FormationLifecycle } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FormationChecklistSectionComponent } from './formation-checklist-section.component';

// GH-2328: this component previously had no spec at all — per plan, add a focused one for
// read-only only rather than attempting to backfill the whole component.

function buildFormation(lifecycle: FormationLifecycle | null, lifecycleRaw: string): Formation {
  return {
    parent_project_uid: 'project:test',
    parent_project_slug: 'test-project',
    parent_project_name: 'Test Project',
    is_foundation: false,
    parent_uid: null,
    template_uid: 'template:test',
    template_version: 1,
    sub_stage: null,
    sub_stage_raw: 'Formation - Engaged',
    lifecycle,
    lifecycle_raw: lifecycleRaw,
    announcement_date: null,
    is_activating: false,
    gating_items_open: 0,
    gating_items_total: 0,
    blocking_item_title: null,
    subtitle: null,
  };
}

function buildResponse(lifecycle: FormationLifecycle | null, lifecycleRaw: string): FormationChecklistResponse {
  return {
    formation: buildFormation(lifecycle, lifecycleRaw),
    template: {
      uid: 'template:test',
      version: 1,
      name: 'Test template',
      sections: [{ key: 'legal', title: 'Legal and entity', items: [] }],
    },
    items: [
      {
        uid: 'formation-item:test',
        formation_uid: 'formation:test',
        project_uid: 'project:test',
        template_item_key: 'test-item',
        section_key: 'legal',
        section_title: 'Legal and entity',
        title: 'Test item',
        status: 'in_progress',
        is_gating: false,
        owner_team: null,
        owner: null,
        due_date: null,
        action: 'manual',
        action_href: null,
        detail: null,
        notes: null,
        evidence_link: null,
        sub_items: [],
        skip_reason: null,
        available_actions: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        version: 1,
      },
    ],
  };
}

describe('FormationChecklistSectionComponent', () => {
  let fixture: ComponentFixture<FormationChecklistSectionComponent>;
  let getProjectFormation: ReturnType<typeof vi.fn>;

  const render = async (response: FormationChecklistResponse, options: { projectSlug?: string } = {}): Promise<void> => {
    TestBed.resetTestingModule();
    getProjectFormation = vi.fn().mockReturnValue(of(response));
    await TestBed.configureTestingModule({
      imports: [FormationChecklistSectionComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: signal({ uid: 'project:test', name: 'Test Project', slug: 'test-project' }),
            activeProjectAnnouncementDate: signal<string | null>(null),
            activeProjectAnnouncementDateLoading: signal(false),
            activeProjectAnnouncementDateHasError: signal(false),
          },
        },
        { provide: FormationService, useValue: { getProjectFormation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationChecklistSectionComponent);
    if (options.projectSlug !== undefined) {
      fixture.componentRef.setInput('projectSlug', options.projectSlug);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const banner = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="formation-checklist-read-only-banner"]');

  it('does not render the read-only banner when lifecycle is live', async () => {
    await render(buildResponse('live', 'live'));

    expect(fixture.componentInstance['readOnly']()).toBe(false);
    expect(banner()).toBeNull();
  });

  it('renders the read-only banner with "complete" copy for a completed formation', async () => {
    await render(buildResponse('completed', 'completed'));

    expect(fixture.componentInstance['readOnly']()).toBe(true);
    expect(banner()?.textContent).toContain('This formation is complete.');
  });

  it('renders the read-only banner with "frozen" copy for a frozen formation', async () => {
    await render(buildResponse('frozen', 'frozen'));

    expect(fixture.componentInstance['readOnly']()).toBe(true);
    expect(banner()?.textContent).toContain('This formation is frozen.');
  });

  it('renders the read-only banner naming the raw value for an unrecognized lifecycle', async () => {
    await render(buildResponse(null, 'archived'));

    expect(fixture.componentInstance['readOnly']()).toBe(true);
    expect(banner()?.textContent).toContain('This formation is read-only (status: "archived").');
  });

  it('passes readOnly through to the row and the drawer', async () => {
    await render(buildResponse('frozen', 'frozen'));

    const row = fixture.nativeElement.querySelector('lfx-formation-checklist-row');
    const drawer = fixture.nativeElement.querySelector('lfx-formation-item-drawer');
    expect(row).not.toBeNull();
    expect(drawer).not.toBeNull();
    // readOnly is bound as a property, not reflected as an attribute — assert via the child
    // component instances' inputs instead of the DOM attribute.
    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.readOnly()).toBe(true);
    expect(drawerDebugEl.componentInstance.readOnly()).toBe(true);
  });

  // LFXV2-3386: the foundation formations drill-down renders another project's checklist while the
  // project context still describes the foundation — the `projectSlug` input must win over the
  // context slug, and the readiness strip's announcement date must come off the checklist response
  // rather than the (foundation's) context signals.
  describe('explicit projectSlug input (LFXV2-3386)', () => {
    it('fetches the checklist for the input slug, not the active context slug', async () => {
      await render(buildResponse('live', 'live'), { projectSlug: 'other-project' });

      expect(getProjectFormation).toHaveBeenCalledWith('other-project');
      expect(getProjectFormation).not.toHaveBeenCalledWith('test-project');
    });

    it('hands the checklist response announcement date to the readiness strip', async () => {
      const response = buildResponse('live', 'live');
      response.formation.announcement_date = '2026-06-30';
      await render(response, { projectSlug: 'other-project' });

      const stripDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-readiness-strip');
      expect(stripDebugEl.componentInstance.announcementDate()).toBe('2026-06-30');
    });

    it('leaves the strip on its context fallback when no slug input is set', async () => {
      await render(buildResponse('live', 'live'));

      expect(getProjectFormation).toHaveBeenCalledWith('test-project');
      const stripDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-readiness-strip');
      expect(stripDebugEl.componentInstance.announcementDate()).toBeUndefined();
    });
  });
});
