// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitOverfullFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView, mktgNoWidow } from '@lfx-one/shared/utils';
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
    // The card lines carry the brand line with its last two words joined (no widow).
    expect(layouts[0].querySelector('.kp-usage-keynote-text')?.textContent).toBe(mktgNoWidow(view.voice.line));
    expect(layouts[1].querySelector('.kp-usage-social-text')?.textContent).toBe(mktgNoWidow(view.voice.line));
    expect(layouts[1].querySelector('.kp-button--tiny')?.textContent).toBe('one.example.org');
    // The report cover's year is the recorded approval's; without one the line carries no year.
    expect(layouts[2].querySelector('.kp-usage-report-text')?.textContent).toBe('Project\u00a0One annual report');
    // The project's name stays on one line in every card; the report line keeps its year as a word of its own.
    expect(layouts[3].querySelector('.kp-usage-announcement-text')?.textContent).toBe(mktgNoWidow('New members join Project One'));
    expect(layouts[3].querySelector('.kp-usage-announcement-text')?.textContent).toBe('New members join Project\u00a0One');
    fixture.componentRef.setInput('approval', { approvedAt: '2026-11-06T10:00:00Z', approvedBy: null });
    await fixture.whenStable();
    expect(layouts[2].querySelector('.kp-usage-report-text')?.textContent).toBe('Project\u00a0One annual report 2026');
    // The reversed lockup on the dark grounds, the full-colour one on the report and on the social card, which keeps a
    // white ground under an accent rule because nothing in this kit reads on its orange (the accent-moment rule).
    expect(layouts.map((card) => card.querySelectorAll('img').length)).toEqual([1, 1, 1, 1]);
    expect(layouts[1].querySelector('.kp-usage-frame')?.classList.contains('kp-usage-frame--social-rule')).toBe(true);
    expect(layouts[1].querySelector('[data-testid="brand-kit-usage-social-note"]')).toBeNull();
    const table = frame.querySelector('[data-testid="brand-kit-usage-table"]');
    expect(rectOf(table)).toEqual({ left: '56px', top: '740px', width: '704px' });
    expect(Array.from(table?.querySelectorAll('thead th') ?? [], (th) => th.textContent)).toEqual(['Example', 'Format', 'Ground', 'Accent moment']);
    const rows = Array.from(table?.querySelectorAll('tbody tr') ?? [], (row) => Array.from(row.querySelectorAll('td'), (td) => td.textContent));
    expect(rows).toHaveLength(4);
    // The table reads the card's resolved ground, not the record's word for it: white, under the accent as its top rule.
    expect(rows.map((row) => row[2])).toEqual(['dark', 'white', 'white', 'dark']);
    expect(rows.map((row) => row[3])).toEqual(['none (grid ground)', 'the top rule', 'none', 'the top rule']);
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

  it('shortens a 300-character brand line to the lines the keynote and social cards hold, at a word with an ellipsis, never set smaller', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageUsageComponent, 'usage', () => buildBrandKitBookView(brandKitOverfullFixture(), 4));
    const keynote = frame.querySelector('.kp-usage-keynote-text')?.textContent ?? '';
    const social = frame.querySelector('.kp-usage-social-text')?.textContent ?? '';
    for (const text of [keynote, social]) {
      expect(text.endsWith('…')).toBe(true);
      expect(text.length).toBeLessThan(view.voice.line.length);
      expect(view.voice.line.startsWith(text.slice(0, 20))).toBe(true);
    }
    expect(social.length).toBeLessThan(keynote.length);
    expect(frame.querySelector('.kp-usage-keynote-text')?.getAttribute('style')).toBeNull();
  });
});
