// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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

@Component({
  selector: 'lfx-ui-button-tooltip-icon-host',
  imports: [UiButtonComponent],
  template: `<lfx-ui-button lfxUiTooltip="Only invited people can join" lfxUiTooltipTitle="Restricted" lfxUiTooltipIcon="fa-solid fa-lock"
    >Join</lfx-ui-button
  >`,
})
class TooltipIconHostComponent {}

@Component({
  selector: 'lfx-ui-button-disabled-tooltip-host',
  imports: [UiButtonComponent, UiTooltipDirective],
  template: `<lfx-ui-button lfxUiTooltip="Copy link" [disabled]="disabled()">Copy</lfx-ui-button
    ><span lfxUiTooltip="Saving is off while offline" tabindex="0"><lfx-ui-button [disabled]="true">Save</lfx-ui-button></span>`,
})
class DisabledTooltipHostComponent {
  public readonly disabled = signal(true);
}

// Set through overrideComponent because an inline template this long trips component-max-inline-declarations.
const MENU_HOST_TEMPLATE = `
  <lfx-ui-button [menu]="actions" ariaLabel="Project actions">Actions</lfx-ui-button>
  <ng-template #actions>
    <lfx-ui-menu ariaLabel="Project actions"><lfx-ui-menu-item>Edit</lfx-ui-menu-item></lfx-ui-menu>
  </ng-template>
`;

@Component({ selector: 'lfx-ui-button-menu-host', template: '' })
class MenuHostComponent {
  public readonly busy = signal(false);
}

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
    ['primary', 'border-transparent'],
    ['secondary', 'border-ui-neutral-alpha-300'],
    ['secondary-accent', 'border-ui-accent-300'],
    ['tertiary', 'border-transparent'],
    ['tertiary-accent', 'border-transparent'],
    ['danger', 'border-transparent'],
    ['danger-tertiary', 'border-transparent'],
    ['recording', 'border-transparent'],
  ])('gives the %s variant a real 1px border in %s', async (variant, border) => {
    await set('variant', variant);
    expect(el().classList).toContain('border');
    expect(el().classList).toContain(border);
    expect(el().classList).not.toContain('edge');
  });

  it.each([
    ['secondary', ['hover:bg-ui-neutral-alpha-50', 'active:bg-ui-neutral-alpha-100']],
    ['secondary-accent', ['hover:bg-ui-accent-100', 'hover:border-ui-accent-500', 'active:bg-ui-accent-200', 'active:border-ui-accent-500']],
    ['tertiary', ['hover:bg-ui-neutral-alpha-50', 'active:bg-ui-neutral-alpha-100']],
    ['tertiary-accent', ['hover:bg-ui-accent-100', 'active:bg-ui-accent-200']],
  ])('gives the %s variant the library hover and pressed states', async (variant, states) => {
    await set('variant', variant);
    expect(Array.from(el().classList)).toEqual(expect.arrayContaining(states));
  });

  it.each(['secondary-accent', 'tertiary-accent'])('keeps the %s label on the accent through hover and press', async (variant) => {
    await set('variant', variant);
    const classes = Array.from(el().classList);
    expect(classes).toContain('text-ui-accent-500');
    expect(classes.filter((name) => /^(hover|active):text-/.test(name))).toEqual([]);
  });

  it('shows the 4px accent halo on keyboard focus only', () => {
    expect(Array.from(el().classList)).toEqual(
      expect.arrayContaining(['focus:outline-none', 'focus-visible:shadow-[0_0_0_4px]', 'focus-visible:shadow-ui-accent-100'])
    );
  });

  it.each([
    ['tiny', 'h-ui-tiny', 'rounded-[10px]', 'px-[8px]', 'button-12', '[&>i]:text-[12px]'],
    ['small', 'h-ui-xsmall', 'rounded-[11px]', 'px-[8px]', 'text-[13px]/[18px]', '[&>i]:text-[13px]'],
    ['default', 'h-ui-small', 'rounded-ui-sm', 'px-[10px]', 'button-14', '[&>i]:text-[14px]'],
    ['large', 'h-ui-medium', 'rounded-[14px]', 'px-[16px]', 'button-14', '[&>i]:text-[18px]'],
  ])('sizes %s with height, radius, padding, type role and icon size', async (size, height, radius, padding, type, icon) => {
    await set('size', size);
    expect(Array.from(el().classList)).toEqual(expect.arrayContaining([height, radius, padding, type, icon]));
  });

  it('defaults to the 32px default size', () => {
    expect(el().classList).toContain('h-ui-small');
  });

  it('renders the leading icon before the label', async () => {
    await set('icon', 'fa-light fa-plus');
    const icon = el().querySelector('i');
    expect(icon?.className).toBe('ui-icon fa-light fa-plus');
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
    expect(el().classList).not.toContain('px-[10px]');
    expect(el().getAttribute('aria-label')).toBe('Next');
  });

  it('disables the native button and fades its own colours to 45% without hover or pressed steps', async () => {
    await set('disabled', true);
    expect((el() as HTMLButtonElement).disabled).toBe(true);
    expect(Array.from(el().classList)).toEqual(expect.arrayContaining(['opacity-45', 'bg-ui-accent-500', 'text-ui-white']));
    expect(Array.from(el().classList).filter((name) => /^(hover|active):/.test(name))).toEqual([]);
  });

  it('keeps the border of a disabled bordered button', async () => {
    await set('variant', 'secondary');
    await set('disabled', true);
    expect(Array.from(el().classList)).toEqual(expect.arrayContaining(['opacity-45', 'border-ui-neutral-alpha-300', 'bg-ui-background-100']));
  });

  it('does not fade an enabled button', () => {
    expect(el().classList).not.toContain('opacity-45');
  });

  it('keeps a disabled tertiary button transparent without a border', async () => {
    await set('variant', 'tertiary');
    await set('disabled', true);
    expect(el().classList).toContain('bg-transparent');
    expect(el().classList).toContain('border-transparent');
  });

  it('accepts boolean attributes written as plain attributes', async () => {
    const host = TestBed.createComponent(UiButtonComponent);
    host.componentRef.setInput('disabled', '');
    await host.whenStable();
    expect((host.nativeElement.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('never calls the consumer click handler when the disabled button is clicked', async () => {
    const host = TestBed.createComponent(ClickHostComponent);
    host.componentInstance.disabled.set(true);
    await host.whenStable();
    (host.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(host.componentInstance.save).not.toHaveBeenCalled();
  });

  it('shows the not-allowed cursor on a disabled button, with its children out of the hit test', async () => {
    expect(el().classList).toContain('cursor-pointer');
    await set('disabled', true);
    expect(Array.from(el().classList)).toEqual(expect.arrayContaining(['pointer-events-auto', 'cursor-not-allowed', '[&_*]:pointer-events-none']));
    expect(el().classList).not.toContain('cursor-pointer');
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

  it('opens an external href in a new tab without an opener, and drops it while disabled', async () => {
    await set('href', 'https://zoom.example.test/j/1');
    expect(el().tagName).toBe('A');
    expect(el().getAttribute('href')).toBe('https://zoom.example.test/j/1');
    expect(el().getAttribute('target')).toBe('_blank');
    expect(el().getAttribute('rel')).toBe('noopener noreferrer');
    expect(el().classList).toContain('!no-underline');
    await set('disabled', true);
    expect(el().hasAttribute('href')).toBe(false);
    expect(el().getAttribute('aria-disabled')).toBe('true');
  });

  it('pins a link label colour in every state and never underlines it', async () => {
    await set('variant', 'tertiary-accent');
    await set('link', '/meetings');
    expect(Array.from(el().classList)).toEqual(expect.arrayContaining(['!no-underline', '!text-ui-accent-500']));
    await set('disabled', true);
    expect(el().classList).toContain('!text-ui-accent-500');
  });

  it('adds no link pins to a button', () => {
    expect(Array.from(el().classList).filter((name) => name.startsWith('!'))).toEqual([]);
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
      expect(spinner.style.width).toBe('14px');
      expect(el().getAttribute('aria-busy')).toBe('true');
    });

    it('hides the spinner from assistive tech so a loading button keeps its name', async () => {
      await set('loading', true);
      expect((el().querySelector('[data-testid="ui-button-spinner"]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    });

    it.each([
      ['tiny', '12px'],
      ['small', '13px'],
      ['large', '18px'],
    ])('sizes the spinner to the icon on a %s button: %s', async (size, width) => {
      await set('size', size);
      await set('loading', true);
      expect((el().querySelector('[data-testid="ui-button-spinner"]') as HTMLElement).style.width).toBe(width);
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

    it('swallows a click on a disabled link and shows the not-allowed cursor', async () => {
      const { host, anchor } = await linkHost((instance) => instance.disabled.set(true));
      expect(anchor.classList).toContain('cursor-not-allowed');
      anchor.click();
      expect(host.componentInstance.open).not.toHaveBeenCalled();
    });

    it('keeps a mouse press from focusing a disabled link', async () => {
      const { anchor } = await linkHost((instance) => instance.disabled.set(true));
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      anchor.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
    });

    it('lets a mouse press focus an idle link', async () => {
      const { anchor } = await linkHost();
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      anchor.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(false);
    });

    it('passes a click on an idle link through', async () => {
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const { host, anchor } = await linkHost();
      anchor.click();
      expect(host.componentInstance.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('focus', () => {
    afterEach(() => fixture.nativeElement.remove());

    it('focuses the inner button', () => {
      document.body.appendChild(fixture.nativeElement);
      fixture.componentInstance.focus();
      expect(document.activeElement).toBe(el());
    });

    it('focuses the inner link when the button is a link', async () => {
      await set('link', '/meetings');
      document.body.appendChild(fixture.nativeElement);
      fixture.componentInstance.focus();
      expect(el().tagName).toBe('A');
      expect(document.activeElement).toBe(el());
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

    it('forwards the tooltip title icon to the inner button', async () => {
      const host = TestBed.createComponent(TooltipIconHostComponent);
      await host.whenStable();
      const tooltip = host.debugElement.query(By.directive(UiTooltipDirective)).injector.get(UiTooltipDirective);
      expect(tooltip.icon()).toBe('fa-solid fa-lock');
      expect(tooltip.title()).toBe('Restricted');
    });

    describe('while disabled', () => {
      let host: ComponentFixture<DisabledTooltipHostComponent>;
      const tooltip = () => TestBed.inject(OverlayContainer).getContainerElement().querySelector('[data-testid="ui-tooltip"]');
      const hover = async (target: Element) => {
        target.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }));
        await vi.advanceTimersByTimeAsync(400);
      };

      beforeEach(async () => {
        host = TestBed.createComponent(DisabledTooltipHostComponent);
        document.body.appendChild(host.nativeElement);
        await host.whenStable();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      });

      afterEach(() => {
        host.destroy();
        TestBed.inject(OverlayContainer).ngOnDestroy();
        vi.clearAllTimers();
        vi.useRealTimers();
      });

      it('drops the forwarded tooltip and its description, and restores them once enabled', async () => {
        const inner = host.nativeElement.querySelector('lfx-ui-button button') as HTMLButtonElement;
        expect(inner.getAttribute('aria-describedby')).toBeNull();
        await hover(inner);
        expect(tooltip()).toBeNull();

        host.componentInstance.disabled.set(false);
        await host.whenStable();
        expect(inner.getAttribute('aria-describedby')).toBeTruthy();
      });

      it('leaves the tooltip on a wrapper around a disabled button working', async () => {
        const wrapper = host.nativeElement.querySelector('span') as HTMLElement;
        const describedBy = wrapper.getAttribute('aria-describedby');
        expect(document.getElementById(describedBy as string)?.textContent).toBe('Saving is off while offline');
        await hover(wrapper);
        expect(tooltip()?.textContent).toContain('Saving is off while offline');
      });
    });
  });
});

describe('UiButtonComponent menu', () => {
  const hosts: ComponentFixture<unknown>[] = [];
  const settle = async (host: ComponentFixture<unknown>): Promise<void> => {
    await host.whenStable();
    await vi.advanceTimersByTimeAsync(20);
  };
  // Tracked so afterEach destroys every host, even when an assertion fails first.
  const mount = async (template: string): Promise<ComponentFixture<MenuHostComponent>> => {
    TestBed.overrideComponent(MenuHostComponent, { set: { imports: [UiButtonComponent, UiMenuComponent, UiMenuItemComponent], template } });
    const host = TestBed.createComponent(MenuHostComponent);
    hosts.push(host);
    document.body.appendChild(host.nativeElement);
    await host.whenStable();
    return host;
  };

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));

  afterEach(() => {
    hosts.splice(0).forEach((host) => host.destroy());
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('makes the inner button the menu trigger and returns focus to it on Escape', async () => {
    const host = await mount(MENU_HOST_TEMPLATE);
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
  });

  it('opens no menu while loading, by click or ArrowDown', async () => {
    const host = await mount(MENU_HOST_TEMPLATE.replace('<lfx-ui-button ', '<lfx-ui-button [loading]="true" '));
    const inner = host.nativeElement.querySelector('lfx-ui-button button') as HTMLButtonElement;
    const container = TestBed.inject(OverlayContainer).getContainerElement();

    inner.click();
    await settle(host);
    expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();

    inner.focus();
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
    await settle(host);
    expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
  });

  it('closes an open menu when the button turns busy', async () => {
    const host = await mount(MENU_HOST_TEMPLATE.replace('<lfx-ui-button ', '<lfx-ui-button [loading]="busy()" '));
    const inner = host.nativeElement.querySelector('lfx-ui-button button') as HTMLButtonElement;
    const container = TestBed.inject(OverlayContainer).getContainerElement();

    inner.click();
    await settle(host);
    expect(container.querySelector('[data-testid="ui-menu"]')).not.toBeNull();
    expect(container.contains(document.activeElement)).toBe(true);

    host.componentInstance.busy.set(true);
    await settle(host);
    expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
    expect(inner.getAttribute('aria-expanded')).toBeNull();
    expect(document.activeElement).toBe(inner);
  });

  it('opens the menu from the start edge by default', async () => {
    const host = await mount(MENU_HOST_TEMPLATE);
    const trigger = host.debugElement.query(By.directive(CdkMenuTrigger)).injector.get(CdkMenuTrigger);
    expect(trigger.menuPosition[0]).toEqual({ originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' });
  });

  it('opens the menu from the end edge with menuAlign="end"', async () => {
    const host = await mount(MENU_HOST_TEMPLATE.replace('<lfx-ui-button ', '<lfx-ui-button menuAlign="end" '));
    const trigger = host.debugElement.query(By.directive(CdkMenuTrigger)).injector.get(CdkMenuTrigger);
    expect(trigger.menuPosition[0]).toEqual({ originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' });
  });

  it('adds no popup semantics without a menu', async () => {
    const plain = TestBed.createComponent(UiButtonComponent);
    await plain.whenStable();
    const inner = plain.nativeElement.querySelector('[data-testid="ui-button"]') as HTMLElement;
    expect(inner.getAttribute('aria-haspopup')).toBeNull();
    expect(inner.getAttribute('aria-expanded')).toBeNull();
  });
});
