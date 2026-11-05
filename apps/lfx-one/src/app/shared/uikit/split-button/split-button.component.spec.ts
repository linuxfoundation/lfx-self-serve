// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UiButtonSize, UiSplitButtonVariant } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';
import { UiSplitButtonComponent } from './split-button.component';

const HOST_TEMPLATE = `
  <lfx-ui-split-button label="Deploy" icon="fa-light fa-rocket" [menu]="menu" [variant]="variant()" [size]="size()" [disabled]="disabled()" [menuLabel]="menuLabel()" (triggered)="log('deploy')" />
  <ng-template #menu>
    <lfx-ui-menu ariaLabel="Deploy options">
      <lfx-ui-menu-item id="first" (triggered)="log('first')">Deploy</lfx-ui-menu-item>
      <lfx-ui-menu-item id="schedule" (triggered)="log('schedule')">Schedule Deploy</lfx-ui-menu-item>
    </lfx-ui-menu>
  </ng-template>
`;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  public readonly variant = signal<UiSplitButtonVariant>('primary');
  public readonly size = signal<UiButtonSize>('large');
  public readonly disabled = signal(false);
  public readonly menuLabel = signal('');
  public readonly events = signal<string[]>([]);

  public log(name: string): void {
    this.events.update((e) => [...e, name]);
  }
}

const ACTION_TEMPLATE = `
  <lfx-ui-split-button label="Recording" icon="fa-light fa-play" secondaryIcon="fa-light fa-link" secondaryTooltip="Copy recording link"
    [variant]="variant()" [disabled]="disabled()" (triggered)="log('play')" (secondaryTriggered)="log('copy')" />
`;

describe('UiSplitButtonComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let container: HTMLElement;

  const main = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-testid="ui-split-button-main"] button') as HTMLButtonElement;
  const chevron = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-testid="ui-split-button-chevron"]') as HTMLButtonElement;
  const menu = (): HTMLElement | null => container.querySelector('[data-testid="ui-menu"]');
  // CDK Menu reads `keyCode`, so the synthetic events carry it.
  const keyCodes: Record<string, number> = { ArrowDown: 40, Escape: 27, Enter: 13 };
  const key = (target: Element, k: string): boolean =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, keyCode: keyCodes[k], bubbles: true, cancelable: true }));

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiSplitButtonComponent, UiMenuComponent, UiMenuItemComponent], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    document.body.appendChild(fixture.nativeElement);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('renders the main action as an lfx-ui-button and the chevron as a native button', () => {
    expect(main().textContent).toContain('Deploy');
    expect(main().getAttribute('type')).toBe('button');
    expect(chevron().tagName).toBe('BUTTON');
    expect(chevron().getAttribute('type')).toBe('button');
  });

  it('names the chevron after the label unless menuLabel overrides it', async () => {
    expect(chevron().getAttribute('aria-label')).toBe('More options for Deploy');

    fixture.componentInstance.menuLabel.set('More deploy options');
    await fixture.whenStable();

    expect(chevron().getAttribute('aria-label')).toBe('More deploy options');
  });

  it('marks the chevron as a menu trigger and tracks aria-expanded', async () => {
    expect(chevron().getAttribute('aria-haspopup')).toBe('menu');
    expect(chevron().getAttribute('aria-expanded')).toBe('false');

    chevron().click();
    await fixture.whenStable();

    expect(chevron().getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.getAttribute('role')).toBe('menu');
  });

  it('emits triggered from the main half only', async () => {
    main().click();
    chevron().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.events()).toEqual(['deploy']);
  });

  it('opens from the keyboard, focuses the first item and closes on Escape with focus back on the chevron', async () => {
    chevron().focus();
    key(chevron(), 'Enter');
    await fixture.whenStable();

    expect(menu()).not.toBeNull();
    expect(document.activeElement?.id).toBe('first');

    key(document.activeElement as Element, 'Escape');
    await fixture.whenStable();

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(chevron());
    expect(chevron().getAttribute('aria-expanded')).toBe('false');
  });

  it('runs a menu item and closes the menu', async () => {
    chevron().click();
    await fixture.whenStable();
    (container.querySelector('#schedule') as HTMLElement).click();
    await fixture.whenStable();

    expect(fixture.componentInstance.events()).toEqual(['schedule']);
    expect(menu()).toBeNull();
  });

  it('squares the joined corners, matches the size and joins the secondary borders by 1px', async () => {
    expect(main().parentElement?.className).toContain('[&>button]:rounded-r-none');
    expect(chevron().className).toContain('rounded-l-none');
    expect(chevron().className).toContain('h-ui-medium');
    expect(chevron().className).toContain('aspect-square');
    expect(chevron().className).not.toContain('-ml-px');

    fixture.componentInstance.size.set('small');
    fixture.componentInstance.variant.set('secondary');
    await fixture.whenStable();

    expect(chevron().className).toContain('h-ui-xsmall');
    expect(chevron().className).toContain('rounded-r-[11px]');
    expect(chevron().className).toContain('text-[13px]');
    expect(chevron().className).toContain('-ml-px');
    expect(chevron().className).toContain('border-ui-neutral-alpha-300');

    fixture.componentInstance.size.set('tiny');
    await fixture.whenStable();

    expect(chevron().className).toContain('h-ui-tiny');
    expect(chevron().className).toContain('rounded-r-[10px]');
    expect(chevron().className).toContain('text-[12px]');
  });

  it('draws the divider on the primary variant only', async () => {
    const divider = (): Element | null => chevron().querySelector('[data-testid="ui-split-button-divider"]');
    expect(divider()).not.toBeNull();
    expect(chevron().className).toContain('bg-ui-accent-500');

    fixture.componentInstance.variant.set('secondary');
    await fixture.whenStable();

    expect(divider()).toBeNull();
    expect(chevron().className).toContain('bg-ui-background-100');
  });

  it('disables both halves and never opens the menu', async () => {
    fixture.componentInstance.disabled.set(true);
    await fixture.whenStable();

    expect(main().disabled).toBe(true);
    expect(chevron().disabled).toBe(true);
    expect(chevron().className).toContain('opacity-45');
    expect(chevron().className).toContain('bg-ui-accent-500');
    expect(chevron().className).not.toMatch(/(^|\s)(hover|active):bg-/);
    expect(chevron().querySelector('[data-testid="ui-split-button-divider"]')).not.toBeNull();
    expect(chevron().className).toContain('cursor-not-allowed');
    expect(chevron().className).not.toContain('cursor-pointer');

    chevron().click();
    await fixture.whenStable();

    expect(menu()).toBeNull();
  });

  it('shows the 4px accent halo on keyboard focus of the chevron and no outline on mouse focus', () => {
    expect(chevron().className).toContain('focus-visible:shadow-[0_0_0_4px]');
    expect(chevron().className).toContain('focus-visible:shadow-ui-accent-100');
    expect(chevron().className).toContain('focus:outline-none');
  });

  it('lines the menu up with the start edge of the whole control, measured from the chevron, and re-measures on resize', async () => {
    let resize: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public disconnect = vi.fn();
        public constructor(callback: () => void) {
          resize = callback;
        }
      }
    );
    let chevronLeft = 86.25;
    // The chevron sits `chevronLeft` px from the host's start edge.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { left: this.tagName === 'BUTTON' ? chevronLeft : 0 } as DOMRect;
    });
    const measured = TestBed.createComponent(TestHostComponent);
    await measured.whenStable();
    const trigger = measured.debugElement.query(By.directive(CdkMenuTrigger)).injector.get(CdkMenuTrigger);

    expect(trigger.menuPosition?.[0]).toMatchObject({ originX: 'start', overlayX: 'start', offsetX: -86.25 });
    expect(trigger.menuPosition?.[1]).toMatchObject({ originX: 'end', overlayX: 'end' });
    expect(trigger.menuPosition?.[2]).toMatchObject({ originY: 'top', overlayY: 'bottom', offsetX: -86.25 });

    chevronLeft = 120;
    resize();
    await measured.whenStable();

    expect(trigger.menuPosition?.[0].offsetX).toBe(-120);
    rect.mockRestore();
    measured.destroy();
  });

  it('measures the menu offset in layout px inside a scaled ancestor, such as a modal entering at scale 0.96', async () => {
    // Laid out 130px wide with the chevron 86.25px in; at scale 0.96 the rects read 124.8px and 82.8px.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(130);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.tagName === 'BUTTON' ? { left: 82.8, width: 0 } : { left: 0, width: 124.8 }) as DOMRect;
    });
    const measured = TestBed.createComponent(TestHostComponent);
    await measured.whenStable();
    const trigger = measured.debugElement.query(By.directive(CdkMenuTrigger)).injector.get(CdkMenuTrigger);

    expect(trigger.menuPosition?.[0].offsetX).toBeCloseTo(-86.25, 2);
    measured.destroy();
  });

  describe('with an action half', () => {
    let action: ComponentFixture<TestHostComponent>;
    const half = (): HTMLButtonElement => action.nativeElement.querySelector('[data-testid="ui-split-button-secondary"]') as HTMLButtonElement;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [TestHostComponent] });
      TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiSplitButtonComponent], template: ACTION_TEMPLATE } });
      action = TestBed.createComponent(TestHostComponent);
      action.componentInstance.variant.set('recording');
      await action.whenStable();
    });

    afterEach(() => action.destroy());

    it('renders a named icon button with no menu trigger', () => {
      expect(half().tagName).toBe('BUTTON');
      expect(half().getAttribute('type')).toBe('button');
      expect(half().getAttribute('aria-label')).toBe('Copy recording link');
      expect(half().hasAttribute('aria-haspopup')).toBe(false);
      expect(half().querySelector('i')?.className).toContain('fa-link');
      expect(action.nativeElement.querySelector('[data-testid="ui-split-button-chevron"]')).toBeNull();
      expect(action.debugElement.query(By.css('[data-testid="ui-split-button-secondary"]')).injector.get(UiTooltipDirective).text()).toBe(
        'Copy recording link'
      );
    });

    it('emits secondaryTriggered from the action half and triggered from the main half', async () => {
      half().click();
      (action.nativeElement.querySelector('[data-testid="ui-split-button-main"] button') as HTMLButtonElement).click();
      await action.whenStable();

      expect(action.componentInstance.events()).toEqual(['copy', 'play']);
    });

    it('fills both halves green and draws the divider as a 30% white inset shadow', () => {
      expect(half().className).toContain('bg-ui-success-600');
      expect(half().className).toContain('shadow-[inset_1px_0_0_color-mix(in_srgb,var(--ui-white)_30%,transparent)]');
      expect(half().className).not.toContain('-ml-px');
      expect(action.nativeElement.querySelector('[data-testid="ui-split-button-main"] button').className).toContain('bg-ui-success-600');
    });

    it('disables the action half and never emits from it', async () => {
      action.componentInstance.disabled.set(true);
      await action.whenStable();
      half().click();
      await action.whenStable();

      expect(half().disabled).toBe(true);
      expect(half().className).toContain('opacity-45');
      expect(half().className).toContain('bg-ui-success-600');
      expect(action.componentInstance.events()).toEqual([]);
    });

    it('warns and renders no empty aria-label when the action half has no tooltip or icon', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [TestHostComponent] });
      TestBed.overrideComponent(TestHostComponent, {
        set: { imports: [UiSplitButtonComponent], template: '<lfx-ui-split-button label="Recording" />' },
      });
      const unnamed = TestBed.createComponent(TestHostComponent);
      await unnamed.whenStable();

      expect(unnamed.nativeElement.querySelector('[data-testid="ui-split-button-secondary"]').hasAttribute('aria-label')).toBe(false);
      expect(warn).toHaveBeenCalledWith('lfx-ui-split-button: without a menu, the action half needs a secondaryTooltip or a secondaryLabel.');
      expect(warn).toHaveBeenCalledWith('lfx-ui-split-button: without a menu, the action half needs a secondaryIcon or a secondaryLabel.');
      unnamed.destroy();
    });
  });

  describe('as a labelled pair', () => {
    let pair: ComponentFixture<TestHostComponent>;
    let warn: ReturnType<typeof vi.spyOn>;
    const half = (): HTMLButtonElement => pair.nativeElement.querySelector('[data-testid="ui-split-button-secondary"]') as HTMLButtonElement;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [TestHostComponent] });
      TestBed.overrideComponent(TestHostComponent, {
        set: {
          imports: [UiSplitButtonComponent],
          template: `<lfx-ui-split-button label="Trend" icon="fa-light fa-chart-line" variant="secondary" size="small" secondaryLabel="Snapshot"
            secondaryIcon="fa-light fa-table-list" (triggered)="log('trend')" (secondaryTriggered)="log('snapshot')" />`,
        },
      });
      // Spied before creation, so the dev-mode warning effect's first run is the one under test; the outer afterEach restores it.
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      pair = TestBed.createComponent(TestHostComponent);
      await pair.whenStable();
    });

    afterEach(() => pair.destroy());

    it('shows the label and icon on the right half, named by its text rather than a tooltip, and without warnings', () => {
      expect(half().textContent?.trim()).toBe('Snapshot');
      expect(half().querySelector('i')?.className).toContain('fa-table-list');
      expect(half().hasAttribute('aria-label')).toBe(false);
      expect(pair.debugElement.query(By.css('[data-testid="ui-split-button-secondary"]')).injector.get(UiTooltipDirective).disabled()).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it('sizes the right half like a button of the same size instead of an icon square', () => {
      expect(half().className).not.toContain('aspect-square');
      expect(half().className).toContain('px-[8px]');
      expect(half().className).toContain('h-ui-xsmall');
    });

    it('keeps the label at the button type at large, sizing only the icon up', async () => {
      pair.destroy();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [TestHostComponent] });
      TestBed.overrideComponent(TestHostComponent, {
        set: {
          imports: [UiSplitButtonComponent],
          template: `<lfx-ui-split-button label="Trend" size="large" secondaryLabel="Snapshot" secondaryIcon="fa-light fa-table-list" />`,
        },
      });
      pair = TestBed.createComponent(TestHostComponent);
      await pair.whenStable();

      expect(half().className).toContain('button-14');
      expect(half().className).toContain('[&>i]:text-[18px]');
      expect(half().className.split(' ')).not.toContain('text-[18px]');
    });

    it('emits each half on its own', async () => {
      half().click();
      (pair.nativeElement.querySelector('[data-testid="ui-split-button-main"] button') as HTMLButtonElement).click();
      await pair.whenStable();

      expect(pair.componentInstance.events()).toEqual(['snapshot', 'trend']);
    });
  });
});
