// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';

import { UiTooltipDirective } from '../tooltip/tooltip.directive';
import { UiChoiceboxGroupComponent } from './choicebox-group.component';

/**
 * One tile of an `lfx-ui-choicebox-group`: a native radio or checkbox (the group's `type`) with a title and a description.
 * The whole tile is the label, so one click or focus target. Put an `lfx-ui-badge` inside to show it after the title.
 * It must sit inside the group, which owns the `type`, the shared `name` and the chosen value.
 */
@Component({
  selector: 'lfx-ui-choicebox',
  imports: [UiTooltipDirective],
  templateUrl: './choicebox.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    'data-testid': 'ui-choicebox',
  },
})
export class UiChoiceboxComponent {
  protected readonly group = inject(UiChoiceboxGroupComponent);
  /** Ids that tie the title, the description and the disabled reason to the input. */
  private readonly ids = inject(_IdGenerator);

  /** What the group's value becomes (radio) or gains (checkbox) when this tile is chosen. */
  public readonly value = input.required<string>();
  /** Title, in Title Case. */
  public readonly label = input.required<string>();
  /** Description under the title, in a sentence ending with a period. */
  public readonly description = input<string>('');
  /** Disables this tile: it keeps its place but cannot be chosen. It cannot be focused either, unless it has a `disabledReason`. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /**
   * Why the tile is disabled. Shown as a tooltip on hover and on keyboard focus, and read as the input's description. Used only while disabled.
   * A tile with a reason stays focusable (`aria-disabled` instead of native `disabled`) so keyboard users can reach the reason.
   */
  public readonly disabledReason = input<string>('');

  protected readonly titleId = this.ids.getId('lfx-ui-choicebox-title-');
  protected readonly descriptionId = this.ids.getId('lfx-ui-choicebox-description-');
  protected readonly reasonId = this.ids.getId('lfx-ui-choicebox-reason-');
  protected readonly isChecked: Signal<boolean> = this.initIsChecked();
  protected readonly isDisabled: Signal<boolean> = this.initIsDisabled();
  protected readonly reason: Signal<string> = this.initReason();
  /** True while a disabled tile explains itself: its input stays focusable and ignores every attempt to choose it. */
  protected readonly isLocked: Signal<boolean> = this.initIsLocked();
  protected readonly describedBy: Signal<string | null> = this.initDescribedBy();
  protected readonly tileClasses: Signal<string> = this.initTileClasses();
  protected readonly titleClasses: Signal<string> = this.initTitleClasses();
  protected readonly controlClasses: Signal<string> = this.initControlClasses();
  protected readonly dotClasses: Signal<string> = this.initDotClasses();

  // A locked input is not natively disabled, so the click that would choose it is cancelled here.
  protected onClick(event: Event): void {
    if (this.isLocked()) event.preventDefault();
  }

  protected onChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (this.isLocked()) {
      this.restoreChoice(input);
      return;
    }
    this.group.choose(this.value(), input.checked);
  }

  // Arrow keys check a focusable radio before a click handler can stop them, so the previous choice is put back.
  private restoreChoice(input: HTMLInputElement): void {
    if (!this.group.isRadio()) {
      input.checked = this.isChecked();
      return;
    }
    const chosen = this.group.value();
    input
      .closest('fieldset')
      ?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
      .forEach((radio) => (radio.checked = radio.value === chosen));
  }

  private initIsChecked(): Signal<boolean> {
    return computed(() => this.group.isChecked(this.value()));
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.group.isDisabled());
  }

  private initReason(): Signal<string> {
    return computed(() => (this.isDisabled() ? this.disabledReason() : ''));
  }

  private initIsLocked(): Signal<boolean> {
    return computed(() => this.reason() !== '');
  }

  private initDescribedBy(): Signal<string | null> {
    return computed(() => [this.description() ? this.descriptionId : '', this.reason() ? this.reasonId : ''].filter(Boolean).join(' ') || null);
  }

  private initTileClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: 14px root. 12px gap and 12px/16px padding are library spacing-3 and spacing-4.
      const base =
        'relative flex items-start gap-[12px] rounded-ui-md px-[16px] py-[12px] ring-1 transition-[box-shadow,background-color] duration-ui-base ease-ui-standard motion-reduce:transition-none';
      const ring = this.isChecked() ? 'ring-ui-accent-500' : 'ring-ui-neutral-alpha-200';
      if (this.isDisabled()) return `${base} ${ring} cursor-not-allowed bg-ui-neutral-50`;
      if (this.isChecked()) return `${base} ${ring} cursor-pointer bg-ui-accent-50`;
      return `${base} ${ring} cursor-pointer bg-ui-background-100 hover:bg-ui-neutral-alpha-50 hover:ring-ui-neutral-alpha-300`;
    });
  }

  private initTitleClasses(): Signal<string> {
    // The library title is 14/20 at weight 500; the `label-14` role is 400, so the weight is added.
    return computed(() => `flex items-center gap-[8px] label-14 font-medium ${this.isDisabled() ? 'text-ui-neutral-500' : 'text-ui-neutral-900'}`);
  }

  private initControlClasses(): Signal<string> {
    return computed(() => {
      // Same 16px control as lfx-ui-radio and lfx-ui-checkbox; ring-0 on focus lets the focus shadow replace the ring.
      // forced-colors: the ring vanishes, so a real border keeps the control and its state visible.
      const shape = this.group.isRadio() ? 'rounded-ui-full' : 'rounded-[5px]';
      const base = `m-0 h-[16px] w-[16px] shrink-0 appearance-none ${shape} ring-1 transition-colors duration-ui-base ease-ui-standard motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-focus forced-colors:border`;
      if (this.isDisabled()) {
        const fill =
          this.isChecked() && !this.group.isRadio()
            ? 'bg-ui-neutral-400 ring-ui-neutral-400 forced-colors:bg-[color:GrayText]'
            : 'bg-ui-neutral-50 ring-ui-neutral-alpha-300';
        return `${base} ${fill} cursor-not-allowed forced-colors:border-[color:GrayText]`;
      }
      if (!this.isChecked()) {
        return `${base} bg-ui-background-100 ring-ui-neutral-alpha-500 hover:bg-ui-neutral-alpha-50 cursor-pointer forced-colors:border-[color:CanvasText] forced-colors:bg-[color:Canvas]`;
      }
      const checked = this.group.isRadio()
        ? 'bg-ui-background-100 ring-ui-accent-500 forced-colors:border-[color:Highlight]'
        : 'bg-ui-accent-500 ring-ui-accent-500 forced-colors:border-[color:CanvasText] forced-colors:bg-[color:Highlight]';
      return `${base} ${checked} cursor-pointer`;
    });
  }

  private initDotClasses(): Signal<string> {
    // 7px dot centred in the 16px circle.
    return computed(
      () =>
        `pointer-events-none absolute left-[4.5px] top-[4.5px] h-[7px] w-[7px] rounded-ui-full ${this.isDisabled() ? 'bg-ui-neutral-400 forced-colors:bg-[color:GrayText]' : 'bg-ui-accent-500 forced-colors:bg-[color:Highlight]'}`
    );
  }
}
