// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { BoilerplatesLengthRow } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';
import { MktgFamilyPrintBoilerplatesPageComponent } from './mktg-family-print-boilerplates-page.component';

function row(index: number, label: string, words: number, max: number, text = 'Synthetic text'): BoilerplatesLengthRow {
  return { index, label, hint: '', text, words, max, over: words > max, countLabel: `${words} / ${max}` };
}

describe('MktgFamilyPrintBoilerplatesPageComponent', () => {
  it('prints one card per length with text, the count against the limit, the fill bar and the over line', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintBoilerplatesPageComponent);
    fixture.componentRef.setInput('lengths', [
      row(0, 'One-liner', 14, 15),
      row(1, '25 words', 27, 25),
      row(2, '50 words', 48, 50),
      row(3, '100 words', 0, 100, '   '),
    ]);
    fixture.componentRef.setInput('sources', [
      'https://acme-mesh.example/press/launch (press release)',
      'https://acme-mesh.example',
      // Two URLs on one host are one label on the page.
      'https://acme-mesh.example/about',
      'LFX project record acme-mesh (uid 00000000-0000-4000-8000-000000000000)',
    ]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    // A block host (MKTG_PORTRAIT_BLOCK_HOST): Chrome 156 breaks a sheet at the anonymous-block boundary an inline host puts around a frame.
    expect(getComputedStyle(root).display).toBe('block');
    const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="family-print-boilerplate-card"]'));
    expect(cards).toHaveLength(3);
    expect(cards[0].classList.contains('fpb-card--first')).toBe(true);
    expect(cards[0].style.minHeight).toBe('96px');
    expect(cards[2].style.minHeight).toBe('130px');
    expect(cards[0].querySelector('.fpb-card__count')?.textContent).toBe('14 words · max 15');
    expect(cards[0].querySelector('.fpb-card__percent')?.textContent).toBe('93 % of the limit');
    expect(cards[0].querySelector<HTMLElement>('.fpb-card__fill')?.style.width).toBe('93%');
    expect(cards[0].querySelector('[data-testid="family-print-boilerplate-over"]')).toBeNull();
    expect(cards[1].querySelector('[data-testid="family-print-boilerplate-over"]')?.textContent).toBe('over by 2');
    expect(cards[1].querySelector<HTMLElement>('.fpb-card__fill')?.style.width).toBe('100%');
    expect(cards[1].querySelector('.fpb-card__fill')?.classList.contains('fpb-card__fill--over')).toBe(true);
    expect(cards.map((card) => card.querySelector<HTMLElement>('.fpb-card__text')?.style.fontSize)).toEqual(['16.5px', '16.5px', '14px']);
    // Built from, in plain words: each source by its label and host, or its host, the record without its slug; the run's notes never print.
    expect(root.querySelector('[data-testid="family-print-boilerplate-notes"]')).toBeNull();
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-boilerplate-sources"] li')).map((item) => item.textContent)).toEqual([
      'Press release (acme-mesh.example)',
      'acme-mesh.example',
      'LFX project record',
    ]);
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources-cut"]')).toBeNull();
  });

  it('holds a text that outgrows the page to the room, cut from the end at a sentence, and says how many words did not print', async () => {
    const sentence = 'The project builds open standards for confidential computing with its members.';
    const long = Array.from({ length: 40 }, () => sentence).join(' ');
    const fixture = TestBed.createComponent(MktgFamilyPrintBoilerplatesPageComponent);
    fixture.componentRef.setInput('lengths', [
      row(0, 'One-liner', 11, 15, sentence),
      row(1, '25 words', 11, 25, sentence),
      row(2, '50 words', 11, 50, sentence),
      row(3, '100 words', 440, 100, long),
    ]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="family-print-boilerplate-card"]'));
    expect(cards).toHaveLength(4);
    expect(cards.slice(0, 3).map((card) => card.querySelector('[data-testid="family-print-boilerplate-cut"]'))).toEqual([null, null, null]);
    const text = cards[3].querySelector('.fpb-card__text')?.textContent?.trim() ?? '';
    expect(text.length).toBeLessThan(long.length);
    expect(text.endsWith('members.')).toBe(true);
    expect(long.startsWith(text)).toBe(true);
    const cut = cards[3].querySelector('[data-testid="family-print-boilerplate-cut"]')?.textContent ?? '';
    expect(cut).toMatch(/^\+\d+ words in LFX One$/);
    expect(Number(cut.match(/\d+/)?.[0]) + text.split(/\s+/).length).toBe(440);
    // The count line still reports the approved text's own words, not the printed ones.
    expect(cards[3].querySelector('.fpb-card__count')?.textContent).toBe('440 words · max 100');
  });

  it('omits the Built from block when the run read nothing it can name, and keeps the whole rows that fit with the rest counted', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintBoilerplatesPageComponent);
    fixture.componentRef.setInput('lengths', [row(0, 'One-liner', 14, 15)]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources"]')).toBeNull();
    expect(root.querySelectorAll('[data-testid="family-print-boilerplate-card"]')).toHaveLength(1);
    fixture.componentRef.setInput(
      'sources',
      Array.from({ length: 12 }, (_, index) => `https://acme-mesh.example/page-${index} (source ${index + 1})`)
    );
    await fixture.whenStable();
    const shown = root.querySelectorAll('[data-testid="family-print-boilerplate-sources"] li').length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(12);
    // The rows past the block are counted, never dropped in silence.
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources-cut"]')?.textContent).toBe(`+${12 - shown} more in LFX One`);
  });

  it('prints the Built from block with its cut note alone when no row fits (one long first label hides nothing in silence)', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintBoilerplatesPageComponent);
    fixture.componentRef.setInput('lengths', [row(0, 'One-liner', 14, 15)]);
    fixture.componentRef.setInput('sources', [
      `https://acme-mesh.example/a (${'a very long source label '.repeat(40).trim()})`,
      'https://acme-mesh.example/b (short)',
    ]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid="family-print-boilerplate-sources"] li')).toHaveLength(0);
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources-cut"]')?.textContent).toBe('+2 more in LFX One');
  });
});
