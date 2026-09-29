// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, Signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import {
  MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL,
  MENTORSHIP_MENTEE_FIND_PROGRAM_URL,
  MENTORSHIP_MENTEE_SHELL_TITLE,
  MENTORSHIP_MENTEE_TABS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeOverview, MentorshipMenteePageTab } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeOverview } from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { catchError, filter, map, of, switchMap } from 'rxjs';

/**
 * Shell for the mentee experience — owns the page H1 ("My Mentorship"), the
 * "Find a Program" button, and the underline tab bar (Overview, My Tasks, Mentee
 * Profile — always all three; My Tasks renders its own empty state).
 *
 * The shell reads the same cached applications as its tabs to decide whether to show
 * "Find a Program" and the "N open" badge on My Tasks. A failed read hides both; the
 * routed tab shows the error and its Retry refreshes the shell through
 * `menteeApplicationsRevision`.
 */
@Component({
  selector: 'lfx-mentorship-mentee-page',
  imports: [RouterOutlet],
  templateUrl: './mentee-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteePageComponent {
  private readonly router = inject(Router);
  private readonly menteeService = inject(MentorshipMenteeService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');

  protected readonly title = MENTORSHIP_MENTEE_SHELL_TITLE;
  protected readonly findProgramLabel = MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL;
  protected readonly findProgramUrl = MENTORSHIP_MENTEE_FIND_PROGRAM_URL;
  protected readonly tabs = MENTORSHIP_MENTEE_TABS;

  /** The overview derived from the mentee's applications, or null while loading or after a failed read. */
  private readonly overview: Signal<MentorshipMenteeOverview | null> = this.initOverview();

  protected readonly showFindProgram = computed(() => this.overview()?.phase === 'applicant');

  protected readonly openTaskCount = computed(() => this.overview()?.openTaskCount ?? 0);

  private readonly currentUrl: Signal<string> = this.initCurrentUrl();

  protected readonly activeTab = computed<MentorshipMenteePageTab>(() => this.resolveActiveTab(this.currentUrl()));

  /** The tab value that should show the open-task count badge, or null if none. */
  protected readonly tabWithCount = computed<MentorshipMenteePageTab | null>(() => (this.openTaskCount() > 0 ? 'tasks' : null));

  protected onTabClick(tab: MentorshipMenteePageTab): void {
    void this.router.navigate(['/mentorship/mentee', tab]);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const tabValues = this.tabs.map((tab) => tab.value);
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

  private initOverview(): Signal<MentorshipMenteeOverview | null> {
    return toSignal(
      toObservable(this.menteeService.menteeApplicationsRevision).pipe(
        switchMap(() =>
          this.menteeService.getMenteeApplications().pipe(
            map((response) => buildMentorshipMenteeOverview(response.data)),
            // The routed tab surfaces the failure; the shell just hides its extras.
            catchError(() => of(null))
          )
        )
      ),
      { initialValue: null }
    );
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
