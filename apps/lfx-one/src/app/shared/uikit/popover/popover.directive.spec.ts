// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ConnectedPosition, FlexibleConnectedPositionStrategy, OverlayContainer } from '@angular/cdk/overlay';
import { Component, inject, signal, TemplateRef, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UI_TOAST_PANE_CLASS } from '@lfx-one/shared/constants';
import { UiPopoverPadding } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiButtonComponent } from '../button/button.component';
import { UiComboboxComponent } from '../combobox/combobox.component';
import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiModalComponent } from '../modal/modal.component';
import { UiModalService } from '../modal/modal.service';
import { UiMultiSelectComponent } from '../multi-select/multi-select.component';
import { UiOptionComponent } from '../select/option.component';
import { UiSelectSlotDirective } from '../select/select-slot.directive';
import { UiSelectComponent } from '../select/select.component';
import { UiToastService } from '../toast/toast.service';
import { UiPopoverDirective } from './popover.directive';

// Set through overrideComponent because an inline template this long trips component-max-inline-declarations.
const HOST_TEMPLATE = `
  <button id="before" type="button">Before</button>
  <button id="trigger" type="button" #pop="lfxUiPopover" [lfxUiPopover]="panel" [lfxUiPopoverLabel]="label()" [lfxUiPopoverWidth]="width()" [(lfxUiPopoverOpen)]="isOpen">Filters</button>
  <button id="after" type="button">After</button>
  <div id="blank" tabindex="-1">Blank</div>
  <ng-template #panel let-close="close">
    <input id="first" aria-label="Search" />
    <button id="done" type="button" (click)="close()">Done</button>
  </ng-template>
`;

const SELECT_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <lfx-ui-select ariaLabel="Project" [(value)]="project">
      <lfx-ui-option value="cncf" label="CNCF" />
      <lfx-ui-option value="lfai" label="LF AI" />
    </lfx-ui-select>
  </ng-template>
`;

const SEARCH_SELECT_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <lfx-ui-select ariaLabel="Project" [(value)]="project">
      <input id="search" lfxUiSelectHeader type="search" aria-label="Search projects" />
      <lfx-ui-option value="cncf" label="CNCF" />
      <lfx-ui-option value="lfai" label="LF AI" />
    </lfx-ui-select>
  </ng-template>
`;

const MULTI_SELECT_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <lfx-ui-multi-select label="Projects">
      <lfx-ui-option value="cncf" label="CNCF" />
      <lfx-ui-option value="lfai" label="LF AI" />
    </lfx-ui-multi-select>
  </ng-template>
`;

const MULTI_SELECT_FIRST_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <lfx-ui-multi-select label="Projects">
      <lfx-ui-option value="cncf" label="CNCF" />
    </lfx-ui-multi-select>
    <button id="next" type="button">Apply</button>
  </ng-template>
`;

const COMBOBOX_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <lfx-ui-combobox ariaLabel="Project" [(value)]="project">
      <lfx-ui-option value="cncf" label="CNCF" />
      <lfx-ui-option value="lfai" label="LF AI" />
    </lfx-ui-combobox>
  </ng-template>
`;

const NESTED_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="outer">Outer</button>
  <ng-template #outer>
    <button id="inner-trigger" type="button" [lfxUiPopover]="inner">Inner</button>
    <button id="outer-last" type="button">Outer last</button>
  </ng-template>
  <ng-template #inner><input id="inner-first" aria-label="Search" /><button id="inner-last" type="button">Inner last</button></ng-template>
`;

const NESTED_LAST_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="outer">Outer</button>
  <ng-template #outer>
    <input id="outer-first" aria-label="Search" />
    <button id="inner-trigger" type="button" [lfxUiPopover]="inner">Inner</button>
  </ng-template>
  <ng-template #inner><button id="inner-last" type="button">Inner last</button></ng-template>
`;

const BUTTON_TEMPLATE = `
  <lfx-ui-button [popover]="panel" popoverLabel="Filters" [popoverWidth]="300" [loading]="busy()" icon="fa-light fa-filter">Filters</lfx-ui-button>
  <ng-template #panel><button id="inside" type="button">Inside</button></ng-template>
`;

const END_BUTTON_TEMPLATE = `
  <lfx-ui-button [popover]="panel" popoverAlign="end">Filters</lfx-ui-button>
  <ng-template #panel><button id="inside" type="button">Inside</button></ng-template>
`;

const CENTER_BUTTON_TEMPLATE = `
  <lfx-ui-button [popover]="panel" popoverAlign="center">Filters</lfx-ui-button>
  <ng-template #panel><button id="inside" type="button">Inside</button></ng-template>
`;

const MODAL_TEMPLATE = `
  <button id="opener" type="button" (click)="openModal(tpl)">Open</button>
  <ng-template #tpl>
    <lfx-ui-modal heading="Create Meeting">
      <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
    </lfx-ui-modal>
  </ng-template>
  <ng-template #panel><button id="first" type="button">First</button></ng-template>
`;

const MENU_IN_PANEL_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <lfx-ui-button [menu]="actions" ariaLabel="Actions">Actions</lfx-ui-button>
    <ng-template #actions>
      <lfx-ui-menu ariaLabel="Actions"><lfx-ui-menu-item>Edit</lfx-ui-menu-item></lfx-ui-menu>
    </ng-template>
  </ng-template>
`;

const MENU_MIDDLE_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <input id="first" aria-label="Search" />
    <lfx-ui-button [menu]="actions" ariaLabel="Actions">Actions</lfx-ui-button>
    <button id="done" type="button">Done</button>
    <ng-template #actions>
      <lfx-ui-menu ariaLabel="Actions"><lfx-ui-menu-item>Edit</lfx-ui-menu-item></lfx-ui-menu>
    </ng-template>
  </ng-template>
`;

const DISABLED_FIRST_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel><button id="off" type="button" disabled>Off</button><input id="first" aria-label="Search" /><button id="done" type="button">Done</button></ng-template>
`;

const DISABLED_LAST_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel><input id="first" aria-label="Search" /><button id="done" type="button">Done</button><button id="off" type="button" disabled>Off</button></ng-template>
`;

const RADIO_LAST_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel>
    <input id="first" aria-label="Search" />
    <input id="r1" type="radio" name="rsvp" aria-label="Going" />
    <input id="r2" type="radio" name="rsvp" aria-label="Maybe" [checked]="checked()" />
    <input id="r3" type="radio" name="rsvp" aria-label="Not going" />
  </ng-template>
`;

const MODAL_FROM_PANEL_TEMPLATE = `
  <button id="trigger" type="button" [lfxUiPopover]="panel">Filters</button>
  <ng-template #panel><button id="opener" type="button" (click)="openModal(tpl)">Open</button></ng-template>
  <ng-template #tpl><lfx-ui-modal heading="Create Meeting"><button id="inside-modal" type="button">Inside</button></lfx-ui-modal></ng-template>
`;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  private readonly modal = inject(UiModalService);

  public readonly label = signal('');
  public readonly width = signal<number | null>(null);
  public readonly isOpen = signal(false);
  public readonly project = signal<string | null>(null);
  public readonly busy = signal(false);
  public readonly checked = signal(true);
  public readonly padding = signal<UiPopoverPadding>('default');

  public openModal(template: TemplateRef<unknown>): void {
    this.modal.open(template);
  }
}

describe('UiPopoverDirective', () => {
  const fixtures: ComponentFixture<TestHostComponent>[] = [];
  let host: ComponentFixture<TestHostComponent>;
  let container: HTMLElement;

  const panel = () => container.querySelector('[data-testid="ui-popover-panel"]') as HTMLElement | null;
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const trigger = () => el('trigger');
  // Virtual time. Only the timers are faked, so the zoneless scheduler is not starved.
  const settle = async () => {
    await host.whenStable();
    await vi.advanceTimersByTimeAsync(20);
  };
  const mount = async (template: string, imports: Type<unknown>[] = []) => {
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiPopoverDirective, ...imports], template } });
    host = TestBed.createComponent(TestHostComponent);
    fixtures.push(host);
    document.body.appendChild(host.nativeElement);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    await host.whenStable();
  };
  const open = async () => {
    trigger().click();
    await settle();
  };
  const key = (target: Element, k: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // jsdom has no layout, so every element reads as hidden to the focusable check; give each one a box.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
  });

  afterEach(() => {
    fixtures.splice(0).forEach((fixture) => fixture.destroy());
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('trigger and panel', () => {
    beforeEach(async () => mount(HOST_TEMPLATE));

    it('marks the trigger as a dialog opener while closed', () => {
      expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
      expect(trigger().getAttribute('aria-expanded')).toBe('false');
      expect(trigger().getAttribute('aria-controls')).toBeNull();
      expect(panel()).toBeNull();
    });

    it('opens a non-modal dialog named by the trigger and linked by aria-controls', async () => {
      await open();

      expect(panel()?.getAttribute('role')).toBe('dialog');
      expect(panel()?.getAttribute('aria-modal')).toBeNull();
      expect(panel()?.getAttribute('aria-labelledby')).toBe(trigger().id);
      expect(panel()?.getAttribute('aria-label')).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('true');
      expect(trigger().getAttribute('aria-controls')).toBe(panel()?.id);
    });

    it('names the dialog from the label input instead of the trigger', async () => {
      host.componentInstance.label.set('Meeting filters');
      await open();

      expect(panel()?.getAttribute('aria-label')).toBe('Meeting filters');
      expect(panel()?.getAttribute('aria-labelledby')).toBeNull();
    });

    it('keeps an id the page already put on the trigger', async () => {
      await open();
      expect(trigger().id).toBe('trigger');
    });

    it('uses the Menu material and the pane carries the same radius', async () => {
      await open();

      expect(panel()?.className).toContain('rounded-ui-md');
      expect(panel()?.className).toContain('shadow-menu');
      expect(panel()?.className).toContain('bg-ui-background-100');
      expect(container.querySelector('.cdk-overlay-pane')?.classList.contains('rounded-ui-md')).toBe(true);
    });

    it('sizes to the content, or to the width input in px', async () => {
      await open();
      expect(panel()?.style.width).toBe('');

      host.componentInstance.width.set(300);
      await settle();
      expect(panel()?.style.width).toBe('300px');
    });

    it('moves focus to the first tabbable element on open', async () => {
      await open();
      expect(document.activeElement).toBe(el('first'));
    });

    it('toggles closed when the trigger is clicked again and keeps focus on it', async () => {
      await open();
      trigger().focus();
      trigger().click();
      await settle();

      expect(panel()).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger());
    });

    it('reports opening and closing through the two-way model and follows it', async () => {
      await open();
      expect(host.componentInstance.isOpen()).toBe(true);

      host.componentInstance.isOpen.set(false);
      await settle();
      expect(panel()).toBeNull();

      host.componentInstance.isOpen.set(true);
      await settle();
      expect(panel()).not.toBeNull();
    });

    it('closes from inside with the template close function and returns focus to the trigger', async () => {
      await open();
      el('done').focus();
      el('done').click();
      await settle();

      expect(panel()).toBeNull();
      expect(host.componentInstance.isOpen()).toBe(false);
      expect(document.activeElement).toBe(trigger());
    });
  });

  describe('dismissal', () => {
    beforeEach(async () => mount(HOST_TEMPLATE));

    it('closes on Escape and returns focus to the trigger', async () => {
      await open();
      const event = key(el('first'), 'Escape');
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores Escape while composing text', async () => {
      await open();
      key(el('first'), 'Escape', { isComposing: true });
      await settle();
      expect(panel()).not.toBeNull();
    });

    it('closes on a click outside and leaves focus on the control that took it', async () => {
      await open();
      el('after').focus();
      el('after').click();
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(el('after'));
    });

    it('returns focus to the trigger when the outside click focuses nothing', async () => {
      await open();
      (document.activeElement as HTMLElement).blur();
      el('blank').click();
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('stays open for a click inside the panel', async () => {
      await open();
      (panel() as HTMLElement).click();
      await settle();
      expect(panel()).not.toBeNull();
    });

    it('closes onto the trigger when Tab leaves the last field, and lets the browser continue from there', async () => {
      await open();
      el('done').focus();
      const event = key(el('done'), 'Tab');
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(false);
    });

    it('keeps Tab inside the panel between fields', async () => {
      await open();
      const event = key(el('first'), 'Tab');
      await settle();

      expect(panel()).not.toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });

    it('closes onto the trigger and stops there when Shift+Tab leaves the first field', async () => {
      await open();
      const event = key(el('first'), 'Tab', { shiftKey: true });
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(true);
    });

    it('closes onto the trigger with Shift+Tab from the bare panel', async () => {
      await open();
      (panel() as HTMLElement).focus();
      key(panel() as HTMLElement, 'Tab', { shiftKey: true });
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('removes the overlay when the host is destroyed', async () => {
      await open();
      host.destroy();
      expect(panel()).toBeNull();
    });
  });

  describe('inside a modal', () => {
    beforeEach(async () => mount(MODAL_TEMPLATE, [UiModalComponent]));

    it('closes on the first Escape and leaves the modal for the second', async () => {
      el('opener').click();
      await settle();
      expect(container.querySelector('[data-testid="ui-modal"]')).not.toBeNull();

      await open();
      expect(panel()).not.toBeNull();

      key(el('first'), 'Escape');
      await settle();
      expect(panel()).toBeNull();
      expect(container.querySelector('[data-testid="ui-modal"]')).not.toBeNull();
      expect(document.activeElement).toBe(trigger());

      key(trigger(), 'Escape');
      await settle();
      expect(container.querySelector('[data-testid="ui-modal"]')).toBeNull();
    });
  });

  describe('with a toast on screen', () => {
    beforeEach(async () => mount(HOST_TEMPLATE));

    it('stays open for a click on the toast', async () => {
      const toast = TestBed.inject(UiToastService);
      await host.whenStable();
      toast.show({ message: 'Saved' });
      await settle();
      await open();

      const message = container.querySelector(`.${UI_TOAST_PANE_CLASS} [data-testid="ui-toast-message"]`) as HTMLElement;
      expect(message).not.toBeNull();
      message.click();
      await settle();

      expect(panel()).not.toBeNull();
    });
  });

  describe('with a modal opened from the panel', () => {
    beforeEach(async () => mount(MODAL_FROM_PANEL_TEMPLATE, [UiModalComponent]));

    it('stays open for a click inside the modal and closes for a click outside both', async () => {
      await open();
      el('opener').click();
      await settle();
      expect(container.querySelector('[data-testid="ui-modal"]')).not.toBeNull();

      el('inside-modal').click();
      await settle();
      expect(panel()).not.toBeNull();

      container.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
      await settle();
      expect(panel()).not.toBeNull();

      el('trigger').parentElement?.click();
      await settle();
      expect(panel()).toBeNull();
    });
  });

  describe('with a menu inside', () => {
    beforeEach(async () => mount(MENU_IN_PANEL_TEMPLATE, [UiButtonComponent, UiMenuComponent, UiMenuItemComponent]));

    it('closes only the menu on the first Escape, then the popover on the second', async () => {
      await open();
      (container.querySelector('lfx-ui-button button') as HTMLElement).click();
      await settle();
      expect(container.querySelector('[data-testid="ui-menu"]')).not.toBeNull();

      // CDK Menu reads `keyCode`, so the synthetic event carries it.
      key(document.activeElement as Element, 'Escape', { keyCode: 27 });
      await settle();
      expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
      expect(panel()).not.toBeNull();

      key(document.activeElement as Element, 'Escape', { keyCode: 27 });
      await settle();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('Tab from an open menu, with its button as the last field, closes the menu and the popover onto the host', async () => {
      await open();
      (container.querySelector('lfx-ui-button button') as HTMLElement).click();
      await settle();
      const item = container.querySelector('[data-testid="ui-menu"] [role="menuitem"]') as HTMLElement;
      item.focus();
      expect(document.activeElement).toBe(item);

      // CDK Menu reads `keyCode`, so the synthetic event carries it.
      const event = key(item, 'Tab', { keyCode: 9 });
      await settle();

      expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(false);
    });

    it('Shift+Tab from an open menu, with its button as the first field, stops on the button and keeps the popover open', async () => {
      await open();
      const button = container.querySelector('lfx-ui-button button') as HTMLElement;
      button.click();
      await settle();
      const item = container.querySelector('[data-testid="ui-menu"] [role="menuitem"]') as HTMLElement;
      item.focus();

      const event = key(item, 'Tab', { keyCode: 9, shiftKey: true });
      await settle();

      expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(button);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores an Escape that something inside already handled', async () => {
      await open();
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      event.preventDefault();
      (container.querySelector('lfx-ui-button button') as HTMLElement).dispatchEvent(event);
      await settle();
      expect(panel()).not.toBeNull();
    });
  });

  describe('with a menu between other fields', () => {
    beforeEach(async () => mount(MENU_MIDDLE_TEMPLATE, [UiButtonComponent, UiMenuComponent, UiMenuItemComponent]));

    const focusItem = async () => {
      await open();
      (container.querySelector('lfx-ui-button button') as HTMLElement).click();
      await settle();
      const item = container.querySelector('[data-testid="ui-menu"] [role="menuitem"]') as HTMLElement;
      item.focus();
      return item;
    };

    it('Shift+Tab from an open menu stops on its button and keeps the popover open', async () => {
      const item = await focusItem();

      const event = key(item, 'Tab', { keyCode: 9, shiftKey: true });
      await settle();

      expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(container.querySelector('lfx-ui-button button'));
      expect(event.defaultPrevented).toBe(true);
    });

    it('Tab from an open menu closes only the menu and lets the browser move on from its button', async () => {
      const item = await focusItem();

      const event = key(item, 'Tab', { keyCode: 9 });
      await settle();

      expect(container.querySelector('[data-testid="ui-menu"]')).toBeNull();
      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(container.querySelector('lfx-ui-button button'));
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('tab stops', () => {
    it('skips a disabled first button: focus starts on the first field and Shift+Tab from it leaves', async () => {
      await mount(DISABLED_FIRST_TEMPLATE);
      await open();
      expect(document.activeElement).toBe(el('first'));

      const event = key(el('first'), 'Tab', { shiftKey: true });
      await settle();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves from the last enabled button when a disabled one follows it', async () => {
      await mount(DISABLED_LAST_TEMPLATE);
      await open();
      el('done').focus();
      key(el('done'), 'Tab');
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('counts a trailing radio group as one stop: Tab from its checked radio leaves', async () => {
      await mount(RADIO_LAST_TEMPLATE);
      await open();
      el('first').focus();
      key(el('first'), 'Tab');
      await settle();
      expect(panel()).not.toBeNull();

      el('r2').focus();
      key(el('r2'), 'Tab');
      await settle();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('counts the first radio of a group with none checked', async () => {
      await mount(RADIO_LAST_TEMPLATE);
      host.componentInstance.checked.set(false);
      await open();
      el('r1').focus();
      key(el('r1'), 'Tab');
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });
  });

  describe('focus leaving the panel', () => {
    beforeEach(async () => mount(HOST_TEMPLATE));

    it('closes onto the trigger when a Tab sends focus nowhere', async () => {
      await open();
      // jsdom reports no focus once the only focused element has blurred; a browser window that is still active reports it.
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      key(el('first'), 'Tab');
      el('first').blur();
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('stays open when focus goes nowhere without a Tab, as when the focused control is removed', async () => {
      await open();
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      el('first').blur();
      await settle();
      expect(panel()).not.toBeNull();
    });

    it('stays open when the window itself lost focus', async () => {
      await open();
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      key(el('first'), 'Tab');
      el('first').blur();
      await settle();
      expect(panel()).not.toBeNull();
    });

    it('closes and leaves focus where it went when it moves to a control outside', async () => {
      await open();
      el('after').focus();
      await settle();

      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(el('after'));
    });

    it('stays open when focus moves to the trigger, which toggles it by click', async () => {
      await open();
      trigger().focus();
      await settle();
      expect(panel()).not.toBeNull();
    });

    it('stays open when focus moves into an overlay pane opened from the panel', async () => {
      await open();
      const pane = document.createElement('div');
      pane.className = 'cdk-overlay-pane';
      pane.innerHTML = '<button id="in-pane" type="button">Pane</button>';
      container.appendChild(pane);
      el('in-pane').focus();
      await settle();
      expect(panel()).not.toBeNull();
    });
  });

  describe('padding', () => {
    beforeEach(async () =>
      mount(`<button id="trigger" type="button" [lfxUiPopover]="panel" [lfxUiPopoverPadding]="padding()">Info</button><ng-template #panel>Text</ng-template>`)
    );

    it('pads the panel by 16px, and not at all with none', async () => {
      await open();
      expect(panel()?.classList.contains('p-[16px]')).toBe(true);

      host.componentInstance.padding.set('none');
      await settle();
      expect(panel()?.classList.contains('p-[16px]')).toBe(false);
    });
  });

  describe('with nothing tabbable inside', () => {
    it('moves focus to the panel itself', async () => {
      await mount(`<button id="trigger" type="button" [lfxUiPopover]="panel">Info</button><ng-template #panel><p>Read only</p></ng-template>`);
      await open();
      expect(document.activeElement).toBe(panel());
    });
  });

  describe('without a template', () => {
    it('is a plain element with no popup semantics', async () => {
      await mount(`<button id="trigger" type="button" [lfxUiPopover]="null">Plain</button>`);
      trigger().click();
      await settle();

      expect(trigger().getAttribute('aria-haspopup')).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBeNull();
      expect(panel()).toBeNull();
    });
  });

  describe('with a select inside', () => {
    beforeEach(async () => mount(SELECT_TEMPLATE, [UiSelectComponent, UiOptionComponent]));

    it('keeps the popover open while a list opened from it is used', async () => {
      await open();
      (container.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement).click();
      await settle();
      const row = container.querySelector('[role="option"]') as HTMLElement;
      expect(row).not.toBeNull();

      row.click();
      await settle();

      expect(host.componentInstance.project()).toBe('cncf');
      expect(panel()).not.toBeNull();
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    });

    it('Tab from a Select trigger with its list open, as the last field, closes onto the host', async () => {
      await open();
      const select = container.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement;
      select.click();
      select.focus();
      await settle();
      expect(container.querySelector('[role="listbox"]')).not.toBeNull();

      const event = key(select, 'Tab');
      await settle();

      expect(container.querySelector('[role="listbox"]')).toBeNull();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(false);
    });

    it('Shift+Tab from a first-field Select with its list open closes the list and the popover onto the host', async () => {
      await open();
      const select = container.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement;
      select.click();
      select.focus();
      await settle();
      expect(container.querySelector('[role="listbox"]')).not.toBeNull();

      const event = key(select, 'Tab', { shiftKey: true });
      await settle();

      expect(container.querySelector('[role="listbox"]')).toBeNull();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(true);
    });

    it('closes only the list on Escape, then the popover on the next Escape', async () => {
      await open();
      const select = container.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement;
      select.click();
      await settle();

      key(select, 'Escape');
      await settle();
      expect(container.querySelector('[role="listbox"]')).toBeNull();
      expect(panel()).not.toBeNull();

      key(select, 'Escape');
      await settle();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });
  });

  describe('with a select search field inside', () => {
    beforeEach(async () => mount(SEARCH_SELECT_TEMPLATE, [UiSelectComponent, UiOptionComponent, UiSelectSlotDirective]));

    const openSearch = async () => {
      await open();
      (container.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement).click();
      await settle();
      el('search').focus();
      expect(document.activeElement).toBe(el('search'));
    };

    it('Tab from the search field, with the Select as the last field, closes the list and the popover onto the host', async () => {
      await openSearch();

      const event = key(el('search'), 'Tab');
      await settle();

      expect(container.querySelector('[role="listbox"]')).toBeNull();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(false);
    });

    it('Shift+Tab from the search field stops on the Select trigger and keeps the popover open', async () => {
      await openSearch();

      const event = key(el('search'), 'Tab', { shiftKey: true });
      await settle();

      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(container.querySelector('[data-testid="ui-select-trigger"]'));
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('with a multi-select inside', () => {
    beforeEach(async () => mount(MULTI_SELECT_TEMPLATE, [UiMultiSelectComponent, UiOptionComponent]));

    const focusRow = async () => {
      await open();
      (container.querySelector('[data-testid="ui-multi-select-trigger"]') as HTMLElement).click();
      await settle();
      const box = container.querySelector('[data-testid="ui-multi-select-panel"] input[type="checkbox"]') as HTMLElement;
      box.focus();
      expect(document.activeElement).toBe(box);
      return box;
    };

    it('Tab from an open list, with the MultiSelect as the only field, closes the list and the popover onto the host', async () => {
      const box = await focusRow();

      const event = key(box, 'Tab');
      await settle();

      expect(container.querySelector('[data-testid="ui-multi-select-panel"]')).toBeNull();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(false);
    });

    it('Shift+Tab from an open list stops on the MultiSelect trigger and keeps the popover open', async () => {
      const box = await focusRow();

      const event = key(box, 'Tab', { shiftKey: true });
      await settle();

      expect(container.querySelector('[data-testid="ui-multi-select-panel"]')).toBeNull();
      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(container.querySelector('[data-testid="ui-multi-select-trigger"]'));
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('with a multi-select before another field', () => {
    beforeEach(async () => mount(MULTI_SELECT_FIRST_TEMPLATE, [UiMultiSelectComponent, UiOptionComponent]));

    it('Tab from an open list closes only the list, and the popover stays open as focus moves to the next field', async () => {
      await open();
      const select = container.querySelector('[data-testid="ui-multi-select-trigger"]') as HTMLElement;
      select.click();
      await settle();
      const box = container.querySelector('[data-testid="ui-multi-select-panel"] input[type="checkbox"]') as HTMLElement;
      box.focus();

      const event = key(box, 'Tab');
      await settle();
      expect(container.querySelector('[data-testid="ui-multi-select-panel"]')).toBeNull();
      expect(document.activeElement).toBe(select);
      expect(event.defaultPrevented).toBe(false);

      // jsdom does not move focus on Tab, so make the browser's move from the trigger to the next field.
      el('next').focus();
      await settle();
      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(el('next'));
    });
  });

  describe('with a combobox inside', () => {
    beforeEach(async () => mount(COMBOBOX_TEMPLATE, [UiComboboxComponent, UiOptionComponent]));

    it('Tab from an open Combobox, as the last field, closes the list and the popover onto the host', async () => {
      await open();
      const field = container.querySelector('[data-testid="ui-combobox-input"]') as HTMLElement;
      field.focus();
      field.click();
      await settle();
      expect(container.querySelector('[role="listbox"]')).not.toBeNull();

      const event = key(field, 'Tab');
      await settle();

      expect(container.querySelector('[role="listbox"]')).toBeNull();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('with a popover inside', () => {
    beforeEach(async () => mount(NESTED_TEMPLATE));

    it('closes only the inner popover when Tab leaves its last field', async () => {
      await open();
      el('inner-trigger').click();
      await settle();
      expect(container.querySelectorAll('[data-testid="ui-popover-panel"]').length).toBe(2);
      el('inner-last').focus();

      key(el('inner-last'), 'Tab');
      await settle();

      expect(container.querySelectorAll('[data-testid="ui-popover-panel"]').length).toBe(1);
      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(el('inner-trigger'));
    });
  });

  describe('with a popover inside as the last field', () => {
    beforeEach(async () => mount(NESTED_LAST_TEMPLATE));

    it('Tab from the inner last field closes both popovers onto the outer host', async () => {
      await open();
      el('inner-trigger').click();
      await settle();
      expect(container.querySelectorAll('[data-testid="ui-popover-panel"]').length).toBe(2);
      el('inner-last').focus();

      const event = key(el('inner-last'), 'Tab');
      await settle();

      expect(container.querySelectorAll('[data-testid="ui-popover-panel"]').length).toBe(0);
      expect(document.activeElement).toBe(trigger());
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('on lfx-ui-button', () => {
    const inner = () => host.nativeElement.querySelector('lfx-ui-button button') as HTMLButtonElement;

    beforeEach(async () => mount(BUTTON_TEMPLATE, [UiButtonComponent]));

    it('forwards the popover to the inner button, where ARIA and focus land', async () => {
      expect(inner().getAttribute('aria-haspopup')).toBe('dialog');
      expect(inner().getAttribute('aria-expanded')).toBe('false');

      inner().click();
      await settle();

      expect(panel()?.getAttribute('aria-label')).toBe('Filters');
      expect(panel()?.style.width).toBe('300px');
      expect(inner().getAttribute('aria-expanded')).toBe('true');
      expect(inner().getAttribute('aria-controls')).toBe(panel()?.id);
      expect(document.activeElement).toBe(el('inside'));

      key(el('inside'), 'Escape');
      await settle();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(inner());
    });

    it('opens nothing while the button is busy and closes an open popover when it turns busy', async () => {
      inner().click();
      await settle();
      expect(panel()).not.toBeNull();

      host.componentInstance.busy.set(true);
      await settle();
      expect(panel()).toBeNull();
      expect(inner().getAttribute('aria-haspopup')).toBeNull();

      inner().click();
      await settle();
      expect(panel()).toBeNull();
    });

    it('stays closed when the button stops being busy', async () => {
      inner().click();
      await settle();
      host.componentInstance.busy.set(true);
      await settle();

      host.componentInstance.busy.set(false);
      await settle();
      expect(panel()).toBeNull();
      expect(inner().getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('alignment', () => {
    const firstPosition = async (template: string): Promise<ConnectedPosition | undefined> => {
      const spy = vi.spyOn(FlexibleConnectedPositionStrategy.prototype, 'withPositions');
      await mount(template, [UiButtonComponent]);
      (host.nativeElement.querySelector('lfx-ui-button button') as HTMLButtonElement).click();
      await settle();
      return spy.mock.calls.at(-1)?.[0][0];
    };

    it('lines the panel up with the start edge by default', async () => {
      expect(await firstPosition(BUTTON_TEMPLATE)).toMatchObject({ originX: 'start', overlayX: 'start', originY: 'bottom' });
    });

    it('tries the end edge first with popoverAlign="end"', async () => {
      expect(await firstPosition(END_BUTTON_TEMPLATE)).toMatchObject({ originX: 'end', overlayX: 'end', originY: 'bottom' });
    });

    it('centers the panel first with popoverAlign="center"', async () => {
      expect(await firstPosition(CENTER_BUTTON_TEMPLATE)).toMatchObject({ originX: 'center', overlayX: 'center', originY: 'bottom' });
    });
  });
});
