// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiToastAction, UiToastVariant } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiToastComponent } from './toast.component';
import { UiToastService } from './toast.service';

@Component({
  selector: 'lfx-ui-test-host',
  imports: [UiToastComponent],
  template:
    '<lfx-ui-toast [variant]="variant()" [actions]="actions()" [duration]="duration()" [dismissible]="dismissible()" (dismissed)="dismissed()">Committee created.</lfx-ui-toast><button id="outside" type="button">Outside</button>',
})
class TestHostComponent {
  public readonly variant = signal<UiToastVariant>('default');
  public readonly actions = signal<UiToastAction[]>([]);
  public readonly duration = signal<number | null>(null);
  public readonly dismissible = signal(true);
  public dismissed = vi.fn();
}

// Only the timers and the clock are faked, so the zoneless scheduler is not starved; changes are flushed with detectChanges.
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

describe('UiToastComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let root: HTMLElement;

  const toast = () => root.querySelector('lfx-ui-toast') as HTMLElement;
  const flush = async () => {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
  };
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const pointer = (type: 'pointerenter' | 'pointerleave') => toast().dispatchEvent(new Event(type));
  const focusIn = (target: HTMLElement) => target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const focusOut = (target: HTMLElement, relatedTarget: HTMLElement | null) =>
    target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));

  const setup = async (configure: (instance: TestHostComponent) => void = () => undefined) => {
    fakeTimers();
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    configure(host);
    root = fixture.nativeElement as HTMLElement;
    await flush();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHostComponent] }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('renders the projected message', async () => {
    await setup();
    expect(toast().querySelector('[data-testid="ui-toast-message"]')?.textContent?.trim()).toBe('Committee created.');
  });

  it.each([
    ['default', 'status', 'bg-ui-background-100'],
    ['success', 'status', 'bg-ui-success-600'],
    ['warning', 'status', 'bg-ui-warning-500'],
    ['error', 'alert', 'bg-ui-danger-600'],
  ] as const)('gives the %s variant role %s and %s', async (variant, role, fill) => {
    await setup((instance) => instance.variant.set(variant));
    expect(toast().getAttribute('role')).toBe(role);
    expect(toast().classList).toContain(fill);
    expect(toast().classList).toContain('rounded-ui-md');
    expect(toast().classList).toContain('shadow-modal');
  });

  describe('auto-dismiss', () => {
    it('dismisses itself after 5 seconds', async () => {
      await setup();
      await advance(4999);
      expect(host.dismissed).not.toHaveBeenCalled();
      await advance(1);
      expect(host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('waits 8 seconds when it has an action', async () => {
      await setup((instance) => instance.actions.set([{ label: 'Undo', run: vi.fn() }]));
      await advance(7999);
      expect(host.dismissed).not.toHaveBeenCalled();
      await advance(1);
      expect(host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('never dismisses an error by itself', async () => {
      await setup((instance) => instance.variant.set('error'));
      await advance(60000);
      expect(host.dismissed).not.toHaveBeenCalled();
    });

    it('never dismisses itself when the duration is 0', async () => {
      await setup((instance) => instance.duration.set(0));
      await advance(60000);
      expect(host.dismissed).not.toHaveBeenCalled();
    });

    it('honours an explicit duration, even on an error', async () => {
      await setup((instance) => {
        instance.variant.set('error');
        instance.duration.set(1000);
      });
      await advance(1000);
      expect(host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('stops counting once destroyed', async () => {
      await setup();
      fixture.destroy();
      await advance(10000);
      expect(host.dismissed).not.toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('pauses while the pointer is over it and resumes with the time that was left', async () => {
      await setup();
      await advance(3000);
      pointer('pointerenter');
      await advance(60000);
      expect(host.dismissed).not.toHaveBeenCalled();

      pointer('pointerleave');
      await advance(1999);
      expect(host.dismissed).not.toHaveBeenCalled();
      await advance(1);
      expect(host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('pauses while focus is inside it', async () => {
      await setup();
      const dismiss = toast().querySelector('[data-testid="ui-toast-dismiss"]') as HTMLElement;
      await advance(2000);
      focusIn(dismiss);
      await advance(60000);
      expect(host.dismissed).not.toHaveBeenCalled();

      focusOut(dismiss, root.querySelector('#outside'));
      await advance(3000);
      expect(host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('stays paused when focus moves between its own buttons', async () => {
      await setup((instance) => instance.actions.set([{ label: 'Undo', run: vi.fn() }]));
      const action = toast().querySelector('[data-testid="ui-toast-action"]') as HTMLElement;
      const dismiss = toast().querySelector('[data-testid="ui-toast-dismiss"]') as HTMLElement;
      focusIn(action);
      focusOut(action, dismiss);
      focusIn(dismiss);
      await advance(60000);
      expect(host.dismissed).not.toHaveBeenCalled();
    });

    it('stays paused while the pointer is over it even after focus leaves', async () => {
      await setup();
      const dismiss = toast().querySelector('[data-testid="ui-toast-dismiss"]') as HTMLElement;
      pointer('pointerenter');
      focusIn(dismiss);
      focusOut(dismiss, null);
      await advance(60000);
      expect(host.dismissed).not.toHaveBeenCalled();
    });
  });

  describe('dismiss button', () => {
    it('is named Dismiss and dismisses on press', async () => {
      await setup();
      const dismiss = toast().querySelector('[data-testid="ui-toast-dismiss"]') as HTMLButtonElement;
      expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
      expect(dismiss.type).toBe('button');
      dismiss.click();
      expect(host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('can be hidden', async () => {
      await setup((instance) => instance.dismissible.set(false));
      expect(toast().querySelector('[data-testid="ui-toast-dismiss"]')).toBeNull();
    });
  });

  describe('actions', () => {
    it('runs an action and dismisses', async () => {
      const run = vi.fn();
      await setup((instance) => instance.actions.set([{ label: 'Undo', run }]));
      (toast().querySelector('[data-testid="ui-toast-action"]') as HTMLButtonElement).click();
      expect(run).toHaveBeenCalledTimes(1);
      expect(host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('shows at most two actions', async () => {
      await setup((instance) =>
        instance.actions.set([
          { label: 'One', run: vi.fn() },
          { label: 'Two', run: vi.fn() },
          { label: 'Three', run: vi.fn() },
        ])
      );
      expect(Array.from(toast().querySelectorAll('[data-testid="ui-toast-action"]')).map((button) => button.textContent?.trim())).toEqual(['One', 'Two']);
    });

    it('gives a primary action the accent fill on a default toast only', async () => {
      await setup((instance) => instance.actions.set([{ label: 'View', run: vi.fn(), primary: true }]));
      expect(toast().querySelector('[data-testid="ui-toast-action"]')?.classList).toContain('bg-ui-accent-500');

      host.variant.set('success');
      await flush();
      const action = toast().querySelector('[data-testid="ui-toast-action"]') as HTMLElement;
      expect(action.classList).not.toContain('bg-ui-accent-500');
      expect(action.classList).toContain('text-white');
    });
  });
});

describe('UiToastService', () => {
  let service: UiToastService;
  let container: HTMLElement;

  const region = () => container.querySelector('[data-testid="ui-toast-region"]') as HTMLElement | null;
  const toasts = () => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="ui-toast"]'));
  const messages = () => toasts().map((element) => element.querySelector('[data-testid="ui-toast-message"]')?.textContent?.trim());
  const flush = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  };

  beforeEach(async () => {
    fakeTimers();
    service = TestBed.inject(UiToastService);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    await flush();
  });

  afterEach(() => {
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.useRealTimers();
  });

  it('keeps a polite live region in the overlay before any toast is shown', () => {
    expect(region()).not.toBeNull();
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    expect(toasts()).toHaveLength(0);
  });

  it('anchors the stack bottom-right above the other overlays', () => {
    const host = region()?.closest('.cdk-global-overlay-wrapper') as HTMLElement;
    expect(host.style.zIndex).toBe('1001');
    const pane = region()?.closest('.cdk-overlay-pane') as HTMLElement;
    expect(pane.style.marginBottom).toBe('16px');
    expect(pane.style.marginRight).toBe('16px');
  });

  it('shows toasts newest first', async () => {
    service.show({ message: 'First.' });
    service.show({ message: 'Second.' });
    await flush();
    expect(messages()).toEqual(['Second.', 'First.']);
  });

  it('dismisses through the returned handle', async () => {
    const ref = service.show({ message: 'Gone soon.' });
    await flush();
    expect(toasts()).toHaveLength(1);
    ref.dismiss();
    await flush();
    expect(toasts()).toHaveLength(0);
    expect(region()).not.toBeNull();
  });

  it('dismisses everything', async () => {
    service.show({ message: 'One.' });
    service.show({ message: 'Two.' });
    service.dismissAll();
    await flush();
    expect(toasts()).toHaveLength(0);
    expect(service.toasts()).toHaveLength(0);
  });

  it('removes a toast after its countdown', async () => {
    service.show({ message: 'Short.' });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(toasts()).toHaveLength(0);
  });

  it('removes a toast when its dismiss button is pressed and leaves the others', async () => {
    service.show({ message: 'Stays.' });
    service.show({ message: 'Goes.' });
    await flush();
    (toasts()[0].querySelector('[data-testid="ui-toast-dismiss"]') as HTMLButtonElement).click();
    await flush();
    expect(messages()).toEqual(['Stays.']);
  });

  it('passes the variant, actions and duration to the toast', async () => {
    const run = vi.fn();
    service.show({ message: 'Could not send.', variant: 'error', actions: [{ label: 'Retry', run }], dismissible: false });
    await flush();
    expect(toasts()[0].getAttribute('role')).toBe('alert');
    expect(toasts()[0].querySelector('[data-testid="ui-toast-dismiss"]')).toBeNull();
    (toasts()[0].querySelector('[data-testid="ui-toast-action"]') as HTMLButtonElement).click();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(0);
  });

  it('gives every toast its own id', () => {
    const first = service.show({ message: 'A.' });
    const second = service.show({ message: 'B.' });
    expect(first.id).not.toBe(second.id);
  });
});
