// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FilterPillOption } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationPageTabsComponent } from './formation-page-tabs.component';

const OPTIONS: FilterPillOption[] = [
  { id: 'formations', label: 'Formations' },
  { id: 'middle', label: 'Middle' },
  { id: 'proposals', label: 'Proposals' },
];

describe('FormationPageTabsComponent (#3037)', () => {
  let fixture: ComponentFixture<FormationPageTabsComponent>;
  let emitted: string[];

  const render = async (active: string): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [FormationPageTabsComponent] }).compileComponents();
    fixture = TestBed.createComponent(FormationPageTabsComponent);
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('active', active);
    fixture.componentRef.setInput('ariaLabel', 'Sections');
    fixture.componentRef.setInput('idPrefix', 'tabs');
    emitted = [];
    fixture.componentInstance.tabChange.subscribe((id) => emitted.push(id));
    fixture.detectChanges();
  };

  const press = (key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('[role="tablist"]').dispatchEvent(event);
    return event;
  };

  beforeEach(async () => {
    await render('formations');
  });

  it('renders the tab/panel id contract, a labelled tablist and a roving tabindex', () => {
    const tablist: HTMLElement = fixture.nativeElement.querySelector('[role="tablist"]');
    expect(tablist.getAttribute('aria-label')).toBe('Sections');
    const tabs: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]'));
    expect(tabs.map((tab) => tab.id)).toEqual(['tabs-tab-formations', 'tabs-tab-middle', 'tabs-tab-proposals']);
    expect(tabs.map((tab) => tab.getAttribute('aria-controls'))).toEqual(['tabs-panel-formations', 'tabs-panel-middle', 'tabs-panel-proposals']);
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  });

  it('ArrowRight moves to the next tab and wraps from last to first', async () => {
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(emitted).toEqual(['middle']);

    await render('proposals');
    press('ArrowRight');
    expect(emitted).toEqual(['formations']);
  });

  it('ArrowLeft wraps from first to last', () => {
    press('ArrowLeft');
    expect(emitted).toEqual(['proposals']);
  });

  it('Home and End jump to the first and last tab', async () => {
    await render('middle');
    press('Home');
    press('End');
    expect(emitted).toEqual(['formations', 'proposals']);
  });

  it('Home on the already-active first tab does not emit', () => {
    press('Home');
    expect(emitted).toEqual([]);
  });

  it('ignores other keys without preventing their default', () => {
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(emitted).toEqual([]);
  });

  describe('focus', () => {
    afterEach(() => {
      vi.useRealTimers();
      fixture.nativeElement.remove();
    });

    it('moves focus to the newly selected tab after the keypress', () => {
      document.body.appendChild(fixture.nativeElement);
      vi.useFakeTimers();
      press('ArrowRight');
      vi.runAllTimers();
      expect(document.activeElement?.id).toBe('tabs-tab-middle');

      press('End');
      vi.runAllTimers();
      expect(document.activeElement?.id).toBe('tabs-tab-proposals');
    });
  });

  it('clicking an inactive tab emits its id; clicking the active one does not', () => {
    const tabs: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]'));
    tabs[0].click();
    tabs[2].click();
    expect(emitted).toEqual(['proposals']);
  });
});
