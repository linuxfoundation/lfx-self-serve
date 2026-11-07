// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageSourcesComponent } from './mktg-brand-kit-page-sources.component';
import { mountBrandKitPage, rectOf, wordsOf } from './mktg-brand-kit-page.spec-helper';

describe('the Sources & decisions page', () => {
  it('lists what was read as readable names in two columns and prints only the blocks the report fills', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageSourcesComponent, 'sources');
    expect(frame.getAttribute('data-page')).toBe('15');
    expect(frame.getAttribute('data-section')).toBe('07 Sources');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-sources-intro"]')?.textContent).toBe(
      'What this kit was built from, what could not be read, what is still missing. Nothing on the other pages comes from anywhere else.'
    );
    const read = frame.querySelector('[data-testid="brand-kit-sources-read"]');
    expect(rectOf(read?.parentElement ?? null)).toEqual({ left: '56px', top: '220px', width: '340px' });
    expect(Array.from(read?.querySelectorAll('li') ?? [], (li) => li.textContent)).toEqual(['one.example.org']);
    expect(frame.querySelector('[data-testid="brand-kit-sources-failed"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-sources-warnings"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-sources-missing"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-sources-conflicts"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-sources-accepted"]')).toBeNull();
    expect(frame.textContent).not.toContain('https://');
    expect(frame.textContent).not.toContain('Across the documents');
  });

  it('names the failed, missing and conflicting sources from the report, the kept value marked, and the accepted box with a recorded approval', async () => {
    const { frame, fixture } = await mountBrandKitPage(MktgBrandKitPageSourcesComponent, 'sources', (view) => ({
      ...view,
      report: {
        ...view.report,
        sources_read: [
          'https://one.example.org',
          'https://one.example.org/_next/static/chunks/app.css',
          'LFX record: Project One (project-one)',
          'logo.svg',
          'logo-reversed.svg',
        ],
        sources_failed: [],
        gaps: ['No symbol file.'],
        notes: '',
        findings: {
          sources_failed: [{ source: 'https://one.example.org/brand.pdf', kind: 'brand_page', reason: 'HTTP 404' }],
          missing_assets: [{ asset: 'logo_symbol', reason: 'No file in the record', fix: 'Upload an SVG.' }],
          warnings: [
            { code: 'font_unverified', text: 'Two values for Charcoal.', source: 'https://one.example.org' },
            { code: 'color_conflict', text: 'Charcoal differs between the stylesheet and the logo.' },
          ],
        },
        color_conflicts: [
          {
            name: 'Charcoal',
            values: [
              { hex: '#4D4E4E', source: 'https://one.example.org/_next/static/chunks/app.css' },
              { hex: '#4A4A4A', source: 'logo.svg' },
            ],
            chosen: '#4D4E4E',
          },
        ],
      },
    }));
    fixture.componentRef.setInput('approval', { approvedAt: '2026-11-06T10:00:00Z', approvedBy: { name: 'Synthetic Approver' } });
    await fixture.whenStable();
    const text = (testid: string) => wordsOf(frame.querySelector(`[data-testid="${testid}"]`));
    expect(Array.from(frame.querySelectorAll('[data-testid="brand-kit-sources-read"] li'), (li) => li.textContent)).toEqual([
      'one.example.org',
      'one.example.org stylesheets',
      'The LFX project record',
      'the uploaded logo files',
    ]);
    expect(text('brand-kit-sources-failed')).toBe('Could not be read one.example.org/brand.pdf — HTTP 404');
    // A `color_conflict` warning is the conflicts block's, not a warning line.
    expect(text('brand-kit-sources-warnings')).toBe('Warnings Two values for Charcoal. (one.example.org) No symbol file.');
    const missing = frame.querySelector('[data-testid="brand-kit-sources-missing"]');
    expect(rectOf(missing?.parentElement ?? null)).toEqual({ left: '420px', top: '220px', width: '340px' });
    expect(text('brand-kit-sources-missing')).toBe('Missing Symbol — No file in the record Fix: Upload an SVG.');
    const conflict = frame.querySelector('[data-testid="brand-kit-sources-conflicts"] table');
    expect(conflict?.querySelector('th')?.textContent).toBe('Charcoal');
    const rows = Array.from(conflict?.querySelectorAll('tbody tr') ?? []);
    expect(rows[0].classList.contains('kp-conflict-kept')).toBe(true);
    expect(wordsOf(rows[0])).toBe('#4D4E4E · kept one.example.org stylesheets');
    expect(rows[1].classList.contains('kp-conflict-kept')).toBe(false);
    expect(wordsOf(rows[1])).toBe('#4A4A4A the uploaded logo files');
    const accepted = frame.querySelector('[data-testid="brand-kit-sources-accepted"]');
    expect(rectOf(accepted)).toEqual({ left: '56px', top: '880px', width: '704px' });
    expect(wordsOf(accepted)).toContain('Accepted when V4.0 was approved. Approved 6 Nov 2026 by Synthetic Approver.');
    expect(text('brand-kit-sources-intro')).toContain(', and what was accepted when V4.0 was approved.');
  });
});
