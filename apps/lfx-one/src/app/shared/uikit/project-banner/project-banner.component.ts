// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { UiProjectBannerVariant } from '@lfx-one/shared/interfaces';

/**
 * A full-width, project-wide notice under the header for a temporary state that someone must resolve. It cannot be
 * dismissed: it goes away when the state is fixed. Show one at a time. If it can be dismissed without fixing anything,
 * use `lfx-ui-note` instead.
 *
 * Project one sentence in sentence case, then one small secondary button that names the fix ("Update Payment") as
 * `<lfx-ui-button banner-action variant="secondary" size="small">`.
 */
@Component({
  selector: 'lfx-ui-project-banner',
  templateUrl: './project-banner.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[attr.role]': 'announce() && variant() === "error" ? "alert" : "status"',
    'data-testid': 'ui-project-banner',
  },
})
export class UiProjectBannerComponent {
  /** Colour and default icon. `error` is for urgent states such as downtime or a failed payment. */
  public readonly variant = input<UiProjectBannerVariant>('default');
  /** Announces an `error` banner to screen readers right away (`role="alert"`). Set it only when the banner appears after an action, because the banner is persistent and would re-announce each time it is re-created. */
  public readonly announce = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Font Awesome icon classes that replace the variant's default icon, such as `fa-light fa-credit-card`. */
  public readonly icon = input<string>('');

  protected readonly classes: Signal<string> = this.initClasses();
  protected readonly iconClasses: Signal<string> = this.initIconClasses();

  private initClasses(): Signal<string> {
    return computed(() => {
      // Fill is the 50 step with a 1px bottom rule (a pseudo-element, so the band stays exactly 48px) at the 200 step; text is the 700 step, neutral-900 on gray.
      const variants = {
        default: 'after:bg-ui-accent-200 bg-ui-accent-50 text-ui-accent-700',
        success: 'after:bg-ui-success-200 bg-ui-success-50 text-ui-success-700',
        warning: 'after:bg-ui-warning-200 bg-ui-warning-50 text-ui-warning-700',
        error: 'after:bg-ui-danger-200 bg-ui-danger-50 text-ui-danger-700',
        gray: 'after:bg-ui-neutral-alpha-200 bg-ui-background-200 text-ui-neutral-900',
      };
      // Exact px: 48px band with 12px gap and 8/16px padding are library steps below the ui spacing scale.
      return `relative flex min-h-[48px] flex-wrap items-center justify-center gap-[12px] px-[16px] py-[8px] text-center copy-14 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:content-[''] ${variants[this.variant()]}`;
    });
  }

  private initIconClasses(): Signal<string> {
    return computed(() => {
      const icons = {
        default: 'fa-light fa-circle-info',
        success: 'fa-light fa-circle-check',
        warning: 'fa-light fa-triangle-exclamation',
        error: 'fa-light fa-circle-exclamation',
        gray: 'fa-light fa-circle-info',
      };
      return this.icon() || icons[this.variant()];
    });
  }
}
