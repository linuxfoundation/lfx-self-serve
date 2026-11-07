// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageUsageComponent } from './mktg-brand-kit-page-usage.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

describe('the Example usage page', () => {
  it('opens the Usage chapter with the four cards in the mock’s layouts, the kit’s words on them, and the table under them', async () => {
    const { frame, view, fixture } = await mountBrandKitPage(MktgBrandKitPageUsageComponent, 'usage');
    expect(frame.getAttribute('data-page')).toBe('13');
    expect(frame.getAttribute('data-section')).toBe('05 Usage');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-usage-intro"]')?.textContent).toBe(view.usage.summary);
    const cards = frame.querySelector('[data-testid="brand-kit-usage-cards"]');
    expect(rectOf(cards)).toEqual({ left: '56px', top: '220px', width: '704px' });
    const layouts = Array.from(cards?.querySelectorAll('.kp-usage-card') ?? []);
    expect(layouts.map((card) => card.getAttribute('data-layout'))).toEqual(['keynote', 'social', 'report', 'announcement']);
    expect(layouts.map((card) => card.querySelector('.pp-cap')?.textContent)).toEqual([
      'Keynote slide · 16:9',
      'Social card · 1200×675',
      'Report cover · letter',
      'Announcement header · 1600×900',
    ]);
    expect(layouts[0].querySelector('.kp-usage-keynote-text')?.textContent).toBe(view.voice.line);
    expect(layouts[1].querySelector('.kp-usage-social-text')?.textContent).toBe(view.voice.line);
    expect(layouts[1].querySelector('.kp-button--tiny')?.textContent).toBe('one.example.org');
    // The report cover's year is the recorded approval's; without one the line carries no year.
    expect(layouts[2].querySelector('.kp-usage-report-text')?.textContent).toBe('Project One annual report');
    expect(layouts[3].querySelector('.kp-usage-announcement-text')?.textContent).toBe('New members join Project One');
    fixture.componentRef.setInput('approval', { approvedAt: '2026-11-06T10:00:00Z', approvedBy: null });
    await fixture.whenStable();
    expect(layouts[2].querySelector('.kp-usage-report-text')?.textContent).toBe('Project One annual report 2026');
    // The reversed lockup on the dark grounds, the full-colour one on the report; every card carries one.
    expect(layouts.map((card) => card.querySelectorAll('img').length)).toEqual([1, 1, 1, 1]);
    const table = frame.querySelector('[data-testid="brand-kit-usage-table"]');
    expect(rectOf(table)).toEqual({ left: '56px', top: '740px', width: '704px' });
    expect(Array.from(table?.querySelectorAll('thead th') ?? [], (th) => th.textContent)).toEqual(['Example', 'Format', 'Ground', 'Accent moment']);
    const rows = Array.from(table?.querySelectorAll('tbody tr') ?? [], (row) => Array.from(row.querySelectorAll('td'), (td) => td.textContent));
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row[3])).toEqual(['none (grid ground)', 'the card itself', 'none', 'the top rule']);
    expect(rows[0].slice(0, 3)).toEqual(['Keynote slide', '16:9', 'dark']);
    expect(frame.textContent).not.toMatch(/\[[^\]]+\]/);
  });

  it('prints the intro alone when the kit has no examples', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageUsageComponent, 'usage', (view) => ({
      ...view,
      usage: { ...view.usage, examples: [] },
      usageTiles: [],
    }));
    expect(frame.querySelector('[data-testid="brand-kit-usage-intro"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-usage-cards"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-usage-table"]')).toBeNull();
  });
});
