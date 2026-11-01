// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';
import { UiButtonComponent } from './button.component';

@Component({
  selector: 'lfx-ui-button-test-host',
  imports: [UiButtonComponent],
  template: `<lfx-ui-button [disabled]="disabled()" [loading]="loading()" (click)="save()">Save</lfx-ui-button>`,
})
class ClickHostComponent {
  public readonly disabled = signal(false);
  public readonly loading = signal(false);
  public save = vi.fn();
}

@Component({
  selector: 'lfx-ui-button-link-host',
  imports: [UiButtonComponent],
  template: `<lfx-ui-button link="/meetings" [disabled]="disabled()" [loading]="loading()" (click)="open()">Open</lfx-ui-button>`,
})
class LinkHostComponent {
  public readonly disabled = signal(false);
  public readonly loading = signal(false);
  public open = vi.fn();
}

@Component({
  selector: 'lfx-ui-button-both-tooltips-host',
  imports: [UiButtonComponent, UiTooltipDirective],
  template: `<span lfxUiTooltip="Plain tooltip" tabindex="0">Plain</span
    ><lfx-ui-button lfxUiTooltip="Copy link" ariaLabel="Copy" [iconOnly]="true" icon="fa-light fa-copy" />`,
})
class BothTooltipsHostComponent {}

@Component({
  selector: 'lfx-ui-button-tooltip-host',
  imports: [UiButtonComponent],
  template: `<lfx-ui-button lfxUiTooltip="Copy link" ariaLabel="Copy" [iconOnly]="true" icon="fa-light fa-copy" />`,
})
class TooltipHostComponent {}

// Set through overrideComponent because an inline template this long trips component-max-inline-declarations.
const MENU_HOST_TEMPLATE = `
  <lfx-ui-button [menu]="actions" ariaLabel="Project actions">Actions</lfx-ui-button>
  <ng-template #actions>
    <lfx-ui-menu ariaLabel="Project actions"><lfx-ui-menu-item>Edit</lfx-ui-menu-item></lfx-ui-menu>
  </ng-template>
`;

@Component({ selector: 'lfx-ui-button-menu-host', template: '' })
class MenuHostComponent {}

describe('UiButtonComponent', () => {
  let fixture: ComponentFixture<UiButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiButtonComponent], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(UiButtonComponent);
    await fixture.whenStable();
  });

  afterEach(() => vi.restoreAllMocks());

  function el(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="ui-button"]') as HTMLElement;
  }

  async function set(name: string, value: unknown): Promise<void> {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  }

  it('renders a button of type button by default', () => {
    expect(el().tagName).toBe('BUTTON');
    expect(el().getAttribute('type')).toBe('button');
  });

  it.each([
    ['primary', 'bg-ui-accent-500'],
    ['secondary', 'bg-ui-background-100'],
    ['secondary-accent', 'text-ui-accent-500'],
    ['tertiary', 'bg-transparent'],
    ['tertiary-accent', 'text-ui-accent-500'],
    ['danger', 'bg-ui-danger-600'],
    ['danger-tertiary', 'text-ui-danger-700'],
    ['recording', 'bg-ui-success-600'],
  ])('styles the %s variant with %s', async (variant, token) => {
    await set('variant', variant);
    expect(el().classList).toContain(token);
  });

  it.each([
    ['secondary', true],
    ['secondary-accent', false],
    ['tertiary', false],
    ['primary', false],
  ])('gives the %s variant the neutral edge ring: %s', async (variant, ring) => {
    await set('variant', variant);
    expect(el().classList.contains('edge')).toBe(ring);
  });

  it.each([
    ['tiny', 'h-ui-tiny', 'rounded-[8px]', 'px-[8px]', 'button-12'],
    ['small', 'h-ui-small', 'rounded-[10px]', 'px-[10px]', 'button-14'],
    ['medium', 'h-ui-medium', 'rounded-ui-sm', 'px-[16px]', 'button-14'],
  ])('sizes %s with height, radius, padding and type role', async (size, height, radius, padding, type) => {
    await set('size', size);
    expect(Array.from(el().classList)).toEqual(expect.arrayContaining([height, radius, padding, type]));
  });

  it('defaults to the medium 40px size', () => {
    expect(el().classList).toContain('h-ui-medium');
  });

  it('renders the leading icon before the label', async () => {
    await set('icon', 'fa-light fa-plus');
    const icon = el().querySelector('i');
    expect(icon?.className).toBe('fa-light fa-plus');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the trailing icon after the label, independent of the leading icon', async () => {
    await set('icon', 'fa-light fa-video');
    await set('trailingIcon', 'fa-light fa-chevron-right');
    const icons = el().querySelectorAll('i');
    expect(icons).toHaveLength(2);
    expect(icons[1].classList).toContain('fa-chevron-right');
    expect(icons[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores the trailing icon on an icon-only button', async () => {
    await set('ariaLabel', 'Next');
    await set('iconOnly', true);
    await set('icon', 'fa-light fa-angle-right');
    await set('trailingIcon', 'fa-light fa-chevron-right');
    expect(el().querySelectorAll('i')).toHaveLength(1);
  });

  it('writes aria-expanded and aria-controls on the inner button, and nothing by default', async () => {
    expect(el().hasAttribute('aria-expanded')).toBe(false);
    expect(el().hasAttribute('aria-controls')).toBe(false);

    await set('ariaExpanded', false);
    await set('ariaControls', 'more-rows');
    expect(el().getAttribute('aria-expanded')).toBe('false');
    expect(el().getAttribute('aria-controls')).toBe('more-rows');

    await set('ariaExpanded', true);
    expect(el().getAttribute('aria-expanded')).toBe('true');
  });

  it('writes aria-expanded on a link too', async () => {
    await set('link', '/meetings');
    await set('ariaExpanded', true);
    expect(el().tagName).toBe('A');
    expect(el().getAttribute('aria-expanded')).toBe('true');
  });

  it('makes an icon-only button a circle and names it', async () => {
    await set('ariaLabel', 'Next');
    await set('iconOnly', true);
    expect(el().classList).toContain('aspect-square');
    expect(el().classList).toContain('rounded-ui-full');
    expect(el().classList).not.toContain('px-[16px]');
    expect(el().getAttribute('aria-label')).toBe('Next');
  });

  it('disables the native button and flattens it to the disabled look', async () => {
    await set('disabled', true);
    expect((el() as HTMLButtonElement).disabled).toBe(true);
    expect(el().classList).toContain('bg-ui-neutral-50');
    expect(el().classList).toContain('text-ui-neutral-500');
    expect(el().classList).not.toContain('bg-ui-accent-500');
  });

  it('keeps a disabled tertiary button transparent without a ring', async () => {
    await set('variant', 'tertiary');
    await set('disabled', true);
    expect(el().classList).toContain('bg-transparent');
    expect(el().classList).not.toContain('edge');
  });

  it('accepts boolean attributes written as plain attributes', async () => {
    const host = TestBed.createComponent(UiButtonComponent);
    host.componentRef.setInput('disabled', '');
    await host.whenStable();
    expect((host.nativeElement.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('turns off pointer events on the host so a consumer click handler cannot fire', async () => {
    const host = TestBed.createComponent(ClickHostComponent);
    host.componentInstance.disabled.set(true);
    await host.whenStable();
    const button = host.nativeElement.querySelector('lfx-ui-button') as HTMLElement;
    // jsdom ignores CSS pointer-events, so assert the host class that blocks the click in a browser.
    expect(button.classList).toContain('pointer-events-none');
  });

  it('does not navigate when a disabled link is clicked', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await set('link', '/meetings');
    await set('disabled', true);
    el().click();
    await fixture.whenStable();

    expect(navigate).not.toHaveBeenCalled();
    expect(el().getAttribute('href')).toBeNull();
  });

  it('warns in dev mode when an icon-only button has no accessible name', async () => {
    // The warning is the behaviour under test; the spy keeps it out of the test output.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await set('iconOnly', true);
    expect(warn).toHaveBeenCalled();
  });

  it('stretches to full width', async () => {
    await set('fullWidth', true);
    expect(el().classList).toContain('w-full');
    expect((fixture.nativeElement as HTMLElement).classList).toContain('block');
  });

  it('renders a router link when link is set', async () => {
    await set('link', '/meetings/create');
    expect(el().tagName).toBe('A');
    expect(el().getAttribute('href')).toBe('/meetings/create');
  });

  it('marks a disabled link as aria-disabled and out of the tab order', async () => {
    await set('link', '/meetings');
    await set('disabled', true);
    expect(el().getAttribute('aria-disabled')).toBe('true');
    expect(el().getAttribute('tabindex')).toBe('-1');
  });

  describe('loading', () => {
    it('swaps the leading icon for a current-colour spinner and keeps the label', async () => {
      await set('icon', 'fa-light fa-plus');
      await set('loading', true);
      expect(el().querySelector('i[aria-hidden="true"].fa-plus')).toBeNull();
      const spinner = el().querySelector('[data-testid="ui-button-spinner"]') as HTMLElement;
      expect(spinner.classList).toContain('text-current');
      expect(spinner.style.width).toBe('16px');
      expect(el().getAttribute('aria-busy')).toBe('true');
    });

    it('hides the spinner from assistive tech so a loading button keeps its name', async () => {
      await set('loading', true);
      expect((el().querySelector('[data-testid="ui-button-spinner"]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    });

    it('uses a 12px spinner on a tiny button', async () => {
      await set('size', 'tiny');
      await set('loading', true);
      expect((el().querySelector('[data-testid="ui-button-spinner"]') as HTMLElement).style.width).toBe('12px');
    });

    it('has no aria-busy and no spinner when idle', () => {
      expect(el().getAttribute('aria-busy')).toBeNull();
      expect(el().querySelector('[data-testid="ui-button-spinner"]')).toBeNull();
    });

    it('swallows a click while loading and keeps the button focusable', async () => {
      const host = TestBed.createComponent(ClickHostComponent);
      host.componentInstance.loading.set(true);
      await host.whenStable();
      const button = host.nativeElement.querySelector('button') as HTMLButtonElement;
      button.click();
      expect(host.componentInstance.save).not.toHaveBeenCalled();
      expect(button.disabled).toBe(false);
      expect(host.nativeElement.querySelector('lfx-ui-button').classList).toContain('pointer-events-none');
    });

    it('passes the click through once loading ends', async () => {
      const host = TestBed.createComponent(ClickHostComponent);
      await host.whenStable();
      (host.nativeElement.querySelector('button') as HTMLButtonElement).click();
      expect(host.componentInstance.save).toHaveBeenCalledTimes(1);
    });

    it('does not navigate a link while loading', async () => {
      await set('link', '/meetings');
      await set('loading', true);
      expect(el().getAttribute('href')).toBeNull();
      expect(el().getAttribute('aria-busy')).toBe('true');
    });

    it('keeps a loading link focusable', async () => {
      await set('link', '/meetings');
      await set('loading', true);
      expect(el().getAttribute('tabindex')).toBe('0');
    });

    it('leaves an idle link out of an explicit tabindex', async () => {
      await set('link', '/meetings');
      expect(el().getAttribute('tabindex')).toBeNull();
    });
  });

  describe('link states', () => {
    async function linkHost(configure: (host: LinkHostComponent) => void = () => undefined) {
      const host = TestBed.createComponent(LinkHostComponent);
      configure(host.componentInstance);
      await host.whenStable();
      return { host, anchor: host.nativeElement.querySelector('a') as HTMLAnchorElement };
    }

    it('keeps the link role while loading or disabled, when the href is gone', async () => {
      const loading = await linkHost((host) => host.loading.set(true));
      expect(loading.anchor.getAttribute('role')).toBe('link');
      const disabled = await linkHost((host) => host.disabled.set(true));
      expect(disabled.anchor.getAttribute('role')).toBe('link');
    });

    it('has no explicit role while idle', async () => {
      const { anchor } = await linkHost();
      expect(anchor.hasAttribute('role')).toBe(false);
    });

    it('swallows a click on a loading link', async () => {
      const { host, anchor } = await linkHost((instance) => instance.loading.set(true));
      anchor.click();
      expect(host.componentInstance.open).not.toHaveBeenCalled();
    });

    it('swallows a click on a disabled link', async () => {
      const { host, anchor } = await linkHost((instance) => instance.disabled.set(true));
      anchor.click();
      expect(host.componentInstance.open).not.toHaveBeenCalled();
    });

    it('passes a click on an idle link through', async () => {
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const { host, anchor } = await linkHost();
      anchor.click();
      expect(host.componentInstance.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('tooltip forwarding', () => {
    it('does not attach a second tooltip to the wrapper when the directive is imported next to it', async () => {
      const host = TestBed.createComponent(BothTooltipsHostComponent);
      await host.whenStable();
      const wrapper = host.nativeElement.querySelector('lfx-ui-button') as HTMLElement;
      expect(wrapper.getAttribute('aria-describedby')).toBeNull();
      expect(wrapper.querySelector('button')?.getAttribute('aria-describedby')).toBeTruthy();
      expect(host.nativeElement.querySelector('span')?.getAttribute('aria-describedby')).toBeTruthy();
    });

    it('registers the spoken description on the inner button, not the wrapper', async () => {
      const host = TestBed.createComponent(TooltipHostComponent);
      await host.whenStable();
      const wrapper = host.nativeElement.querySelector('lfx-ui-button') as HTMLElement;
      const inner = wrapper.querySelector('button') as HTMLButtonElement;
      const describedBy = inner.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)?.textContent).toBe('Copy link');
      expect(wrapper.getAttribute('aria-describedby')).toBeNull();
    });
  });
});

describe('UiButtonComponent menu', () => {
  const settle = async (host: ComponentFixture<unknown>): Promise<void> => {
    await host.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  };

  afterEach(() => TestBed.inject(OverlayContainer).ngOnDestroy());

  it('makes the inner button the menu trigger and returns focus to it on Escape', async () => {
    TestBed.overrideComponent(MenuHostComponent, {
      set: { imports: [UiButtonComponent, UiMenuComponent, UiMenuItemComponent], template: MENU_HOST_TEMPLATE },
    });
    const host = TestBed.createComponent(MenuHostComponent);
    document.body.appendChild(host.nativeElement);
    await host.whenStable();
    const inner = host.nativeElement.querySelector('lfx-ui-button button') as HTMLButtonElement;
    expect(inner.getAttribute('aria-haspopup')).toBe('menu');
    expect(inner.getAttribute('aria-expanded')).toBe('false');

    inner.click();
    await settle(host);
    const container = TestBed.inject(OverlayContainer).getContainerElement();
    expect(container.querySelector('[data-testid="ui-menu"]')).not.toBeNull();
    expect(inner.getAttribute('aria-expanded')).toBe('true');

    // CDK Menu reads `keyCode`, so the synthetic event carries it.
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    await settle(host);
    expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
    expect(inner.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(inner);

    host.destroy();
  });

  it('adds no popup semantics without a menu', async () => {
    const plain = TestBed.createComponent(UiButtonComponent);
    await plain.whenStable();
    const inner = plain.nativeElement.querySelector('[data-testid="ui-button"]') as HTMLElement;
    expect(inner.getAttribute('aria-haspopup')).toBeNull();
    expect(inner.getAttribute('aria-expanded')).toBeNull();
  });
});
