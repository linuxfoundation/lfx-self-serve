// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ButtonProps } from '@lfx-one/shared/interfaces';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-button',
  imports: [NgClass, ButtonModule, RouterModule, TooltipModule],
  templateUrl: './button.component.html',
})
export class ButtonComponent {
  // Text and Icon properties
  public readonly label = input<string | undefined>(undefined);
  public readonly icon = input<string | undefined>(undefined);
  public readonly iconPos = input<'left' | 'right' | 'top' | 'bottom'>('left');

  // Button type and behavior
  public readonly type = input<string>('button');
  public readonly disabled = input<boolean | undefined>(false);
  public readonly loading = input<boolean>(false);
  public readonly loadingIcon = input<string | undefined>(undefined);
  public readonly tabindex = input<number | undefined>(undefined);
  public readonly autofocus = input<boolean | undefined>(false);

  // Styling properties
  public readonly severity = input<ButtonProps['severity']>(undefined);
  public readonly raised = input<boolean>(false);
  public readonly rounded = input<boolean>(false);
  public readonly text = input<boolean>(false);
  public readonly plain = input<boolean>(false);
  public readonly outlined = input<boolean>(false);
  public readonly link = input<boolean>(false);
  public readonly size = input<ButtonProps['size']>(undefined);
  public readonly variant = input<ButtonProps['variant']>(undefined);
  public readonly fluid = input<boolean | undefined>(false);
  public readonly style = input<{ [key: string]: any } | null | undefined>(undefined);
  public readonly styleClass = input<string | undefined>(undefined);

  // Badge properties
  public readonly badge = input<string | undefined>(undefined);
  public readonly badgeSeverity = input<ButtonProps['badgeSeverity']>('secondary');

  // Accessibility
  public readonly ariaLabel = input<string | undefined>(undefined);

  // Navigation
  public readonly routerLink = input<string | string[] | undefined>(undefined);
  public readonly href = input<string | undefined>(undefined);
  public readonly target = input<string | undefined>('_self');
  public readonly rel = input<string | undefined>(undefined);
  public readonly queryParams = input<Record<string, string>>({});

  // Events
  public readonly onClick = output<MouseEvent>();
  public readonly onFocus = output<FocusEvent>();
  public readonly onBlur = output<FocusEvent>();

  // Tooltip
  public readonly tooltip = input<string | undefined>(undefined);
  public readonly tooltipPosition = input<string>('top');

  protected handleClick(event: MouseEvent): void {
    if (!this.disabled() && !this.loading()) {
      this.onClick.emit(event);
    }
  }

  protected handleFocus(event: FocusEvent): void {
    this.onFocus.emit(event);
  }

  protected handleBlur(event: FocusEvent): void {
    this.onBlur.emit(event);
  }
}
