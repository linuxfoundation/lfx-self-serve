// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ButtonProps } from '@lfx-one/shared/interfaces';
import { resolveAriaPressedPt } from '@lfx-one/shared/utils';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-button',
  imports: [NgClass, ButtonModule, RouterModule, TooltipModule],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
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
  public readonly style = input<Record<string, any> | null | undefined>(undefined);
  public readonly styleClass = input<string | undefined>(undefined);

  // Badge properties
  public readonly badge = input<string | undefined>(undefined);
  public readonly badgeSeverity = input<ButtonProps['badgeSeverity']>('secondary');

  // Accessibility
  public readonly ariaLabel = input<string | undefined>(undefined);
  /**
   * Toggle/pressed state for buttons that act as a binary on/off control (e.g. a view-mode switcher).
   * Only meaningful on the default `<p-button>` branch (no `href`) — `aria-pressed` is valid only on
   * `role="button"`, and the `href()` anchor branch renders as a link (implicit `role="link"`), where
   * it would be invalid ARIA. Forwarded to the `<p-button>` branch's internal `<button>` via PrimeNG's
   * `pt` passthrough (`ptm('root')`) — a plain `[attr.aria-pressed]` at the call site would only reach
   * the `<p-button>` host, not the real button. Do not combine with `tooltip` on the same instance:
   * the Tooltip directive on the same host also consumes the `pt` binding for its own `role="tooltip"`
   * container, so {@link ariaPressedPt} suppresses itself whenever `tooltip` is set rather than leak
   * `aria-pressed` onto that element.
   */
  public readonly ariaPressed = input<boolean | undefined>(undefined);

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

  /**
   * `pt` passthrough object for the `<p-button>` branch's `aria-pressed` — hoisted to a computed so
   * the template doesn't hand PrimeNG a fresh object literal on every change-detection pass. See
   * {@link resolveAriaPressedPt} for why an unset input resolves to `undefined` rather than a pt
   * object. Deliberately NOT annotated against PrimeNG's own `ButtonPassThrough` type: the same
   * `<p-button>` host also carries `[pTooltip]`, and the Tooltip directive declares its own `pt`
   * input of a different (non-nullable) passthrough type — Angular's template checker resolves the
   * single `[pt]="ariaPressedPt()"` binding against both directives, so `ButtonPassThrough`'s `null`
   * member fails to type-check against Tooltip's `pt`. The shared package's narrower
   * `ButtonRootPassThrough` is structurally compatible with both and is what's actually verified here.
   *
   * That same dual-consumption means the `pt` value reaches the Tooltip directive's own root element
   * (its `role="tooltip"` container) too, not just `<p-button>`'s. Resolving to `undefined` whenever
   * `tooltip` is set prevents `aria-pressed` from ever landing on that tooltip container — no current
   * call site combines the two, but this keeps a future one from silently shipping invalid ARIA. That
   * combination also silently drops `aria-pressed` entirely rather than raising a build error, so a
   * dev-mode console warning below flags it at runtime instead.
   */
  protected readonly ariaPressedPt = computed(() => {
    if (this.tooltip() && this.ariaPressed() !== undefined && typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.warn('<lfx-button>: `ariaPressed` is ignored when `tooltip` is also set — both consume the same PrimeNG `pt` binding on this host.');
    }
    return this.tooltip() ? undefined : resolveAriaPressedPt(this.ariaPressed());
  });

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
