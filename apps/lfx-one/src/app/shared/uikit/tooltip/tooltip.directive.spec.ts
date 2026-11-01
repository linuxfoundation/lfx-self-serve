// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FocusMonitor } from '@angular/cdk/a11y';
import { FlexibleConnectedPositionStrategy, Overlay, OverlayContainer, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTooltipSide } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiTooltipDirective } from './tooltip.directive';

const HOST_TEMPLATE = `
  <button
    id="trigger"
    aria-describedby="existing"
    [attr.aria-label]="label()"
    [lfxUiTooltip]="text()"
    [lfxUiTooltipTitle]="heading()"
    [lfxUiTooltipShortcut]="shortcut()"
    [lfxUiTooltipSide]="side()"
    [lfxUiTooltipDelay]="delay"
    [lfxUiTooltipDisabled]="disabled()">
    Trigger
  </button>
`;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  public readonly text = signal('Copy link');
  public readonly heading = signal('');
  public readonly shortcut = signal<string[]>([]);
  public readonly side = signal<UiTooltipSide>('top');
  public readonly disabled = signal(false);
  public readonly label = signal<string | null>(null);
  public readonly delay = 40;
}

@Component({ selector: 'lfx-ui-test-underlay', template: '' })
class TestUnderlayComponent {}

describe('UiTooltipDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let trigger: HTMLButtonElement;
  let container: HTMLElement;

  const tooltip = () => container.querySelector('[data-testid="ui-tooltip"]') as HTMLElement | null;
  // Virtual time. Only the timers are faked, so the zoneless scheduler is not starved; changes are flushed with detectChanges.
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const flush = async () => {
    fixture.detectChanges();
    await advance(0);
  };
  const pressKey = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const pointer = (target: Element | null, type: 'pointerenter' | 'pointerleave', pointerType = 'mouse') =>
    target?.dispatchEvent(Object.assign(new Event(type), { pointerType }));
  const descriptions = () =>
    (trigger.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((id) => id && id !== 'existing')
      .map((id) => document.getElementById(id)?.textContent);

  const setup = async (providers: unknown[] = []) => {
    TestBed.configureTestingModule({ imports: [TestHostComponent], providers: providers as never[] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiTooltipDirective], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    trigger = fixture.nativeElement.querySelector('#trigger');
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  };

  const hover = async () => {
    pointer(trigger, 'pointerenter');
    await advance(60);
  };

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('browser', () => {
    it('opens on hover only after the delay and closes after the grace period on leave', async () => {
      await setup();
      pointer(trigger, 'pointerenter');
      await advance(39);
      expect(tooltip()).toBeNull();

      await advance(1);
      await flush();
      expect(tooltip()?.textContent?.trim()).toBe('Copy link');
      expect(tooltip()?.getAttribute('role')).toBe('tooltip');

      pointer(trigger, 'pointerleave');
      expect(tooltip()).not.toBeNull();
      await advance(100);
      expect(tooltip()).toBeNull();
    });

    it('a quick pass over the host never opens it', async () => {
      await setup();
      pointer(trigger, 'pointerenter');
      await advance(10);
      pointer(trigger, 'pointerleave');
      await advance(500);

      expect(tooltip()).toBeNull();
    });

    it('ignores touch pointers', async () => {
      await setup();
      pointer(trigger, 'pointerenter', 'touch');
      await advance(200);
      expect(tooltip()).toBeNull();

      await hover();
      pointer(trigger, 'pointerleave', 'touch');
      await advance(300);
      expect(tooltip()).not.toBeNull();
    });

    it('opens on keyboard focus and closes on blur', async () => {
      await setup();
      pressKey('Tab');
      trigger.focus();
      await advance(40);
      expect(tooltip()).not.toBeNull();

      trigger.blur();
      await advance(0);
      expect(tooltip()).toBeNull();
    });

    it('does not open when focus comes from a mouse click', async () => {
      await setup();
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, buttons: 1, detail: 1 }));
      trigger.focus();
      await advance(200);

      expect(tooltip()).toBeNull();
    });

    it('closes on Escape even when the host is only hovered', async () => {
      await setup();
      await hover();
      expect(tooltip()).not.toBeNull();

      pressKey('Escape');
      expect(tooltip()).toBeNull();
    });

    it('keeps focus on the host when Escape closes the tooltip', async () => {
      await setup();
      pressKey('Tab');
      trigger.focus();
      await advance(40);
      pressKey('Escape');

      expect(tooltip()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('Escape during the show delay cancels the pending show', async () => {
      await setup();
      pointer(trigger, 'pointerenter');
      await advance(10);
      pressKey('Escape');
      await advance(200);

      expect(tooltip()).toBeNull();
    });

    it('a pointer pass over the host does not cancel the show that keyboard focus started', async () => {
      await setup();
      pressKey('Tab');
      trigger.focus();
      await advance(10);
      pointer(trigger, 'pointerenter');
      pointer(trigger, 'pointerleave');
      await advance(300);

      expect(tooltip()).not.toBeNull();
    });

    it('keyboard focus arriving during the hide grace period keeps the tooltip open', async () => {
      await setup();
      await hover();
      pointer(trigger, 'pointerleave');
      await advance(30);
      pressKey('Tab');
      trigger.focus();
      await advance(300);

      expect(tooltip()).not.toBeNull();
    });

    it('Escape on the open tooltip does not reach other Escape listeners, such as a dialog behind it', async () => {
      await setup();
      await hover();
      const listener = vi.fn();
      document.addEventListener('keydown', listener);
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      document.removeEventListener('keydown', listener);

      expect(tooltip()).toBeNull();
      expect(event.defaultPrevented).toBe(true);
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not take the keyboard away from an overlay underneath, such as a menu or dialog', async () => {
      await setup();
      const underneath = vi.fn();
      const overlayRef = TestBed.inject(Overlay).create();
      overlayRef.attach(new ComponentPortal(TestUnderlayComponent));
      overlayRef.keydownEvents().subscribe(underneath);
      await hover();
      expect(tooltip()).not.toBeNull();

      pressKey('ArrowDown');
      pressKey('Tab');
      pressKey('Enter');
      expect(underneath).toHaveBeenCalledTimes(3);

      pressKey('Escape');
      expect(tooltip()).toBeNull();
      expect(underneath).toHaveBeenCalledTimes(3);
      overlayRef.dispose();
    });

    it('ignores Escape pressed with a modifier key', async () => {
      await setup();
      await hover();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true, cancelable: true }));

      expect(tooltip()).not.toBeNull();
    });

    it('Escape ends keyboard-focus mode, so a later hover closes normally', async () => {
      await setup();
      pressKey('Tab');
      trigger.focus();
      await advance(40);
      pressKey('Escape');

      await hover();
      pointer(trigger, 'pointerleave');
      await advance(100);
      expect(tooltip()).toBeNull();
    });

    it('registers the text as the accessible description before it is shown and keeps existing references', async () => {
      await setup();

      expect(trigger.getAttribute('aria-describedby')?.startsWith('existing ')).toBe(true);
      expect(descriptions()).toEqual(['Copy link']);
      expect(tooltip()).toBeNull();
    });

    it('updates the description when the text changes and removes it when disabled', async () => {
      await setup();
      fixture.componentInstance.text.set('Copied');
      await flush();
      expect(descriptions()).toEqual(['Copied']);

      fixture.componentInstance.disabled.set(true);
      await flush();
      expect(descriptions()).toEqual([]);
      expect(trigger.getAttribute('aria-describedby')).toBe('existing');
    });

    it('includes the title in the description and removes it when the host is destroyed', async () => {
      await setup();
      fixture.componentInstance.heading.set('Health score');
      fixture.componentInstance.text.set('Weighted from activity.');
      await flush();
      expect(descriptions()).toEqual(['Health score. Weighted from activity.']);

      fixture.destroy();
      expect(trigger.getAttribute('aria-describedby')).toBe('existing');
    });

    it('skips the description when it equals the host aria-label', async () => {
      await setup();
      fixture.componentInstance.label.set('Copy link');
      fixture.componentInstance.text.set('Copy link ');
      await flush();
      fixture.componentInstance.text.set('Copy link');
      await flush();

      expect(descriptions()).toEqual([]);
    });

    it('speaks the shortcut in the description, even when the text only repeats the aria-label', async () => {
      await setup();
      fixture.componentInstance.label.set('Copy link');
      fixture.componentInstance.shortcut.set(['⌘', 'C']);
      await flush();

      expect(descriptions()).toEqual(['Command C']);

      fixture.componentInstance.shortcut.set(['⇧', '⇥', '⌘K']);
      await flush();
      expect(descriptions()).toEqual(['Shift Tab Command K']);
      fixture.componentInstance.shortcut.set(['⌘', 'C']);
      await flush();

      // The description is recomputed when the tooltip inputs change, not when aria-label does.
      fixture.componentInstance.label.set(null);
      fixture.componentInstance.shortcut.set(['⌘', 'C']);
      await flush();
      expect(descriptions()).toEqual(['Copy link. Command C']);
    });

    it('places the tooltip again when its content changes while open', async () => {
      await setup();
      await hover();
      const update = vi.spyOn(OverlayRef.prototype, 'updatePosition');
      fixture.componentInstance.heading.set('Health score');
      fixture.componentInstance.text.set('A longer explanation that wraps onto several lines.');
      await flush();
      await advance(0);

      expect(update).toHaveBeenCalled();
    });

    it('lets the CDK push a tooltip into view when no placement fits', async () => {
      await setup();
      const push = vi.spyOn(FlexibleConnectedPositionStrategy.prototype, 'withPush');
      await hover();

      expect(push).toHaveBeenCalledWith(true);
    });

    it('renders the rich layout with a title, a description and key caps', async () => {
      await setup();
      fixture.componentInstance.heading.set('Health score');
      fixture.componentInstance.text.set('Weighted from activity.');
      fixture.componentInstance.shortcut.set(['⌘', 'C']);
      await flush();
      await hover();

      expect(container.querySelector('[data-testid="ui-tooltip-title"]')?.textContent).toBe('Health score');
      expect(container.querySelector('[data-testid="ui-tooltip-text"]')?.textContent).toBe('Weighted from activity.');
      expect(container.querySelectorAll('kbd').length).toBe(2);
      expect(tooltip()?.className).toContain('flex-col');
    });

    it('updates the open tooltip when the text changes', async () => {
      await setup();
      await hover();
      fixture.componentInstance.text.set('Copied');
      await flush();

      expect(tooltip()?.textContent?.trim()).toBe('Copied');
    });

    it('shows nothing for empty text and closes when the text is cleared', async () => {
      await setup();
      await hover();
      fixture.componentInstance.text.set('');
      await flush();
      expect(tooltip()).toBeNull();

      pointer(trigger, 'pointerleave');
      await hover();
      expect(tooltip()).toBeNull();
    });

    it('watches focus only while there is text or a title', async () => {
      await setup();
      const focusMonitor = TestBed.inject(FocusMonitor);
      const monitor = vi.spyOn(focusMonitor, 'monitor');
      const stop = vi.spyOn(focusMonitor, 'stopMonitoring');
      fixture.componentInstance.text.set('');
      await flush();
      expect(stop).toHaveBeenCalledWith(trigger);

      pressKey('Tab');
      trigger.focus();
      await advance(60);
      expect(tooltip()).toBeNull();
      expect(monitor).not.toHaveBeenCalled();

      trigger.blur();
      fixture.componentInstance.heading.set('Heading');
      await flush();
      expect(monitor).toHaveBeenCalledWith(trigger, true);
    });

    it('stays closed while disabled', async () => {
      await setup();
      fixture.componentInstance.disabled.set(true);
      await flush();
      await hover();

      expect(tooltip()).toBeNull();
    });

    it('prefers the requested side and falls back to the opposite side first', async () => {
      await setup();
      const spy = vi.spyOn(FlexibleConnectedPositionStrategy.prototype, 'withPositions');
      fixture.componentInstance.side.set('right');
      await flush();
      await hover();

      const positions = spy.mock.calls[0][0];
      expect(positions).toHaveLength(4);
      expect(positions[0]).toMatchObject({ originX: 'end', overlayX: 'start', offsetX: 6 });
      expect(positions[1]).toMatchObject({ originX: 'start', overlayX: 'end', offsetX: -6 });
    });

    it('reopens after the CDK disposes the overlay itself, such as on navigation', async () => {
      await setup();
      const create = vi.spyOn(Overlay.prototype, 'create');
      await hover();
      expect(tooltip()).not.toBeNull();

      (create.mock.results[0].value as OverlayRef).dispose();
      expect(tooltip()).toBeNull();

      pointer(trigger, 'pointerleave');
      await advance(100);
      await hover();
      expect(tooltip()).not.toBeNull();
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('removes the tooltip when the host is destroyed', async () => {
      await setup();
      await hover();
      fixture.destroy();

      expect(tooltip()).toBeNull();
    });

    describe('hoverable tooltip', () => {
      it('can be hovered: no pointer-events lock on the panel', async () => {
        await setup();
        await hover();

        expect(tooltip()?.className).not.toContain('pointer-events-none');
      });

      it('stays open while the pointer crosses from the host to the tooltip', async () => {
        await setup();
        await hover();
        pointer(trigger, 'pointerleave');
        await advance(30);
        pointer(tooltip(), 'pointerenter');
        await advance(500);

        expect(tooltip()).not.toBeNull();
      });

      it('closes after the pointer leaves the tooltip', async () => {
        await setup();
        await hover();
        pointer(trigger, 'pointerleave');
        pointer(tooltip(), 'pointerenter');
        await advance(150);
        pointer(tooltip(), 'pointerleave');
        expect(tooltip()).not.toBeNull();
        await advance(100);

        expect(tooltip()).toBeNull();
      });

      it('stays open when the pointer returns to the host within the grace period', async () => {
        await setup();
        await hover();
        pointer(trigger, 'pointerleave');
        await advance(30);
        pointer(trigger, 'pointerenter');
        await advance(500);

        expect(tooltip()).not.toBeNull();
      });

      it('Escape still closes it while the pointer is over the tooltip', async () => {
        await setup();
        await hover();
        pointer(tooltip(), 'pointerenter');
        pressKey('Escape');

        expect(tooltip()).toBeNull();
      });

      it('keyboard focus keeps it open when the pointer leaves the host', async () => {
        await setup();
        pressKey('Tab');
        trigger.focus();
        await advance(40);
        pointer(trigger, 'pointerenter');
        pointer(trigger, 'pointerleave');
        await advance(300);
        expect(tooltip()).not.toBeNull();

        trigger.blur();
        await advance(0);
        expect(tooltip()).toBeNull();
      });
    });
  });

  describe('server', () => {
    it('never creates an overlay or a description', async () => {
      await setup([{ provide: PLATFORM_ID, useValue: 'server' }]);
      pointer(trigger, 'pointerenter');
      await advance(200);

      expect(tooltip()).toBeNull();
      expect(trigger.getAttribute('aria-describedby')).toBe('existing');
    });
  });
});
