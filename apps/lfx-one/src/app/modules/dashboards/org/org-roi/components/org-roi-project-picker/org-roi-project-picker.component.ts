// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { ORG_LENS_ROI_PROJECT_PICKER_DEFAULT_COUNT, ORG_LENS_ROI_PROJECT_PICKER_MAX_MATCHES } from '@lfx-one/shared/constants';
import type { OrgLensRoiProjectOption } from '@lfx-one/shared/interfaces';

/**
 * The project selection shared by the comparison, flow and efficiency views.
 *
 * One component rather than one per view: the three views differ in how they draw a selection, not
 * in how a selection is made, and three copies of this would drift the moment one of them gained a
 * behaviour the others did not.
 */
@Component({
  selector: 'lfx-org-roi-project-picker',
  imports: [InputTextComponent, ReactiveFormsModule],
  templateUrl: './org-roi-project-picker.component.html',
})
export class OrgRoiProjectPickerComponent {
  /** Every project, already ranked by return — the order the default selection is taken from. */
  public readonly options = input.required<OrgLensRoiProjectOption[]>();

  public readonly selectedIds = input.required<string[]>();

  /**
   * One-way in, events out, rather than a two-way `model`. The section distinguishes a selection
   * the viewer emptied from one it has never set, and a `model` this component could write to
   * would let it produce the first without saying so.
   */
  public readonly selectionChange = output<string[]>();

  protected readonly defaultCount = ORG_LENS_ROI_PROJECT_PICKER_DEFAULT_COUNT;

  /** The LFX input wrappers are reactive-forms only, so the search box is a control, not ngModel. */
  protected readonly searchForm = new FormGroup({ query: new FormControl('', { nonNullable: true }) });

  private readonly query: Signal<string> = toSignal(this.searchForm.controls.query.valueChanges, { initialValue: '' });

  private readonly optionsById: Signal<Map<string, OrgLensRoiProjectOption>> = computed(
    () => new Map(this.options().map((option) => [option.projectId, option]))
  );

  /**
   * Chips follow the selection's own order, not the ranking. Reordering them under the viewer when
   * a project is added would make the chip they just created appear somewhere they were not
   * looking, and the set is what matters here — nothing downstream reads this order.
   */
  protected readonly selectedOptions: Signal<OrgLensRoiProjectOption[]> = computed(() => {
    const byId = this.optionsById();
    // An id with no option is dropped rather than rendered blank: the selection outlives a payload
    // refresh, so a project can leave the set between one response and the next.
    return this.selectedIds()
      .map((id) => byId.get(id))
      .filter((option): option is OrgLensRoiProjectOption => option !== undefined);
  });

  protected readonly hasSelection: Signal<boolean> = computed(() => this.selectedOptions().length > 0);

  protected readonly canSelectAll: Signal<boolean> = computed(() => this.selectedIds().length < this.options().length);

  /** Every unselected project matching the query. Counted here, before any cap is applied. */
  private readonly allMatches: Signal<OrgLensRoiProjectOption[]> = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (query === '') return [];
    const selected = new Set(this.selectedIds());
    return this.options().filter((option) => !selected.has(option.projectId) && option.projectName.toLowerCase().includes(query));
  });

  /** Capped for display — this finds one project, it does not browse. */
  protected readonly matches: Signal<OrgLensRoiProjectOption[]> = computed(() => this.allMatches().slice(0, ORG_LENS_ROI_PROJECT_PICKER_MAX_MATCHES));

  protected readonly hasQuery: Signal<boolean> = computed(() => this.query().trim() !== '');

  /**
   * Counts the matches that exist, not the ones drawn, and says so when those differ. Counting the
   * capped list instead reported "20 projects match" to a viewer whose search actually found
   * hundreds — an unqualified claim about data the component had withheld, which is the one thing
   * every other truncation in this feature is careful not to do.
   */
  protected readonly matchCountLabel: Signal<string> = computed(() => {
    const total = this.allMatches().length;
    const shown = this.matches().length;
    if (total === 0) return 'No unselected project matches that name.';
    if (total > shown) return `${total.toLocaleString('en-US')} projects match; showing the first ${shown}. Narrow the search to find a specific project.`;
    return total === 1 ? '1 project matches.' : `${total.toLocaleString('en-US')} projects match.`;
  });

  public selectTop(): void {
    this.selectionChange.emit(
      this.options()
        .slice(0, this.defaultCount)
        .map((option) => option.projectId)
    );
    this.searchForm.controls.query.setValue('');
  }

  public selectAll(): void {
    this.selectionChange.emit(this.options().map((option) => option.projectId));
    this.searchForm.controls.query.setValue('');
  }

  public selectNone(): void {
    this.selectionChange.emit([]);
  }

  public add(projectId: string): void {
    if (this.selectedIds().includes(projectId)) return;
    this.selectionChange.emit([...this.selectedIds(), projectId]);
    this.searchForm.controls.query.setValue('');
  }

  public remove(projectId: string): void {
    this.selectionChange.emit(this.selectedIds().filter((id) => id !== projectId));
  }
}
