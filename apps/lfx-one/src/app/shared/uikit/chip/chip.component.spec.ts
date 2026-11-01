// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiChipGroupComponent } from './chip-group.component';
import { UiChipComponent } from './chip.component';

// Set through overrideComponent because an inline template this long trips component-max-inline-declarations.
const GROUP_TEMPLATE = `
  <button id="filters" type="button">Filters</button>
  <lfx-ui-chip-group ariaLabel="Applied filters" [fallbackFocus]="fallback()">
    @for (filter of filters(); track filter) {
      <lfx-ui-chip [label]="filter" (dismissed)="remove(filter)" />
    }
  </lfx-ui-chip-group>
`;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  public readonly filters = signal(['Project: CNCF', 'Meeting type: Committee', 'RSVP: Going']);
  public readonly fallback = signal<HTMLElement | null>(null);
  public readonly removed = signal<string[]>([]);

  public remove(filter: string): void {
    this.removed.update((list) => [...list, filter]);
    this.filters.update((list) => list.filter((item) => item !== filter));
  }
}

describe('UiChipComponent', () => {
  let fixture: ComponentFixture<UiChipComponent>;
  let host: HTMLElement;
  const badge = () => host.querySelector('lfx-ui-badge') as HTMLElement;
  const dismiss = () => host.querySelector('[data-testid="ui-chip-dismiss"]') as HTMLButtonElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiChipComponent);
    fixture.componentRef.setInput('label', 'Project: CNCF');
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => vi.restoreAllMocks());

  it('is a 24px accent subtle badge by default and shows its label', () => {
    expect(host.querySelector('[data-testid="ui-chip-label"]')?.textContent).toBe('Project: CNCF');
    expect(badge().className).toContain('bg-ui-accent-100');
    expect(badge().className).toContain('text-ui-accent-700');
    expect(badge().className).toContain('h-ui-tiny');
    expect(badge().className).toContain('rounded-ui-full');
    expect(host.getAttribute('data-testid')).toBe('ui-chip');
  });

  it('takes the badge sizes, tones and the outline look', async () => {
    fixture.componentRef.setInput('size', 'sm');
    fixture.componentRef.setInput('tone', 'success');
    await fixture.whenStable();
    expect(badge().className).toContain('h-[20px]');
    expect(badge().className).toContain('text-[11px]');
    expect(badge().className).toContain('bg-ui-success-100');

    fixture.componentRef.setInput('variant', 'outline');
    await fixture.whenStable();
    expect(badge().className).toContain('bg-ui-background-100');
    expect(badge().className).toContain('edge');
  });

  it('has a real remove button named after the label, with a visible focus ring', () => {
    const button = dismiss() as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Remove Project: CNCF');
    expect(button.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.className).toContain('focus-visible:shadow-focus');
  });

  it('keeps a 24px hit area on both sizes and a circle that fits inside the badge', async () => {
    expect(dismiss()?.className).toContain('after:h-[24px]');
    expect(dismiss()?.className).toContain('after:w-[24px]');
    expect(dismiss()?.className).toContain('h-[20px]');

    fixture.componentRef.setInput('size', 'sm');
    await fixture.whenStable();
    expect(dismiss()?.className).toContain('after:h-[24px]');
    expect(dismiss()?.className).toContain('h-[16px]');
  });

  it('emits dismissed once per activation and does not remove itself', () => {
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);

    dismiss()?.click();

    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(host.querySelector('lfx-ui-badge')).not.toBeNull();
  });

  it('has no button when it is not dismissible', async () => {
    fixture.componentRef.setInput('dismissible', false);
    await fixture.whenStable();
    expect(dismiss()).toBeNull();
  });

  it('is not a list item outside a group', () => {
    expect(host.getAttribute('role')).toBeNull();
  });
});

describe('UiChipGroupComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  const group = () => fixture.nativeElement.querySelector('lfx-ui-chip-group') as HTMLElement;
  const dismiss = (index: number) => fixture.nativeElement.querySelectorAll('[data-testid="ui-chip-dismiss"]')[index] as HTMLButtonElement;
  const remaining = () => Array.from(fixture.nativeElement.querySelectorAll('[data-testid="ui-chip-label"]')).map((el) => (el as HTMLElement).textContent);

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiChipGroupComponent, UiChipComponent], template: GROUP_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('is a named list of list items', () => {
    expect(group().getAttribute('role')).toBe('list');
    expect(group().getAttribute('aria-label')).toBe('Applied filters');
    expect(group().className).toContain('flex-wrap');
    expect(group().querySelectorAll('lfx-ui-chip[role="listitem"]').length).toBe(3);
  });

  it('moves focus to the next chip when a chip in the middle is removed', async () => {
    dismiss(1).focus();
    dismiss(1).click();
    await fixture.whenStable();

    expect(remaining()).toEqual(['Project: CNCF', 'RSVP: Going']);
    expect(document.activeElement).toBe(dismiss(1));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove RSVP: Going');
  });

  it('moves focus to the previous chip when the last one is removed', async () => {
    dismiss(2).focus();
    dismiss(2).click();
    await fixture.whenStable();

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove Meeting type: Committee');
  });

  it('moves focus to the fallback element when the last chip is removed, even if the row is gone', async () => {
    fixture.componentInstance.filters.set(['Project: CNCF']);
    fixture.componentInstance.fallback.set(document.getElementById('filters'));
    await fixture.whenStable();

    dismiss(0).focus();
    dismiss(0).click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(document.getElementById('filters'));
  });

  it('moves focus to the row itself when there is no fallback', async () => {
    fixture.componentInstance.filters.set(['Project: CNCF']);
    await fixture.whenStable();

    dismiss(0).focus();
    dismiss(0).click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(group());
    expect(group().getAttribute('tabindex')).toBe('-1');
  });
});
