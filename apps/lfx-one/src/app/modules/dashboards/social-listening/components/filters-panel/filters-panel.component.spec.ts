// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FiltersPanelComponent } from './filters-panel.component';

/** Filters panel a11y contract: Escape closes, Tab cycles inside the dialog, Shift+Tab wraps back. Template is overridden so the focus trap is tested against known focusable elements, not PrimeNG internals. */
describe('FiltersPanelComponent', () => {
  let fixture: ComponentFixture<FiltersPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FiltersPanelComponent] })
      .overrideComponent(FiltersPanelComponent, {
        set: {
          template: `
            <div #panelContainer tabindex="-1" data-testid="social-listening-filters-panel"
                 (keydown.escape)="visible.set(false)" (keydown)="trapFocus($event)">
              <button type="button" data-testid="first-btn">First</button>
              <button type="button" data-testid="last-btn">Last</button>
            </div>
          `,
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FiltersPanelComponent);
    fixture.componentRef.setInput('selectedSentiment', 'all');
    fixture.componentRef.setInput('selectedRelevance', 'all');
    fixture.componentRef.setInput('selectedLanguage', 'all');
    fixture.componentRef.setInput('selectedHasTitle', 'all');
    fixture.componentRef.setInput('selectedBookmarkFilter', 'all');
    fixture.componentRef.setInput('selectedKeywords', []);
    fixture.componentRef.setInput('selectedTags', []);
    fixture.componentRef.setInput('selectedAuthors', []);
    fixture.componentRef.setInput('languageOptions', []);
    fixture.componentRef.setInput('availableKeywords', []);
    fixture.componentRef.setInput('availableTags', []);
    fixture.componentRef.setInput('availableAuthors', []);

    // Attach to the document so offsetParent is non-null (the focus trap filters on it).
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  function firstBtn(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="first-btn"]');
  }

  function lastBtn(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="last-btn"]');
  }

  // jsdom doesn't implement offsetParent (always returns null); the focus trap filters on it to skip hidden elements.
  function stubOffsetParent(...elements: HTMLElement[]): void {
    for (const el of elements) {
      Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
    }
  }

  it('closes on Escape', async () => {
    const panel = fixture.nativeElement.querySelector('[data-testid="social-listening-filters-panel"]');
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('wraps Tab from the last focusable back to the first', () => {
    const first = firstBtn();
    const last = lastBtn();
    stubOffsetParent(first, last);
    last.focus();
    expect(document.activeElement).toBe(last);

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    (fixture.componentInstance as unknown as { trapFocus: (e: KeyboardEvent) => void }).trapFocus(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable to the last', () => {
    const first = firstBtn();
    const last = lastBtn();
    stubOffsetParent(first, last);
    first.focus();
    expect(document.activeElement).toBe(first);

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    (fixture.componentInstance as unknown as { trapFocus: (e: KeyboardEvent) => void }).trapFocus(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });

  it('bridges the bookmark filter between the model and the form control', async () => {
    const form = (fixture.componentInstance as unknown as { filtersForm: { controls: { bookmarkFilter: { value: string; setValue: (v: string) => void } } } })
      .filtersForm;

    fixture.componentRef.setInput('selectedBookmarkFilter', 'bookmarked');
    await fixture.whenStable();
    expect(form.controls.bookmarkFilter.value).toBe('bookmarked');

    form.controls.bookmarkFilter.setValue('all');
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedBookmarkFilter()).toBe('all');
  });

  it('does not intercept Tab from a middle element', () => {
    stubOffsetParent(firstBtn(), lastBtn());
    firstBtn().focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    (fixture.componentInstance as unknown as { trapFocus: (e: KeyboardEvent) => void }).trapFocus(event);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
