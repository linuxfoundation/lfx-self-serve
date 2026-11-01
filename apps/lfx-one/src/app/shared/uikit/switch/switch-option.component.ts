// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';

import { UiTooltipDirective } from '../tooltip/tooltip.directive';
import { UiSwitchComponent } from './switch.component';

/**
 * One option of an `lfx-ui-switch`: a segment holding a label, an icon, or an icon with `iconOnly`. It wraps a visually hidden native radio.
 * It must sit inside the switch, which owns the shared `name`, the chosen value and the arrow-key behaviour.
 */
@Component({
  selector: 'lfx-ui-switch-option',
  imports: [UiTooltipDirective],
  templateUrl: './switch-option.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex',
    'data-testid': 'ui-switch-option',
  },
})
export class UiSwitchOptionComponent {
  protected readonly group = inject(UiSwitchComponent);

  /** What the switch's value becomes when this option is chosen. */
  public readonly value = input.required<string>();
  /** The option's name. Shown as text, or as a tooltip and screen-reader text when `iconOnly` is set. */
  public readonly label = input.required<string>();
  /** Font Awesome class string for an icon before the label, e.g. `fa-light fa-list`. */
  public readonly icon = input<string>('');
  /** Shows only the icon. The label stays as screen-reader text and as a tooltip. Needs `icon`. */
  public readonly iconOnly = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Disables this option: it keeps its place but cannot be chosen or focused. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly isChecked: Signal<boolean> = this.initIsChecked();
  protected readonly isDisabled: Signal<boolean> = this.initIsDisabled();
  protected readonly tooltip: Signal<string> = this.initTooltip();
  protected readonly segmentClasses: Signal<string> = this.initSegmentClasses();

  protected onChange(): void {
    this.group.select(this.value());
  }

  private initIsChecked(): Signal<boolean> {
    return computed(() => this.group.value() === this.value());
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.group.isDisabled());
  }

  private initTooltip(): Signal<string> {
    return computed(() => (this.iconOnly() && this.icon() ? this.label() : ''));
  }

  private initSegmentClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: 14px root. Segment radius is the track radius minus its padding (9, 7 and 6px: no ui-* utility); padding and gap are library steps.
      // forced-colors:transition-none keeps a half-faded label off screen when the colours swap.
      const base =
        'inline-flex items-center whitespace-nowrap transition-[color,background-color] duration-ui-base ease-ui-standard motion-reduce:transition-none forced-colors:transition-none peer-focus-visible:shadow-focus forced-colors:peer-focus-visible:outline forced-colors:peer-focus-visible:outline-2 forced-colors:peer-focus-visible:outline-offset-2 forced-colors:peer-focus-visible:outline-[color:CanvasText]';
      const sizes = {
        tiny: 'gap-[4px] rounded-[6px] px-[8px] button-12',
        small: 'gap-[6px] rounded-[7px] px-[8px] label-13 font-medium',
        medium: 'gap-[6px] rounded-[9px] px-[12px] button-14',
      };
      // The checked segment is raised; in the dark theme it is neutral-200 because background-100 is the track's neighbour there.
      // forced-colors: fills and shadows vanish, so a checked segment gets a border (Highlight plus fill, GrayText if disabled) and focus an outline.
      const forcedChecked = this.isDisabled()
        ? 'forced-colors:border forced-colors:border-[color:GrayText]'
        : 'forced-colors:border forced-colors:border-[color:Highlight] forced-colors:bg-[color:Highlight] forced-colors:text-[color:HighlightText]';
      const fill = this.isChecked() ? `bg-ui-background-100 shadow-small [[data-theme='dark']_&]:bg-ui-neutral-200 ${forcedChecked}` : '';
      let ink = 'cursor-pointer text-ui-neutral-600 hover:text-ui-neutral-900';
      if (this.isDisabled()) ink = 'cursor-not-allowed text-ui-neutral-400 forced-colors:text-[color:GrayText]';
      else if (this.isChecked()) ink = 'cursor-pointer text-ui-neutral-900';
      return `${base} ${sizes[this.group.size()]} ${fill} ${ink}`;
    });
  }
}
