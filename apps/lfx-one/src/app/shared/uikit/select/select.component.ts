// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, ListKeyManager } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  model,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { UiInputSize, UiOption } from '@lfx-one/shared/interfaces';

import { UiErrorComponent } from '../error/error.component';

/**
 * Picks one value from a list, with an optional label, hint, error and leading icon. Built to the WAI-ARIA select-only combobox pattern:
 * focus stays on the trigger, the list is a `listbox`, and the highlighted row is announced with `aria-activedescendant`.
 * Works with `[(value)]` and with Angular forms (`formControlName`, `formControl`).
 *
 * Keyboard: Arrow Down, Arrow Up, Enter or Space opens the list on the chosen row. Arrows, Home, End, Page Up and Page Down move through
 * it, typing jumps to a row by its label, Enter or Space picks, Escape closes without picking, Tab picks and moves on.
 * Use it for short lists; for search or several values use the combobox or multi-select.
 */
@Component({
  selector: 'lfx-ui-select',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, UiErrorComponent],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiSelectComponent implements ControlValueAccessor {
  private readonly baseId = inject(_IdGenerator).getId('lfx-ui-select-');
  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  protected readonly origin = viewChild.required(CdkOverlayOrigin);

  /** The choices, in display order. */
  public readonly options = input<UiOption[]>([]);
  /** Visible label above the field. Without one, set `ariaLabel`. */
  public readonly label = input<string>('');
  /** Accessible name when there is no visible label. */
  public readonly ariaLabel = input<string>('');
  /** Helper text under the field. Hidden while an error shows. */
  public readonly hint = input<string>('');
  /** Error message under the field, phrased as how to fix the value. Marks the field invalid. */
  public readonly error = input<string>('');
  /** Text shown while nothing is picked. */
  public readonly placeholder = input<string>('');
  /** `tiny` 24px, `small` 32px, `medium` 40px. Pair with a button of the same size. */
  public readonly size = input<UiInputSize>('medium');
  /** Disables the field. Forms can also disable it. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Marks the field as required for assistive technology. */
  public readonly required = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-globe`. A picked option's own icon replaces it. */
  public readonly prefixIcon = input<string>('');
  /** The `value` of the picked option, or `null` for none. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string | null>(null);

  protected readonly triggerId = this.baseId;
  protected readonly labelId = `${this.baseId}-label`;
  protected readonly listboxId = `${this.baseId}-listbox`;
  protected readonly hintId = `${this.baseId}-hint`;
  protected readonly errorId = `${this.baseId}-error`;
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);
  protected readonly panelWidth = signal(0);
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  protected readonly selectedIndex: Signal<number> = computed(() => this.options().findIndex((option) => option.value === this.value()));
  protected readonly selected: Signal<UiOption | null> = computed(() => this.options()[this.selectedIndex()] ?? null);
  protected readonly activeDescendant: Signal<string | null> = computed(() =>
    this.open() && this.activeIndex() >= 0 ? this.optionId(this.activeIndex()) : null
  );
  protected readonly describedBy: Signal<string | null> = computed(() => {
    if (this.error()) return this.errorId;
    return this.hint() ? this.hintId : null;
  });
  protected readonly triggerClasses: Signal<string> = this.initTriggerClasses();
  protected readonly valueIconClasses: Signal<string> = this.initIconClasses();
  protected readonly chevronClasses: Signal<string> = this.initChevronClasses();

  private readonly keyManager = this.initKeyManager();
  private onChange: ((value: string | null) => void) | null = null;
  private onTouched: (() => void) | null = null;
  private typed = '';
  private typedAt = 0;

  public constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
    this.keyManager.change.pipe(takeUntilDestroyed()).subscribe((index) => {
      this.activeIndex.set(index);
      this.scrollActiveIntoView();
    });
  }

  public writeValue(value: string | null): void {
    this.value.set(value ?? null);
  }

  public registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
    if (isDisabled) this.closePanel();
  }

  protected optionId(index: number): string {
    return `${this.baseId}-option-${index}`;
  }

  protected focusTrigger(): void {
    if (!this.isDisabled()) this.origin().elementRef.nativeElement.focus();
  }

  protected toggle(): void {
    if (this.open()) this.closePanel();
    else this.openPanel();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.isDisabled()) return;
    if (!this.open()) {
      const opensOnly = ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key);
      if (opensOnly) event.preventDefault();
      // Home, End and a typed character open the list and then move the highlight, like the native select.
      if (opensOnly || event.key === 'Home' || event.key === 'End' || this.isCharacter(event)) this.openPanel();
      if (opensOnly || !this.open()) return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      // A select inside a modal must not close the modal as well.
      event.stopPropagation();
      this.closePanel();
    } else if (event.key === 'Enter' || (event.key === ' ' && !this.isTyping()) || (event.key === 'ArrowUp' && event.altKey)) {
      event.preventDefault();
      this.select(this.activeIndex());
    } else if (event.key === 'Tab') {
      // Tab picks the highlighted row and lets focus move on.
      this.select(this.activeIndex());
    } else if (this.isCharacter(event)) {
      event.preventDefault();
      this.typeAhead(event.key);
    } else {
      this.keyManager.onKeydown(event);
    }
  }

  protected onBlur(): void {
    this.closePanel();
    this.onTouched?.();
  }

  protected highlight(index: number): void {
    if (this.activeIndex() !== index && !this.options()[index]?.disabled) this.keyManager.setActiveItem(index);
  }

  protected select(index: number): void {
    const option = this.options()[index];
    if (!option || option.disabled) return;
    this.value.set(option.value);
    this.onChange?.(option.value);
    this.closePanel();
  }

  protected closePanel(): void {
    this.open.set(false);
    this.activeIndex.set(-1);
    this.keyManager.updateActiveItem(-1);
    this.typed = '';
  }

  protected scrollActiveIntoView(): void {
    // Wait for the panel to render when this runs as the list opens.
    afterNextRender(() => this.document.getElementById(this.optionId(this.activeIndex()))?.scrollIntoView({ block: 'nearest' }), { injector: this.injector });
  }

  private openPanel(): void {
    if (this.isDisabled() || this.open()) return;
    this.panelWidth.set(this.origin().elementRef.nativeElement.getBoundingClientRect().width);
    this.open.set(true);
    // Open on the chosen row, or on the first one that can be picked.
    const start = this.selectedIndex() >= 0 ? this.selectedIndex() : this.options().findIndex((option) => !option.disabled);
    this.keyManager.updateActiveItem(start);
    this.activeIndex.set(start);
    this.scrollActiveIntoView();
  }

  private isTyping(): boolean {
    return this.typed !== '' && Date.now() - this.typedAt <= 500;
  }

  // Own type-ahead: the CDK one waits for a pause before it moves, the pattern asks for an immediate jump and a half-second buffer.
  private typeAhead(char: string): void {
    this.typed = this.isTyping() ? this.typed + char.toLowerCase() : char.toLowerCase();
    this.typedAt = Date.now();
    const options = this.options();
    // One letter pressed repeatedly cycles through the options that start with it; a longer word narrows from the current row.
    const cycling = [...this.typed].every((c) => c === this.typed[0]);
    const prefix = cycling ? this.typed[0] : this.typed;
    const from = cycling ? this.activeIndex() + 1 : this.activeIndex();
    for (let step = 0; step < options.length; step++) {
      const index = (from + step) % options.length;
      if (!options[index].disabled && options[index].label.toLowerCase().startsWith(prefix)) {
        this.keyManager.setActiveItem(index);
        return;
      }
    }
  }

  private isCharacter(event: KeyboardEvent): boolean {
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  private initKeyManager(): ListKeyManager<UiOption> {
    // The manager skips disabled options and does not wrap, as the pattern asks.
    return new ListKeyManager(this.options, this.injector).withVerticalOrientation().withHomeAndEnd().withPageUpDown();
  }

  private initTriggerClasses(): Signal<string> {
    return computed(() => {
      // Library recipe (same as Input): 1px ring at rest, stronger ring plus a 4px halo when focused or open (accent) or invalid (danger).
      const dangerHalo = 'shadow-[0_0_0_1px_theme(colors.ui.danger.700),0_0_0_4px_theme(colors.ui.danger.200)]';
      const interactive =
        'cursor-pointer hover:edge-hover focus-visible:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)] aria-expanded:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)]';
      // A disabled field keeps the resting ring only, so it does not look interactive on hover.
      const rest = this.isDisabled() ? 'edge cursor-not-allowed' : `edge ${interactive}`;
      const ring = this.error() ? dangerHalo : rest;
      const fill = this.isDisabled() ? 'bg-ui-neutral-50 text-ui-neutral-500' : 'bg-ui-background-100 text-ui-neutral-900';
      // forced-colors: shadows vanish, so a real border keeps the field visible and an outline marks focus.
      const border = this.isDisabled() ? 'forced-colors:border-[color:GrayText]' : 'forced-colors:border-[color:CanvasText]';
      const forced = `forced-colors:border ${border} forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[color:Highlight]`;
      const heights = { tiny: 'h-ui-tiny', small: 'h-ui-small', medium: 'h-ui-medium' };
      // Exact px (14px root): 8 and 10px radii have no token; side padding and icon gap per size.
      const radii = { tiny: 'rounded-[8px]', small: 'rounded-[10px]', medium: 'rounded-ui-sm' };
      const pads = { tiny: 'px-[8px] gap-[8px]', small: 'px-[10px] gap-[12px]', medium: 'px-[12px] gap-[10px]' };
      const text = this.size() === 'tiny' ? 'label-12' : 'label-14';
      const size = this.size();
      return `flex w-full select-none items-center outline-none transition-shadow duration-ui-base ease-ui-standard motion-reduce:transition-none ${heights[size]} ${radii[size]} ${pads[size]} ${text} ${fill} ${ring} ${forced}`;
    });
  }

  private initIconClasses(): Signal<string> {
    return computed(() => `inline-flex shrink-0 items-center ${this.size() === 'tiny' ? 'text-[12px]' : 'text-[14px]'} text-ui-neutral-600`);
  }

  private initChevronClasses(): Signal<string> {
    return computed(() => {
      // Exact px: chevron 12px (10px tiny), pushed 12px from the text (10px small and tiny).
      const sizes = { tiny: 'ml-[10px] text-[10px]', small: 'ml-[10px] text-[12px]', medium: 'ml-[12px] text-[12px]' };
      return `inline-flex shrink-0 items-center text-ui-neutral-600 ${sizes[this.size()]}`;
    });
  }
}
