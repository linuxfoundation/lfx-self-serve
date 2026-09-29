// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HEALTH_SCORE_BAR_FILL } from '@lfx-one/shared/constants';
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
    it('renders a partial score with a dotted remainder, a dash for the uncovered category and no partial chrome', () => {
      const popup = renderPopup({ label: 'healthy', score: 52, maxScore: 65, maintainer: 30, security: null, development: 22 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Healthy (52/65)');
      expect(byTestId(popup, 'org-health-popup-bar-missing')?.style.width).toBe('35%');
      expect(byTestId(popup, 'org-health-popup-row-maintainer')?.textContent).toContain('30/40');
      expect(byTestId(popup, 'org-health-popup-row-security')?.textContent).toContain('—/35');
      expect(byTestId(popup, 'org-health-popup-row-development')?.textContent).toContain('22/25');
      expect(byTestId(popup, 'org-health-popup-link')).toBeNull();
      // The popup text must be non-empty before the negative checks mean anything.
      expect(popup.textContent).toContain('Maintainer Health');
      expect(popup.textContent).not.toContain('*');
      expect(popup.textContent).not.toContain('Partial');
    });

    it('has no dotted remainder for a score out of 100', () => {
      const popup = renderPopup({ label: 'excellent', score: 88, maxScore: 100, maintainer: 35, security: 30, development: 23 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Excellent (88/100)');
      expect(byTestId(popup, 'org-health-popup-bar')).not.toBeNull();
      expect(byTestId(popup, 'org-health-popup-bar-missing')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-row-security')?.textContent).toContain('30/35');
    });

    it('renders only the unavailable block when there is no score', () => {
      const popup = renderPopup({ label: null, score: null });

      expect(byTestId(popup, 'org-health-popup-unavailable')?.textContent).toBe('Health score is unavailable for this project.');
      expect(byTestId(popup, 'org-health-popup-headline')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-bar')).toBeNull();
      expect(byTestId(popup, 'org-health-popup-row-maintainer')).toBeNull();
    });

    it('keeps the fill and the dotted remainder inside the track when the score exceeds the max', () => {
      const popup = renderPopup({ label: 'healthy', score: 70, maxScore: 65, maintainer: 40, security: null, development: 25 });

      expect(byTestId(popup, 'org-health-popup-headline')?.textContent).toBe('Healthy (70/65)');
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

      expect(component['labelText']()).toBe('Healthy');
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

      expect(component['scoreText']()).toBe('(88/100)');
      expect(component['barMissingPercent']()).toBe(0);
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
