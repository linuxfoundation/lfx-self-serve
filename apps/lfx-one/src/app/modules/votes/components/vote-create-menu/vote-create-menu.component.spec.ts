// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, type Provider } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { VOTE_METHOD_OPTIONS } from '@lfx-one/shared/constants';
import { PollType } from '@lfx-one/shared/enums';
import type { VoteCreateMenuRow } from '@lfx-one/shared/interfaces';
import type { MenuItem } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteCreateMenuComponent } from './vote-create-menu.component';

/**
 * Mirrors `meeting-create-menu.component.spec.ts`: the rows are pinned to the method they emit, and
 * the right-edge alignment is exercised through `onShow()` with a stubbed panel, since jsdom lays
 * nothing out.
 */
describe('VoteCreateMenuComponent', () => {
  let fixture: ComponentFixture<VoteCreateMenuComponent>;
  let emitted: PollType[];

  /** Matches `viewportGutter` in the component. */
  const GUTTER = 8;
  const PANEL_WIDTH = 352;

  let viewportWidth = 1200;
  let clientWidthDescriptor: PropertyDescriptor | undefined;

  const menuItems = (): MenuItem[] => fixture.componentInstance['menuItems'];
  const rows = (): (MenuItem & Partial<VoteCreateMenuRow>)[] => menuItems()[0].items ?? [];

  const stubPanel = (): HTMLElement => {
    const panel = document.createElement('div');
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: PANEL_WIDTH });
    return panel;
  };

  const triggerAt = (left: number, width: number): HTMLElement => {
    const trigger = document.createElement('button');
    trigger.getBoundingClientRect = (): DOMRect =>
      ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    return trigger;
  };

  const mount = async (providers: Provider[] = []): Promise<void> => {
    if (providers.length) {
      TestBed.configureTestingModule({ providers });
    }
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(VoteCreateMenuComponent);
    emitted = [];
    fixture.componentInstance.methodSelected.subscribe((pollType) => emitted.push(pollType));
    fixture.detectChanges();
  };

  const showAgainst = (trigger: HTMLElement, panel: HTMLElement | null): void => {
    const menu = fixture.componentInstance['menu']()!;
    vi.spyOn(menu, 'toggle').mockImplementation(() => undefined);
    vi.spyOn(menu, 'overlayElement').mockReturnValue(panel);
    fixture.componentInstance.toggle({ currentTarget: trigger, target: trigger } as unknown as Event);
    fixture.componentInstance['onShow']();
  };

  beforeEach(() => {
    viewportWidth = 1200;
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => viewportWidth });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (clientWidthDescriptor) {
      Object.defineProperty(document.documentElement, 'clientWidth', clientWidthDescriptor);
    } else {
      Reflect.deleteProperty(document.documentElement, 'clientWidth');
    }
  });

  describe('menu model', () => {
    it('lists one row per voting method under a single "Vote type" heading', async () => {
      await mount();

      expect(menuItems()).toHaveLength(1);
      expect(menuItems()[0].label).toBe('Vote type');
      expect(rows().map((row) => row.testId)).toEqual(VOTE_METHOD_OPTIONS.map((option) => `vote-create-method-${option.value}`));
      expect(rows().map((row) => row.label)).toEqual(['Plurality vote', 'Condorcet IRV']);
    });

    it('shares each method’s description and icon with the form’s Voting Method select', async () => {
      await mount();

      expect(rows().map((row) => row.description)).toEqual(VOTE_METHOD_OPTIONS.map((option) => option.description));
      expect(rows().map((row) => row.icon)).toEqual(VOTE_METHOD_OPTIONS.map((option) => option.icon));
    });

    it('emits both available voting methods', async () => {
      await mount();

      rows()[1].command!({});
      rows()[0].command!({});

      expect(rows()[1].disabled).not.toBe(true);
      expect(rows()[0].disabled).not.toBe(true);
      expect(emitted).toEqual([PollType.CONDORCET_IRV, PollType.GENERIC]);
    });
  });

  describe('open state', () => {
    it('follows onShow and onHide, for the trigger’s aria-expanded', async () => {
      await mount();
      expect(fixture.componentInstance.isOpen()).toBe(false);

      fixture.componentInstance['onShow']();
      expect(fixture.componentInstance.isOpen()).toBe(true);

      fixture.componentInstance['onHide']();
      expect(fixture.componentInstance.isOpen()).toBe(false);
    });
  });

  describe('panel alignment', () => {
    it("lines the panel's right edge up with the trigger's", async () => {
      await mount();
      const panel = stubPanel();

      showAgainst(triggerAt(700, 100), panel);

      expect(panel.style.left).toBe('448px');
    });

    it('keeps the panel inside the gutter at either viewport edge', async () => {
      await mount();
      const rightPanel = stubPanel();
      const leftPanel = stubPanel();

      showAgainst(triggerAt(1158, 40), rightPanel);
      showAgainst(triggerAt(20, 60), leftPanel);

      expect(rightPanel.style.left).toBe(`${viewportWidth - PANEL_WIDTH - GUTTER}px`);
      expect(leftPanel.style.left).toBe(`${GUTTER}px`);
    });

    it('never asks for a frame on the server, where there is no panel to measure', async () => {
      await mount([{ provide: PLATFORM_ID, useValue: 'server' }]);
      const panel = stubPanel();
      const framesBefore = vi.mocked(window.requestAnimationFrame).mock.calls.length;

      showAgainst(triggerAt(700, 100), panel);

      expect(vi.mocked(window.requestAnimationFrame).mock.calls).toHaveLength(framesBefore);
      expect(panel.style.left).toBe('');
    });
  });

  /** Drives the real panel, as the meeting menu's spec does — see its notes on the frame stub and `menuRef`. */
  describe('reaching a row through the rendered panel', () => {
    beforeEach(() => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        setTimeout(() => callback(0), 0);
        return 0;
      });
    });

    const openPanel = async (): Promise<HTMLElement> => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);

      fixture.componentInstance.toggle({ currentTarget: trigger, target: trigger } as unknown as Event);
      const menu = fixture.componentInstance['menu']()!['menuRef']()!;
      menu['cd'].detectChanges();
      await fixture.whenStable();

      return menu.containerViewChild!.nativeElement;
    };

    const rowIn = (panel: HTMLElement, testId: string): HTMLElement => panel.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;

    it('enables Condorcet without coming-soon copy and activates it with a click', async () => {
      await mount([provideNoopAnimations()]);
      const panel = await openPanel();
      const condorcet = rowIn(panel, 'vote-create-method-condorcet_irv') as HTMLButtonElement;

      expect(condorcet.disabled).toBe(false);
      expect(condorcet.textContent).not.toContain('Coming soon');
      expect(condorcet.closest('li')?.getAttribute('aria-disabled')).not.toBe('true');
      condorcet.click();
      expect(emitted).toEqual([PollType.CONDORCET_IRV]);
    });

    it('activates the Condorcet row with Enter', async () => {
      await mount([provideNoopAnimations()]);
      const panel = await openPanel();
      const menu = fixture.componentInstance['menu']()!['menuRef']()!;

      menu.focusedOptionIndex.set(rowIn(panel, 'vote-create-method-condorcet_irv').closest('li')!.id);
      await fixture.whenStable();
      menu.onEnterKey(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(emitted).toEqual([PollType.CONDORCET_IRV]);
    });

    it('emits the method when the focused row is chosen with Enter', async () => {
      await mount([provideNoopAnimations()]);
      const panel = await openPanel();
      const menu = fixture.componentInstance['menu']()!['menuRef']()!;

      menu.focusedOptionIndex.set(rowIn(panel, 'vote-create-method-generic').closest('li')!.id);
      await fixture.whenStable();
      menu.onEnterKey(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(emitted).toEqual([PollType.GENERIC]);
    });
  });
});
