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
    fixture.componentRef.setInput('notes', ['Figures from the press release.']);
    fixture.componentRef.setInput('sources', ['https://acme-mesh.example']);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
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
    expect(root.querySelector('[data-testid="family-print-boilerplate-notes"]')?.textContent).toContain('Figures from the press release.');
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources"]')?.textContent).toContain('https://acme-mesh.example');
  });

  it('prints the notes and sources blocks both or neither: none when the run left none, none when it left only one', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintBoilerplatesPageComponent);
    fixture.componentRef.setInput('lengths', [row(0, 'One-liner', 14, 15)]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-boilerplate-notes"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources"]')).toBeNull();
    fixture.componentRef.setInput('sources', ['https://acme-mesh.example']);
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-print-boilerplate-notes"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-boilerplate-sources"]')).toBeNull();
    expect(root.querySelectorAll('[data-testid="family-print-boilerplate-card"]')).toHaveLength(1);
  });
});
