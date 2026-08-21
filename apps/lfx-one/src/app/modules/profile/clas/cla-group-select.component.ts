// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CLA_GROUP_SEARCH_DEBOUNCE_MS, CLA_GROUP_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import type { ClaGroupMatchType, ClaGroupOption, ClaGroupOrgSource, ClaGroupSearchResponse } from '@lfx-one/shared/interfaces';
import { MyClasService } from '@services/my-clas.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, debounceTime, map, of, Subject, switchMap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

/** Stands in for a result the producer could name neither by project nor by CLA group (FR-008). */
const UNNAMED_CLA_GROUP = 'Unnamed CLA group';

/** Why a result matched, in contributor language rather than the producer's enum. */
const MATCH_TYPE_LABELS: Record<ClaGroupMatchType, string> = {
  claGroup: 'CLA group name',
  project: 'Project name',
  organization: 'Linked organization',
  repository: 'Repository link',
};

const ORG_SOURCE_LABELS: Record<ClaGroupOrgSource, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gerrit: 'Gerrit',
};

const ORG_SOURCE_ICONS: Record<ClaGroupOrgSource, string> = {
  github: 'fa-brands fa-github',
  gitlab: 'fa-brands fa-gitlab',
  gerrit: 'fa-light fa-code-branch',
};

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
 */
@Component({
  selector: 'lfx-cla-group-select',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './cla-group-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClaGroupSelectComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly myClasService = inject(MyClasService);

  protected readonly searchForm = new FormGroup({
    query: new FormControl(''),
  });

  protected readonly options = signal<ClaGroupOption[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly selected = signal<ClaGroupOption | null>(null);
  protected readonly resultsOpen = signal(false);
  /** Producer capped the set — a property of the result set, so it cannot live on a result. */
  protected readonly truncated = signal(false);
  /** CLA group ids whose linked-organization list the contributor has opened. */
  private readonly expandedOrgs = signal<ReadonlySet<string>>(new Set());

  private readonly query = signal('');

  /** Position of the keyboard highlight in `options`, or -1 when nothing is highlighted. */
  protected readonly highlightedIndex = signal(-1);

  /**
   * Which of the three "the list is empty" answers applies, so the template never has to infer
   * one from `options().length === 0` — which cannot tell "you have not typed yet" from "keep
   * going" from "that term matched nothing".
   */
  protected readonly queryBand = computed<'empty' | 'short' | 'searchable'>(() => {
    const length = this.query().trim().length;
    if (length === 0) return 'empty';
    return length < CLA_GROUP_SEARCH_MIN_CHARS ? 'short' : 'searchable';
  });

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
        this.options.set(response.results);
        this.truncated.set(response.truncated);
        // The highlight is a position in the previous list; carrying it over would let Enter
        // confirm whichever project happens to land at that offset in the new one.
        this.highlightedIndex.set(-1);
      });

    this.searchForm
      .get('query')!
      .valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
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
   * Primary line for a result. The producer omits `projectName` when a CLA Group maps to several
   * projects with no foundation marker, and `claGroupName` when the group record could not be
   * resolved — the two are omitted independently, and a result can arrive with neither.
   *
   * The CLA group name is used when there is no project name, rather than going straight to the
   * literal: a search for `cncf` returns several groups named CNCF with no project resolved, and
   * naming them all "Unnamed CLA group" would make a real, distinguishable choice unreadable. The
   * literal is for the both-absent case only (FR-008), and stands in for a truncated UUID, which
   * reads as a broken row rather than a nameless one.
   */
  protected primaryName(option: ClaGroupOption): string {
    return option.projectName || option.claGroupName || UNNAMED_CLA_GROUP;
  }

  /** Secondary line — only when it says something the primary line does not. */
  protected secondaryName(option: ClaGroupOption): string | null {
    return option.claGroupName && option.claGroupName !== this.primaryName(option) ? option.claGroupName : null;
  }

  protected matchTypeLabel(matchType: ClaGroupMatchType): string {
    return MATCH_TYPE_LABELS[matchType];
  }

  protected orgSourceLabel(source: ClaGroupOrgSource): string {
    return ORG_SOURCE_LABELS[source];
  }

  protected orgSourceIcon(source: ClaGroupOrgSource): string {
    return ORG_SOURCE_ICONS[source];
  }

  protected orgsExpanded(option: ClaGroupOption): boolean {
    return this.expandedOrgs().has(option.claGroupId);
  }

  /**
   * Reveals a result's linked organizations. Click, not hover, per the approved prototype: the
   * list is reference material a contributor reads to tell two similarly named groups apart, and
   * a hover panel cannot be read on touch or held open while comparing.
   */
  protected toggleOrgs(event: Event, option: ClaGroupOption): void {
    event.stopPropagation();
    this.expandedOrgs.update((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(option.claGroupId)) next.add(option.claGroupId);
      return next;
    });
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
        if (!highlighted) return;
        event.preventDefault();
        this.onSelect(highlighted);
        break;
      }
    }
  }

  protected onFocus(): void {
    this.resultsOpen.set(true);
    if (!this.selected()) this.pushSearch(this.searchForm.get('query')?.value ?? '');
  }

  protected retry(): void {
    this.pushSearch(this.searchForm.get('query')?.value ?? '');
  }

  protected onSelect(option: ClaGroupOption): void {
    this.selected.set(option);
    this.suppressNextEmit = true;
    const secondary = this.secondaryName(option);
    this.searchForm.get('query')?.setValue(secondary ? `${this.primaryName(option)} — ${secondary}` : this.primaryName(option));
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
}
