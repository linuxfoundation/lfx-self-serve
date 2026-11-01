// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/** The state of something that runs, such as a sync, an import, a deployment or a recording: a 10px dot and a word. */
@Component({
  selector: 'lfx-ui-status-dot',
  imports: [UiTooltipDirective],
  templateUrl: './status-dot.component.html',
  styleUrl: './status-dot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    'data-testid': 'ui-status-dot',
  },
})
export class UiStatusDotComponent {
  /** Which state to show. `queued` and `building` pulse while work is in progress; the others are final and still. */
  public readonly status = input.required<'queued' | 'building' | 'ready' | 'error' | 'canceled' | 'deleted'>();
  /** Overrides the default word for the state, such as "Running" for `building`. Keep it sentence case. */
  public readonly label = input<string>('');
  /** Shows only the dot. It then becomes a focusable `role="img"` named by the word, with a tooltip on hover and keyboard focus. */
  public readonly dotOnly = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly text: Signal<string> = this.initText();
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly dotClasses: Signal<string> = this.initDotClasses();

  private initText(): Signal<string> {
    return computed(() => {
      const words = { queued: 'Queued', building: 'Building', ready: 'Ready', error: 'Error', canceled: 'Canceled', deleted: 'Deleted' };
      return this.label() || words[this.status()];
    });
  }

  private initHostClasses(): Signal<string> {
    return computed(() => {
      const base = 'inline-flex items-center text-copy-14 text-ui-neutral-900';
      // Exact px, not rem; 14px root.
      return this.dotOnly() ? base : `${base} gap-[8px]`;
    });
  }

  private initDotClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root.
      const base = 'h-[10px] w-[10px] shrink-0 rounded-ui-full';
      const states = {
        queued: 'status-dot-pulse bg-ui-neutral-400',
        building: 'status-dot-pulse bg-ui-warning-500',
        ready: 'bg-ui-success-600',
        error: 'bg-ui-danger-600',
        canceled: 'bg-ui-neutral-900',
        deleted: 'bg-transparent ring-[1.5px] ring-inset ring-ui-neutral-400',
      };
      return `${base} ${states[this.status()]}`;
    });
  }
}
