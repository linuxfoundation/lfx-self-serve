// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FlexibleConnectedPositionStrategy, OverlayContainer } from '@angular/cdk/overlay';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiTooltipDirective } from './tooltip.directive';

@Component({
  selector: 'lfx-ui-test-host',
  template: '',
})
class TestHostComponent {
  public readonly text = signal('Copy link');
  public readonly heading = signal('');
  public readonly shortcut = signal<string[]>([]);
  public readonly side = signal<'top' | 'right' | 'bottom' | 'left'>('top');
  public readonly disabled = signal(false);
  public readonly delay = 40;
}

describe('UiTooltipDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let trigger: HTMLButtonElement;
  let container: HTMLElement;

  const tooltip = () => container.querySelector('[data-testid="ui-tooltip"]') as HTMLElement | null;
  // Real timers: fake ones stall the zoneless scheduler behind fixture.whenStable().
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const pressKey = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  const setup = async (providers: unknown[] = []) => {
    TestBed.configureTestingModule({ imports: [TestHostComponent], providers: providers as never[] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(TestHostComponent, {
      set: {
        imports: [UiTooltipDirective],
        template: `
    <button
      id="trigger"
      aria-describedby="existing"
      [lfxUiTooltip]="text()"
      [lfxUiTooltipTitle]="heading()"
      [lfxUiTooltipShortcut]="shortcut()"
      [lfxUiTooltipSide]="side()"
      [lfxUiTooltipDelay]="delay" [lfxUiTooltipDisabled]="disabled()">
      Trigger
    </button>
  `,
      },
    });
    fixture = TestBed.createComponent(TestHostComponent);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    trigger = fixture.nativeElement.querySelector('#trigger');
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  };

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  describe('browser', () => {
    beforeEach(async () => setup());

    it('opens on hover only after the delay and closes on mouseleave', async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(10);
      expect(tooltip()).toBeNull();

      await wait(60);
      expect(tooltip()?.textContent?.trim()).toBe('Copy link');
      expect(tooltip()?.getAttribute('role')).toBe('tooltip');

      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      expect(tooltip()).not.toBeNull();
      await wait(160);
      expect(tooltip()).toBeNull();
    });

    it('a quick pass over the host never opens it', async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(10);
      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      await wait(100);

      expect(tooltip()).toBeNull();
    });

    it('opens on keyboard focus and closes on blur', async () => {
      pressKey('Tab');
      trigger.focus();
      await wait(60);
      expect(tooltip()).not.toBeNull();

      trigger.blur();
      await wait(0);
      expect(tooltip()).toBeNull();
    });

    it('does not open when focus comes from a mouse click', async () => {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, buttons: 1, detail: 1 }));
      trigger.focus();
      await wait(100);

      expect(tooltip()).toBeNull();
    });

    it('closes on Escape even when the host is only hovered', async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      expect(tooltip()).not.toBeNull();

      pressKey('Escape');
      expect(tooltip()).toBeNull();
    });

    it('keeps focus on the host when Escape closes the tooltip', async () => {
      pressKey('Tab');
      trigger.focus();
      await wait(60);
      pressKey('Escape');

      expect(tooltip()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('points aria-describedby at the tooltip while open and keeps the existing reference', async () => {
      expect(trigger.getAttribute('aria-describedby')).toBe('existing');

      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      const id = tooltip()?.id;
      expect(id).toBeTruthy();
      expect(trigger.getAttribute('aria-describedby')).toBe(`existing ${id}`);

      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      await wait(160);
      expect(trigger.getAttribute('aria-describedby')).toBe('existing');
    });

    it('renders the rich layout with a title, a description and key caps', async () => {
      fixture.componentInstance.heading.set('Health score');
      fixture.componentInstance.text.set('Weighted from activity.');
      fixture.componentInstance.shortcut.set(['⌘', 'C']);
      await fixture.whenStable();
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);

      expect(container.querySelector('[data-testid="ui-tooltip-title"]')?.textContent).toBe('Health score');
      expect(container.querySelector('[data-testid="ui-tooltip-text"]')?.textContent).toBe('Weighted from activity.');
      expect(container.querySelectorAll('kbd').length).toBe(2);
      expect(tooltip()?.className).toContain('flex-col');
    });

    it('updates the open tooltip when the text changes', async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      fixture.componentInstance.text.set('Copied');
      await fixture.whenStable();

      expect(tooltip()?.textContent?.trim()).toBe('Copied');
    });

    it('shows nothing for empty text and closes when the text is cleared', async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      fixture.componentInstance.text.set('');
      await fixture.whenStable();
      expect(tooltip()).toBeNull();

      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      expect(tooltip()).toBeNull();
    });

    it('stays closed while disabled', async () => {
      fixture.componentInstance.disabled.set(true);
      await fixture.whenStable();
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);

      expect(tooltip()).toBeNull();
    });

    it('prefers the requested side and falls back to the opposite side first', async () => {
      const spy = vi.spyOn(FlexibleConnectedPositionStrategy.prototype, 'withPositions');
      fixture.componentInstance.side.set('right');
      await fixture.whenStable();
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);

      const positions = spy.mock.calls[0][0];
      expect(positions).toHaveLength(4);
      expect(positions[0]).toMatchObject({ originX: 'end', overlayX: 'start', offsetX: 6 });
      expect(positions[1]).toMatchObject({ originX: 'start', overlayX: 'end', offsetX: -6 });
    });

    describe('hoverable tooltip', () => {
      const openByHover = async () => {
        trigger.dispatchEvent(new MouseEvent('mouseenter'));
        await wait(60);
      };

      it('can be hovered: no pointer-events lock on the panel', async () => {
        await openByHover();

        expect(tooltip()?.className).not.toContain('pointer-events-none');
      });

      it('stays open while the pointer crosses from the host to the tooltip', async () => {
        await openByHover();
        trigger.dispatchEvent(new MouseEvent('mouseleave'));
        await wait(30);
        tooltip()?.dispatchEvent(new MouseEvent('mouseenter'));
        await wait(250);

        expect(tooltip()).not.toBeNull();
      });

      it('closes after the pointer leaves the tooltip', async () => {
        await openByHover();
        trigger.dispatchEvent(new MouseEvent('mouseleave'));
        tooltip()?.dispatchEvent(new MouseEvent('mouseenter'));
        await wait(150);
        tooltip()?.dispatchEvent(new MouseEvent('mouseleave'));
        expect(tooltip()).not.toBeNull();
        await wait(160);

        expect(tooltip()).toBeNull();
      });

      it('stays open when the pointer returns to the host within the grace period', async () => {
        await openByHover();
        trigger.dispatchEvent(new MouseEvent('mouseleave'));
        await wait(30);
        trigger.dispatchEvent(new MouseEvent('mouseenter'));
        await wait(250);

        expect(tooltip()).not.toBeNull();
      });

      it('Escape still closes it while the pointer is over the tooltip', async () => {
        await openByHover();
        tooltip()?.dispatchEvent(new MouseEvent('mouseenter'));
        pressKey('Escape');

        expect(tooltip()).toBeNull();
      });

      it('keyboard focus keeps it open when the pointer leaves the host', async () => {
        pressKey('Tab');
        trigger.focus();
        await wait(60);
        trigger.dispatchEvent(new MouseEvent('mouseenter'));
        trigger.dispatchEvent(new MouseEvent('mouseleave'));
        await wait(200);
        expect(tooltip()).not.toBeNull();

        trigger.blur();
        await wait(0);
        expect(tooltip()).toBeNull();
      });
    });

    it('removes the tooltip and the reference when the host is destroyed', async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      fixture.destroy();

      expect(tooltip()).toBeNull();
    });
  });

  describe('server', () => {
    it('never creates an overlay', async () => {
      await setup([{ provide: PLATFORM_ID, useValue: 'server' }]);
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(100);

      expect(tooltip()).toBeNull();
    });
  });
});
