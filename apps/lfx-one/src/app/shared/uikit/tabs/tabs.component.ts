// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  signal,
  Signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { UiTabItem, UiTabsSize, UiTabsVariant, UiTone } from '@lfx-one/shared/interfaces';

import { UiOptionComponent } from '../select/option.component';
import { UiSelectComponent } from '../select/select.component';
import { UiSelectValueDirective } from '../select/select-value.directive';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Tabs for switching sections of one page, following the WAI-ARIA tabs pattern: a labelled `tablist`, roving `tabindex`, and
 * Left/Right/Home/End moving focus and selection together. Disabled tabs take focus from those keys without being selected, so their
 * reason tooltip opens, but they stay out of the initial tab stop. Use `[(value)]` to read and set the selection.
 * `variant="default"` is an underline with a 2px accent bar on a rule; `variant="secondary"` is 32px pills. `size="small"` is 13px; the
 * default is 14px. A tab can have a count, an icon, and a disabled state with a tooltip that says why. The component renders the
 * tablist only: render the `role="tabpanel"` elements yourself and point them at `idPrefix`. Projected content, such as a search field, sits at
 * the end of the row, 16px from the tabs and on the same rule; it wraps below the tabs when the row is too narrow, and the rule stays under it.
 * A tab can lead with a 7px dot in a colour role (`dotTone`). With `collapseToSelect`, tabs too wide for the row turn into a 32px select that
 * shows the chosen tab with its dot and count; its options keep theirs. The width is measured in the browser, so the server renders the tabs.
 * The host's width must not follow its content, or it never widens again: keep it a block, or `flex-1 min-w-0` in a row.
 */
@Component({
  selector: 'lfx-ui-tabs',
  imports: [NgTemplateOutlet, UiOptionComponent, UiSelectComponent, UiSelectValueDirective, UiTooltipDirective],
  templateUrl: './tabs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A flex row keeps the list's negative margins inside the host, so the rule sits on the tabs' bottom edge; 16px gaps, exact px.
  host: { class: 'flex flex-wrap items-end justify-between gap-[16px]', '[class]': 'hostClasses()' },
})
export class UiTabsComponent {
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  /** The tabs to render, in order. */
  public readonly tabs = input.required<UiTabItem[]>();
  /** Accessible name for the tab list. */
  public readonly ariaLabel = input<string>('');
  /** `default` is 14px; `small` is 13px with 11px bottom padding. The secondary variant ignores it. */
  public readonly size = input<UiTabsSize>('default');
  /** `default` is an underline on a rule; `secondary` is 32px pills without a rule. */
  public readonly variant = input<UiTabsVariant>('default');

  /** Prefix for tab and panel ids. When set, each tab gets `{prefix}-tab-{value}` and `aria-controls="{prefix}-panel-{value}"`. */
  public readonly idPrefix = input<string>('');
  /** Swaps the tabs for a select, named by `ariaLabel`, while they do not fit the row. Off by default. */
  public readonly collapseToSelect = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The selected tab's value. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string>('');

  private readonly listElement = viewChild.required<ElementRef<HTMLElement>>('tabList');
  private readonly tabElements = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');
  private readonly selectElement = viewChild<UiSelectComponent, ElementRef<HTMLElement>>(UiSelectComponent, { read: ElementRef });
  /** True while the tabs are wider than the row; only ever set in the browser. */
  private readonly overflowing = signal(false);
  /** Index of the tab that holds focus, or null when focus is outside the list. */
  protected readonly focusedIndex = signal<number | null>(null);

  /** The resting tab stop: the selected enabled tab, else the first enabled tab. */
  protected readonly focusIndex: Signal<number> = this.initFocusIndex();
  /** The one tab in the tab order: the focused tab (a disabled one included) while focus is in the list, else the resting tab stop. */
  protected readonly tabStopIndex: Signal<number> = computed(() => this.focusedIndex() ?? this.focusIndex());
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly listClasses: Signal<string> = this.initListClasses();
  protected readonly tabClasses: Signal<string> = this.initTabClasses();
  protected readonly iconSize: Signal<number> = computed(() => (this.size() === 'small' && this.variant() === 'default' ? 13 : 14));
  protected readonly collapsed: Signal<boolean> = computed(() => this.collapseToSelect() && this.overflowing());
  protected readonly selectedTab: Signal<UiTabItem | undefined> = computed(() => this.tabs().find((t) => t.value === this.value()));
  /** Dot classes by tab value; empty for tabs without a dot. */
  protected readonly dotClasses: Signal<Record<string, string>> = this.initDotClasses();
  /** True when any tab has a dot, so dotless options keep a spacer and the labels line up. */
  protected readonly hasDots: Signal<boolean> = computed(() => this.tabs().some((t) => t.dotTone));

  public constructor() {
    // The row's width changes with its container; the tabs' width changes with their labels, counts and fonts.
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(this.hostElement.nativeElement);
      observer.observe(this.listElement().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
      // A web font that swaps in changes the tabs' width without resizing either box.
      this.document.fonts?.ready.then(() => this.measure());
    });
    afterRenderEffect(() => {
      this.tabs();
      this.collapseToSelect();
      this.measure();
    });
  }

  protected select(tab: UiTabItem): void {
    if (!tab.disabled) this.value.set(tab.value);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    // Arrows wrap; every tab, disabled ones included, can take focus.
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.select(tabs[next]);
    this.tabElements()[next]?.nativeElement.focus();
  }

  protected onSelectChange(value: string | null): void {
    if (value !== null) this.value.set(value);
  }

  private initFocusIndex(): Signal<number> {
    return computed(() => {
      const tabs = this.tabs();
      const selected = tabs.findIndex((t) => t.value === this.value() && !t.disabled);
      return selected >= 0 ? selected : tabs.findIndex((t) => !t.disabled);
    });
  }

  private initHostClasses(): Signal<string> {
    // The rule is an inset shadow on the host, so the selected bar sits on top of it (as in the library).
    return computed(() => {
      const rule = this.variant() === 'secondary' ? '' : 'shadow-[inset_0_-1px_0_0] shadow-ui-neutral-alpha-200';
      // The hidden list is positioned against the host while the select stands in for it.
      return this.collapseToSelect() ? `relative ${rule}` : rule;
    });
  }

  private initDotClasses(): Signal<Record<string, string>> {
    return computed(() => {
      // Each role's solid dot shade; forced colours keep the dot visible as text colour.
      const tones: Record<UiTone, string> = {
        neutral: 'bg-ui-neutral-500',
        accent: 'bg-ui-accent-600',
        feature: 'bg-ui-feature-700',
        warning: 'bg-ui-warning-600',
        danger: 'bg-ui-danger-600',
        success: 'bg-ui-success-600',
      };
      return Object.fromEntries(this.tabs().map((t) => [t.value, t.dotTone ? `${tones[t.dotTone]} forced-colors:bg-[color:CanvasText]` : '']));
    });
  }

  private initListClasses(): Signal<string> {
    return computed(() => {
      // Exact px gap, not rem; 14px root. The 4px padding, offset by negative margins, gives the focus ring room on every side inside the scroll area.
      // shrink-0 lets projected content narrow first; max-w-full still scrolls tabs wider than the row.
      const base = '-mx-[4px] -my-[4px] flex max-w-full shrink-0 items-end overflow-x-auto p-[4px] isolate';
      // Collapsed, the list keeps its full width out of sight, past the row's unscrollable start edge; 4px offsets its margin.
      const hidden = this.collapsed() ? ' invisible absolute right-[4px] top-0 w-max max-w-none' : '';
      return this.variant() === 'secondary' ? `${base} gap-[4px]${hidden}` : `${base} gap-[24px]${hidden}`;
    });
  }

  private initTabClasses(): Signal<string> {
    return computed(() => {
      const base =
        'relative inline-flex cursor-pointer items-center whitespace-nowrap border-0 bg-transparent label-14 transition-[color] duration-ui-base focus-visible:shadow-focus focus-visible:outline-none motion-reduce:transition-none aria-disabled:cursor-not-allowed aria-disabled:text-ui-neutral-400 aria-disabled:hover:text-ui-neutral-400';
      if (this.variant() === 'secondary') {
        // Exact px sizes, not rem; the 10px radius is the library's radius-sm minus 2px (no token).
        return `${base} h-[32px] gap-[8px] rounded-[10px] px-[12px] text-ui-neutral-600 hover:text-ui-neutral-900 before:absolute before:inset-0 before:z-[-1] before:rounded-ui-sm before:bg-transparent before:transition-[background-color] before:duration-ui-base before:content-[''] motion-reduce:before:transition-none hover:before:bg-ui-neutral-alpha-50 aria-selected:cursor-default aria-selected:font-medium aria-selected:text-ui-accent-700 aria-selected:before:bg-ui-accent-100`;
      }
      // Exact px padding and gap, not rem; the selected bar is a 2px ::after on the tab's bottom edge.
      const size = this.size() === 'small' ? 'pb-[11px] text-[13px]' : 'pb-[14px]';
      return `${base} gap-[7px] pt-[8px] ${size} text-ui-neutral-700 hover:text-ui-neutral-900 aria-selected:cursor-default aria-selected:font-medium aria-selected:text-ui-neutral-900 aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:bottom-0 aria-selected:after:h-[2px] aria-selected:after:bg-ui-accent-500 aria-selected:after:content-['']`;
    });
  }

  private measure(): void {
    if (!this.collapseToSelect()) return;
    const host = this.hostElement.nativeElement;
    const list = this.listElement().nativeElement;
    const style = this.document.defaultView?.getComputedStyle(host);
    // The list is capped at the host's content box; its scroll width is its full content in both modes, so the check does not flip-flop.
    const room = host.clientWidth - (parseFloat(style?.paddingLeft ?? '') || 0) - (parseFloat(style?.paddingRight ?? '') || 0);
    const overflowing = list.scrollWidth > room;
    if (overflowing === untracked(this.overflowing)) return;
    // Only focus on the control being replaced moves; projected content keeps it.
    const active = this.document.activeElement;
    const hadFocus = list.contains(active) || !!this.selectElement()?.nativeElement.contains(active);
    this.overflowing.set(overflowing);
    this.focusedIndex.set(null);
    // The control that held focus is gone or inert now, so hand focus to the one that replaced it.
    if (hadFocus) afterNextRender(() => this.focusControl(), { injector: this.injector });
  }

  private focusControl(): void {
    const target = this.collapsed()
      ? this.selectElement()?.nativeElement.querySelector<HTMLElement>('[role="combobox"]')
      : this.tabElements()[this.focusIndex()]?.nativeElement;
    target?.focus();
  }
}
