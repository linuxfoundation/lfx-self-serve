// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ALREADY_SIGNED_CLA_LABEL, CLA_GROUP_SEARCH_DEBOUNCE_MS, CLA_GROUP_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import type { ClaGroupOptionView, ClaGroupSearchResponse, ClaGroupSelectDialogData, MyClaAgreement } from '@lfx-one/shared/interfaces';
import { alreadySignedClaTooltip, coveringAgreementForGroup, toClaGroupOptionView } from '@lfx-one/shared/utils';
import { MyClasService } from '@services/my-clas.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, debounceTime, map, of, Subject, switchMap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

/**
 * "Sign a CLA" picker, opened via DialogService (#1251), following the approved M2 prototype:
 * search, pick from the results, confirm the selection, then continue.
 *
 * The two-step shape is the prototype's, not an embellishment — the contributor confirms *which*
 * project they are about to sign for before leaving the application, because the next screen is
 * a different product and a legal act.
 *
 * Closes with the chosen `ClaGroupOption`, or `null` if the contributor backs out; the caller
 * resolves the hand-off URL. Searching happens here and upstream rather than by filtering a
 * fetched list, so #1250 can put the real four-source search behind the same route untouched.
 *
 * A group the contributor already holds a CLA for stays in the list, grayed out, with a
 * tooltip that says so (#1914). Hiding it would look like the project does not exist.
 */
@Component({
  selector: 'lfx-cla-group-select',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, TooltipModule],
  templateUrl: './cla-group-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClaGroupSelectComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly myClasService = inject(MyClasService);
  private readonly config = inject<DynamicDialogConfig<ClaGroupSelectDialogData>>(DynamicDialogConfig, { optional: true });

  /** Chip on a grayed-out row. The tooltip sentence is computed per option. */
  protected readonly alreadySignedLabel = ALREADY_SIGNED_CLA_LABEL;

  /**
   * The CLAs tab's loaded list. Optional so a test that never opens this through DialogService
   * still constructs; no list means nothing is grayed out.
   */
  private readonly agreements: readonly MyClaAgreement[] = this.config?.data?.agreements ?? [];

  protected readonly searchForm = new FormGroup({
    query: new FormControl(''),
  });

  protected readonly options = signal<ClaGroupOptionView[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly selected = signal<ClaGroupOptionView | null>(null);
  protected readonly resultsOpen = signal(false);
  /** Producer capped the set — a property of the result set, so it cannot live on a result. */
  protected readonly truncated = signal(false);

  private readonly query = signal('');

  /** Position of the keyboard highlight in `options`, or -1 when nothing is highlighted. */
  protected readonly highlightedIndex = signal(-1);

  /**
   * Which of the three "the list is empty" answers applies, so the template never has to infer
   * one from `options().length === 0` — which cannot tell "you have not typed yet" from "keep
   * going" from "that term matched nothing".
   */
  protected readonly queryBand: Signal<'empty' | 'short' | 'searchable'> = this.initQueryBand();

  private readonly search$ = new Subject<string>();

  /** Set while writing the chosen project's name back into the field, so it is not re-searched. */
  private suppressNextEmit = false;

  public constructor() {
    this.search$
      .pipe(
        debounceTime(CLA_GROUP_SEARCH_DEBOUNCE_MS),
        map((query) => query.trim()),
        switchMap((searchTerm) => {
          // Below the producer's minimum there is nothing to ask and nothing to report: the
          // contributor is mid-word, so an error here would describe a mistake nobody made.
          if (searchTerm.length < CLA_GROUP_SEARCH_MIN_CHARS) {
            this.loading.set(false);
            this.error.set(false);
            this.clearResults();
            return of<ClaGroupSearchResponse | null>(null);
          }

          this.loading.set(true);
          this.error.set(false);
          return this.myClasService.getClaGroupOptions(searchTerm).pipe(
            catchError(() => {
              // Every failure takes this one branch, including a 400 or 422 from a short term
              // that slipped past the gate above: same mistake, same message, one Retry.
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
        this.options.set(response.results.map((option) => toClaGroupOptionView(option)));
        this.truncated.set(response.truncated);
        // The highlight is a position in the previous list; carrying it over would let Enter
        // confirm whichever project happens to land at that offset in the new one.
        this.highlightedIndex.set(-1);
      });

    this.searchForm.controls.query.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (this.suppressNextEmit) {
        this.suppressNextEmit = false;
        return;
      }

      // A typed character invalidates the confirmed choice: the summary and CTA must never
      // describe a project the text no longer matches. The highlight is a position in the
      // previous list, so it has to drop here rather than after the debounce — Enter during
      // the request window would otherwise confirm a CLA group the text no longer describes.
      this.selected.set(null);
      this.highlightedIndex.set(-1);
      this.resultsOpen.set(true);
      this.pushSearch(value ?? '');
    });
  }

  /**
   * Reveals a result's linked organizations. Click, not hover, per the approved prototype: the
   * list is reference material a contributor reads to tell two similarly named groups apart, and
   * a hover panel cannot be read on touch or held open while comparing.
   */
  protected toggleOrgs(event: Event, option: ClaGroupOptionView): void {
    event.stopPropagation();
    this.options.update((options) => options.map((row) => (row.claGroupId === option.claGroupId ? { ...row, expanded: !row.expanded } : row)));
  }

  /**
   * Arrow keys, Enter and Escape on the open results list (FR-010).
   *
   * Bound at the field's container rather than on each row, and the rows are not focusable: focus
   * stays in the text box so the contributor can keep typing while moving the highlight, which is
   * what `aria-activedescendant` on the listbox describes.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.ref.close(null);
      return;
    }

    const options = this.options();
    // Match the template: keep-typing / error copy hide the rows, so the keyboard must not
    // treat those leftover options as still on screen.
    if (!this.resultsOpen() || this.error() || this.queryBand() !== 'searchable' || options.length === 0) {
      return;
    }

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
        if (!highlighted || this.alreadySignedTooltip(highlighted)) return;
        event.preventDefault();
        this.onSelect(highlighted);
        break;
      }
    }
  }

  protected onFocus(): void {
    this.resultsOpen.set(true);
    if (this.selected()) return;

    const value = this.searchForm.controls.query.value ?? '';
    // Refocusing the field (tab back, retry, result click) must not re-issue the same
    // five-table producer search. Retry still calls `pushSearch` directly so an unchanged
    // term after an error is not swallowed.
    if (value.trim() === this.query().trim() && this.options().length > 0) return;
    this.pushSearch(value);
  }

  protected retry(): void {
    this.pushSearch(this.searchForm.controls.query.value ?? '');
  }

  /**
   * Tooltip on a result the contributor already holds a CLA for. Undefined means the
   * row is selectable. Kept as a method rather than precomputed onto the view model so
   * a search-result update cannot drop the coverage the parent already loaded.
   */
  protected alreadySignedTooltip(option: ClaGroupOptionView): string | undefined {
    const covering = coveringAgreementForGroup(this.agreements, option.claGroupId);
    return covering ? alreadySignedClaTooltip(covering) : undefined;
  }

  protected onSelect(option: ClaGroupOptionView): void {
    if (this.alreadySignedTooltip(option)) return;
    this.selected.set(option);
    this.suppressNextEmit = true;
    const display = option.secondaryName ? `${option.primaryName} — ${option.secondaryName}` : option.primaryName;
    this.searchForm.controls.query.setValue(display);
    this.resultsOpen.set(false);
  }

  protected onContinue(): void {
    const option = this.selected();
    if (!option) return;
    this.ref.close(option);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }

  /** Single entry point to the search stream, so the band and the request never disagree. */
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

  private initQueryBand(): Signal<'empty' | 'short' | 'searchable'> {
    return computed(() => {
      const length = this.query().trim().length;
      if (length === 0) return 'empty';
      return length < CLA_GROUP_SEARCH_MIN_CHARS ? 'short' : 'searchable';
    });
  }
}
