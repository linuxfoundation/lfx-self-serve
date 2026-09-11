// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, type Provider, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingType } from '@lfx-one/shared/enums';
import type { MeetingCreateMenuRow, PersonaType } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';
import type { MenuItem } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerService } from './meeting-composer.service';
import { MeetingCreateMenuComponent } from './meeting-create-menu.component';

/**
 * Covers the two things this dropdown owns that nothing else can check for it.
 *
 * The panel is appended to `body` at a fixed 22rem, so its `left` is arithmetic against a viewport
 * rather than a layout the browser will correct: get it wrong and the panel lands off the right edge
 * of the meetings dashboard, or over the sidebar on a project dashboard. The maths is exercised
 * through `onShow()` with a stubbed panel and trigger rect, since jsdom lays nothing out.
 *
 * The model is the only entry point into either composer surface, so the rows are pinned to the
 * calls they make rather than to their own labels.
 */
describe('MeetingCreateMenuComponent', () => {
  let fixture: ComponentFixture<MeetingCreateMenuComponent>;
  let composer: MeetingComposerService;
  let open: ReturnType<typeof vi.spyOn>;
  let persona: ReturnType<typeof signal<PersonaType>>;

  /** Matches `viewportGutter` in the component; the panel never sits closer than this to an edge. */
  const GUTTER = 8;
  const PANEL_WIDTH = 352;

  let viewportWidth = 1200;
  let scrollX = 0;
  let clientWidthDescriptor: PropertyDescriptor | undefined;
  let scrollXDescriptor: PropertyDescriptor | undefined;

  const menuItems = (): MenuItem[] => fixture.componentInstance['createMenuItems']();
  const quickStartRows = (): (MenuItem & Partial<MeetingCreateMenuRow>)[] => menuItems()[0].items ?? [];
  const rowFor = (testId: string): MenuItem & Partial<MeetingCreateMenuRow> => quickStartRows().find((row) => row.testId === testId)!;

  /** A panel whose width is fixed, standing in for the body-appended one jsdom never lays out. */
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

  /** Injecting instantiates the test module, so every extra provider has to be in place first. */
  const mount = async (providers: Provider[] = []): Promise<void> => {
    if (providers.length) {
      TestBed.configureTestingModule({ providers });
    }

    composer = TestBed.inject(MeetingComposerService);
    open = vi.spyOn(composer, 'open').mockImplementation(() => undefined);

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MeetingCreateMenuComponent);
    fixture.componentRef.setInput('projectUid', 'project-7');
    fixture.detectChanges();
  };

  /** Opens the dropdown against `trigger` and returns the panel `onShow()` will move. */
  const showAgainst = async (trigger: HTMLElement | null, panel: HTMLElement | null): Promise<void> => {
    const menu = fixture.componentInstance['menu']()!;
    vi.spyOn(menu, 'toggle').mockImplementation(() => undefined);
    vi.spyOn(menu, 'overlayElement').mockReturnValue(panel);

    if (trigger) {
      fixture.componentInstance.toggle({ currentTarget: trigger, target: trigger } as unknown as Event);
    }

    fixture.componentInstance['onShow']();
  };

  beforeEach(() => {
    viewportWidth = 1200;
    scrollX = 0;
    persona = signal<PersonaType>('contributor');

    clientWidthDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
    scrollXDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollX');
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => viewportWidth });
    Object.defineProperty(window, 'scrollX', { configurable: true, get: () => scrollX });

    // Run the alignment callback inline: the real one lands a frame later, after the assertion.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    TestBed.configureTestingModule({
      providers: [{ provide: PersonaService, useValue: { currentPersona: persona } }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (clientWidthDescriptor) {
      Object.defineProperty(document.documentElement, 'clientWidth', clientWidthDescriptor);
    } else {
      Reflect.deleteProperty(document.documentElement, 'clientWidth');
    }

    if (scrollXDescriptor) {
      Object.defineProperty(window, 'scrollX', scrollXDescriptor);
    } else {
      Reflect.deleteProperty(window, 'scrollX');
    }
  });

  describe('panel alignment', () => {
    it("lines the panel's right edge up with the trigger's, which PrimeNG never does", async () => {
      await mount();
      const panel = stubPanel();

      await showAgainst(triggerAt(700, 100), panel);

      // The trigger's right edge is at 800, so a 352-wide panel starts at 448.
      expect(panel.style.left).toBe('448px');
    });

    it('centres the panel on the trigger when asked to', async () => {
      await mount();
      fixture.componentRef.setInput('align', 'center');
      fixture.detectChanges();
      const panel = stubPanel();

      await showAgainst(triggerAt(300, 100), panel);

      // Centred on a 100-wide trigger, a 352-wide panel overhangs 126px on each side.
      expect(panel.style.left).toBe('174px');
    });

    it('pulls the panel back inside the gutter rather than off the right edge', async () => {
      await mount();
      const panel = stubPanel();

      // Right-aligned against a trigger at the very edge, the panel would start at 846.
      await showAgainst(triggerAt(1158, 40), panel);

      expect(panel.style.left).toBe(`${viewportWidth - PANEL_WIDTH - GUTTER}px`);
    });

    it('pushes the panel back inside the gutter rather than off the left edge', async () => {
      await mount();
      const panel = stubPanel();

      // Right-aligned against a trigger near the left edge, the panel would start at -272.
      await showAgainst(triggerAt(20, 60), panel);

      expect(panel.style.left).toBe(`${GUTTER}px`);
    });

    it('starts a panel wider than the viewport at the gutter instead of pushing it off-screen', async () => {
      viewportWidth = 320;
      await mount();
      const panel = stubPanel();

      // Both bounds are now negative, so the order the two clamps apply in is what decides this.
      await showAgainst(triggerAt(240, 60), panel);

      expect(panel.style.left).toBe(`${GUTTER}px`);
    });

    it('offsets by the page scroll, since a body-appended panel is positioned in page coordinates', async () => {
      scrollX = 250;
      await mount();
      const panel = stubPanel();

      await showAgainst(triggerAt(700, 100), panel);

      expect(panel.style.left).toBe('698px');
    });

    it('leaves the panel alone when the menu closed again before the frame ran', async () => {
      await mount();
      const panel = stubPanel();

      await showAgainst(triggerAt(700, 100), null);

      expect(panel.style.left).toBe('');
    });

    it('does nothing when no trigger was captured', async () => {
      await mount();
      const panel = stubPanel();

      await showAgainst(null, panel);

      expect(panel.style.left).toBe('');
    });

    it('never asks for a frame on the server, where there is no panel to measure', async () => {
      await mount([{ provide: PLATFORM_ID, useValue: 'server' }]);
      const panel = stubPanel();
      // Angular schedules frames of its own during the render above, so count from here.
      const framesBefore = vi.mocked(window.requestAnimationFrame).mock.calls.length;

      await showAgainst(triggerAt(700, 100), panel);

      expect(vi.mocked(window.requestAnimationFrame).mock.calls).toHaveLength(framesBefore);
      expect(panel.style.left).toBe('');
    });
  });

  describe('menu model', () => {
    it('keeps every row inside one group, so Advanced is not rendered as a second heading', async () => {
      await mount();

      expect(menuItems()).toHaveLength(1);
      expect(menuItems()[0].label).toBe('Quick start');
    });

    it('closes the type rows with a separator and the Advanced row', async () => {
      await mount();
      const rows = quickStartRows();

      expect(rows.at(-2)).toEqual({ separator: true });
      expect(rows.at(-1)?.testId).toBe('meeting-create-advanced');
    });

    it('reads each type row as a thing to create rather than as a bare type name', async () => {
      await mount();

      expect(rowFor('meeting-create-quick-board').label).toBe('Board meeting');
    });

    it('leaves Other unsuffixed, since it names the absence of a type', async () => {
      await mount();

      expect(rowFor('meeting-create-quick-other').label).toBe('Other');
    });

    it('offers a maintainer only the types the composer would let them keep', async () => {
      persona.set('maintainer');
      await mount();

      const typeRows = quickStartRows().filter((row) => row.testId?.startsWith('meeting-create-quick-'));
      expect(typeRows.map((row) => row.label)).toEqual(['Maintainers meeting', 'Technical meeting', 'Other']);
    });

    it('opens the quick dialog on the chosen type, so its template prefill runs straight away', async () => {
      await mount();

      rowFor('meeting-create-quick-board').command?.({});

      expect(open).toHaveBeenCalledWith({ mode: 'create', variant: 'quick', meetingType: MeetingType.BOARD, projectUid: 'project-7' });
    });

    it('sends Advanced to the drawer with no type chosen', async () => {
      await mount();

      rowFor('meeting-create-advanced').command?.({});

      expect(open).toHaveBeenCalledWith({ mode: 'create', projectUid: 'project-7' });
    });
  });
});
