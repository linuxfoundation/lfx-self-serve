// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HEALTH_SCORE_BAR_FILL, HEALTH_SCORE_PARTIAL_SUFFIX } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgHealthPopupComponent } from './org-health-popup.component';

describe('OrgHealthPopupComponent', () => {
  let fixture: ComponentFixture<OrgHealthPopupComponent>;
  let component: OrgHealthPopupComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OrgHealthPopupComponent], providers: [provideNoopAnimations()] }).compileComponents();
    fixture = TestBed.createComponent(OrgHealthPopupComponent);
    component = fixture.componentInstance;
  });

  const setInputs = (inputs: Record<string, unknown>): void => {
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
  };

  // Angular always builds the projected markup, so read #popupContent without opening the popover.
  const renderPopup = (inputs: Record<string, unknown>): HTMLElement => {
    setInputs(inputs);
    fixture.detectChanges();
    const popup = component['content']()?.nativeElement;
    if (!popup) {
      throw new Error('popup content was not rendered');
    }
    return popup;
  };

  const byTestId = (popup: HTMLElement, testId: string): HTMLElement | null => popup.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  describe('rendered popup', () => {
    it.each([
      {
        name: 'security',
        inputs: { label: 'healthy', score: 52, maxScore: 65, maintainer: 30, security: null, development: 22 },
        headline: 'Healthy* (52/65)',
        remainder: '35%',
        missingRow: 'security',
        missingRowText: '—/35',
        category: 'Security & Supply Chain',
      },
      {
        name: 'development',
        inputs: { label: 'concerning', score: 38, maxScore: 75, maintainer: 20, security: 18, development: null },
        headline: 'Concerning* (38/75)',
        remainder: '25%',
        missingRow: 'development',
        missingRowText: '—/25',
        category: 'Development Activity',
      },
      {
        name: 'maintainer',
        inputs: { label: 'critical', score: 21, maxScore: 60, maintainer: null, security: 12, development: 9 },
        headline: 'Critical* (21/60)',
        remainder: '40%',
        missingRow: 'maintainer',
        missingRowText: '—/40',
        category: 'Maintainer Health',
      },
    ])(
      'renders the asterisk, dotted remainder, divider and footnote when the $name category is missing',
      ({ inputs, headline, remainder, missingRow, missingRowText, category }) => {
        const popup = renderPopup(inputs);

        expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe(headline);
        // The asterisk belongs to the semibold label, ahead of the (score/max) text.
        expect(byTestId(popup, 'org-health-popup-headline')?.querySelector('.font-semibold')?.textContent).toBe(headline.split(' ')[0]);
        expect(byTestId(popup, 'org-health-popup-bar-missing')?.style.width).toBe(remainder);
        expect(byTestId(popup, `org-health-popup-row-${missingRow}`)?.textContent).toContain(missingRowText);
        expect(byTestId(popup, 'org-health-popup-partial-divider')).not.toBeNull();
        expect(byTestId(popup, 'org-health-popup-partial-note')?.textContent?.trim()).toBe(
          `*The Health score is partial because the ${category} category is missing data for this project.`
        );
        expect(byTestId(popup, 'org-health-popup-link')).toBeNull();
        // The badge's " - Partial" suffix never appears in the popup.
        expect(popup.textContent).not.toContain(HEALTH_SCORE_PARTIAL_SUFFIX);
      }
    );

    it('renders the other categories with their scores on a partial score', () => {
      const popup = renderPopup({ label: 'healthy', score: 52, maxScore: 65, maintainer: 30, security: null, development: 22 });

      expect(byTestId(popup, 'org-health-popup-row-maintainer')?.textContent).toContain('30/40');
      expect(byTestId(popup, 'org-health-popup-row-security')?.textContent).toContain('—/35');
      expect(byTestId(popup, 'org-health-popup-row-development')?.textContent).toContain('22/25');
    });

    it('marks a partial score with an asterisk but omits the footnote when the max maps to no single category', () => {
      const popup = renderPopup({ label: 'fair', score: 50, maxScore: 70, maintainer: 30, security: null, development: 20 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Fair* (50/70)');
      expect(byTestId(popup, 'org-health-popup-bar-missing')?.style.width).toBe('30%');
      expect(byTestId(popup, 'org-health-popup-partial-divider')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-partial-note')).toBeNull();
    });

    it('has no dotted remainder, asterisk, divider or footnote for a score out of 100', () => {
      const popup = renderPopup({ label: 'excellent', score: 88, maxScore: 100, maintainer: 35, security: 30, development: 23 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Excellent (88/100)');
      expect(byTestId(popup, 'org-health-popup-bar')).not.toBeNull();
      expect(byTestId(popup, 'org-health-popup-bar-missing')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-row-security')?.textContent).toContain('30/35');
      expect(byTestId(popup, 'org-health-popup-partial-divider')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-partial-note')).toBeNull();
      expect(popup.textContent).not.toContain('*');
    });

    it('has no asterisk, divider or footnote when the max score is missing', () => {
      const popup = renderPopup({ label: 'excellent', score: 88, maxScore: null, maintainer: 35, security: 30, development: 23 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Excellent (88/100)');
      expect(byTestId(popup, 'org-health-popup-bar-missing')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-partial-divider')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-partial-note')).toBeNull();
      expect(popup.textContent).not.toContain('*');
    });

    it('renders only the unavailable block when there is no score', () => {
      const popup = renderPopup({ label: null, score: null, maxScore: 65 });

      expect(byTestId(popup, 'org-health-popup-unavailable')?.textContent).toBe('Health score is unavailable for this project.');
      expect(byTestId(popup, 'org-health-popup-headline')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-bar')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-row-maintainer')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-partial-divider')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-partial-note')).toBeNull();
    });

    it('keeps the fill and the dotted remainder inside the track when the score exceeds the max', () => {
      const popup = renderPopup({ label: 'healthy', score: 70, maxScore: 65, maintainer: 40, security: null, development: 25 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Healthy* (70/65)');
      expect(byTestId(popup, 'org-health-popup-bar-fill')?.style.width).toBe('70%');
      expect(byTestId(popup, 'org-health-popup-bar-missing')?.style.width).toBe('30%');
    });

    it('renders a zero score with real zeros rather than dashes', () => {
      const popup = renderPopup({ label: 'critical', score: 0, maxScore: 100, maintainer: 0, security: 0, development: 0 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Critical (0/100)');
      expect(byTestId(popup, 'org-health-popup-row-security')?.textContent).toContain('0/35');
      expect(byTestId(popup, 'org-health-popup-row-security')?.textContent).not.toContain('—');
    });

    it('paints the band colour on the headline dot and the bar fill', () => {
      const popup = renderPopup({ label: 'critical', score: 20, maxScore: 100, maintainer: 10, security: 5, development: 5 });
      // jsdom serialises inline colours as rgb(), so normalise the hex constant via a style probe.
      const probe = document.createElement('span');
      probe.style.backgroundColor = HEALTH_SCORE_BAR_FILL.critical;

      expect(byTestId(popup, 'org-health-popup-headline-dot')?.style.backgroundColor).toBe(probe.style.backgroundColor);
      expect(byTestId(popup, 'org-health-popup-bar-fill')?.style.backgroundColor).toBe(probe.style.backgroundColor);
    });
  });

  describe('popover overlay', () => {
    // A `#content` ref inside <p-popover> is captured as its template and throws on open.
    it('opens without the PrimeNG content-ref collision and attaches the popup to document.body', async () => {
      setInputs({ label: 'healthy', score: 52, maxScore: 65, maintainer: 30, security: null, development: 22 });
      fixture.detectChanges();
      const badge = document.createElement('button');
      fixture.nativeElement.appendChild(badge);
      badge.addEventListener('mouseenter', (event) => component.show(event));

      badge.dispatchEvent(new Event('mouseenter'));
      fixture.detectChanges();
      await fixture.whenStable();

      const popup = document.querySelector('[data-testid="org-health-popup-content"]');
      expect(popup).not.toBeNull();
      expect(popup?.closest('.org-health-popover')?.parentElement).toBe(document.body);
    });
  });

  describe('view model', () => {
    it('splits a partial score into label, (score/max) and per-category rows', () => {
      setInputs({ label: 'healthy', score: 52, maxScore: 65, maintainer: 30, security: null, development: 22 });

      expect(component['labelText']()).toBe('Healthy*');
      expect(component['scoreText']()).toBe('(52/65)');
      expect(component['barFillPercent']()).toBe(52);
      expect(component['barMissingPercent']()).toBe(35);
      const rows = component['rows']();
      expect(rows.find((r) => r.key === 'security')).toMatchObject({ score: null, max: 35 });
      expect(rows.find((r) => r.key === 'maintainer')).toMatchObject({ score: '30', max: 40 });
      expect(rows.find((r) => r.key === 'development')).toMatchObject({ score: '22', max: 25 });
    });

    it('defaults a missing max score to 100', () => {
      setInputs({ label: 'excellent', score: 88, maxScore: null });

      expect(component['labelText']()).toBe('Excellent');
      expect(component['scoreText']()).toBe('(88/100)');
      expect(component['barMissingPercent']()).toBe(0);
    });

    it.each([
      { maxScore: 60, partial: true, category: 'Maintainer Health' },
      { maxScore: 65, partial: true, category: 'Security & Supply Chain' },
      { maxScore: 75, partial: true, category: 'Development Activity' },
      { maxScore: 70, partial: true, category: undefined },
      { maxScore: 100, partial: false, category: undefined },
      { maxScore: 120, partial: false, category: undefined },
      { maxScore: null, partial: false, category: undefined },
    ])('treats a max of $maxScore as partial=$partial and names the missing category $category', ({ maxScore, partial, category }) => {
      setInputs({ label: 'healthy', score: 50, maxScore });

      expect(component['isPartial']()).toBe(partial);
      expect(component['missingCategoryName']()).toBe(category);
    });

    it('is unavailable without a label', () => {
      setInputs({ label: null, score: 52 });

      expect(component['available']()).toBe(false);
    });

    it.each([
      { name: 'a score above the max', score: 70, maxScore: 65, fill: 70, missing: 30 },
      { name: 'a zero score', score: 0, maxScore: 100, fill: 0, missing: 0 },
      { name: 'a zero max', score: 20, maxScore: 0, fill: 20, missing: 80 },
      { name: 'a missing max', score: 88, maxScore: null, fill: 88, missing: 0 },
      { name: 'a score above the track', score: 150, maxScore: 65, fill: 100, missing: 0 },
      { name: 'a negative score', score: -5, maxScore: 100, fill: 0, missing: 0 },
      { name: 'a max above the track', score: 40, maxScore: 120, fill: 40, missing: 0 },
    ])('keeps fill + remainder within 100% for $name', ({ score, maxScore, fill, missing }) => {
      const popup = renderPopup({ label: 'healthy', score, maxScore });

      expect(component['barFillPercent']()).toBe(fill);
      expect(component['barMissingPercent']()).toBe(missing);
      expect(component['barFillPercent']() + component['barMissingPercent']()).toBeLessThanOrEqual(100);
      expect(byTestId(popup, 'org-health-popup-bar-fill')?.style.width).toBe(`${fill}%`);
    });
  });
});
