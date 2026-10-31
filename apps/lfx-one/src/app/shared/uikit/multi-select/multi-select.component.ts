// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
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
  Injector,
  input,
  model,
  output,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { UiInputSize, UiOption } from '@lfx-one/shared/interfaces';

import { UiBadgeComponent } from '../badge/badge.component';
import { UiOptionHost } from '../select/option-host';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Picks several values from a known list. The trigger shows the field's name and, once something is picked, a count. The choices are the same
 * projected `lfx-ui-option` rows the select uses, optionally grouped with `lfx-ui-option-group` and divided with `lfx-ui-option-separator`:
 *
 * ```html
 * <lfx-ui-multi-select label="Environments" [(values)]="environments">
 *   <lfx-ui-option value="prod" label="Production" />
 *   <lfx-ui-option value="preview" label="Preview" />
 * </lfx-ui-multi-select>
 * ```
 *
 * Each row is a checkbox and, on the row under the pointer or the keyboard focus, an "Only" button that picks that value and drops the rest.
 * Picking a row keeps the list open. `values` is the list of picked `value`s, in the order they were picked, and the form value is the same
 * `string[]`. Works with `[(values)]` and with Angular forms (`formControlName`, `formControl`).
 *
 * When the trigger is too narrow for the name, hovering or focusing it shows the full name in a tooltip; the tooltip stays off otherwise and while the list is open.
 * The trigger is a disclosure button (`aria-expanded`, `aria-controls`) and the list is a labelled group of real checkboxes and buttons: focus
 * moves into it when it opens. Each checkbox is named by its option's `label`; the Only button is named "Only" plus that label.
 *
 * Keyboard: Enter, Space, Arrow Down or Arrow Up on the trigger opens the list and focuses the first picked row, or the first row that can be
 * picked. Arrow Up and Arrow Down move between rows, Home and End to the first and last, Arrow Right moves from a row's checkbox to its Only
 * button and Arrow Left back. Space toggles a checkbox, Enter toggles it or presses Only. Escape closes the list and returns focus to the
 * trigger; Tab closes it and moves on from the trigger. Nothing is picked or dropped by closing. Use it for filters and settings with a few known
 * values; for one value use the select, and for a long searchable list the combobox.
 */
@Component({
  selector: 'lfx-ui-multi-select',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, UiBadgeComponent, UiTooltipDirective],
  providers: [{ provide: UiOptionHost, useExisting: UiMultiSelectComponent }],
  templateUrl: './multi-select.component.html',
  styleUrl: './multi-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiMultiSelectComponent extends UiOptionHost implements ControlValueAccessor {
  private readonly baseId = inject(_IdGenerator).getId('lfx-ui-multi-select-');
  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly origin = viewChild.required(CdkOverlayOrigin);
  private readonly nameEl = viewChild.required<ElementRef<HTMLElement>>('nameEl');
  public override readonly multiple = true;

  /** The field's name, shown in the trigger and used as its accessible name. Without one, set `ariaLabel`. */
  public readonly label = input<string>('');
  /** Accessible name when there is no visible `label`. */
  public readonly ariaLabel = input<string>('');
  /** `tiny` 24px, `small` 32px, `medium` 40px. Pair with a button of the same size. */
  public readonly size = input<UiInputSize>('medium');
  /** Disables the field. Forms can also disable it. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The `value`s of the picked options, in the order they were picked. Supports two-way binding with `[(values)]`. */
  public readonly values = model<string[]>([]);
  /** Emits `true` when the list opens and `false` when it closes. */
  public readonly openChange = output<boolean>();

  protected readonly triggerId = this.baseId;
  protected readonly panelId = `${this.baseId}-panel`;
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  protected readonly open = signal(false);
  protected readonly panelWidth = signal(0);
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  // The panel closes when the field is disabled under it.
  protected readonly expanded: Signal<boolean> = computed(() => this.open() && !this.isDisabled());
  protected readonly name: Signal<string> = computed(() => this.label() || this.ariaLabel());
  protected readonly count: Signal<number> = computed(() => this.values().length);
  protected readonly accessibleName: Signal<string> = computed(() => (this.count() > 0 ? `${this.name()}, ${this.count()} selected` : this.name()));
  // True while the field's name is cut off by the trigger's width; the name tooltip only shows then.
  protected readonly truncated = signal(false);
  protected readonly tooltipOff: Signal<boolean> = computed(() => this.expanded() || !this.truncated());
  protected readonly triggerClasses: Signal<string> = this.initTriggerClasses();
  protected readonly chevronClasses: Signal<string> = this.initChevronClasses();

  private onChange: ((values: string[]) => void) | null = null;
  private onTouched: (() => void) | null = null;

  public constructor() {
    super();
    if (this.ngControl) this.ngControl.valueAccessor = this;
    afterNextRender(() => {
      const name = this.nameEl().nativeElement;
      const measure = (): void => this.truncated.set(name.scrollWidth > name.clientWidth);
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      // The name's box changes with the trigger's width, the count badge and the name itself.
      const observer = new ResizeObserver(measure);
      observer.observe(name);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  public writeValue(values: string[] | null): void {
    this.values.set(values ?? []);
  }

  public registerOnChange(fn: (values: string[]) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
    if (isDisabled) this.closePanel();
  }

  public isSelected(option: UiOption): boolean {
    return this.values().includes(option.value);
  }

  // Rows take real focus here, so there is no list highlight for the host to track.
  public isActive(): boolean {
    return false;
  }

  public pick(option: UiOption): void {
    if (option.disabled || this.isDisabled()) return;
    this.commit(this.isSelected(option) ? this.values().filter((value) => value !== option.value) : [...this.values(), option.value]);
  }

  public override only(option: UiOption): void {
    if (option.disabled || this.isDisabled()) return;
    this.commit([option.value]);
  }

  public highlight(): void {
    // Rows take real focus here; hover is styled by CSS.
  }

  protected toggle(): void {
    if (this.open()) this.closePanel();
    else this.openPanel();
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.open()) this.focusFirst();
      else this.openPanel();
    } else if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      // A multi-select inside a modal must not close the modal as well.
      event.stopPropagation();
      this.closePanel();
    }
  }

  protected onTriggerBlur(): void {
    if (!this.open()) this.onTouched?.();
  }

  protected onPanelKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const column = target.matches(this.actionSelector()) ? this.actionSelector() : this.boxSelector();
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.closePanel(true);
        break;
      case 'Tab':
        // Focus goes back to the trigger first, so the browser's own Tab moves on from there and never drops to the page.
        this.closePanel(true);
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const rows = this.controls(column);
        const next = rows.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1);
        // Not wrapping, as the pattern asks. From the panel itself, Arrow Down enters the first row.
        if (!rows.includes(target)) this.focusFirst();
        else rows[next]?.focus();
        break;
      }
      case 'Home':
      case 'End': {
        event.preventDefault();
        const rows = this.controls(column);
        (event.key === 'Home' ? rows[0] : rows[rows.length - 1])?.focus();
        break;
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        const row = target.closest('lfx-ui-option');
        const sibling = row?.querySelector<HTMLElement>(event.key === 'ArrowRight' ? this.actionSelector() : this.boxSelector());
        if (!sibling) break;
        event.preventDefault();
        sibling.focus();
        break;
      }
      case 'Enter':
        // A checkbox ignores Enter natively; the library has it toggle like Space.
        if (target.matches(this.boxSelector())) {
          event.preventDefault();
          if (!event.repeat) target.click();
        }
        break;
    }
  }

  protected onPanelFocusout(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next) {
      // The focused row can be removed while the list is open: once the page has settled, focus returns to the first row instead of the body.
      afterNextRender(
        () => {
          if (this.open() && this.document.activeElement === this.document.body) this.focusFirst();
        },
        { injector: this.injector }
      );
    } else if (!this.panel()?.contains(next) && !this.trigger().contains(next)) this.leave();
  }

  protected onOutsideClick(event: MouseEvent): void {
    if (!this.trigger().contains(event.target as Node)) this.leave();
  }

  // Wait for the rows to render, then move focus into the panel.
  protected onAttach(): void {
    afterNextRender(() => this.focusFirst(), { injector: this.injector });
  }

  protected closePanel(returnFocus = false): void {
    const wasOpen = this.open();
    // Focus moves while the trigger and the panel are still in the page.
    if (wasOpen && returnFocus) this.trigger().focus();
    this.open.set(false);
    if (wasOpen) this.openChange.emit(false);
  }

  private initTriggerClasses(): Signal<string> {
    return computed(() => {
      // Library recipe (same as Input): 1px ring at rest, stronger ring plus a 4px halo when focused or open (accent).
      const interactive =
        'cursor-pointer hover:edge-hover focus-visible:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)] aria-expanded:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)]';
      // A disabled field keeps the resting ring only, so it does not look interactive on hover.
      const ring = this.isDisabled() ? 'edge cursor-not-allowed' : `edge ${interactive}`;
      const fill = this.isDisabled() ? 'bg-ui-neutral-50 text-ui-neutral-500' : 'bg-ui-background-100 text-ui-neutral-900';
      // forced-colors: shadows vanish, so a real border keeps the field visible and an outline marks focus.
      const border = this.isDisabled() ? 'forced-colors:border-[color:GrayText]' : 'forced-colors:border-[color:CanvasText]';
      const forced = `forced-colors:border ${border} forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[color:Highlight]`;
      const size: UiInputSize = this.size();
      const heights = { tiny: 'h-ui-tiny', small: 'h-ui-small', medium: 'h-ui-medium' };
      // Exact px (14px root): 8 and 10px radii have no token; side padding and gap per size.
      const radii = { tiny: 'rounded-[8px]', small: 'rounded-[10px]', medium: 'rounded-ui-sm' };
      const pads = { tiny: 'px-[8px] gap-[4px]', small: 'px-[10px] gap-[6px]', medium: 'px-[12px] gap-[8px]' };
      const text = size === 'tiny' ? 'label-12' : 'label-14';
      return `flex w-full select-none items-center outline-none transition-shadow duration-ui-base ease-ui-standard motion-reduce:transition-none ${heights[size]} ${radii[size]} ${pads[size]} ${text} ${fill} ${ring} ${forced}`;
    });
  }

  private initChevronClasses(): Signal<string> {
    // Exact px (14px root): the library's chevron is 10px in the tiny field and 12px in the others.
    return computed(() => `inline-flex shrink-0 items-center text-ui-neutral-600 ${this.size() === 'tiny' ? 'text-[10px]' : 'text-[12px]'}`);
  }

  private commit(values: string[]): void {
    this.values.set(values);
    this.onChange?.(values);
  }

  // Focus left the field for somewhere else: close without stealing it back.
  private leave(): void {
    this.closePanel();
    this.onTouched?.();
  }

  private openPanel(): void {
    if (this.isDisabled() || this.open()) return;
    this.panelWidth.set(this.trigger().getBoundingClientRect().width);
    this.open.set(true);
    this.openChange.emit(true);
  }

  // The first picked row, or the first row that can be picked; the panel itself when no row can.
  private focusFirst(): void {
    const boxes = this.controls(this.boxSelector());
    (boxes.find((box) => (box as HTMLInputElement).checked) ?? boxes[0] ?? this.panel())?.focus();
  }

  private boxSelector(): string {
    return 'lfx-ui-option input[type="checkbox"]:not(:disabled)';
  }

  private actionSelector(): string {
    return 'lfx-ui-option [data-ui-option-action] button';
  }

  private controls(selector: string): HTMLElement[] {
    return Array.from(this.panel()?.querySelectorAll<HTMLElement>(selector) ?? []);
  }

  private trigger(): HTMLElement {
    return this.origin().elementRef.nativeElement;
  }

  private panel(): HTMLElement | null {
    return this.document.getElementById(this.panelId);
  }
}
