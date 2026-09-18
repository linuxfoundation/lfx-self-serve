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

function buildResponse(lifecycle: FormationLifecycle | null, lifecycleRaw: string, canWrite = true, canSetStatus = canWrite): FormationChecklistResponse {
  return {
    can_write: canWrite,
    can_set_status: canSetStatus,
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
        audience: null,
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
  let getQueueFormationChecklist: ReturnType<typeof vi.fn>;

  const render = async (response: FormationChecklistResponse, options: { projectSlug?: string } = {}): Promise<void> => {
    TestBed.resetTestingModule();
    getProjectFormation = vi.fn().mockReturnValue(of(response));
    getQueueFormationChecklist = vi.fn().mockReturnValue(of(response));
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
        { provide: FormationService, useValue: { getProjectFormation, getQueueFormationChecklist } },
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

  // GH-2694: the drawer's `canWrite` input previously went unbound here, defaulting `true` — every
  // caller was offered editable assignee/due-date fields whose writer-gated upstream route then
  // refused the save (and, when an assignee was refused, silently discarded the due date with it).
  it('passes the response can_write through to the row and the drawer', async () => {
    await render(buildResponse('live', 'live', true));

    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.canWrite()).toBe(true);
    expect(drawerDebugEl.componentInstance.canWrite()).toBe(true);
  });

  it('passes canWrite false to the row and the drawer for a non-writer caller (fail-closed)', async () => {
    await render(buildResponse('live', 'live', false));

    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.canWrite()).toBe(false);
    expect(drawerDebugEl.componentInstance.canWrite()).toBe(false);
  });

  // GH-2705: can_set_status is the writer ∧ team:formation pair — the shipped defect was a writer
  // outside the formation team receiving status controls that could only 403, so the split
  // (canWrite true, canSetStatus false) is the case that matters.
  it('passes the response can_set_status through to the row and the drawer independently of can_write', async () => {
    await render(buildResponse('live', 'live', true, false));

    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.canWrite()).toBe(true);
    expect(rowDebugEl.componentInstance.canSetStatus()).toBe(false);
    expect(drawerDebugEl.componentInstance.canWrite()).toBe(true);
    expect(drawerDebugEl.componentInstance.canSetStatus()).toBe(false);
  });

  // LFXV2-3386: the foundation formations drill-down renders another project's checklist while the
  // project context still describes the foundation — the `projectSlug` input must win over the
  // context slug. (The strip's announcement-date override this mode used to feed is gone — the date
  // moved to the formation-page sidebar card, GH-2702.)
  describe('explicit projectSlug input (LFXV2-3386)', () => {
    it('fetches via the auditor-gated queue read for the input slug, never the context slug or the project-page read', async () => {
      await render(buildResponse('live', 'live'), { projectSlug: 'other-project' });

      // Explicit-slug mode is the auditor drill-down — it must use the requireAuditor-gated
      // endpoint (#2690 review) so the queue's root-auditor contract holds server-side.
      expect(getQueueFormationChecklist).toHaveBeenCalledWith('other-project');
      expect(getProjectFormation).not.toHaveBeenCalled();
    });

    it('uses the plain project-page read when no slug input is set', async () => {
      await render(buildResponse('live', 'live'));

      expect(getProjectFormation).toHaveBeenCalledWith('test-project');
      expect(getQueueFormationChecklist).not.toHaveBeenCalled();
    });
  });
});
