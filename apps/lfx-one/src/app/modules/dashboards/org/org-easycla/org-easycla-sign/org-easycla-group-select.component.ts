// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CCLA_SIGN_COPY, CLA_GROUP_SEARCH_DEBOUNCE_MS, CLA_GROUP_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import type {
  ClaGroupOption,
  ClaGroupSearchResponse,
  OrgClaGroupOptionView,
  OrgClaGroupPickerResult,
  OrgClaGroupSelectDialogData,
} from '@lfx-one/shared/interfaces';
import { toClaGroupOptionView } from '@lfx-one/shared/utils';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, debounceTime, map, of, Subject, switchMap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

/**
 * "Sign a Corporate CLA" CLA Group picker for the Organization Lens (#1983).
 *
 * **A deliberate second picker, not an oversight.** The Me-lens `ClaGroupSelectComponent` was
 * considered and rejected as a base. It reads its results from `MyClasService` — a route that is
 * neither dark-launch gated for this section nor organization-scoped — and it takes the
 * contributor's own held agreements as dialog input so it can annotate rows they have already
 * signed. Neither applies here, and the annotation this picker needs is the inverse: why a row
 * *cannot* be signed corporately. Parameterising the data source, the annotation source and the
 * selectability rule would rewrite the component the Me-lens signing flow depends on, inside a
 * slice whose risk is already spent on a write path and legal copy.
 *
 * What is genuinely shared is shared: the debounce and minimum-term constants, and
 * `toClaGroupOptionView`. If the two pickers later converge, that is the moment for a common
 * base — not now, when they disagree about what a row means.
 *
 * Closes with the chosen group, or `null` if the viewer backs out.
 */
@Component({
  selector: 'lfx-org-easycla-group-select',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './org-easycla-group-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaGroupSelectComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly claService = inject(OrgLensClaService);
  private readonly config = inject<DynamicDialogConfig<OrgClaGroupSelectDialogData>>(DynamicDialogConfig);

  private readonly orgUid = this.config.data?.orgUid ?? '';

  protected readonly copy = CCLA_SIGN_COPY.picker;
  protected readonly minChars = CLA_GROUP_SEARCH_MIN_CHARS;

  protected readonly searchForm = new FormGroup({
    query: new FormControl(''),
  });

  protected readonly options = signal<OrgClaGroupOptionView[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly selected = signal<OrgClaGroupOptionView | null>(null);
  protected readonly truncated = signal(false);

  private readonly query = signal('');

  /** Position of the keyboard highlight in `options`, or -1 when nothing is highlighted. */
  protected readonly highlightedIndex = signal(-1);

  /**
   * Which "the list is empty" answer applies, so the template never infers one from a zero
   * length — which cannot tell "you have not typed yet" from "keep going" from "no matches".
   */
  protected readonly queryBand: Signal<'empty' | 'short' | 'searchable'> = computed(() => {
    const length = this.query().trim().length;
    if (length === 0) return 'empty';
    return length < CLA_GROUP_SEARCH_MIN_CHARS ? 'short' : 'searchable';
  });

  private readonly search$ = new Subject<string>();

  /** Set while writing the chosen group's name back into the field, so it is not re-searched. */
  private suppressNextEmit = false;

  public constructor() {
    this.search$
      .pipe(
        debounceTime(CLA_GROUP_SEARCH_DEBOUNCE_MS),
        map((query) => query.trim()),
        switchMap((searchTerm) => {
          if (searchTerm.length < CLA_GROUP_SEARCH_MIN_CHARS) {
            this.loading.set(false);
            this.error.set(false);
            this.clearResults();
            return of<ClaGroupSearchResponse | null>(null);
          }

          this.loading.set(true);
          this.error.set(false);
          return this.claService.getSignOptions(this.orgUid, searchTerm).pipe(
            catchError(() => {
              this.error.set(true);
              this.clearResults();
              return of<ClaGroupSearchResponse | null>(null);
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((response) => {
        this.loading.set(false);
        if (!response) return;
        this.options.set(response.results.map((option) => this.toOrgOptionView(option)));
        this.truncated.set(response.truncated);
        // The highlight is a position in the previous list; carrying it over would let Enter
        // confirm whichever CLA Group happens to land at that offset in the new one.
        this.highlightedIndex.set(-1);
      });

    this.searchForm.controls.query.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (this.suppressNextEmit) {
        this.suppressNextEmit = false;
        return;
      }

      // A typed character invalidates the confirmed choice, so the summary and the continue
      // control can never describe a CLA Group the text no longer matches. The highlight is a
      // position in the previous list, so it has to drop here rather than after the debounce —
      // Enter during the request window would otherwise confirm a CLA Group the text no longer
      // describes.
      this.selected.set(null);
      this.highlightedIndex.set(-1);
      this.pushSearch(value ?? '');
    });
  }

  /**
   * Arrow keys, Enter and Escape on the results list, matching the Me-lens picker.
   *
   * Bound at the field's container rather than on each row, and the rows are not focusable: focus
   * stays in the text box so the viewer can keep typing while moving the highlight, which is what
   * `aria-activedescendant` on the listbox describes.
   *
   * The highlight does stop on a row that cannot be signed. Skipping those would be the obvious
   * reading of "disabled", and it is the wrong one here — the reason a CLA Group cannot be signed
   * corporately is the row's whole payload, and a keyboard-only viewer who cannot reach the row
   * never hears it. `onSelect` is what refuses; arriving is allowed.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.ref.close(null);
      return;
    }

    const options = this.options();
    // Match the template: the error and keep-typing panels replace the rows, so the keyboard must
    // not treat a leftover list as still on screen.
    if (this.error() || this.queryBand() !== 'searchable' || options.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        // Otherwise the caret jumps to the end of the field on every step.
        event.preventDefault();
        this.highlightedIndex.set((this.highlightedIndex() + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.highlightedIndex.set((this.highlightedIndex() - 1 + options.length) % options.length);
        break;
      case 'Enter': {
        const highlighted = options[this.highlightedIndex()];
        if (!highlighted) return;
        event.preventDefault();
        this.onSelect(highlighted);
        break;
      }
    }
  }

  protected retry(): void {
    this.pushSearch(this.searchForm.controls.query.value ?? '');
  }

  protected onSelect(option: OrgClaGroupOptionView): void {
    // Belt and braces with the template's disabled state: a row that names why it cannot be
    // signed must not become the chosen one through a keyboard activation either.
    if (option.disabledReason) return;

    this.selected.set(option);
    this.suppressNextEmit = true;
    this.searchForm.controls.query.setValue(option.secondaryName ? `${option.primaryName} — ${option.secondaryName}` : option.primaryName);
  }

  protected onContinue(): void {
    const option = this.selected();
    // `projectSfid` is what makes a row selectable in the first place, so this is unreachable
    // through the UI. It is here because the alternative to checking is asserting, and the value
    // being asserted is the key of a request that creates a legal document.
    if (!option?.projectSfid) return;

    const result: OrgClaGroupPickerResult = {
      claGroupId: option.claGroupId,
      projectSfid: option.projectSfid,
      projectName: option.primaryName,
    };
    this.ref.close(result);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }

  private pushSearch(value: string): void {
    this.query.set(value);
    this.search$.next(value);
  }

  /** Drops a list the template is no longer drawing, so Arrow/Enter cannot confirm a hidden row. */
  private clearResults(): void {
    this.options.set([]);
    this.truncated.set(false);
    this.highlightedIndex.set(-1);
  }

  /**
   * A row that cannot be signed stays on screen with its reason, rather than being filtered out.
   *
   * Dropping it would leave a viewer searching repeatedly for a CLA Group they can see in the
   * legacy console, with nothing to explain the absence. Leaving it selectable would send a
   * request that is certain to fail.
   */
  private toOrgOptionView(option: ClaGroupOption): OrgClaGroupOptionView {
    const view = toClaGroupOptionView(option);

    if (!option.projectSfid) {
      return { ...view, disabledReason: this.copy.multiProjectDisabledReason };
    }
    if (option.cclaEnabled !== true) {
      return { ...view, disabledReason: this.copy.cclaDisabledReason };
    }
    return { ...view, disabledReason: null };
  }
}
