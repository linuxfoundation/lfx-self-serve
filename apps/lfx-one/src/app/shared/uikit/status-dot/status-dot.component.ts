// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** The state of something that runs, such as a sync, an import, a deployment or a recording: a 10px dot and a word. */
@Component({
  selector: 'lfx-ui-status-dot',
  templateUrl: './status-dot.component.html',
  styleUrl: './status-dot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[attr.role]': 'dotOnly() ? "img" : null',
    '[attr.aria-label]': 'dotOnly() ? text() : null',
    // shortcut: native title tooltip, hover only, so the tab stop shows a focus ring but no text. revisit: when lfx-ui-tooltip lands (#4661)
    '[attr.title]': 'dotOnly() ? text() : null',
    '[attr.tabindex]': 'dotOnly() ? 0 : null',
    'data-testid': 'ui-status-dot',
  },
})
export class UiStatusDotComponent {
  /** Which state to show. `queued` and `building` pulse while work is in progress; the others are final and still. */
  public readonly status = input.required<'queued' | 'building' | 'ready' | 'error' | 'canceled' | 'deleted'>();
  /** Overrides the default word for the state, such as "Running" for `building`. Keep it sentence case. */
  public readonly label = input<string>('');
  /** Shows only the dot. It then gets `role="img"`, an `aria-label` and a native tooltip from the word. */
  public readonly dotOnly = input<boolean>(false);

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
      return this.dotOnly() ? `${base} rounded-full focus-visible:shadow-focus focus-visible:outline-none` : `${base} gap-[8px]`;
    });
  }

  private initDotClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root.
      const base = 'h-[10px] w-[10px] shrink-0 rounded-full';
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
