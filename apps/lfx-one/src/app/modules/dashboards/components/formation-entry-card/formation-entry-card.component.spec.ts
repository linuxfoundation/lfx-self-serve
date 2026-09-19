// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Formation, FormationChecklistResponse, FormationItem, ProjectContext } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationEntryCardComponent } from './formation-entry-card.component';

/** Only the fields `deriveFormationReadinessSummary` reads — the rest is irrelevant to this component. */
function buildItem(overrides: Partial<FormationItem>): FormationItem {
  return {
    uid: 'formation-item:test',
    formation_uid: 'formation:test',
    project_uid: 'project:test',
    template_item_key: 'test-item',
    section_key: 'legal',
    section_title: 'Legal and entity',
    title: 'Test item',
    status: 'not_started',
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
    ...overrides,
  };
}

describe('FormationEntryCardComponent', () => {
  let fixture: ComponentFixture<FormationEntryCardComponent>;
  let getProjectFormation: ReturnType<typeof vi.fn>;
  const activeContext = signal<ProjectContext | null>({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });

  const render = async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [FormationEntryCardComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext } },
        { provide: FormationService, useValue: { getProjectFormation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationEntryCardComponent);
    await fixture.whenStable();
  };

  const summaryText = (): string | null => fixture.nativeElement.querySelector('[data-testid="formation-entry-card-summary"]')?.textContent ?? null;

  function buildFormation(overrides: Partial<Formation> = {}): Formation {
    return {
      parent_project_uid: 'project:test',
      parent_project_slug: 'test-project',
      parent_project_name: 'Test Project',
      is_foundation: false,
      parent_uid: null,
      template_uid: 'template:test',
      template_version: 1,
      sub_stage: 'engaged',
      sub_stage_raw: 'Formation - Engaged',
      lifecycle: 'live',
      lifecycle_raw: 'live',
      announcement_date: null,
      is_activating: false,
      gating_items_open: 0,
      gating_items_total: 0,
      blocking_item_title: null,
      subtitle: null,
      ...overrides,
    };
  }

  /** The component reads `response.formation.gating_items_open`/`.gating_items_total` directly (server-computed), not derived from `items`. */
  const buildResponse = (items: FormationItem[], gatingItemsOpen = 0, gatingItemsTotal = 0): FormationChecklistResponse => ({
    items,
    template: null,
    formation: buildFormation({ gating_items_open: gatingItemsOpen, gating_items_total: gatingItemsTotal }),
    can_write: true,
    can_set_status: true,
  });

  beforeEach(() => {
    activeContext.set({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });
    getProjectFormation = vi.fn();
  });

  it('renders the done/total count and the open/total gating count', async () => {
    const items = [
      buildItem({ uid: '1', status: 'done', is_gating: true }),
      buildItem({ uid: '2', status: 'not_started', is_gating: true }),
      buildItem({ uid: '3', status: 'not_started', is_gating: false }),
    ];
    getProjectFormation.mockReturnValue(of(buildResponse(items, 1, 2)));

    await render();

    const text = summaryText();
    expect(text).toContain('1 of 3 done');
    // Regression guard: one of two gating items is still open — this must read "1 of 2", never
    // the inverted "1 of 2" flipped to totalGating - openGating (a bug this spec caught once).
    expect(text).toContain('1 of 2 required for Active open');
  });

  it('omits the gating clause entirely when the formation has no gating items', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: false })];
    getProjectFormation.mockReturnValue(of(buildResponse(items, 0, 0)));

    await render();

    expect(summaryText()).not.toContain('required for Active open');
  });

  it('shows 0 of N open when every gating item is actually done', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: true }), buildItem({ uid: '2', status: 'done', is_gating: true })];
    getProjectFormation.mockReturnValue(of(buildResponse(items, 0, 2)));

    await render();

    expect(summaryText()).toContain('0 of 2 required for Active open');
  });

  /**
   * GH-2329 regression guard: a skipped gating item is neither `done` (so `doneCount`, a plain
   * per-status tally, doesn't count it) nor open for readiness purposes under the retired
   * `done || skipped` gate formula. The server's rule is that only `done` clears a gate, so
   * `gating_items_open` for this formation is `1`, not `0` — and the component must read that number
   * verbatim off the response rather than re-deriving it from `items`. Passing `1` here and asserting
   * `1 of 2 required for Active open` fails if either the component or a future edit starts
   * re-deriving the count with the retired rule.
   */
  it('keeps a skipped gating item open in the required-for-Active count', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: true }), buildItem({ uid: '2', status: 'skipped', is_gating: true })];
    getProjectFormation.mockReturnValue(of(buildResponse(items, 1, 2)));

    await render();

    const text = summaryText();
    // doneCount is the checklist-completion count (`counts.done`), which only tallies `status ===
    // 'done'` — a skipped item is not folded into it either, so this reads `1 of 2`, not `2 of 2`.
    expect(text).toContain('1 of 2 done');
    expect(text).toContain('1 of 2 required for Active open');
  });

  it('links to the formation route with the active project slug as a query param', async () => {
    getProjectFormation.mockReturnValue(of(buildResponse([])));

    await render();

    const link = fixture.nativeElement.querySelector('[data-testid="formation-entry-card-link"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/project/formation?project=test-project');
  });

  it('shows an error state instead of a misleading "0 of 0 done" when the fetch fails', async () => {
    getProjectFormation.mockReturnValue(throwError(() => new Error('network error')));

    await render();

    expect(summaryText()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="formation-entry-card-error"]')?.textContent).toContain("Couldn't load the checklist status");
  });
});
