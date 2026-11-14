// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiCommandGroup, UiCommandItem, UiCommandMenuConfig } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { UiCommandMenuComponent } from './command-menu.component';
import { UiCommandMenuService } from './command-menu.service';

const GROUPS: UiCommandGroup[] = [
  {
    label: 'Projects',
    items: [
      { value: 'kubernetes', label: 'Kubernetes', icon: 'fa-light fa-cube' },
      { value: 'envoy', label: 'Envoy', icon: 'fa-light fa-cube', disabled: true },
    ],
  },
  {
    label: 'Actions',
    items: [
      { value: 'committee', label: 'Create Committee', icon: 'fa-light fa-users', shortcut: ['C'] },
      { value: 'meeting', label: 'Schedule Meeting', keywords: ['calendar', 'call'], shortcut: ['⌘', 'M'] },
      { value: 'theme', label: 'Change Theme…' },
    ],
  },
];

describe('UiCommandMenuComponent and UiCommandMenuService', () => {
  let service: UiCommandMenuService;
  let app: ApplicationRef;
  let container: HTMLElement;
  let ref: DialogRef<UiCommandItem | undefined, UiCommandMenuComponent>;
  let result: { value: UiCommandItem | undefined; closed: boolean };

  const settle = async (): Promise<void> => {
    app.tick();
    await app.whenStable();
  };
  const open = async (config: UiCommandMenuConfig = { groups: GROUPS }): Promise<void> => {
    ref = service.open(config);
    result = { value: undefined, closed: false };
    ref.closed.subscribe((value) => (result = { value, closed: true }));
    await settle();
    // The dialog moves focus to its first tabbable element after the first render.
    await settle();
  };
  const input = (): HTMLInputElement => container.querySelector('[data-testid="ui-command-menu-input"]') as HTMLInputElement;
  const rows = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="ui-command-menu-item"]'));
  const labelOf = (row: HTMLElement): string => row.querySelector('[data-testid="ui-command-menu-item-label"]')?.textContent?.trim() ?? '';
  const labels = (): string[] => rows().map(labelOf);
  const groupLabels = (): string[] =>
    Array.from(container.querySelectorAll('[data-testid="ui-command-menu-group-label"]')).map((el) => el.textContent?.trim() ?? '');
  const activeLabel = (): string | undefined => labelOf(rows().find((row) => row.id === input().getAttribute('aria-activedescendant')) as HTMLElement);
  const type = async (text: string): Promise<void> => {
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const keyCodes: Record<string, number> = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, Home: 36 };
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { key, keyCode: keyCodes[key], bubbles: true, cancelable: true, ...init });
    input().dispatchEvent(event);
    await settle();
    return event;
  };

  beforeEach(() => {
    // jsdom has no layout, and no geometry, which the CDK needs to count the search field as tabbable.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    service = TestBed.inject(UiCommandMenuService);
    app = TestBed.inject(ApplicationRef);
    container = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('opens a modal dialog named by a hidden title, with the search field focused', async () => {
    await open();
    const dialog = container.querySelector('.cdk-dialog-container') as HTMLElement;
    const title = container.querySelector('[data-testid="ui-command-menu-title"]') as HTMLElement;

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).not.toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.textContent).toBe('Command menu');
    expect(title.className).toContain('sr-only');
    expect(document.activeElement).toBe(input());
  });

  it('takes a custom label and placeholder', async () => {
    await open({ groups: GROUPS, label: 'Jump to', placeholder: 'Search projects, people and actions…' });

    expect(container.querySelector('[data-testid="ui-command-menu-title"]')?.textContent).toBe('Jump to');
    expect(input().getAttribute('aria-label')).toBe('Jump to');
    expect(input().placeholder).toBe('Search projects, people and actions…');
  });

  it('is a combobox with a listbox of grouped options', async () => {
    await open();
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;

    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-autocomplete')).toBe('list');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-controls')).toBe(listbox.id);
    expect(groupLabels()).toEqual(['Projects', 'Actions']);
    const groups = Array.from(container.querySelectorAll('[role="group"]'));
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual(
      Array.from(container.querySelectorAll('[data-testid="ui-command-menu-group-label"]')).map((el) => el.id)
    );
    expect(rows().every((row) => row.getAttribute('role') === 'option')).toBe(true);
    expect(labels()).toEqual(['Kubernetes', 'Envoy', 'Create Committee', 'Schedule Meeting', 'Change Theme…']);
  });

  it('highlights the first row you can choose and announces it with aria-activedescendant', async () => {
    await open();

    expect(activeLabel()).toBe('Kubernetes');
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    expect(rows()[0].hasAttribute('data-highlighted')).toBe(true);
    expect(rows()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('shows the icon of a row, and a shortcut as one key per entry', async () => {
    await open();

    expect(rows()[2].querySelector('[data-testid="ui-command-menu-item-icon"] i')?.className).toContain('fa-users');
    expect(Array.from(rows()[3].querySelectorAll('kbd')).map((k) => k.textContent?.trim())).toEqual(expect.arrayContaining(['M']));
    expect(rows()[3].querySelectorAll('kbd').length).toBe(2);
    expect(rows()[4].querySelector('kbd')).toBeNull();
  });

  it('shows the Esc hint and the footer key hints', async () => {
    await open();

    expect(container.querySelector('[data-testid="ui-command-menu-search"] kbd')?.textContent).toContain('Esc');
    const footer = container.querySelector('[data-testid="ui-command-menu-footer"]') as HTMLElement;
    expect(footer.textContent).toContain('Open');
    expect(footer.textContent).toContain('Navigate');
    expect(footer.querySelectorAll('kbd').length).toBe(3);
  });

  it('filters by label and by keywords, and hides groups with no match', async () => {
    await open();

    await type('comm');
    expect(labels()).toEqual(['Create Committee']);
    expect(groupLabels()).toEqual(['Actions']);

    await type('CALENDAR');
    expect(labels()).toEqual(['Schedule Meeting']);

    await type('create comm');
    expect(labels()).toEqual(['Create Committee']);

    await type('comm create');
    expect(labels()).toEqual(['Create Committee']);
  });

  it('keeps a row on screen as the same element while the search narrows around it', async () => {
    await open();
    const meeting = rows().find((row) => labelOf(row) === 'Schedule Meeting');

    await type('e');
    await type('meeting');

    expect(rows()).toEqual([meeting]);
  });

  it('gives every label a native title, so a truncated one can still be read', async () => {
    await open();

    const titles = rows().map((row) => row.querySelector('[data-testid="ui-command-menu-item-label"]')?.getAttribute('title'));
    expect(titles).toEqual(labels());
  });

  it('numbers the rows across groups after filtering, so the ids follow what is on screen', async () => {
    await open();
    await type('e');

    const ids = rows().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(input().getAttribute('aria-activedescendant')).toBe(ids[0]);
  });

  it('resets the highlight to the first match when the search changes', async () => {
    await open();
    await press('ArrowDown');
    expect(activeLabel()).toBe('Create Committee');

    await type('ch');

    expect(labels()).toEqual(['Schedule Meeting', 'Change Theme…']);
    expect(activeLabel()).toBe('Schedule Meeting');
  });

  it('shows an empty state that names the search, and drops the listbox', async () => {
    await open();
    await type('zzz');

    expect(container.querySelector('[data-testid="ui-command-menu-empty"]')?.textContent).toContain('No results for “zzz”.');
    expect(container.querySelector('[data-testid="ui-command-menu-status"]')?.getAttribute('role')).toBe('status');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().hasAttribute('aria-controls')).toBe(false);
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);

    await type('');
    expect(container.querySelector('[data-testid="ui-command-menu-empty"]')).toBeNull();
    expect(labels().length).toBe(5);
  });

  it('says so when there are no commands at all', async () => {
    await open({ groups: [] });

    expect(container.querySelector('[data-testid="ui-command-menu-empty"]')?.textContent).toContain('No commands available.');
  });

  it('moves the highlight with the arrows, skipping a disabled row and wrapping at both ends', async () => {
    await open();

    await press('ArrowDown');
    expect(activeLabel()).toBe('Create Committee');
    await press('ArrowDown');
    expect(activeLabel()).toBe('Schedule Meeting');
    await press('ArrowDown');
    expect(activeLabel()).toBe('Change Theme…');
    await press('ArrowDown');
    expect(activeLabel()).toBe('Kubernetes');
    await press('ArrowUp');
    expect(activeLabel()).toBe('Change Theme…');
  });

  it('keeps focus in the search field while the highlight moves', async () => {
    await open();
    const event = await press('ArrowDown');

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it('leaves Home and End to the text cursor', async () => {
    await open();
    const event = await press('Home');

    expect(event.defaultPrevented).toBe(false);
    expect(activeLabel()).toBe('Kubernetes');
  });

  it('chooses the highlighted row with Enter and closes with it', async () => {
    await open();
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Enter');

    expect(result.closed).toBe(true);
    expect(result.value?.value).toBe('meeting');
    expect(container.querySelector('.cdk-dialog-container')).toBeNull();
  });

  it('does not choose on Enter while an IME composition is open', async () => {
    await open();
    await press('Enter', { isComposing: true });

    expect(result.closed).toBe(false);
  });

  it('does not choose on Enter that Safari reports with keyCode 229', async () => {
    await open();
    await press('Enter', { keyCode: 229 });

    expect(result.closed).toBe(false);
  });

  it('does not choose on a repeated Enter, such as the one that opened the palette', async () => {
    await open();
    const event = await press('Enter', { repeat: true });

    expect(event.defaultPrevented).toBe(true);
    expect(result.closed).toBe(false);
  });

  it('leaves the arrows to the IME candidate list while composing', async () => {
    await open();
    const event = await press('ArrowDown', { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(activeLabel()).toBe('Kubernetes');
  });

  it('keeps the palette open when Escape only cancels an IME composition', async () => {
    await open();
    const event = await press('Escape', { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(result.closed).toBe(false);
    expect(container.querySelector('.cdk-dialog-container')).not.toBeNull();
  });

  describe('scrolling the highlighted row into view', () => {
    // jsdom has no layout: the list spans 100–200, "Kubernetes" sits above it and "Change Theme…" below it.
    const boxes: Record<string, { top: number; bottom: number }> = { Kubernetes: { top: 40, bottom: 70 }, 'Change Theme…': { top: 230, bottom: 260 } };
    const scroller = (): HTMLElement => container.querySelector<HTMLElement>('.overflow-auto') as HTMLElement;

    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const box = this.classList.contains('overflow-auto') ? { top: 100, bottom: 200 } : (boxes[labelOf(this)] ?? { top: 120, bottom: 150 });
        return box as DOMRect;
      });
    });

    it('scrolls the list when a row is above it or below it', async () => {
      await open();
      expect(scroller().scrollTop).toBe(-60);

      scroller().scrollTop = 300;
      await press('ArrowUp');

      expect(labelOf(rows().at(-1) as HTMLElement)).toBe('Change Theme…');
      expect(scroller().scrollTop).toBe(360);
    });

    it('undoes the scale of the opening animation when measuring how far to scroll', async () => {
      // The list is laid out 100 tall but drawn at half scale, so the 20px the row is short of it is 40 layout pixels.
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        return (this.classList.contains('overflow-auto') ? { top: 100, bottom: 150, height: 50 } : { top: 120, bottom: 170 }) as DOMRect;
      });

      await open();

      expect(scroller().scrollTop).toBe(40);
    });

    it('scrolls to the highlight again when a search resets it', async () => {
      await open();
      await press('ArrowUp');
      scroller().scrollTop = 0;

      await type(' ');

      expect(activeLabel()).toBe('Kubernetes');
      expect(scroller().scrollTop).toBe(-60);
    });

    it('scrolls to the first row you can choose when disabled rows come first', async () => {
      boxes['On'] = { top: 10, bottom: 40 };
      await open({
        groups: [
          {
            label: 'Projects',
            items: [
              { value: 'off', label: 'Off', disabled: true },
              { value: 'on', label: 'On' },
            ],
          },
        ],
      });

      expect(scroller().scrollTop).toBe(-90);
    });
  });

  it('chooses a row on click and keeps focus in the search field until it closes', async () => {
    await open();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    rows()[3].dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());

    rows()[3].click();
    await settle();

    expect(result.value?.value).toBe('meeting');
  });

  it('leaves a press on the list scrollbar alone so the thumb can be dragged', async () => {
    await open();
    const list = container.querySelector('[data-testid="ui-command-menu-listbox"]')?.parentElement as HTMLElement;
    // jsdom has no layout, so give the list a width and press to the right of it, where a scrollbar sits.
    Object.defineProperty(list, 'clientWidth', { value: 300 });
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    Object.defineProperty(press, 'offsetX', { value: 310 });
    list.dispatchEvent(press);

    const inside = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    Object.defineProperty(inside, 'offsetX', { value: 100 });
    list.dispatchEvent(inside);

    expect(press.defaultPrevented).toBe(false);
    expect(inside.defaultPrevented).toBe(true);
  });

  it('outlines the highlighted row in forced colours, where the fill disappears', async () => {
    await open();

    expect(rows()[0].className).toContain('forced-colors:data-[highlighted]:outline');
  });

  it('ignores a click on a disabled row and an Enter with nothing to choose', async () => {
    await open();
    expect(rows()[1].getAttribute('aria-disabled')).toBe('true');
    rows()[1].click();
    await type('zzz');
    await press('Enter');

    expect(result.closed).toBe(false);
  });

  it('highlights the row under the pointer, but not a disabled one', async () => {
    await open();
    rows()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await settle();
    expect(activeLabel()).toBe('Schedule Meeting');

    rows()[1].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await settle();
    expect(activeLabel()).toBe('Schedule Meeting');
  });

  it('continues the arrows from the row the pointer highlighted', async () => {
    await open();
    rows()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await settle();
    await press('ArrowDown');

    expect(activeLabel()).toBe('Change Theme…');
  });

  it('closes with nothing on Escape', async () => {
    await open();
    await press('Escape');

    expect(result).toEqual({ value: undefined, closed: true });
  });

  it('closes with nothing on a backdrop click', async () => {
    await open();
    (container.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    await settle();

    expect(result.closed).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it('returns the palette already open instead of stacking a second one', async () => {
    await open();
    const again = service.open({ groups: [] });
    await settle();

    expect(again).toBe(ref);
    expect(container.querySelectorAll('.cdk-dialog-container').length).toBe(1);
  });

  it('opens again after it was closed', async () => {
    await open();
    await press('Escape');
    await open();

    expect(container.querySelectorAll('.cdk-dialog-container').length).toBe(1);
    expect(labels().length).toBe(5);
  });

  describe('shortcut', () => {
    let unbind: () => void;
    let onChoose: Mock<(item: UiCommandItem) => void>;

    const shortcut = async (init: KeyboardEventInit): Promise<KeyboardEvent> => {
      const event = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...init });
      document.body.dispatchEvent(event);
      await settle();
      return event;
    };

    beforeEach(() => {
      onChoose = vi.fn<(item: UiCommandItem) => void>();
      unbind = service.bindShortcut(() => ({ groups: GROUPS }), onChoose);
    });

    afterEach(() => unbind());

    it('opens with Ctrl K and closes with the same key', async () => {
      const event = await shortcut({ ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(container.querySelector('.cdk-dialog-container')).not.toBeNull();

      await shortcut({ ctrlKey: true });
      expect(container.querySelector('.cdk-dialog-container')).toBeNull();
    });

    it('hands the command chosen from a shortcut-opened palette to the callback, and nothing when dismissed', async () => {
      await shortcut({ ctrlKey: true });
      await press('Enter');

      expect(onChoose).toHaveBeenCalledTimes(1);
      expect(onChoose).toHaveBeenCalledWith(GROUPS[0].items[0]);

      await shortcut({ ctrlKey: true });
      await press('Escape');
      expect(onChoose).toHaveBeenCalledTimes(1);
    });

    it('leaves ⌘K alone off Apple platforms', async () => {
      const event = await shortcut({ metaKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(container.querySelector('.cdk-dialog-container')).toBeNull();
    });

    it('opens with ⌘K on an Apple platform and leaves Ctrl K to the text field', async () => {
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');

      const ctrl = await shortcut({ ctrlKey: true });
      expect(ctrl.defaultPrevented).toBe(false);
      expect(container.querySelector('.cdk-dialog-container')).toBeNull();

      const meta = await shortcut({ metaKey: true, key: 'K' });
      expect(meta.defaultPrevented).toBe(true);
      expect(container.querySelector('.cdk-dialog-container')).not.toBeNull();
    });

    it('prefers the platform from userAgentData over the deprecated navigator.platform', async () => {
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('');
      Object.defineProperty(window.navigator, 'userAgentData', { value: { platform: 'macOS' }, configurable: true });

      try {
        const ctrl = await shortcut({ ctrlKey: true });
        expect(ctrl.defaultPrevented).toBe(false);

        const meta = await shortcut({ metaKey: true });
        expect(meta.defaultPrevented).toBe(true);
      } finally {
        Reflect.deleteProperty(window.navigator, 'userAgentData');
      }
    });

    it('ignores a Safari composition key reported with keyCode 229', async () => {
      const event = await shortcut({ ctrlKey: true, keyCode: 229 });

      expect(event.defaultPrevented).toBe(false);
      expect(container.querySelector('.cdk-dialog-container')).toBeNull();
    });

    it('ignores a key that belongs to an IME composition', async () => {
      const event = await shortcut({ ctrlKey: true, isComposing: true });

      expect(event.defaultPrevented).toBe(false);
      expect(container.querySelector('.cdk-dialog-container')).toBeNull();
    });

    it('ignores a held key: it neither closes the open palette nor opens a closed one', async () => {
      const held = await shortcut({ ctrlKey: true, repeat: true });
      expect(held.defaultPrevented).toBe(true);
      expect(container.querySelector('.cdk-dialog-container')).toBeNull();

      await shortcut({ ctrlKey: true });
      await shortcut({ ctrlKey: true, repeat: true });
      expect(container.querySelector('.cdk-dialog-container')).not.toBeNull();
    });

    it('ignores K alone and other modifier chords', async () => {
      const plain = await shortcut({});
      await shortcut({ ctrlKey: true, shiftKey: true });
      await shortcut({ ctrlKey: true, altKey: true });

      expect(plain.defaultPrevented).toBe(false);
      expect(container.querySelector('.cdk-dialog-container')).toBeNull();
    });

    it('stops listening once unbound', async () => {
      unbind();
      await shortcut({ ctrlKey: true });

      expect(container.querySelector('.cdk-dialog-container')).toBeNull();
    });

    it('reads the commands at the moment it opens', async () => {
      unbind();
      let groups = GROUPS;
      unbind = service.bindShortcut(() => ({ groups }), onChoose);
      groups = [{ label: 'Late', items: [{ value: 'late', label: 'Added Later' }] }];
      await shortcut({ ctrlKey: true });

      expect(labels()).toEqual(['Added Later']);
    });
  });
});
