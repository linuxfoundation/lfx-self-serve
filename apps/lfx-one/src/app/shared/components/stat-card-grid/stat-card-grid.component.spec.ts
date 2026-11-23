// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatCardItem } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { StatCardGridComponent } from './stat-card-grid.component';

const baseCard = (overrides: Partial<StatCardItem> = {}): StatCardItem => ({
  value: 3,
  label: 'Sample',
  subLine: 'Caption',
  icon: 'fa-light fa-users',
  iconContainerClass: 'bg-blue-100 text-blue-600',
  ...overrides,
});

describe('StatCardGridComponent', () => {
  let fixture: ComponentFixture<StatCardGridComponent>;
  let emitted: string[];

  async function render(cards: StatCardItem[], loading = false): Promise<HTMLElement> {
    fixture.componentRef.setInput('cards', cards);
    fixture.componentRef.setInput('loading', loading);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatCardGridComponent] }).compileComponents();
    fixture = TestBed.createComponent(StatCardGridComponent);
    emitted = [];
    fixture.componentInstance.actionClick.subscribe((action) => emitted.push(action));
  });

  describe('default rendering', () => {
    it('renders a display-only card as a div with the gray-400 caption', async () => {
      const el = await render([baseCard()]);

      expect(el.querySelector('button')).toBeNull();
      expect(el.querySelector('[data-testid="stat-card-Sample"]')).toBeTruthy();
      const caption = Array.from(el.querySelectorAll('p')).find((p) => p.textContent?.trim() === 'Caption');
      expect(caption?.classList.contains('text-gray-400')).toBe(true);
      expect(el.querySelector('[role="img"]')).toBeNull();
    });

    it('renders a card with an action as a whole-cell button that emits the action', async () => {
      const el = await render([baseCard({ action: 'open' })]);

      const button = el.querySelector<HTMLButtonElement>('[data-testid="stat-card-open"]');
      expect(button?.tagName).toBe('BUTTON');
      button?.click();
      expect(emitted).toEqual(['open']);
    });
  });

  describe('ctas', () => {
    const ctas = [
      { label: 'Send reminder', action: 'remind' },
      { label: 'View voters', action: 'voters', text: true },
    ];

    it('renders a button per cta and emits the cta action on click', async () => {
      const el = await render([baseCard({ ctas })]);

      el.querySelector<HTMLButtonElement>('[data-testid="stat-card-cta-remind"] button')?.click();
      el.querySelector<HTMLButtonElement>('[data-testid="stat-card-cta-voters"] button')?.click();

      expect(emitted).toEqual(['remind', 'voters']);
    });

    it('never nests a button inside a button, even when the card also has an action', async () => {
      const el = await render([baseCard({ action: 'open', ctas })]);

      expect(el.querySelectorAll('button button')).toHaveLength(0);
      expect(el.querySelector('[data-testid="stat-card-open"]')).toBeNull();
      expect(el.querySelector('[data-testid="stat-card-Sample"]')).toBeTruthy();
    });

    it('disables the cta buttons while loading and when the card is disabled', async () => {
      const loadingEl = await render([baseCard({ ctas })], true);
      expect(loadingEl.querySelector<HTMLButtonElement>('[data-testid="stat-card-cta-remind"] button')?.disabled).toBe(true);

      const disabledEl = await render([baseCard({ ctas, disabled: true })], false);
      expect(disabledEl.querySelector<HTMLButtonElement>('[data-testid="stat-card-cta-remind"] button')?.disabled).toBe(true);
    });
  });

  describe('progress', () => {
    it('renders segment widths and exposes one labelled image', async () => {
      const el = await render([
        baseCard({
          progress: {
            ariaLabel: '2 voted, 1 abstained',
            segments: [
              { percentage: 50, className: 'bg-blue-600' },
              { percentage: 25, className: 'bg-slate-400' },
            ],
          },
        }),
      ]);

      const bar = el.querySelector('[role="img"]');
      expect(bar?.getAttribute('aria-label')).toBe('2 voted, 1 abstained');
      const segments = Array.from(bar?.children ?? []) as HTMLElement[];
      expect(segments.map((segment) => segment.style.width)).toEqual(['50%', '25%']);
      expect(segments[0].classList.contains('bg-blue-600')).toBe(true);
      expect(segments[1].classList.contains('bg-slate-400')).toBe(true);
    });

    it('hides the bar while loading', async () => {
      const el = await render([baseCard({ progress: { ariaLabel: 'x', segments: [{ percentage: 10, className: 'bg-blue-600' }] } })], true);

      expect(el.querySelector('[role="img"]')).toBeNull();
    });
  });

  describe('subLineClass', () => {
    it('replaces the default caption color', async () => {
      const el = await render([baseCard({ subLineClass: 'text-gray-600' })]);

      const caption = Array.from(el.querySelectorAll('p')).find((p) => p.textContent?.trim() === 'Caption');
      expect(caption?.classList.contains('text-gray-600')).toBe(true);
      expect(caption?.classList.contains('text-gray-400')).toBe(false);
    });
  });
});
