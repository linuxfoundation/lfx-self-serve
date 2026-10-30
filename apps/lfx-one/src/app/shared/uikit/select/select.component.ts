// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, InteractivityChecker, ListKeyManager } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  contentChildren,
  inject,
  Injector,
  input,
  linkedSignal,
  model,
  output,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { UiInputSize, UiOption } from '@lfx-one/shared/interfaces';

import { UiErrorComponent } from '../error/error.component';
import { UiOptionHost } from './option-host';
import { UiOptionComponent } from './option.component';
import { UiSelectValueDirective } from './select-value.directive';

/**
 * Picks one value from a list, with an optional label, hint, error and leading icon. The choices are projected `lfx-ui-option` rows, which can hold
 * any content, optionally grouped with `lfx-ui-option-group` and divided with `lfx-ui-option-separator`:
 *
 * ```html
 * <lfx-ui-select label="Foundation" [(value)]="foundation">
 *   <lfx-ui-option-group label="Hosted"><lfx-ui-option value="cncf" label="CNCF"><my-row /></lfx-ui-option></lfx-ui-option-group>
 *   <lfx-ui-option-separator />
 *   <lfx-ui-option value="none" label="None" />
 * </lfx-ui-select>
 * ```
 *
 * Slots, by attribute: `lfxUiSelectPrefix` (content before the value in the trigger, such as an icon or an avatar), `lfxUiSelectHeader` (the top
 * of the panel, such as a search field; the first focusable element in it takes focus when the panel opens, Escape closes and returns focus to the
 * trigger, and Arrow Down hands focus back to the list) and `<ng-template lfxUiSelectValue let-option>` (what the trigger shows for the picked
 * option, instead of its label). Filtering the options from a search field is up to the page: render only the matching `lfx-ui-option` rows,
 * and reset the query from `openChange`. The trigger keeps showing the picked option while a filter hides its row.
 *
 * Built to the WAI-ARIA select-only combobox pattern: the list is a `listbox` and the highlighted row is announced with `aria-activedescendant`.
 * Focus stays on the trigger, except while a header field has it. Works with `[(value)]` and with Angular forms (`formControlName`, `formControl`).
 *
 * Keyboard: Arrow Down, Arrow Up, Enter or Space opens the list on the chosen row. Arrows, Home, End, Page Up and Page Down move through
 * it, typing jumps to a row by its label, Enter or Space picks, Escape closes without picking, Tab picks and moves on. With a header field,
 * a typed character on the closed trigger only opens the list, so typing starts in the field. Tab from the last header field closes the list
 * and moves on from the trigger, and Shift+Tab from the first one stops on the trigger; neither picks an option.
 * Use it for short lists. For typed input that is the value itself, use the combobox; for several values, the multi-select.
 */
@Component({
  selector: 'lfx-ui-select',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgTemplateOutlet, UiErrorComponent],
  providers: [{ provide: UiOptionHost, useExisting: UiSelectComponent }],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiSelectComponent extends UiOptionHost implements ControlValueAccessor {
  private readonly baseId = inject(_IdGenerator).getId('lfx-ui-select-');
  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly checker = inject(InteractivityChecker);
  protected readonly origin = viewChild.required(CdkOverlayOrigin);
  protected readonly overlay = viewChild.required(CdkConnectedOverlay);
  protected readonly valueTemplate = contentChild(UiSelectValueDirective);
  protected readonly optionComponents = contentChildren(UiOptionComponent, { descendants: true });
  /** The projected options, in document order, groups included. */
  protected readonly options: Signal<UiOption[]> = computed(() => this.optionComponents().map((option) => option.item));

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
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-globe`. A picked option's own icon replaces it. For other content use the `lfxUiSelectPrefix` slot. */
  public readonly prefixIcon = input<string>('');
  /** Fully rounded trigger with 16px side padding, like `rounded` on the input. */
  public readonly pill = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The `value` of the picked option, or `null` for none. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string | null>(null);
  /** Emits `true` when the list opens and `false` when it closes, so a page can reset its search query. */
  public readonly openChange = output<boolean>();

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
  // The highlighted option by identity, so it survives the options changing under it.
  protected readonly activeItem = signal<UiOption | null>(null);
  protected readonly panelWidth = signal(0);
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  // The panel closes when the field is disabled under it.
  protected readonly expanded: Signal<boolean> = computed(() => this.open() && !this.isDisabled());
  protected readonly selectedIndex: Signal<number> = computed(() => this.options().findIndex((option) => option.value === this.value()));
  protected readonly selected: Signal<UiOption | null> = this.initSelected();
  protected readonly activeOption: Signal<UiOption | null> = this.initActiveOption();
  protected readonly activeIndex: Signal<number> = computed(() => this.options().findIndex((option) => option === this.activeOption()));
  protected readonly activeDescendant: Signal<string | null> = computed(() => this.activeOption()?.id ?? null);
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
    super();
    if (this.ngControl) this.ngControl.valueAccessor = this;
    this.keyManager.change.pipe(takeUntilDestroyed()).subscribe((index) => {
      this.activeItem.set(this.options()[index] ?? null);
    });
    // After the panel renders, keep the highlighted row visible, including when the fallback moves it.
    afterRenderEffect(() => this.document.getElementById(this.activeOption()?.id ?? '')?.scrollIntoView({ block: 'nearest' }));
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

  public isSelected(option: UiOption): boolean {
    return option.value === this.value();
  }

  public isActive(option: UiOption): boolean {
    return this.activeOption() === option;
  }

  public pick(option: UiOption): void {
    this.select(option);
  }

  public highlight(option: UiOption): void {
    const index = this.options().indexOf(option);
    if (this.activeIndex() === index || option.disabled) return;
    this.syncKeyManager();
    this.keyManager.setActiveItem(index);
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
      const typed = !opensOnly && this.isCharacter(event);
      if (opensOnly || typed) event.preventDefault();
      // A typed character opens the list, then jumps to its row unless a header field takes focus for the typing.
      if (typed) {
        this.openPanel(event.key);
        return;
      }
      // Home and End open the list and then move the highlight, like the native select.
      if (opensOnly || event.key === 'Home' || event.key === 'End') this.openPanel();
      if (opensOnly || !this.open()) return;
    }
    this.syncKeyManager();

    if (event.key === 'Escape') {
      event.preventDefault();
      // A select inside a modal must not close the modal as well.
      event.stopPropagation();
      this.closePanel();
    } else if (event.key === 'Enter' || (event.key === ' ' && !this.isTyping()) || (event.key === 'ArrowUp' && event.altKey)) {
      event.preventDefault();
      this.select(this.activeOption());
    } else if (event.key === 'Tab') {
      // Tab picks the highlighted row and lets focus move on.
      this.select(this.activeOption());
    } else if (this.isCharacter(event)) {
      event.preventDefault();
      this.typeAhead(event.key);
    } else {
      this.keyManager.onKeydown(event);
    }
  }

  protected onBlur(event: FocusEvent): void {
    // Focus moving into the panel header (a search field) keeps the list open.
    if (this.panelHolds(event.relatedTarget)) return;
    this.closePanel();
    this.onTouched?.();
  }

  protected onPanelFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next === this.origin().elementRef.nativeElement || this.panelHolds(next)) return;
    this.closePanel();
    this.onTouched?.();
  }

  protected onHeaderMousedown(event: MouseEvent): void {
    // Only a field in the header may take focus; a click on its padding must not close the list by dropping focus.
    if (!(event.target as HTMLElement).closest('input, textarea, select, button, a[href], [tabindex]')) event.preventDefault();
  }

  protected onHeaderKeydown(event: KeyboardEvent): void {
    // Composition keys are not ours; the overlay's own Escape close is off for the same reason.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      // A select inside a modal must not close the modal as well.
      event.stopPropagation();
      this.closePanel();
      this.focusTrigger();
    } else if (event.key === 'ArrowDown') {
      // The trigger owns `aria-activedescendant`, so list navigation continues from there.
      event.preventDefault();
      this.focusTrigger();
    } else if (event.key === 'Tab') {
      // The panel sits at the end of the body, so Tab out of it would land on <body>: hand focus to the trigger first.
      const fields = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('*')).filter((el) => this.checker.isTabbable(el));
      const edge = event.shiftKey ? fields[0] : fields.at(-1);
      if (edge && edge !== event.target) return;
      this.focusTrigger();
      if (event.shiftKey) {
        // Backward, the trigger is where focus stops.
        event.preventDefault();
        return;
      }
      // Forward: the still-mounted header would be the trigger's next tab stop, so make it inert and close.
      (event.currentTarget as HTMLElement).inert = true;
      this.closePanel();
    }
  }

  protected select(option: UiOption | null): void {
    if (!option || option.disabled || this.isDisabled()) return;
    // Picking the row that is already chosen is not a change: the control stays pristine.
    if (option.value !== this.value()) {
      this.value.set(option.value);
      this.onChange?.(option.value);
    }
    this.closePanel();
    // Focus may sit in the header, which is about to disappear.
    this.focusTrigger();
  }

  protected closePanel(): void {
    const wasOpen = this.open();
    this.open.set(false);
    this.activeItem.set(null);
    this.keyManager.updateActiveItem(-1);
    this.typed = '';
    if (wasOpen) this.openChange.emit(false);
  }

  private initSelected(): Signal<UiOption | null> {
    // A filter can remove the picked row while the value stays; keep showing the last match until the value changes.
    return linkedSignal<{ options: UiOption[]; value: string | null }, UiOption | null>({
      source: () => ({ options: this.options(), value: this.value() }),
      computation: ({ options, value }, previous) => {
        const match = options.find((option) => option.value === value);
        if (match) return match;
        return previous?.value && previous.value.value === value ? previous.value : null;
      },
    });
  }

  private initActiveOption(): Signal<UiOption | null> {
    return computed(() => {
      if (!this.expanded()) return null;
      const options = this.options();
      const item = this.activeItem();
      // The highlighted row may have left the list (a filter) or been disabled: fall back to the first row that can be picked.
      return (item && !item.disabled && options.includes(item) ? item : options.find((option) => !option.disabled)) ?? null;
    });
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
      // Exact px (14px root): 8 and 10px radii have no token; side padding and icon gap per size, 16px side padding when a pill.
      const radii = { tiny: 'rounded-[8px]', small: 'rounded-[10px]', medium: 'rounded-ui-sm' };
      const pads = { tiny: 'px-[8px] gap-[8px]', small: 'px-[10px] gap-[12px]', medium: 'px-[12px] gap-[10px]' };
      const pillPads = { tiny: 'px-[16px] gap-[8px]', small: 'px-[16px] gap-[12px]', medium: 'px-[16px] gap-[10px]' };
      const text = this.size() === 'tiny' ? 'label-12' : 'label-14';
      const size = this.size();
      const shape = this.pill() ? `rounded-ui-full ${pillPads[size]}` : `${radii[size]} ${pads[size]}`;
      return `flex w-full select-none items-center outline-none transition-shadow duration-ui-base ease-ui-standard motion-reduce:transition-none ${heights[size]} ${shape} ${text} ${fill} ${ring} ${forced}`;
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

  // Opens on the chosen row, or on the first one that can be picked (the active option falls back to it).
  private openPanel(typed?: string): void {
    if (this.isDisabled() || this.open()) return;
    this.panelWidth.set(this.origin().elementRef.nativeElement.getBoundingClientRect().width);
    this.open.set(true);
    this.activeItem.set(this.options()[this.selectedIndex()] ?? null);
    this.syncKeyManager();
    this.focusHeader(typed);
    this.openChange.emit(true);
  }

  // A search field in the header takes focus on open, so typing filters at once. Without one, a character that opened the list jumps to its row.
  private focusHeader(typed?: string): void {
    const focusable = '[data-testid="ui-select-header"] :is(input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"]))';
    afterNextRender(
      () => {
        const candidates = this.overlay().overlayRef?.overlayElement.querySelectorAll<HTMLElement>(focusable) ?? [];
        // A hidden or disabled field in the header cannot take focus, so skip to the first one that can.
        const field = Array.from(candidates).find((candidate) => this.checker.isFocusable(candidate));
        if (field) field.focus();
        else if (typed && this.open()) this.typeAhead(typed, true);
      },
      { injector: this.injector }
    );
  }

  // The options can change while the list is open, and the key manager only follows silently: point it at the highlighted row before it acts.
  private syncKeyManager(): void {
    this.keyManager.updateActiveItem(this.activeIndex());
  }

  private panelHolds(node: EventTarget | null): boolean {
    return node instanceof Node && !!this.overlay().overlayRef?.overlayElement.contains(node);
  }

  private isTyping(): boolean {
    return this.typed !== '' && Date.now() - this.typedAt <= 500;
  }

  // Own type-ahead: the CDK one waits for a pause before it moves, the pattern asks for an immediate jump and a half-second buffer.
  private typeAhead(char: string, opening = false): void {
    this.typed = this.isTyping() ? this.typed + char.toLowerCase() : char.toLowerCase();
    this.typedAt = Date.now();
    const options = this.options();
    // One letter pressed repeatedly cycles through the options that start with it; a longer word narrows from the current row.
    const cycling = [...this.typed].every((c) => c === this.typed[0]);
    const prefix = cycling ? this.typed[0] : this.typed;
    // The character that opens the list with nothing picked starts at the fallback row, so the first match wins.
    const startAtActive = opening && this.selectedIndex() < 0;
    const from = Math.max(0, cycling && !startAtActive ? this.activeIndex() + 1 : this.activeIndex());
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
}
