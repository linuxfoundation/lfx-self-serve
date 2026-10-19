// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { MKTG_RUN_ACTIVITY_ICONS, MKTG_RUN_ACTIVITY_VISIBLE_ROWS } from '@lfx-one/shared/constants';
import { MktgRunActivity, MktgRunActivityPhase, MktgRunActivityRow, MktgRunActivityStatus } from '@lfx-one/shared/interfaces';
import { mktgRunActivityPhases } from '@lfx-one/shared/utils';

/** One feed row as the template binds it. */
interface ActivityRowView extends MktgRunActivityRow {
  bubbleClass: string;
  labelClass: string;
  duration: string;
}

/** One header phase as the template binds it. */
interface ActivityPhaseView extends MktgRunActivityPhase {
  chipClass: string;
  iconClass: string;
}

// The live activity feed of an agent run: what the agent is doing while it
// works, as a timeline of plain sentences built server-side from the
// session's events. Purely presentational — the run page feeds it the whole
// feed on every poll that changed it.
@Component({
  selector: 'lfx-mktg-run-activity',
  imports: [NgClass],
  templateUrl: './mktg-run-activity.component.html',
})
export class MktgRunActivityComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** The feed so far, oldest first. */
  public readonly activity = input<MktgRunActivity[]>([]);
  /** The header line ("Researching OpenSearch…"). */
  public readonly title = input.required<string>();
  /** Epoch ms the current stretch started — the elapsed timer counts from it. */
  public readonly startedAt = input.required<number>();
  /** The agent's accent classes for the header icon. */
  public readonly iconClass = input('bg-blue-50 text-blue-600');
  /** The agent's icon. */
  public readonly icon = input('fa-light fa-sparkles');
  /** Form-only agents have no questions turn, even before any activity arrives. */
  public readonly showQuestions = input(true);

  // === Signals ===
  protected readonly showAll = signal(false);
  private readonly now = signal(Date.now());

  // === Computed ===
  protected readonly rows: Signal<ActivityRowView[]> = this.initRows();
  protected readonly visibleRows = computed(() => {
    const rows = this.rows();
    return this.showAll() || rows.length <= MKTG_RUN_ACTIVITY_VISIBLE_ROWS ? rows : rows.slice(-MKTG_RUN_ACTIVITY_VISIBLE_ROWS);
  });
  protected readonly hiddenCount = computed(() => this.rows().length - this.visibleRows().length);
  protected readonly phases: Signal<ActivityPhaseView[]> = this.initPhases();
  protected readonly elapsed = computed(() => this.formatDuration(this.now() - this.startedAt()));
  /** The step under way, for the screen-reader status line. */
  protected readonly currentLabel = computed(() => [...this.rows()].reverse().find((row) => row.status === 'running')?.label ?? '');

  // Literal class names so Tailwind's content scan generates them.
  private readonly bubbleClasses: Record<MktgRunActivityStatus, string> = {
    running: 'bg-blue-50 text-blue-600 ring-4 ring-blue-50',
    done: 'bg-gray-50 text-gray-500',
    failed: 'bg-amber-50 text-amber-600',
  };
  private readonly labelClasses: Record<MktgRunActivityStatus, string> = {
    running: 'text-gray-900 font-medium',
    done: 'text-gray-700',
    failed: 'text-amber-700',
  };
  private readonly phaseClasses: Record<MktgRunActivityPhase['state'], { chipClass: string; iconClass: string }> = {
    active: { chipClass: 'border-blue-200 bg-blue-50 text-blue-700', iconClass: 'fa-light fa-spinner-third motion-safe:animate-spin' },
    done: { chipClass: 'border-gray-200 bg-white text-gray-600', iconClass: 'fa-light fa-check text-emerald-600' },
    skipped: { chipClass: 'border-gray-100 bg-white text-gray-300', iconClass: 'fa-light fa-minus' },
    pending: { chipClass: 'border-gray-100 bg-white text-gray-400', iconClass: 'fa-light fa-circle' },
  };

  public constructor() {
    // The elapsed timer ticks once a second, in the browser only (SSR renders the first value).
    if (isPlatformBrowser(this.platformId)) {
      const tick = setInterval(() => this.now.set(Date.now()), 1000);
      this.destroyRef.onDestroy(() => clearInterval(tick));
    }
  }

  // === Protected methods ===
  protected onToggleAll(): void {
    this.showAll.update((all) => !all);
  }

  // === Private initializers ===
  private initRows(): Signal<ActivityRowView[]> {
    return computed(() => {
      const now = this.now();
      return this.activity().map((step) => {
        const ended = step.endedAt ? Date.parse(step.endedAt) : now;
        const started = Date.parse(step.startedAt);
        return {
          ...step,
          iconClass: MKTG_RUN_ACTIVITY_ICONS[step.kind],
          bubbleClass: this.bubbleClasses[step.status],
          labelClass: this.labelClasses[step.status],
          // A step that took under a second says nothing; a long one is worth showing.
          duration: Number.isNaN(started) || ended - started < 1000 ? '' : this.formatDuration(ended - started),
        };
      });
    });
  }

  private initPhases(): Signal<ActivityPhaseView[]> {
    return computed(() =>
      mktgRunActivityPhases(this.activity())
        // A phase the run passed over says nothing; one not reached yet is shown so the user sees what is ahead.
        .filter((phase) => phase.state !== 'skipped' && (this.showQuestions() || phase.id !== 'questions'))
        .map((phase) => ({ ...phase, ...this.phaseClasses[phase.state] }))
    );
  }

  // === Private helpers ===
  private formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
  }
}
