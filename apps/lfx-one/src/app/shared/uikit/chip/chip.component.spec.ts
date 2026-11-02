// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
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
  public readonly fallback = signal<{ focus(): void } | null>(null);
  public readonly removed = signal<string[]>([]);
  /** When set, a dismissal waits here, like a removal that needs a request, until `flush`. */
  public readonly deferred = signal(false);
  private readonly pending: string[] = [];

  public remove(filter: string): void {
    this.removed.update((list) => [...list, filter]);
    if (this.deferred()) this.pending.push(filter);
    else this.drop([filter]);
  }

  public flush(order: string[] = [...this.pending]): void {
    this.pending.length = 0;
    this.drop(order);
  }

  private drop(names: string[]): void {
    this.filters.update((list) => list.filter((item) => !names.includes(item)));
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

  it('is a 20px accent subtle badge by default and shows its label', () => {
    expect(host.querySelector('[data-testid="ui-chip-label"]')?.textContent).toBe('Project: CNCF');
    expect(badge().className).toContain('bg-ui-accent-100');
    expect(badge().className).toContain('text-ui-accent-700');
    expect(badge().className).toContain('h-[20px]');
    expect(badge().className).toContain('text-[11px]');
    expect(badge().className).toContain('rounded-ui-full');
    expect(host.getAttribute('data-testid')).toBe('ui-chip');
  });

  it('takes the medium size, the tones and the outline look', async () => {
    fixture.componentRef.setInput('size', 'md');
    fixture.componentRef.setInput('tone', 'success');
    await fixture.whenStable();
    expect(badge().className).toContain('h-ui-tiny');
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
    expect(dismiss()?.className).toContain('h-[16px]');

    fixture.componentRef.setInput('size', 'md');
    await fixture.whenStable();
    expect(dismiss()?.className).toContain('after:h-[24px]');
    expect(dismiss()?.className).toContain('h-[20px]');
  });

  it('shrinks the label with an ellipsis and keeps the × from shrinking', () => {
    expect(badge().className).toContain('max-w-full');
    expect(badge().className).toContain('min-w-0');
    const label = host.querySelector('[data-testid="ui-chip-label"]') as HTMLElement;
    expect(label.className).toContain('truncate');
    expect(label.className).toContain('min-w-0');
    expect(dismiss()?.className).toContain('shrink-0');
  });

  it('ignores a second activation while the removal is pending, and allows a fresh click again', () => {
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);

    dismiss()?.click();
    dismiss()?.click();
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.dismissing()).toBe(true);

    // The second mouse down of a double-click does not start a new activation; a fresh click does.
    dismiss()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 2 }));
    dismiss()?.click();
    expect(dismissed).toHaveBeenCalledTimes(1);

    dismiss()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 1 }));
    dismiss()?.click();
    expect(dismissed).toHaveBeenCalledTimes(2);
  });

  it('treats a fresh key press as a new activation, and the repeats of a held key as none', () => {
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);
    dismiss()?.click();
    dismiss()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    dismiss()?.click();
    expect(dismissed).toHaveBeenCalledTimes(2);
  });

  it('leaves other keys alone: Tab keeps the pending state and a held Tab is not cancelled', () => {
    dismiss()?.click();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', repeat: true, bubbles: true, cancelable: true });
    dismiss()?.dispatchEvent(tab);
    dismiss()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(tab.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.dismissing()).toBe(true);
  });

  it('swallows the repeats of a held key on the ×, and not the first press', () => {
    const first = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
    dismiss()?.dispatchEvent(first);
    dismiss()?.dispatchEvent(repeat);

    expect(first.defaultPrevented).toBe(false);
    expect(repeat.defaultPrevented).toBe(true);
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

describe('UiChipComponent long label', () => {
  let fixture: ComponentFixture<UiChipComponent>;
  const mount = async (truncated: boolean) => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(truncated ? 300 : 80);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    await TestBed.configureTestingModule({ imports: [UiChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiChipComponent);
    fixture.componentRef.setInput('label', 'Project: The Linux Foundation Core Infrastructure Initiative');
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('[data-testid="ui-chip-label"]') as HTMLElement;
  };

  afterEach(() => vi.restoreAllMocks());

  it('describes the label with a tooltip and gives it a tab stop when it is cut off', async () => {
    const label = await mount(true);
    expect(label.getAttribute('aria-describedby')).toBeTruthy();
    expect(label.getAttribute('tabindex')).toBe('0');
  });

  it('has no tooltip and no tab stop when the label fits', async () => {
    const label = await mount(false);
    expect(label.getAttribute('aria-describedby')).toBeNull();
    expect(label.hasAttribute('tabindex')).toBe(false);
  });

  it('measures again when the label changes without the box changing size', async () => {
    const label = await mount(false);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300);
    fixture.componentRef.setInput('label', 'A longer label that no longer fits');
    await fixture.whenStable();

    expect(label.getAttribute('tabindex')).toBe('0');
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

  describe('removal that waits', () => {
    const activeName = () => document.activeElement?.getAttribute('aria-label');

    beforeEach(() => fixture.componentInstance.deferred.set(true));

    it('keeps focus on the × while the removal is pending, then moves it to the next chip once the chip is gone', async () => {
      dismiss(1).focus();
      dismiss(1).click();
      await fixture.whenStable();

      expect(remaining()).toHaveLength(3);
      expect(document.activeElement).toBe(dismiss(1));

      fixture.componentInstance.flush();
      await fixture.whenStable();

      expect(remaining()).toEqual(['Project: CNCF', 'RSVP: Going']);
      expect(activeName()).toBe('Remove RSVP: Going');
    });

    it('lands on the last chip left after two quick removals', async () => {
      dismiss(0).focus();
      dismiss(0).click();
      dismiss(1).focus();
      dismiss(1).click();
      await fixture.whenStable();
      expect(fixture.componentInstance.removed()).toEqual(['Project: CNCF', 'Meeting type: Committee']);

      fixture.componentInstance.flush();
      await fixture.whenStable();

      expect(remaining()).toEqual(['RSVP: Going']);
      expect(activeName()).toBe('Remove RSVP: Going');
    });

    it('does not hand focus to a chip that is itself being removed', async () => {
      dismiss(2).focus();
      dismiss(2).click();
      dismiss(1).focus();
      dismiss(1).click();
      await fixture.whenStable();

      fixture.componentInstance.flush(['Meeting type: Committee']);
      await fixture.whenStable();

      expect(remaining()).toEqual(['Project: CNCF', 'RSVP: Going']);
      expect(activeName()).toBe('Remove Project: CNCF');
    });

    it('leaves focus on the × and the chip in place when the parent never removes it', async () => {
      dismiss(1).focus();
      dismiss(1).click();
      dismiss(1).click();
      await fixture.whenStable();

      expect(fixture.componentInstance.removed()).toEqual(['Meeting type: Committee']);
      expect(remaining()).toHaveLength(3);
      expect(document.activeElement).toBe(dismiss(1));

      dismiss(1).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 1 }));
      dismiss(1).click();
      expect(fixture.componentInstance.removed()).toHaveLength(2);
    });

    it('does not move focus that the user already took elsewhere', async () => {
      dismiss(1).focus();
      dismiss(1).click();
      await fixture.whenStable();
      document.getElementById('filters')?.focus();

      fixture.componentInstance.flush();
      await fixture.whenStable();

      expect(document.activeElement).toBe(document.getElementById('filters'));
    });
  });

  it('moves focus on when the parent removes the chip whose × holds focus without it being used', async () => {
    dismiss(1).focus();
    fixture.componentInstance.filters.update((list) => list.filter((item) => item !== 'Meeting type: Committee'));
    await fixture.whenStable();

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove RSVP: Going');
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

describe('UiChipGroupComponent with the animation renderer', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  const dismiss = (index: number) => fixture.nativeElement.querySelectorAll('[data-testid="ui-chip-dismiss"]')[index] as HTMLButtonElement;

  // The animation renderer removes a node after the chip's destroy hook has run, so the × still holds focus when focus is restored.
  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent], providers: [provideNoopAnimations()] });
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiChipGroupComponent, UiChipComponent], template: GROUP_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('moves focus to the next chip when a chip in the middle is removed', async () => {
    dismiss(1).focus();
    dismiss(1).click();
    await fixture.whenStable();

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove RSVP: Going');
  });

  it('moves focus to the fallback when the last chip is removed', async () => {
    fixture.componentInstance.filters.set(['Project: CNCF']);
    fixture.componentInstance.fallback.set(document.getElementById('filters'));
    await fixture.whenStable();

    dismiss(0).focus();
    dismiss(0).click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(document.getElementById('filters'));
  });
});
