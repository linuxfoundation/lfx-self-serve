// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, linkedSignal, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import {
  ORG_LENS_ROI_PROJECT_PICKER_DEFAULT_COUNT,
  ORG_LENS_ROI_PROJECT_SELECTION_VIEWS,
  ORG_LENS_ROI_PROJECT_VIEW_LABELS,
  ORG_LENS_ROI_PROJECT_VIEWS,
} from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod, OrgLensRoiProjectOption, OrgLensRoiProjectRow, OrgLensRoiProjectView } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { classifySectionError, OrgLensSectionOutcome, sectionEmptyState } from '@shared/utils/org-lens-empty-state.utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, map, of, switchMap, tap } from 'rxjs';

import { OrgRoiProjectPickerComponent } from '../org-roi-project-picker/org-roi-project-picker.component';
import { OrgRoiProjectsBarComponent } from '../org-roi-projects-bar/org-roi-projects-bar.component';
import { OrgRoiProjectsBubbleComponent } from '../org-roi-projects-bubble/org-roi-projects-bubble.component';
import { OrgRoiProjectsSankeyComponent } from '../org-roi-projects-sankey/org-roi-projects-sankey.component';
import { OrgRoiProjectsTableComponent } from '../org-roi-projects-table/org-roi-projects-table.component';

/** Four complementary views of the same project set, over one shared selection. */
@Component({
  selector: 'lfx-org-roi-projects-section',
  imports: [
    OrgLensEmptyStateComponent,
    OrgRoiProjectPickerComponent,
    OrgRoiProjectsBarComponent,
    OrgRoiProjectsBubbleComponent,
    OrgRoiProjectsSankeyComponent,
    OrgRoiProjectsTableComponent,
    SkeletonModule,
  ],
  templateUrl: './org-roi-projects-section.component.html',
})
export class OrgRoiProjectsSectionComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly roiService = inject(OrgLensRoiService);

  public readonly method = input.required<OrgLensRoiMethod>();

  protected readonly views = ORG_LENS_ROI_PROJECT_VIEWS;
  protected readonly viewLabels = ORG_LENS_ROI_PROJECT_VIEW_LABELS;

  protected readonly view = signal<OrgLensRoiProjectView>('bar');

  protected readonly loading = signal(true);
  /** How the last request ended (spec 053 FR-014/FR-015); emptiness is judged on the rows in hand, below. */
  private readonly loadOutcome = signal<Exclude<OrgLensSectionOutcome, 'empty'>>('records');
  /** Bumped by Retry; part of the request key so the same organization and method re-issue the read. */
  private readonly attempt = signal(0);

  /**
   * The rows alone, not the whole response — nothing here reads the envelope's `method`, and
   * holding it would mean inventing one for the pre-fetch sentinel.
   */
  protected readonly projectRows: Signal<OrgLensRoiProjectRow[]> = this.initProjectRows();

  protected readonly hasRows: Signal<boolean> = computed(() => this.projectRows().length > 0);

  protected readonly orgName: Signal<string> = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');

  /** The shared state to render instead of the views, or `null` while there are projects to show. */
  protected readonly emptyState = computed(() => {
    const outcome = this.loadOutcome();
    return sectionEmptyState(outcome === 'records' && !this.hasRows() ? 'empty' : outcome);
  });

  /** Already ranked by return: the payload arrives ordered that way and nothing re-sorts it here. */
  protected readonly options: Signal<OrgLensRoiProjectOption[]> = computed(() =>
    this.projectRows().map((row) => ({ projectId: row.projectId, projectName: row.projectName, amount: formatCurrency(row.totalReturn) }))
  );

  /**
   * The selection shared by the comparison, flow and efficiency views.
   *
   * `null` means the viewer has not chosen, so the default applies; `[]` means they chose nothing.
   * Keeping those distinct is the whole point of the sentinel — collapsing both to an empty array
   * made a failed read (which emits zero projects) indistinguishable from pressing None, so after a
   * retry succeeded the charts stayed blank for the rest of the session.
   *
   * The cases, in the order they are tested:
   *
   * - **A different organization** — back to unchosen, so that org gets its own default.
   * - **No options yet** — hold. A read that failed, was refused, or has not landed says nothing
   *   about what the viewer wants, so it must not overwrite what they picked.
   * - **Unchosen** — stay unchosen.
   * - **Deliberately emptied** — stay empty, including across an estimation-method switch.
   * - **A real selection** — keep whatever still exists. Switching method returns the same projects
   *   with different figures, and discarding the selection would make the two impossible to
   *   compare. If none survive, the ids are stale and the default applies.
   */
  private readonly selectionOverride = linkedSignal<{ orgUid: string; options: OrgLensRoiProjectOption[] }, string[] | null>({
    source: computed(() => ({ orgUid: this.accountContext.selectedAccount()?.accountId ?? '', options: this.options() })),
    computation: ({ orgUid, options }, previous) => {
      if (previous === undefined || previous.source.orgUid !== orgUid) return null;
      if (options.length === 0) return previous.value;
      if (previous.value === null || previous.value.length === 0) return previous.value;

      const available = new Set(options.map((option) => option.projectId));
      const kept = previous.value.filter((id) => available.has(id));
      return kept.length > 0 ? kept : null;
    },
  });

  /** The default is derived, never stored, so it always reflects the options actually in hand. */
  protected readonly selectedIds: Signal<string[]> = computed(
    () =>
      this.selectionOverride() ??
      this.options()
        .slice(0, ORG_LENS_ROI_PROJECT_PICKER_DEFAULT_COUNT)
        .map((option) => option.projectId)
  );

  /** Selection order follows the ranking, so every view draws the leading projects first. */
  protected readonly selectedProjects: Signal<OrgLensRoiProjectRow[]> = computed(() => {
    const selected = new Set(this.selectedIds());
    return this.projectRows().filter((row) => selected.has(row.projectId));
  });

  /** The table pages the complete set, so it needs no picker; the other three views do. */
  protected readonly showsPicker: Signal<boolean> = computed(() => (ORG_LENS_ROI_PROJECT_SELECTION_VIEWS as readonly string[]).includes(this.view()));

  public setView(view: OrgLensRoiProjectView): void {
    this.view.set(view);
  }

  public setSelection(projectIds: string[]): void {
    this.selectionOverride.set(projectIds);
  }

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private initProjectRows(): Signal<OrgLensRoiProjectRow[]> {
    // A typed record rather than a delimited string, so nothing has to be parsed back out or cast.
    //
    // The dedup the string gave for free has to be restored explicitly: the selected-account object
    // is rewritten in place, so this recomputes on changes that leave every field identical, and a
    // fresh object reference would re-emit and refetch each time.
    const request$ = toObservable(
      computed(() => ({ orgUid: this.accountContext.selectedAccount()?.accountId ?? '', method: this.method(), attempt: this.attempt() }))
    ).pipe(distinctUntilChanged((previous, next) => previous.orgUid === next.orgUid && previous.method === next.method && previous.attempt === next.attempt));

    return toSignal(
      request$.pipe(
        filter(({ orgUid }) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.loadOutcome.set('records');
        }),
        switchMap(({ orgUid, method }) =>
          this.roiService.getProjects(orgUid, method).pipe(
            tap(() => this.loading.set(false)),
            map((projects) => projects.rows),
            catchError((error: unknown) => {
              console.error('Failed to load ROI projects section', error);
              this.loading.set(false);
              this.loadOutcome.set(classifySectionError(error));
              return of([] as OrgLensRoiProjectRow[]);
            })
          )
        )
      ),
      { initialValue: [] as OrgLensRoiProjectRow[] }
    );
  }
}
