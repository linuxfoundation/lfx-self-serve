// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, Signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import {
  MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL,
  MENTORSHIP_MENTEE_FIND_PROGRAM_URL,
  MENTORSHIP_MENTEE_SHELL_TITLE,
  MENTORSHIP_MENTEE_TABS_ACCEPTED,
  MENTORSHIP_MENTEE_TABS_APPLICANT,
  MENTORSHIP_MENTEE_TABS_EMPTY,
} from '@lfx-one/shared/constants';
import { MentorshipMenteePageTab, MentorshipMenteePhase } from '@lfx-one/shared/interfaces';
import { filter, map } from 'rxjs';

/**
 * Shell for the mentee experience — owns the page H1 ("My Mentorship"), the
 * "Find a Program" button, and the underline tab bar. The tab config changes
 * per phase:
 *
 * - **empty** — Overview + Mentee Profile (no tasks tab)
 * - **applicant** — Overview + My Application Tasks (N open) + Mentee Profile
 * - **accepted** — Overview + My Tasks (N open) + Mentee Profile
 *
 * The active phase is set by the overview child via `onChildActivate()`.
 */
@Component({
  selector: 'lfx-mentorship-mentee-page',
  imports: [RouterOutlet],
  templateUrl: './mentee-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteePageComponent {
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');

  protected readonly title = MENTORSHIP_MENTEE_SHELL_TITLE;
  protected readonly findProgramLabel = MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL;
  protected readonly findProgramUrl = MENTORSHIP_MENTEE_FIND_PROGRAM_URL;

  /** Phase reported by the overview child. */
  readonly phase = signal<MentorshipMenteePhase>('empty');
  /** Open task count reported by the overview child. */
  readonly openTaskCount = signal(0);

  private static readonly tabConfigs: Record<MentorshipMenteePhase, readonly { value: MentorshipMenteePageTab; label: string }[]> = {
    empty: MENTORSHIP_MENTEE_TABS_EMPTY,
    applicant: MENTORSHIP_MENTEE_TABS_APPLICANT,
    accepted: MENTORSHIP_MENTEE_TABS_ACCEPTED,
  };

  protected readonly tabs = computed(() => MenteePageComponent.tabConfigs[this.phase()]);

  protected readonly showFindProgram = computed(() => this.phase() !== 'empty');

  private readonly currentUrl: Signal<string> = this.initCurrentUrl();

  protected readonly activeTab = computed<MentorshipMenteePageTab>(() => this.resolveActiveTab(this.currentUrl()));

  /** The tab value that should show the open-task count badge, or null if none. */
  protected readonly tabWithCount = computed<MentorshipMenteePageTab | null>(() => (this.openTaskCount() > 0 ? 'tasks' : null));

  /** Called by the overview child (via output signal or directly) when phase is known. */
  onPhaseChange(phase: MentorshipMenteePhase): void {
    this.phase.set(phase);
  }

  /** Called by the overview child when the open task count is known. */
  onOpenTaskCountChange(count: number): void {
    this.openTaskCount.set(count);
  }

  /**
   * Wire up `output()` signal subscriptions from the routed child. Only the
   * overview component emits `phaseChange` and `openTaskCountChange`; other
   * children simply lack those properties and the wiring is a no-op.
   * `OutputEmitterRef.subscribe` returns a cleanup-managed subscription.
   */
  onChildActivate(child: unknown): void {
    const c = child as {
      phaseChange?: import('@angular/core').OutputEmitterRef<MentorshipMenteePhase>;
      openTaskCountChange?: import('@angular/core').OutputEmitterRef<number>;
    };
    c.phaseChange?.subscribe((phase) => this.onPhaseChange(phase));
    c.openTaskCountChange?.subscribe((count) => this.onOpenTaskCountChange(count));
  }

  protected onTabClick(tab: MentorshipMenteePageTab): void {
    void this.router.navigate(['/mentorship/mentee', tab]);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const tabValues = this.tabs().map((tab) => tab.value);
    const current = tabValues.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % tabValues.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabValues.length) % tabValues.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabValues.length - 1;
    if (next === null) return;

    event.preventDefault();
    this.onTabClick(tabValues[next]);
    if (isPlatformBrowser(this.platformId)) {
      this.tabBtns()[next]?.nativeElement.focus();
    }
  }

  private initCurrentUrl(): Signal<string> {
    return toSignal(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map((event) => event.urlAfterRedirects),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: this.router.url }
    );
  }

  private resolveActiveTab(url: string): MentorshipMenteePageTab {
    const segments = this.router.parseUrl(url).root.children['primary']?.segments ?? [];
    const last = segments[segments.length - 1]?.path;
    if (last === 'tasks') return 'tasks';
    if (last === 'profile') return 'profile';
    return 'overview';
  }
}
