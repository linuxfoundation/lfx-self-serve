// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormationItem } from '@lfx-one/shared/interfaces';
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

describe('FormationReadinessStripComponent', () => {
  let fixture: ComponentFixture<FormationReadinessStripComponent>;

  const render = async (items: FormationItem[], openGatingItems: number, totalGatingItems: number): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [FormationReadinessStripComponent],
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
  const requiredLegend = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="formation-readiness-strip-required-legend"]');

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

  // #2774: the rows mark gating items with a red asterisk; the "Required for Active" caption carries
  // the same mark so it doubles as the legend — only while there are open gates for it to point at.
  it('marks the "Required for Active" caption with the rows’ red asterisk legend while gates are open', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: true }), buildItem({ uid: '2', status: 'not_started', is_gating: true })];
    await render(items, 1, 2);

    const legend = requiredLegend();
    expect(legend?.textContent).toBe('*');
    expect(legend?.className).toContain('text-red-500');
    expect(legend?.getAttribute('aria-hidden')).toBe('true');
    expect(gatingText()).toContain('1 of 2 open');
  });

  it('omits the asterisk legend in the "all done" branch', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: true })];
    await render(items, 0, 1);

    expect(requiredLegend()).toBeNull();
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

  // GH-2702: the announcement date moved to the formation-page sidebar (`lfx-formation-card`) — the
  // strip must no longer render its own copy on either checklist host.
  it('renders no announcement date block', async () => {
    await render([buildItem({ uid: '1' })], 0, 1);

    expect(fixture.nativeElement.querySelector('[data-testid="formation-readiness-strip-announcement"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Announcement date');
  });

  // GH-2440: the strip's four-column single-row layout overlapped itself at phone width. These
  // assert the responsive classes stay in place rather than the visual result (JSDOM doesn't evaluate
  // real breakpoint media queries) — a manual check at 390/360/320px is the actual regression guard.
  describe('responsive layout (GH-2440)', () => {
    it('stacks the root below sm: and restores a row at sm: and above', async () => {
      await render([buildItem({ uid: '1' })], 0, 1);

      const root = fixture.nativeElement.querySelector('[data-testid="formation-readiness-strip"]');
      expect(root?.className).toContain('flex-col');
      expect(root?.className).toContain('sm:flex-row');
    });

    it('does not force whitespace-nowrap on "Ready for go-live" below sm:', async () => {
      await render([buildItem({ uid: '1' })], 0, 1);

      const label = Array.from(fixture.nativeElement.querySelectorAll('span')).find((el) => (el as HTMLElement).textContent === 'Ready for go-live') as
        | HTMLElement
        | undefined;
      expect(label?.className).not.toMatch(/(^|\s)whitespace-nowrap(\s|$)/);
      expect(label?.className).toContain('sm:whitespace-nowrap');
    });
  });
});
