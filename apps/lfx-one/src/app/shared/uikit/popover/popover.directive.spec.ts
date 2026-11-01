// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, inject, signal, TemplateRef, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPopoverPadding } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiButtonComponent } from '../button/button.component';
import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiModalComponent } from '../modal/modal.component';
import { UiModalService } from '../modal/modal.service';
import { UiOptionComponent } from '../select/option.component';
import { UiSelectComponent } from '../select/select.component';
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

const BUTTON_TEMPLATE = `
  <lfx-ui-button [popover]="panel" popoverLabel="Filters" [popoverWidth]="300" [loading]="busy()" icon="fa-light fa-filter">Filters</lfx-ui-button>
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

    it('ignores an Escape that something inside already handled', async () => {
      await open();
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      event.preventDefault();
      (container.querySelector('lfx-ui-button button') as HTMLElement).dispatchEvent(event);
      await settle();
      expect(panel()).not.toBeNull();
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
});
