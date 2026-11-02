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
  signal,
  viewChild,
} from '@angular/core';
import { UiBadgeSize, UiBadgeTone, UiChipVariant } from '@lfx-one/shared/interfaces';

import { UiBadgeComponent } from '../badge/badge.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';
import { UiChipHost } from './chip-host';

/**
 * A badge that can be removed, for an applied filter or a selected value: "Project: CNCF" with a × button. It looks like `lfx-ui-badge`
 * (same sizes, pill radius, subtle and outline looks) and defaults to the accent subtle one at the small, 20px size. It only reports the
 * dismissal: the parent owns the list, so remove the chip from it in the `dismissed` handler, at once or after a request. The × is a real
 * button named "Remove" and the `label`, with a 24px hit area on both sizes. Put chips in an `lfx-ui-chip-group` to get a list role, wrapping and
 * focus that moves to a neighbouring chip once a removed chip is gone; a chip on its own leaves focus handling to the parent. A long label is cut
 * off with an ellipsis at the width of its container and shows in full in a tooltip then; it takes a tab stop then so the tooltip opens on
 * keyboard focus, and the × button's name carries the full text for screen readers. A chip that cannot be removed is a plain `lfx-ui-badge`; `dismissible` off keeps the chip's look for a read-only copy
 * of the same filter. A leading icon goes in as `<i slot="icon" class="fa-light fa-..."></i>`.
 */
@Component({
  selector: 'lfx-ui-chip',
  imports: [UiBadgeComponent, UiTooltipDirective],
  templateUrl: './chip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex max-w-full',
    '[attr.role]': 'group ? "listitem" : null',
    'data-testid': 'ui-chip',
  },
})
export class UiChipComponent {
  private readonly group = inject(UiChipHost, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dismissButton = viewChild<ElementRef<HTMLElement>>('dismissButton');
  private readonly labelElement = viewChild.required<ElementRef<HTMLElement>>('labelElement');

  /** The text of the chip, such as "Project: CNCF". It also names the × button: "Remove Project: CNCF". */
  public readonly label = input.required<string>();
  /** Colour role of the `subtle` look; `accent` is the filter-chip default. Ignored by `outline`. */
  public readonly tone = input<UiBadgeTone>('accent');
  /** `subtle` is the role's 100 fill with 700 text; `outline` is a hairline ring on the page background for neutral metadata. */
  public readonly variant = input<UiChipVariant>('subtle');
  /** `sm` is 20px tall with 11px text, the chip default; `md` is 24px tall with 12px text, the badge's default. */
  public readonly size = input<UiBadgeSize>('sm');
  /** Shows the × button. Turn it off for a read-only chip. */
  public readonly dismissible = input<boolean, unknown>(true, { transform: booleanAttribute });
  /** Emits when the × is activated by click, Enter or Space, once per press. The chip does not remove itself: drop it from the parent's list. */
  public readonly dismissed = output<void>();

  /** True from the moment `dismissed` is emitted until the chip is gone or the user starts a new click or key press on the ×, so a double-click or a held key emits once. A neighbour's removal skips a chip in this state. */
  public readonly dismissing = signal(false);
  protected readonly truncated = signal(false);
  protected readonly removeLabel: Signal<string> = computed(() => `Remove ${this.label()}`);
  protected readonly tooltipOff: Signal<boolean> = computed(() => !this.truncated());
  protected readonly dismissClasses: Signal<string> = this.initDismissClasses();

  // Set when the × held focus as it was activated; focus is restored only if the chip's destruction then left it nowhere.
  private heldFocus = false;
  private successor: UiChipComponent | null = null;

  public constructor() {
    afterNextRender(() => {
      const label = this.labelElement().nativeElement;
      const measure = (): void => this.truncated.set(label.scrollWidth > label.clientWidth);
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      // The label's box changes with the container's width and the label itself.
      const observer = new ResizeObserver(measure);
      observer.observe(label);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    this.destroyRef.onDestroy(() => this.restoreFocus());
  }

  /** Focuses the × of this chip. Returns false when it has none, is being removed or is gone. Used by the group once a neighbour is removed. */
  public focusDismiss(): boolean {
    const button = this.dismissButton()?.nativeElement;
    if (!button?.isConnected || this.dismissing()) return false;
    button.focus();
    return true;
  }

  protected onDismiss(button: HTMLElement): void {
    if (this.dismissing()) return;
    this.dismissing.set(true);
    this.heldFocus = this.document.activeElement === button;
    this.successor = this.group?.successorOf(this) ?? null;
    this.dismissed.emit();
  }

  // Holding Enter repeats keydown, and each repeat would click the × of whichever chip took focus next. A fresh press is a new activation.
  protected onKeydown(event: KeyboardEvent): void {
    if (event.repeat) event.preventDefault();
    else this.dismissing.set(false);
  }

  // The first mouse down of a click starts a new activation; the second of a double-click does not.
  protected onMouseDown(event: MouseEvent): void {
    if (event.detail <= 1) this.dismissing.set(false);
  }

  private initDismissClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. The circle is the badge height minus 4px, tucked into the badge's side padding; the after element
      // widens the hit area to 24px on both sizes, as the library asks of every target.
      const sizes = { sm: 'h-[16px] w-[16px] -mr-[4px]', md: 'h-[20px] w-[20px] -mr-[8px]' };
      const hit = "after:absolute after:left-1/2 after:top-1/2 after:h-[24px] after:w-[24px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";
      // forced-colors: shadows vanish, so an outline marks focus.
      const focus =
        'focus-visible:shadow-focus focus-visible:outline-none forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[color:Highlight]';
      return `relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-ui-full text-current transition-colors duration-ui-fast ease-ui-standard hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200 motion-reduce:transition-none ${sizes[this.size()]} ${hit} ${focus}`;
    });
  }

  // Focus moves while the × still holds it or has already lost it: with animations the renderer removes the node after this hook runs.
  private restoreFocus(): void {
    this.dismissing.set(true);
    if (!this.heldFocus || !this.group) return;
    const active = this.document.activeElement;
    if (active && active !== this.document.body && !this.host.contains(active)) return;
    this.group.restoreFocus(this.successor);
  }
}
