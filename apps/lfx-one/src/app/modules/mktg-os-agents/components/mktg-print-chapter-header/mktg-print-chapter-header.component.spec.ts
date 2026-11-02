// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import { MktgPrintChapterHeaderComponent } from './mktg-print-chapter-header.component';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';

it('keeps the shared chapter number and title in one Inter/accent-rule heading', async () => {
  const fixture = TestBed.createComponent(MktgPrintChapterHeaderComponent);
  fixture.componentRef.setInput('number', '02.4');
  fixture.componentRef.setInput('title', 'Visual');
  const accent = brandKitTestRevision().kit.accent;
  fixture.componentRef.setInput('accent', accent);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('h2')?.className).toBe('lfx-print-chapter-title');
  expect(root.classList.contains('lfx-print-chapter-accent')).toBe(true);
  expect(root.style.getPropertyValue('--mfp-chapter-accent')).toBe(accent);
  expect(root.querySelector('h2 > span')?.textContent).toBe('02.4');
  expect(root.querySelector('h2')?.textContent).toContain('Visual');
  const heading = root.querySelector('h2');
  if (!heading) throw new Error('Missing synthetic print heading');
  expect(getComputedStyle(heading).breakAfter).toBe('avoid');
  expect(getComputedStyle(heading).fontFamily).toContain('sans-serif');
});
