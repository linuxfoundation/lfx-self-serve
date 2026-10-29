// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiMenuGroupComponent } from './menu-group.component';
import { UiMenuItemComponent } from './menu-item.component';
import { UiMenuSeparatorComponent } from './menu-separator.component';
import { UiMenuComponent } from './menu.component';

const HOST_TEMPLATE = `
  <button id="trigger" [cdkMenuTriggerFor]="menu">Actions</button>
  <ng-template #menu>
    <lfx-ui-menu ariaLabel="Project actions">
      <lfx-ui-menu-item id="edit" icon="fa-light fa-pen-to-square" shortcut="⌘E" (triggered)="log('edit')">Edit</lfx-ui-menu-item>
      <lfx-ui-menu-item id="duplicate" (triggered)="log('duplicate')">Duplicate</lfx-ui-menu-item>
      <lfx-ui-menu-separator />
      <lfx-ui-menu-group label="Share">
        <lfx-ui-menu-item id="invite" (triggered)="log('invite')">Invite Members</lfx-ui-menu-item>
        <lfx-ui-menu-item id="transfer" [disabled]="true" (triggered)="log('transfer')">Transfer Ownership</lfx-ui-menu-item>
      </lfx-ui-menu-group>
      <lfx-ui-menu-separator />
      <lfx-ui-menu-item id="delete" variant="danger" trailingIcon="fa-light fa-trash-can" (triggered)="log('delete')">Delete Project</lfx-ui-menu-item>
    </lfx-ui-menu>
  </ng-template>
`;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  public readonly events = signal<string[]>([]);

  public log(name: string): void {
    this.events.update((e) => [...e, name]);
  }
}

describe('UiMenuComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let trigger: HTMLButtonElement;
  let container: HTMLElement;

  const menu = () => container.querySelector('[data-testid="ui-menu"]') as HTMLElement | null;
  const item = (id: string) => container.querySelector(`#${id}`) as HTMLElement;
  // CDK Menu reads `keyCode`, so the synthetic events carry it.
  const keyCodes: Record<string, number> = { ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Escape: 27, Enter: 13, ' ': 32, i: 73 };
  const key = (target: Element, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, keyCode: keyCodes[k], bubbles: true, cancelable: true }));
  const settle = async () => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  };
  const open = async () => {
    trigger.click();
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(TestHostComponent, {
      set: { imports: [CdkMenuTrigger, UiMenuComponent, UiMenuItemComponent, UiMenuGroupComponent, UiMenuSeparatorComponent], template: HOST_TEMPLATE },
    });
    fixture = TestBed.createComponent(TestHostComponent);
    document.body.appendChild(fixture.nativeElement);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    trigger = fixture.nativeElement.querySelector('#trigger');
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('opens from the trigger as a named menu with menuitem rows', async () => {
    expect(menu()).toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await open();

    expect(menu()?.getAttribute('role')).toBe('menu');
    expect(menu()?.getAttribute('aria-label')).toBe('Project actions');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[role="menuitem"]').length).toBe(5);
  });

  it('renders icon, shortcut, trailing icon and the danger variant', async () => {
    await open();

    expect(item('edit').querySelector('[data-testid="ui-menu-item-icon"] i')?.className).toContain('fa-pen-to-square');
    expect(item('edit').querySelector('kbd')?.textContent).toBe('⌘E');
    expect(item('delete').querySelector('[data-testid="ui-menu-item-trailing-icon"]')).not.toBeNull();
    expect(item('delete').className).toContain('text-ui-danger-700');
    expect(item('edit').className).toContain('text-ui-neutral-900');
    expect(item('edit').className).toContain('h-ui-menu-item');
  });

  it('draws separators and a labelled group', async () => {
    await open();

    expect(container.querySelectorAll('[role="separator"]').length).toBe(2);
    const group = container.querySelector('[role="group"]') as HTMLElement;
    const label = group.querySelector('[data-testid="ui-menu-group-label"]') as HTMLElement;
    expect(label.textContent).toBe('Share');
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
  });

  it('moves with the arrow keys and wraps; a disabled item stays reachable so its reason can be read', async () => {
    trigger.focus();
    key(trigger, 'ArrowDown');
    await settle();
    expect(document.activeElement).toBe(item('edit'));

    key(item('edit'), 'ArrowDown');
    expect(document.activeElement).toBe(item('duplicate'));
    key(item('duplicate'), 'ArrowDown');
    expect(document.activeElement).toBe(item('invite'));
    key(item('invite'), 'ArrowDown');
    expect(document.activeElement).toBe(item('transfer'));
    key(item('transfer'), 'ArrowDown');
    expect(document.activeElement).toBe(item('delete'));
    key(item('delete'), 'ArrowDown');
    expect(document.activeElement).toBe(item('edit'));
    key(item('edit'), 'ArrowUp');
    expect(document.activeElement).toBe(item('delete'));
  });

  it('jumps to the first and last items with Home and End', async () => {
    trigger.focus();
    key(trigger, 'ArrowDown');
    await settle();

    key(item('edit'), 'End');
    expect(document.activeElement).toBe(item('delete'));
    key(item('delete'), 'Home');
    expect(document.activeElement).toBe(item('edit'));
  });

  it('opens on ArrowUp with the last item focused', async () => {
    trigger.focus();
    key(trigger, 'ArrowUp');
    await settle();

    expect(document.activeElement).toBe(item('delete'));
  });

  it('jumps to the matching item with type-ahead', async () => {
    trigger.focus();
    key(trigger, 'ArrowDown');
    await settle();

    key(item('edit'), 'i');
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    expect(document.activeElement).toBe(item('invite'));
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    trigger.focus();
    key(trigger, 'ArrowDown');
    await settle();
    expect(menu()).not.toBeNull();

    key(item('edit'), 'Escape');
    await settle();

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('emits triggered and closes when an item is clicked', async () => {
    await open();
    item('duplicate').click();
    await settle();

    expect(fixture.componentInstance.events()).toEqual(['duplicate']);
    expect(menu()).toBeNull();
  });

  it('chooses the focused item with Enter and with Space', async () => {
    trigger.focus();
    key(trigger, 'ArrowDown');
    await settle();
    key(item('edit'), 'Enter');
    await settle();
    expect(fixture.componentInstance.events()).toEqual(['edit']);

    trigger.focus();
    key(trigger, 'ArrowDown');
    await settle();
    key(item('edit'), ' ');
    await settle();
    expect(fixture.componentInstance.events()).toEqual(['edit', 'edit']);
  });

  it('a disabled item is aria-disabled and does nothing when clicked', async () => {
    await open();

    expect(item('transfer').getAttribute('aria-disabled')).toBe('true');
    expect(item('transfer').className).toContain('aria-disabled:cursor-not-allowed');
    item('transfer').click();
    await settle();

    expect(fixture.componentInstance.events()).toEqual([]);
    expect(menu()).not.toBeNull();
  });

  it('closes when the user clicks outside', async () => {
    await open();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.body.click();
    await settle();

    expect(menu()).toBeNull();
  });
});
