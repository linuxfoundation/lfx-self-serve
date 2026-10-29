// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTabItem } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiTabsComponent } from './tabs.component';

describe('UiTabsComponent', () => {
  const tabs: UiTabItem[] = [
    { value: 'upcoming', label: 'Upcoming', count: 12 },
    { value: 'past', label: 'Past', count: 0, countLabel: '0 meetings' },
    { value: 'drafts', label: 'Drafts', disabled: true, disabledReason: 'Drafts are not available yet' },
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

  afterEach(() => {
    fixture.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.useRealTimers();
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
    expect(tab('upcoming').className).toContain('aria-selected:after:bg-ui-accent-500');
    expect(tab('upcoming').className).toContain('aria-selected:font-medium');
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

  it('uses the default 14px underline tab with exact px spacing', () => {
    const list = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;

    expect(list.className).toContain('gap-[24px]');
    expect(list.className).toContain('overflow-x-auto');
    expect((fixture.nativeElement as HTMLElement).className).toContain('shadow-[inset_0_-1px_0_var(--ui-neutral-alpha-200)]');
    expect(tab('upcoming').className).toContain('label-14');
    expect(tab('upcoming').className).toContain('pt-[8px]');
    expect(tab('upcoming').className).toContain('pb-[14px]');
    expect(tab('upcoming').className).toContain('gap-[7px]');
    expect(tab('upcoming').className).toContain('aria-selected:after:h-[2px]');
    expect(tab('upcoming').className).toContain('text-ui-neutral-500');
    expect(tab('upcoming').className).toContain('hover:text-ui-neutral-900');
    expect(tab('upcoming').className).toContain('duration-ui-base');
    expect(tab('upcoming').className).toContain('focus-visible:shadow-focus');
  });

  it('uses 13px text and 11px bottom padding when small', async () => {
    fixture.componentRef.setInput('size', 'small');
    await fixture.whenStable();

    expect(tab('upcoming').className).toContain('text-[13px]');
    expect(tab('upcoming').className).toContain('pb-[11px]');
    expect(tab('upcoming').className).not.toContain('pb-[14px]');
  });

  it('renders 32px pills without a rule when secondary, whatever the size', async () => {
    fixture.componentRef.setInput('variant', 'secondary');
    fixture.componentRef.setInput('size', 'small');
    await fixture.whenStable();
    const list = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;

    expect(list.className).toContain('gap-[4px]');
    expect((fixture.nativeElement as HTMLElement).className).not.toContain('shadow-');
    expect(tab('upcoming').className).toContain('h-[32px]');
    expect(tab('upcoming').className).toContain('px-[12px]');
    expect(tab('upcoming').className).toContain('aria-selected:before:bg-ui-accent-100');
    expect(tab('upcoming').className).toContain('aria-selected:text-ui-accent-700');
    expect(tab('upcoming').className).not.toContain('pb-[11px]');
    expect(tab('upcoming').className).not.toContain('text-[13px]');
  });

  it('leaves the focus ring room inside the scroll area without moving the layout', () => {
    const list = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;

    for (const cls of ['px-[4px]', 'pt-[4px]', '-mx-[4px]', '-mt-[4px]']) expect(list.className).toContain(cls);
    expect(list.className).toContain('pointer-events-none');
    expect(tab('upcoming').className).toContain('pointer-events-auto');
  });

  it('keeps the tab width steady with a hidden bold copy of the label', () => {
    const label = tab('upcoming').querySelector('span') as HTMLElement;

    expect(label.getAttribute('data-label')).toBe('Upcoming');
    expect(label.className).toContain('after:content-[attr(data-label)]');
    expect(label.className).toContain('after:font-medium');
    expect(label.textContent).toBe('Upcoming');
  });

  it('shows an optional 14px icon before the label, 13px when small', async () => {
    fixture.componentRef.setInput('tabs', [{ value: 'gh', label: 'GitHub', icon: 'fa-brands fa-github' }]);
    await fixture.whenStable();
    const icon = tab('gh').querySelector('i') as HTMLElement;

    expect(icon.className).toContain('fa-github');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.style.fontSize).toBe('14px');
    expect(tab('gh').firstElementChild).toBe(icon);

    fixture.componentRef.setInput('size', 'small');
    await fixture.whenStable();

    expect(icon.style.fontSize).toBe('13px');
  });

  it('adds the spoken count to the accessible name only where given', () => {
    expect(tab('past').getAttribute('aria-label')).toBe('Past, 0 meetings');
    expect(tab('upcoming').getAttribute('aria-label')).toBeNull();
  });

  it('renders a disabled tab as aria-disabled, out of the tab order and greyed', () => {
    expect(tab('drafts').getAttribute('aria-disabled')).toBe('true');
    expect(tab('drafts').hasAttribute('disabled')).toBe(false);
    expect(tab('drafts').getAttribute('tabindex')).toBe('-1');
    expect(tab('drafts').className).toContain('aria-disabled:text-ui-neutral-400');
    expect(tab('drafts').className).toContain('aria-disabled:cursor-not-allowed');
    expect(tab('upcoming').getAttribute('aria-disabled')).toBeNull();
  });

  it('explains a disabled tab in a tooltip on hover, and shows none on enabled tabs', async () => {
    const container = TestBed.inject(OverlayContainer).getContainerElement();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hover = async (target: HTMLElement) => {
      target.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }));
      await vi.advanceTimersByTimeAsync(300);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
    };

    await hover(tab('past'));
    expect(container.querySelector('[data-testid="ui-tooltip"]')).toBeNull();

    await hover(tab('drafts'));
    expect(container.querySelector('[data-testid="ui-tooltip"]')?.textContent?.trim()).toBe('Drafts are not available yet');
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
