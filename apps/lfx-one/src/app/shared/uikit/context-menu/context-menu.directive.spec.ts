// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiContextMenuDirective } from './context-menu.directive';

const HOST_TEMPLATE = `
    <div
      id="outer"
      tabindex="0"
      [lfxUiContextMenu]="outerMenu"
      [lfxUiContextMenuDisabled]="outerDisabled()"
      (lfxUiContextMenuOpened)="log('opened')"
      (lfxUiContextMenuClosed)="log('closed')">
      <button id="inner" type="button">Inner button</button>
      <div id="nested" tabindex="0" [lfxUiContextMenu]="nestedMenu" [lfxUiContextMenuDisabled]="nestedDisabled()">Nested</div>
    </div>
    <ng-template #outerMenu>
      <lfx-ui-menu ariaLabel="Project actions">
        <lfx-ui-menu-item id="edit" (triggered)="log('edit')">Edit</lfx-ui-menu-item>
        <lfx-ui-menu-item id="duplicate">Duplicate</lfx-ui-menu-item>
      </lfx-ui-menu>
    </ng-template>
    <ng-template #nestedMenu>
      <lfx-ui-menu ariaLabel="Nested actions">
        <lfx-ui-menu-item id="nested-item">Nested action</lfx-ui-menu-item>
      </lfx-ui-menu>
    </ng-template>
  `;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  public readonly outerDisabled = signal(false);
  public readonly nestedDisabled = signal(false);
  public readonly events = signal<string[]>([]);

  public log(name: string): void {
    this.events.update((e) => [...e, name]);
  }
}

describe('UiContextMenuDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let container: HTMLElement;

  // `whenStable` waits on a timer, so under fake timers flush them instead.
  const settle = async (): Promise<void> => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await fixture.whenStable();
  };
  const el = (id: string): HTMLElement => fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
  const menus = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="ui-menu"]'));
  const item = (id: string): HTMLElement => container.querySelector(`#${id}`) as HTMLElement;
  // CDK menu reads `keyCode`, so the synthetic events carry it.
  const keyCodes: Record<string, number> = { ArrowDown: 40, Escape: 27, F10: 121, ContextMenu: 93, Enter: 13 };
  const key = async (target: Element, k: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { key: k, keyCode: keyCodes[k], bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    await settle();
    return event;
  };
  const rightClick = async (target: Element): Promise<MouseEvent> => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 80 });
    target.dispatchEvent(event);
    await settle();
    return event;
  };

  const pointer = (target: Element, type: string, init: PointerEventInit = {}): void => {
    target.dispatchEvent(
      new PointerEvent(type, { pointerType: 'touch', pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, clientX: 60, clientY: 50, ...init })
    );
  };
  // Records the `contextmenu` events that reach the host, capturing so the CDK handler cannot hide them.
  const spyContextMenu = (target: Element): MouseEvent[] => {
    const seen: MouseEvent[] = [];
    target.addEventListener('contextmenu', (e) => seen.push(e as MouseEvent), { capture: true });
    return seen;
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiContextMenuDirective, UiMenuComponent, UiMenuItemComponent], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    document.body.appendChild(fixture.nativeElement);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fixture.destroy();
    // The fixture host was moved out of TestBed's root, so TestBed does not remove it.
    fixture.nativeElement.remove();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('opens a named menu on right-click and replaces the browser menu', async () => {
    expect(menus().length).toBe(0);

    const event = await rightClick(el('outer'));

    expect(event.defaultPrevented).toBe(true);
    expect(menus().length).toBe(1);
    expect(menus()[0].getAttribute('role')).toBe('menu');
    expect(menus()[0].getAttribute('aria-label')).toBe('Project actions');
    expect(container.querySelectorAll('[role="menuitem"]').length).toBe(2);
  });

  it('opens from a right-click on something inside the host', async () => {
    await rightClick(el('inner'));

    expect(menus().length).toBe(1);
  });

  it('opens with Shift+F10 on the focused host and focuses the first item', async () => {
    el('outer').focus();
    const event = await key(el('outer'), 'F10', { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(menus().length).toBe(1);
    expect(document.activeElement).toBe(item('edit'));
  });

  it('opens with the context menu key', async () => {
    el('outer').focus();
    await key(el('outer'), 'ContextMenu');

    expect(menus().length).toBe(1);
    expect(document.activeElement).toBe(item('edit'));
  });

  it('opens from the keyboard when the focus is on something inside the host', async () => {
    el('inner').focus();
    await key(el('inner'), 'ContextMenu');

    expect(menus().length).toBe(1);
  });

  it('opens at the focused element, below its start edge', async () => {
    vi.spyOn(el('outer'), 'getBoundingClientRect').mockReturnValue({ left: 40, bottom: 96 } as DOMRect);
    const seen: MouseEvent[] = [];
    el('outer').addEventListener('contextmenu', (e) => seen.push(e), { capture: true });

    await key(el('outer'), 'ContextMenu');

    expect(seen.length).toBe(1);
    expect(seen[0].clientX).toBe(40);
    expect(seen[0].clientY).toBe(96);
    expect(seen[0].button).toBe(0);
  });

  it('ignores F10 without Shift and other keys', async () => {
    const f10 = await key(el('outer'), 'F10');
    const enter = await key(el('outer'), 'Enter');

    expect(menus().length).toBe(0);
    expect(f10.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('moves between items with the arrow keys and closes with Escape', async () => {
    el('outer').focus();
    await key(el('outer'), 'ContextMenu');

    await key(item('edit'), 'ArrowDown');
    expect(document.activeElement).toBe(item('duplicate'));

    await key(item('duplicate'), 'Escape');
    expect(menus().length).toBe(0);
    expect(document.activeElement).toBe(el('outer'));
  });

  it('returns focus to where it was when an item is chosen', async () => {
    el('inner').focus();
    await key(el('inner'), 'ContextMenu');
    item('edit').click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(el('inner'));
  });

  it('does not take focus back from a control clicked outside the menu', async () => {
    el('outer').focus();
    await key(el('outer'), 'ContextMenu');
    el('inner').focus();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();

    expect(menus().length).toBe(0);
    expect(document.activeElement).toBe(el('inner'));
  });

  it('emits triggered and closes when an item is chosen', async () => {
    await rightClick(el('outer'));
    item('edit').click();
    await fixture.whenStable();

    expect(fixture.componentInstance.events()).toEqual(['opened', 'edit', 'closed']);
    expect(menus().length).toBe(0);
  });

  it('closes on a click outside', async () => {
    await rightClick(el('outer'));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();

    expect(menus().length).toBe(0);
  });

  it('moves the open menu on a second right-click instead of stacking another', async () => {
    await rightClick(el('outer'));
    await rightClick(el('outer'));

    expect(menus().length).toBe(1);
  });

  it('leaves the browser menu and the keyboard alone while disabled', async () => {
    fixture.componentInstance.outerDisabled.set(true);
    await fixture.whenStable();

    const click = await rightClick(el('outer'));
    const shortcut = await key(el('outer'), 'F10', { shiftKey: true });

    expect(click.defaultPrevented).toBe(false);
    expect(shortcut.defaultPrevented).toBe(false);
    expect(menus().length).toBe(0);
  });

  it('opens only the innermost context menu, for the mouse and the keyboard', async () => {
    await rightClick(el('nested'));
    expect(menus().map((m) => m.getAttribute('aria-label'))).toEqual(['Nested actions']);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();

    el('nested').focus();
    await key(el('nested'), 'ContextMenu');
    expect(menus().map((m) => m.getAttribute('aria-label'))).toEqual(['Nested actions']);
  });

  it('lets the outer menu open when the inner one is disabled', async () => {
    fixture.componentInstance.nestedDisabled.set(true);
    await fixture.whenStable();

    el('nested').focus();
    await key(el('nested'), 'ContextMenu');

    // The inner directive steps aside and the outer host takes the key from its bubbled event.
    expect(menus().map((m) => m.getAttribute('aria-label'))).toEqual(['Project actions']);
  });
  describe('menu key on Windows', () => {
    it('cancels the browser menu that Chromium raises on keyup, once focus is in our menu', async () => {
      el('outer').focus();
      await key(el('outer'), 'ContextMenu');
      expect(document.activeElement).toBe(item('edit'));

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 });
      item('edit').dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the browser menu alone outside our menu', async () => {
      await rightClick(el('outer'));

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves the browser menu of another menu on the page alone while ours is open', async () => {
      const other = document.createElement('div');
      other.setAttribute('role', 'menu');
      document.body.appendChild(other);
      await rightClick(el('outer'));

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      other.dispatchEvent(event);
      other.remove();

      expect(event.defaultPrevented).toBe(false);
    });

    it('stops cancelling once the menu has closed', async () => {
      await rightClick(el('outer'));
      const stackId = item('edit').closest('[data-cdk-menu-stack-id]')?.getAttribute('data-cdk-menu-stack-id') ?? '';
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await fixture.whenStable();
      const stale = document.createElement('div');
      stale.setAttribute('data-cdk-menu-stack-id', stackId);
      document.body.appendChild(stale);

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      stale.dispatchEvent(event);
      stale.remove();

      expect(stackId).not.toBe('');
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('long press on a touch screen', () => {
    beforeEach(() => vi.useFakeTimers());

    it('opens the menu at the press point after about half a second', async () => {
      const seen = spyContextMenu(el('outer'));
      pointer(el('outer'), 'pointerdown');

      vi.advanceTimersByTime(499);
      expect(menus().length).toBe(0);

      vi.advanceTimersByTime(1);
      await settle();

      expect(menus().length).toBe(1);
      expect(seen[0].clientX).toBe(60);
      expect(seen[0].clientY).toBe(50);
      expect(menus()[0].getAttribute('aria-label')).toBe('Project actions');
    });

    it('does not open for a mouse or a pen', async () => {
      pointer(el('outer'), 'pointerdown', { pointerType: 'mouse' });
      pointer(el('outer'), 'pointerdown', { pointerType: 'pen' });

      vi.advanceTimersByTime(1000);
      await settle();

      expect(menus().length).toBe(0);
    });

    it('cancels when the finger lifts early, or the browser cancels the touch', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(300);
      pointer(el('outer'), 'pointerup');
      vi.advanceTimersByTime(1000);

      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(300);
      pointer(el('outer'), 'pointercancel');
      vi.advanceTimersByTime(1000);
      await settle();

      expect(menus().length).toBe(0);
    });

    it('cancels once the finger drifts past the tolerance, and ignores a small wobble', async () => {
      pointer(el('outer'), 'pointerdown');
      pointer(el('outer'), 'pointermove', { clientX: 66, clientY: 56 });
      vi.advanceTimersByTime(500);
      await settle();
      expect(menus().length).toBe(1);

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();

      pointer(el('outer'), 'pointerdown');
      pointer(el('outer'), 'pointermove', { clientX: 60, clientY: 62 });
      vi.advanceTimersByTime(1000);
      await settle();

      expect(menus().length).toBe(0);
    });

    it('ignores a finger that is not the first, even when the first is elsewhere', async () => {
      pointer(el('outer'), 'pointerdown', { pointerId: 2, isPrimary: false });

      vi.advanceTimersByTime(1000);
      await settle();

      expect(menus().length).toBe(0);
    });

    it('cancels when a second finger lands', async () => {
      pointer(el('outer'), 'pointerdown');
      pointer(el('outer'), 'pointerdown', { pointerId: 2, isPrimary: false });

      vi.advanceTimersByTime(1000);
      await settle();

      expect(menus().length).toBe(0);
    });

    it('does not open a second time when the browser raises its own contextmenu', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(300);
      await rightClick(el('outer'));
      vi.advanceTimersByTime(1000);
      await settle();

      expect(menus().length).toBe(1);
      expect(fixture.componentInstance.events()).toEqual(['opened']);
    });

    it('swallows the browser contextmenu that follows ours instead of closing and reopening the menu', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(500);
      await settle();
      const native = await rightClick(el('outer'));

      expect(native.defaultPrevented).toBe(true);
      expect(menus().length).toBe(1);
      expect(fixture.componentInstance.events()).toEqual(['opened']);
    });

    it('keeps the menu open when the browser sends a click as the finger lifts', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(500);
      await settle();
      pointer(el('outer'), 'pointerup');
      el('outer').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await settle();

      expect(menus().length).toBe(1);

      // Only that one click is swallowed: the next outside click closes the menu.
      el('outer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
      expect(menus().length).toBe(0);
    });

    it('stops expecting the release click after a moment', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(500);
      await settle();
      pointer(el('outer'), 'pointerup');
      vi.advanceTimersByTime(300);

      el('outer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();

      expect(menus().length).toBe(0);
    });

    it('keeps the menu open for the release click when the browser opened it first', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(300);
      await rightClick(el('outer'));
      pointer(el('outer'), 'pointerup');
      el('outer').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await settle();

      expect(menus().length).toBe(1);
    });

    it('lets a new tap through, even right after the release', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(500);
      await settle();
      pointer(el('outer'), 'pointerup');

      pointer(document.body, 'pointerdown', { pointerId: 3 });
      pointer(document.body, 'pointerup', { pointerId: 3 });
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();

      expect(menus().length).toBe(0);
    });

    it('treats a later right-click as a right-click again', async () => {
      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(500);
      await settle();
      pointer(el('outer'), 'pointerup');
      pointer(el('outer'), 'pointerdown', { pointerType: 'mouse' });
      await rightClick(el('outer'));

      expect(fixture.componentInstance.events()).toEqual(['opened', 'closed', 'opened']);
    });

    it('stays quiet while disabled', async () => {
      fixture.componentInstance.outerDisabled.set(true);
      await settle();

      pointer(el('outer'), 'pointerdown');
      vi.advanceTimersByTime(1000);
      await settle();

      expect(menus().length).toBe(0);
    });

    it('opens only the innermost menu, and the outer one when the inner is disabled', async () => {
      pointer(el('nested'), 'pointerdown');
      vi.advanceTimersByTime(500);
      await settle();
      expect(menus().map((m) => m.getAttribute('aria-label'))).toEqual(['Nested actions']);

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fixture.componentInstance.nestedDisabled.set(true);
      await settle();
      pointer(el('nested'), 'pointerdown');
      vi.advanceTimersByTime(500);
      await settle();

      expect(menus().map((m) => m.getAttribute('aria-label'))).toEqual(['Project actions']);
    });

    it('clears a pending press when the host is destroyed', () => {
      const host = el('outer');
      const dispatch = vi.spyOn(host, 'dispatchEvent');
      pointer(host, 'pointerdown');
      fixture.destroy();

      vi.advanceTimersByTime(1000);

      expect(dispatch.mock.calls.filter(([e]) => e.type === 'contextmenu').length).toBe(0);
    });
  });
});
