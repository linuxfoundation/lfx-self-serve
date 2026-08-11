// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, linkedSignal, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
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
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

import { OrgRoiProjectPickerComponent } from '../org-roi-project-picker/org-roi-project-picker.component';
import { OrgRoiProjectsBarComponent } from '../org-roi-projects-bar/org-roi-projects-bar.component';
import { OrgRoiProjectsBubbleComponent } from '../org-roi-projects-bubble/org-roi-projects-bubble.component';
import { OrgRoiProjectsSankeyComponent } from '../org-roi-projects-sankey/org-roi-projects-sankey.component';
import { OrgRoiProjectsTableComponent } from '../org-roi-projects-table/org-roi-projects-table.component';

/** Four complementary views of the same project set, over one shared selection. */
@Component({
  selector: 'lfx-org-roi-projects-section',
  imports: [
    OrgRoiProjectPickerComponent,
    OrgRoiProjectsBarComponent,
    OrgRoiProjectsSankeyComponent,
    OrgRoiProjectsBubbleComponent,
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
  protected readonly failed = signal(false);
  protected readonly forbidden = signal(false);

  /**
   * The rows alone, not the whole response — nothing here reads the envelope's `method`, and
   * holding it would mean inventing one for the pre-fetch sentinel.
   */
  protected readonly projectRows: Signal<OrgLensRoiProjectRow[]> = this.initProjectRows();

  protected readonly hasRows: Signal<boolean> = computed(() => this.projectRows().length > 0);

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

  private initProjectRows(): Signal<OrgLensRoiProjectRow[]> {
    // Keyed by string, not the account object: that object is rewritten in place and would retrigger the fetch.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.method()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgLensRoiMethod]),
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
          this.forbidden.set(false);
        }),
        switchMap(([orgUid, method]) =>
          this.roiService.getProjects(orgUid, method).pipe(
            tap(() => this.loading.set(false)),
            map((projects) => projects.rows),
            catchError((error: unknown) => {
              console.error('Failed to load ROI projects section', error);
              this.loading.set(false);
              // Only a 403 may show the no-access message; a 503 must not.
              if ((error as { status?: number })?.status === 403) this.forbidden.set(true);
              else this.failed.set(true);
              return of([] as OrgLensRoiProjectRow[]);
            })
          )
        )
      ),
      { initialValue: [] as OrgLensRoiProjectRow[] }
    );
  }
}
