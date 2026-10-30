// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, ListKeyManager } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  inject,
  Injector,
  input,
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
import { UiOptionHost } from '../select/option-host';
import { UiOptionComponent } from '../select/option.component';

/**
 * A text field that narrows a list of suggestions as you type, with an optional label, hint and error. The suggestions are the same projected
 * `lfx-ui-option` rows the select uses, optionally grouped with `lfx-ui-option-group` and divided with `lfx-ui-option-separator`:
 *
 * ```html
 * <lfx-ui-combobox label="Project" placeholder="Search projects" emptyText="No projects match" [(value)]="project">
 *   <lfx-ui-option value="k8s" label="Kubernetes" />
 *   <lfx-ui-option value="keda" label="KEDA" />
 * </lfx-ui-combobox>
 * ```
 *
 * The component filters the rows itself: a row stays while its `label` contains the typed text, ignoring case, and the matching part of a plain
 * label is shown in bold. Rows with projected content keep their own look, and a group with no matching row is hidden. Separators stay. The field
 * picks from the list only: typed text that is not picked is dropped when focus leaves, and the field shows the picked option's `label` again.
 *
 * Built to the WAI-ARIA combobox pattern with a list popup: the input is the `combobox`, the list is a `listbox`, `aria-autocomplete="list"`
 * and the highlighted row is announced with `aria-activedescendant`. Focus never leaves the input. Works with `[(value)]` and with Angular forms.
 *
 * Keyboard: typing opens the list and highlights the first match. Arrow Down and Arrow Up open it and move through the rows, Page Up and Page
 * Down jump, Enter picks the highlighted row, Escape closes the list and keeps the typed text, Tab closes it without picking and moves on. Home
 * and End stay with the text caret. Use it for long or searchable lists; for a short list use the select, for several values the multi-select.
 */
@Component({
  selector: 'lfx-ui-combobox',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, UiErrorComponent],
  providers: [{ provide: UiOptionHost, useExisting: UiComboboxComponent }],
  templateUrl: './combobox.component.html',
  styleUrl: './combobox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiComboboxComponent extends UiOptionHost implements ControlValueAccessor {
  private readonly baseId = inject(_IdGenerator).getId('lfx-ui-combobox-');
  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  protected readonly origin = viewChild.required(CdkOverlayOrigin);
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
  /** Text shown while nothing is picked and nothing is typed. */
  public readonly placeholder = input<string>('');
  /** What the list says when no row matches. The typed text follows it in quotes, so `No projects match` reads `No projects match “xyz”`. */
  public readonly emptyText = input<string>('No matches');
  /** `tiny` 24px, `small` 32px, `medium` 40px. Pair with a button of the same size. */
  public readonly size = input<UiInputSize>('medium');
  /** Disables the field. Forms can also disable it. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Marks the field as required for assistive technology. */
  public readonly required = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The `value` of the picked option, or `null` for none. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string | null>(null);
  /** Emits `true` when the list opens and `false` when it closes. */
  public readonly openChange = output<boolean>();

  protected readonly inputId = this.baseId;
  protected readonly labelId = `${this.baseId}-label`;
  protected readonly listboxId = `${this.baseId}-listbox`;
  protected readonly hintId = `${this.baseId}-hint`;
  protected readonly errorId = `${this.baseId}-error`;
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  protected readonly open = signal(false);
  /** The text the user typed, or `null` while the field shows the picked option's label. */
  protected readonly query = signal<string | null>(null);
  // The highlighted option by identity. It is set when the list opens, when the text changes and by the keyboard, never derived from the rows.
  protected readonly activeItem = signal<UiOption | null>(null);
  protected readonly panelWidth = signal(0);
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  // The panel closes when the field is disabled under it.
  protected readonly expanded: Signal<boolean> = computed(() => this.open() && !this.isDisabled());
  protected readonly queryText: Signal<string> = computed(() => this.query()?.trim() ?? '');
  protected readonly selected: Signal<UiOption | null> = computed(() => this.options().find((option) => option.value === this.value()) ?? null);
  /** The rows that match the typed text, in document order. The keyboard moves through these. */
  protected readonly navigable: Signal<UiOption[]> = computed(() => this.options().filter((option) => this.matches(option)));
  protected readonly isEmpty: Signal<boolean> = computed(() => this.navigable().length === 0);
  protected readonly displayText: Signal<string> = computed(() => this.query() ?? this.selected()?.label ?? '');
  protected readonly emptyMessage: Signal<string> = computed(() => (this.queryText() ? `${this.emptyText()} “${this.queryText()}”` : this.emptyText()));
  protected readonly activeOption: Signal<UiOption | null> = this.initActiveOption();
  protected readonly activeDescendant: Signal<string | null> = computed(() => this.activeOption()?.id ?? null);
  protected readonly describedBy: Signal<string | null> = computed(() => {
    if (this.error()) return this.errorId;
    return this.hint() ? this.hintId : null;
  });
  protected readonly triggerClasses: Signal<string> = this.initTriggerClasses();
  protected readonly iconClasses: Signal<string> = this.initIconClasses();
  protected readonly chevronClasses: Signal<string> = this.initChevronClasses();

  private readonly keyManager = this.initKeyManager();
  private onChange: ((value: string | null) => void) | null = null;
  private onTouched: (() => void) | null = null;

  public constructor() {
    super();
    if (this.ngControl) this.ngControl.valueAccessor = this;
    this.keyManager.change.pipe(takeUntilDestroyed()).subscribe((index) => {
      this.activeItem.set(this.navigable()[index] ?? null);
    });
    // After the panel renders, keep the highlighted row visible.
    afterRenderEffect(() => this.revealActive());
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

  public override isVisible(option: UiOption): boolean {
    return this.matches(option);
  }

  public override matchRange(option: UiOption): [number, number] | null {
    const text = this.queryText().toLowerCase();
    const start = text ? option.label.toLowerCase().indexOf(text) : -1;
    return start < 0 ? null : [start, start + text.length];
  }

  public pick(option: UiOption): void {
    this.select(option);
  }

  public highlight(option: UiOption): void {
    const index = this.navigable().indexOf(option);
    if (index < 0 || option.disabled || this.activeOption() === option) return;
    this.syncKeyManager();
    this.keyManager.setActiveItem(index);
  }

  protected onTriggerClick(event: MouseEvent): void {
    if (this.isDisabled()) return;
    this.inputElement()?.focus();
    // A click in the text opens the list; a click anywhere else on the field, such as the chevron, toggles it.
    if (this.open() && event.target !== this.inputElement()) this.closePanel();
    else this.openPanel();
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.openPanel();
    this.activeItem.set(this.firstPickable());
    this.syncKeyManager();
  }

  protected onKeydown(event: KeyboardEvent): void {
    // Keys that belong to an input method composition are not ours.
    if (this.isDisabled() || event.isComposing || event.keyCode === 229) return;
    if (!this.open()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.openPanel();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      // A combobox inside a modal must not close the modal as well.
      event.stopPropagation();
      this.closePanel(true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) this.select(this.activeOption());
    } else if (event.key === 'Tab') {
      this.closePanel();
    } else {
      this.syncKeyManager();
      this.keyManager.onKeydown(event);
    }
  }

  protected onBlur(): void {
    this.closePanel();
    this.onTouched?.();
  }

  protected onDetach(): void {
    // The overlay left on its own (the panel closing already did its work), so only a list still marked open needs closing.
    if (this.open()) this.closePanel(true);
  }

  protected closePanel(keepText = false): void {
    const wasOpen = this.open();
    this.open.set(false);
    this.activeItem.set(null);
    this.keyManager.updateActiveItem(-1);
    // Typed text that was not picked is dropped, so the field shows the picked option again.
    if (!keepText) this.query.set(null);
    if (wasOpen) this.openChange.emit(false);
  }

  private initActiveOption(): Signal<UiOption | null> {
    return computed(() => {
      const item = this.activeItem();
      return this.expanded() && item && this.options().includes(item) ? item : null;
    });
  }

  private initKeyManager(): ListKeyManager<UiOption> {
    // The manager skips disabled options and does not wrap, as the pattern asks. Home and End stay with the text caret.
    return new ListKeyManager(this.navigable, this.injector).withVerticalOrientation().withPageUpDown();
  }

  private initTriggerClasses(): Signal<string> {
    return computed(() => {
      // Library recipe (same as Input): 1px ring at rest, stronger ring plus a 4px halo when focused or open (accent) or invalid (danger).
      const dangerHalo = 'shadow-[0_0_0_1px_theme(colors.ui.danger.700),0_0_0_4px_theme(colors.ui.danger.200)]';
      const interactive =
        'cursor-text hover:edge-hover focus-within:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)] data-[open]:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)]';
      // A disabled field keeps the resting ring only, so it does not look interactive on hover.
      const rest = this.isDisabled() ? 'edge cursor-not-allowed' : `edge ${interactive}`;
      const ring = this.error() ? dangerHalo : rest;
      const fill = this.isDisabled() ? 'bg-ui-neutral-50 text-ui-neutral-500' : 'bg-ui-background-100 text-ui-neutral-900';
      // forced-colors: shadows vanish, so a real border keeps the field visible and an outline marks focus.
      const border = this.isDisabled() ? 'forced-colors:border-[color:GrayText]' : 'forced-colors:border-[color:CanvasText]';
      const forced = `forced-colors:border ${border} forced-colors:focus-within:outline forced-colors:focus-within:outline-2 forced-colors:focus-within:outline-offset-2 forced-colors:focus-within:outline-[color:Highlight]`;
      const heights = { tiny: 'h-ui-tiny', small: 'h-ui-small', medium: 'h-ui-medium' };
      // Exact px (14px root): 8 and 10px radii have no token; side padding and icon gap per size, as the library trigger.
      const radii = { tiny: 'rounded-[8px]', small: 'rounded-[10px]', medium: 'rounded-ui-sm' };
      const pads = { tiny: 'px-[8px] gap-[4px]', small: 'px-[10px] gap-[6px]', medium: 'px-[12px] gap-[8px]' };
      const text = this.size() === 'tiny' ? 'label-12' : 'label-14';
      const size = this.size();
      return `flex w-full items-center transition-shadow duration-ui-base ease-ui-standard motion-reduce:transition-none ${heights[size]} ${radii[size]} ${pads[size]} ${text} ${fill} ${ring} ${forced}`;
    });
  }

  private initIconClasses(): Signal<string> {
    return computed(() => `inline-flex shrink-0 items-center ${this.size() === 'tiny' ? 'text-[12px]' : 'text-[14px]'} text-ui-neutral-500`);
  }

  private initChevronClasses(): Signal<string> {
    return computed(() => {
      // Exact px: chevron 12px (10px tiny). The trigger gap spaces it from the text.
      const sizes = { tiny: 'text-[10px]', small: 'text-[12px]', medium: 'text-[12px]' };
      return `inline-flex shrink-0 cursor-pointer items-center text-ui-neutral-600 ${sizes[this.size()]}`;
    });
  }

  private inputElement(): HTMLInputElement | null {
    return this.origin().elementRef.nativeElement.querySelector('input');
  }

  private select(option: UiOption | null): void {
    if (!option || option.disabled || this.isDisabled()) return;
    // Picking the option that is already chosen is not a change: the control stays pristine.
    if (option.value !== this.value()) {
      this.value.set(option.value);
      this.onChange?.(option.value);
    }
    this.closePanel();
  }

  // Opens on the chosen row when it matches, or on the first one that can be picked.
  private openPanel(): void {
    if (this.isDisabled() || this.open()) return;
    this.panelWidth.set(this.origin().elementRef.nativeElement.getBoundingClientRect().width);
    this.open.set(true);
    const chosen = this.selected();
    this.activeItem.set(chosen && this.navigable().includes(chosen) ? chosen : this.firstPickable());
    this.syncKeyManager();
    this.openChange.emit(true);
  }

  private firstPickable(): UiOption | null {
    return this.navigable().find((option) => !option.disabled) ?? null;
  }

  private matches(option: UiOption): boolean {
    const text = this.queryText().toLowerCase();
    return !text || option.label.toLowerCase().includes(text);
  }

  // The options can change while the list is open, and the key manager only follows silently: point it at the highlighted row before it acts.
  private syncKeyManager(): void {
    const active = this.activeOption();
    this.keyManager.updateActiveItem(this.navigable().findIndex((option) => option === active));
  }

  // Scrolls the list only: scrollIntoView would also move the page or a dialog around it.
  private revealActive(): void {
    const row = this.document.getElementById(this.activeOption()?.id ?? '');
    const list = row?.closest<HTMLElement>('[role="listbox"]');
    if (!row || !list) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }
}
