// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  Signal,
} from '@angular/core';
import { UiToastAction, UiToastVariant } from '@lfx-one/shared/interfaces';

/**
 * A short message about something that just happened. `UiToastService.show` renders these in a stack at the bottom-right of the window;
 * the component can also be placed directly. It dismisses itself after `duration` (5s, 8s with actions, never for `error`) and the
 * countdown pauses while the pointer is over the toast or focus is inside it. The message is the projected content.
 *
 * Announced to screen readers as a polite status, or as an alert for `error`. The countdown is read once, when the toast first renders.
 */
@Component({
  selector: 'lfx-ui-toast',
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[attr.role]': 'role()',
    'data-testid': 'ui-toast',
    '(pointerenter)': 'onHover(true)',
    '(pointerleave)': 'onHover(false)',
    '(focusin)': 'onFocusIn($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class UiToastComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  /** Colour and urgency: `success`, `warning` and `error` are solid; `error` is an alert and stays until dismissed. */
  public readonly variant = input<UiToastVariant>('default');
  /** Up to two action buttons; any more are ignored. Running one dismisses the toast. */
  public readonly actions = input<UiToastAction[]>([]);
  /** Milliseconds before it dismisses itself, `0` for never. Leave unset for 5000, 8000 with actions, and never for `error`. */
  public readonly duration = input<number | null>(null);
  /** Shows the dismiss button. A toast that never dismisses itself and has no action shows it regardless, so it can always be closed. */
  public readonly dismissible = input<boolean, unknown>(true, { transform: booleanAttribute });
  /** Emits when the toast wants to go away: the countdown ended, the dismiss button or an action was pressed. */
  public readonly dismissed = output<void>();

  protected readonly role: Signal<'alert' | 'status'> = this.initRole();
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly visibleActions: Signal<{ action: UiToastAction; classes: string }[]> = this.initVisibleActions();
  protected readonly dismissClasses: Signal<string> = this.initDismissClasses();
  protected readonly showDismiss: Signal<boolean> = this.initShowDismiss();

  private readonly resolvedDuration: Signal<number> = this.initResolvedDuration();
  private remaining = 0;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hovered = false;
  private focused = false;
  private returnTarget: HTMLElement | null = null;
  private leavingWithoutTarget = false;

  public constructor() {
    // afterNextRender never runs on the server, so no timer is left behind there.
    afterNextRender(() => {
      this.remaining = this.resolvedDuration();
      this.resume();
    });
    this.destroyRef.onDestroy(() => {
      this.pause();
      // Removed by `ref.dismiss()` or the service while focus was inside: the removed button would leave focus on the body.
      if (this.focused || this.leavingWithoutTarget) this.restoreFocus();
    });
  }

  protected onHover(hovered: boolean): void {
    this.hovered = hovered;
    this.syncTimer();
  }

  protected onFocusIn(event: FocusEvent): void {
    const from = event.relatedTarget as Node | null;
    // Remember where focus came from; moving between the toast's own buttons keeps the first origin.
    if (!from) this.returnTarget = null;
    else if (!this.host.nativeElement.contains(from) && from instanceof HTMLElement) this.returnTarget = from;
    this.onFocusWithin(true);
  }

  protected onFocusWithin(focused: boolean): void {
    this.focused = focused;
    this.syncTimer();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    // Focus moving between the toast's own buttons keeps it paused.
    if (next && (event.currentTarget as Node).contains(next)) return;
    // Browsers that blur a removed button report it as focus leaving with no target; destroy runs before this microtask clears the flag.
    this.leavingWithoutTarget = !next;
    if (!next) queueMicrotask(() => (this.leavingWithoutTarget = false));
    this.onFocusWithin(false);
  }

  protected run(action: UiToastAction): void {
    // Focus goes back first so an action that moves focus on purpose, such as opening a dialog, has the last word.
    if (this.focused) this.restoreFocus();
    action.run();
    this.dismissed.emit();
  }

  protected dismiss(): void {
    if (this.focused) this.restoreFocus();
    this.dismissed.emit();
  }

  private initRole(): Signal<'alert' | 'status'> {
    return computed(() => (this.variant() === 'error' ? 'alert' : 'status'));
  }

  private initResolvedDuration(): Signal<number> {
    return computed(() => {
      const given = this.duration();
      if (given !== null) return given;
      if (this.variant() === 'error') return 0;
      return this.actions().length ? 8000 : 5000;
    });
  }

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. 12px gap, 12px padding (16px at the start), 56px minimum height and 420px width are library values.
      const base =
        'flex min-h-[56px] w-[420px] max-w-[calc(100vw-32px)] items-center gap-[12px] rounded-ui-md py-[12px] pl-[16px] pr-[12px] shadow-modal copy-14';
      const variants = {
        default: 'bg-ui-background-100 text-ui-neutral-900',
        success: 'bg-ui-success-600 text-white',
        warning: 'bg-ui-warning-500 text-ui-neutral-900',
        error: 'bg-ui-danger-600 text-white',
      };
      return `${base} ${variants[this.variant()]}`;
    });
  }

  private initVisibleActions(): Signal<{ action: UiToastAction; classes: string }[]> {
    return computed(() =>
      this.actions()
        .slice(0, 2)
        .map((action) => {
          // 10px radius, 10px padding and 6px gap are the small-button steps.
          const shape = `${this.buttonBase()} gap-[6px] rounded-[10px] px-[10px] button-14`;
          // shortcut: hover/active mixes spelled out with var(). revisit: when the library ships hover/active mix tokens
          const primary =
            'bg-ui-accent-500 text-white hover:bg-[color-mix(in_srgb,var(--ui-accent-500)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-accent-500)_76%,var(--ui-slate-900))]';
          const accent = action.primary && this.variant() === 'default';
          return { action, classes: `${shape} ${accent ? primary : this.quietInk()}` };
        })
    );
  }

  private initDismissClasses(): Signal<string> {
    return computed(() => `${this.buttonBase()} aspect-square rounded-ui-full ${this.quietInk()}`);
  }

  private initShowDismiss(): Signal<boolean> {
    return computed(() => this.dismissible() || (this.resolvedDuration() === 0 && !this.visibleActions().length));
  }

  private syncTimer(): void {
    if (this.hovered || this.focused) this.pause();
    else this.resume();
  }

  // Counts down what is left, so a pause does not restart the full duration.
  private resume(): void {
    if (this.remaining <= 0 || this.timer !== null || this.hovered || this.focused) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.remaining = 0;
      this.dismissed.emit();
    }, this.remaining);
  }

  private pause(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.remaining = Math.max(1, this.remaining - (Date.now() - this.startedAt));
  }

  // Back to the element focus came from if it is still on the page; otherwise the removed button leaves focus on the body.
  private restoreFocus(): void {
    const target = this.returnTarget;
    if (target?.isConnected && target !== this.document.activeElement) target.focus();
  }

  // shortcut: native buttons in the small tertiary look. revisit: when lfx-ui-button gets an on-colour variant (white ink)
  private buttonBase(): string {
    return 'inline-flex h-ui-small cursor-pointer items-center justify-center whitespace-nowrap transition-colors duration-ui-base ease-ui-standard motion-reduce:transition-none focus-visible:shadow-focus focus-visible:outline-none';
  }

  // Success and error toasts get white ink and a translucent white hover; the rule has no token, so the 16% white is written out.
  private quietInk(): string {
    return this.variant() === 'success' || this.variant() === 'error'
      ? 'bg-transparent text-white hover:bg-[rgba(255,255,255,0.16)]'
      : 'bg-transparent text-ui-neutral-900 hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200';
  }
}
