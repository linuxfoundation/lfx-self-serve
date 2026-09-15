// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormationItem } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it } from 'vitest';

import { FormationReadinessStripComponent } from './formation-readiness-strip.component';

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
    owner: null,
    due_date: null,
    action: 'manual',
    action_href: null,
    detail: null,
    notes: null,
    links: [],
    sub_items: [],
    skip_reason: null,
    can_complete: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

describe('FormationReadinessStripComponent', () => {
  let fixture: ComponentFixture<FormationReadinessStripComponent>;

  const render = async (items: FormationItem[], openGatingItems: number, totalGatingItems: number): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [FormationReadinessStripComponent],
      providers: [
        {
          provide: ProjectContextService,
          useValue: {
            activeProjectAnnouncementDate: signal<string | null>(null),
            activeProjectAnnouncementDateLoading: signal(false),
            activeProjectAnnouncementDateHasError: signal(false),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationReadinessStripComponent);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('openGatingItems', openGatingItems);
    fixture.componentRef.setInput('totalGatingItems', totalGatingItems);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const gatingText = (): string | null => fixture.nativeElement.querySelector('[data-testid="formation-readiness-strip-gating-text"]')?.textContent ?? null;
  const activatingText = (): string | null =>
    fixture.nativeElement.querySelector('[data-testid="formation-readiness-strip-activating-text"]')?.textContent ?? null;
  const countsText = (): string | null => fixture.nativeElement.querySelector('[data-testid="formation-readiness-strip-counts"]')?.textContent ?? null;

  /**
   * GH-2329 regression guard: a skipped gating item is checklist-complete (nothing left for a human
   * to do) but not resolved for readiness — the server's `openGatingItems`/`totalGatingItems` must
   * render verbatim rather than be re-derived from `items` with the retired `done || skipped` gate
   * formula, which would compute `0` here instead of the `1` the server reports.
   */
  it('renders the server gating counts verbatim for a formation with a skipped gating item', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: true }), buildItem({ uid: '2', status: 'skipped', is_gating: true })];
    await render(items, 1, 2);

    expect(gatingText()).toContain('1 of 2 open');
    // A retired `done || skipped` derivation would take this "everything done" branch instead —
    // it must not, since one gating item is still open per the server's rule.
    expect(activatingText()).toBeNull();
  });

  it('takes the "all done" branch only when the server reports zero open gating items', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: true }), buildItem({ uid: '2', status: 'done', is_gating: true })];
    await render(items, 0, 2);

    expect(activatingText()).toContain('All gating items done');
    expect(gatingText()).toBeNull();
  });

  it('tallies `skipped` as its own checklist-completion bucket, separate from `done`', async () => {
    const items = [
      buildItem({ uid: '1', status: 'done', is_gating: true }),
      buildItem({ uid: '2', status: 'skipped', is_gating: true }),
      buildItem({ uid: '3', status: 'not_started', is_gating: false }),
    ];
    await render(items, 1, 2);

    const text = countsText();
    expect(text).toContain('1 of 3 done');
    expect(text).toContain('1 skipped');
  });
});
