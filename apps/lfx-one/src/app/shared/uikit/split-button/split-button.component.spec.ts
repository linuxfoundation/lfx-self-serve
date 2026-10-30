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
  public readonly size = signal<UiButtonSize>('medium');
  public readonly disabled = signal(false);
  public readonly menuLabel = signal('');
  public readonly events = signal<string[]>([]);

  public log(name: string): void {
    this.events.update((e) => [...e, name]);
  }
}

describe('UiSplitButtonComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let container: HTMLElement;

  const main = (): HTMLButtonElement => fixture.nativeElement.querySelector('lfx-ui-button button') as HTMLButtonElement;
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

  it('squares the joined corners, matches the size and joins the secondary rings by 1px', async () => {
    expect(main().parentElement?.className).toContain('[&>button]:rounded-r-none');
    expect(chevron().className).toContain('rounded-l-none');
    expect(chevron().className).toContain('h-ui-medium');
    expect(chevron().className).toContain('aspect-square');
    expect(chevron().className).not.toContain('-ml-px');

    fixture.componentInstance.size.set('tiny');
    fixture.componentInstance.variant.set('secondary');
    await fixture.whenStable();

    expect(chevron().className).toContain('h-ui-tiny');
    expect(chevron().className).toContain('rounded-r-[8px]');
    expect(chevron().className).toContain('-ml-px');
    expect(chevron().className).toContain('edge');
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
    expect(chevron().className).toContain('bg-ui-neutral-50');

    chevron().click();
    await fixture.whenStable();

    expect(menu()).toBeNull();
  });

  it('shows the library focus ring on keyboard focus of the chevron', () => {
    expect(chevron().className).toContain('focus-visible:shadow-focus');
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
});
