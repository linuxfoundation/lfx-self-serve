// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTabItem } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiTabsComponent } from './tabs.component';

describe('UiTabsComponent', () => {
  const tabs: UiTabItem[] = [
    { value: 'upcoming', label: 'Upcoming', count: 12 },
    { value: 'past', label: 'Past', count: 0 },
    { value: 'drafts', label: 'Drafts', disabled: true },
  ];

  let fixture: ComponentFixture<UiTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTabsComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiTabsComponent);
    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('ariaLabel', 'Meetings');
    fixture.componentInstance.value.set('upcoming');
    await fixture.whenStable();
  });

  function tab(value: string): HTMLButtonElement {
    return fixture.nativeElement.querySelector(`[data-testid="ui-tab-${value}"]`) as HTMLButtonElement;
  }

  async function press(value: string, key: string): Promise<void> {
    tab(value).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await fixture.whenStable();
  }

  it('renders a labelled tablist with one tab per item', () => {
    expect(fixture.nativeElement.querySelector('[role="tablist"]').getAttribute('aria-label')).toBe('Meetings');
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(3);
  });

  it('shows counts, including zero, only where given', () => {
    expect(tab('upcoming').textContent).toContain('12');
    expect(tab('past').querySelector('[data-testid="ui-tab-count-past"]')?.textContent).toBe('0');
    expect(tab('drafts').querySelector('[data-testid="ui-tab-count-drafts"]')).toBeNull();
  });

  it('marks the selected tab and keeps only it in the tab order', () => {
    expect(tab('upcoming').getAttribute('aria-selected')).toBe('true');
    expect(tab('upcoming').getAttribute('tabindex')).toBe('0');
    expect(tab('upcoming').className).toContain('border-blue-500');
    expect(tab('upcoming').className).toContain('font-medium');
    expect(tab('past').getAttribute('aria-selected')).toBe('false');
    expect(tab('past').getAttribute('tabindex')).toBe('-1');
  });

  it('keeps exactly one tab in the tab order when the value matches no tab', async () => {
    for (const value of ['', 'nope', 'drafts']) {
      fixture.componentInstance.value.set(value);
      await fixture.whenStable();
      const inOrder = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')).filter((t) => (t as HTMLElement).getAttribute('tabindex') === '0');
      expect(inOrder).toHaveLength(1);
      expect(inOrder[0]).toBe(tab('upcoming'));
    }
  });

  it('adds no ids or aria-controls without an idPrefix', () => {
    expect(tab('upcoming').getAttribute('id')).toBeNull();
    expect(tab('upcoming').getAttribute('aria-controls')).toBeNull();
  });

  it('links each tab to its panel when an idPrefix is set', async () => {
    fixture.componentRef.setInput('idPrefix', 'meetings');
    await fixture.whenStable();

    expect(tab('past').getAttribute('id')).toBe('meetings-tab-past');
    expect(tab('past').getAttribute('aria-controls')).toBe('meetings-panel-past');
  });

  it('selects a tab on click', async () => {
    tab('past').click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('past');
    expect(tab('past').getAttribute('aria-selected')).toBe('true');
  });

  it('does not select a disabled tab', async () => {
    tab('drafts').click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('upcoming');
  });

  it('moves with the arrow keys, wrapping and skipping disabled tabs', async () => {
    await press('upcoming', 'ArrowRight');
    expect(fixture.componentInstance.value()).toBe('past');

    await press('past', 'ArrowRight');
    expect(fixture.componentInstance.value()).toBe('upcoming');

    await press('upcoming', 'ArrowLeft');
    expect(fixture.componentInstance.value()).toBe('past');
  });

  it('jumps to the first and last enabled tab with Home and End', async () => {
    await press('upcoming', 'End');
    expect(fixture.componentInstance.value()).toBe('past');

    await press('past', 'Home');
    expect(fixture.componentInstance.value()).toBe('upcoming');
  });

  it('moves focus to the newly selected tab', async () => {
    await press('upcoming', 'ArrowRight');
    expect(document.activeElement).toBe(tab('past'));
  });
});
