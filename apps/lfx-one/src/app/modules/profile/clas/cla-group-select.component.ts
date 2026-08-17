// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CLA_GROUP_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type { ClaGroupOption } from '@lfx-one/shared/interfaces';
import { MyClasService } from '@services/my-clas.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, debounceTime, of, Subject, switchMap, tap } from 'rxjs';

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

  private readonly search$ = new Subject<string>();

  /** Set while writing the chosen project's name back into the field, so it is not re-searched. */
  private suppressNextEmit = false;

  public constructor() {
    this.search$
      .pipe(
        debounceTime(CLA_GROUP_SEARCH_DEBOUNCE_MS),
        tap(() => {
          this.loading.set(true);
          this.error.set(false);
        }),
        switchMap((query) =>
          this.myClasService.getClaGroupOptions(query).pipe(
            catchError(() => {
              this.error.set(true);
              return of<ClaGroupOption[] | null>(null);
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe((options) => {
        this.loading.set(false);
        if (options) this.options.set(options);
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
        // describe a project the text no longer matches.
        this.selected.set(null);
        this.resultsOpen.set(true);
        this.search$.next(value ?? '');
      });
  }

  protected onFocus(): void {
    this.resultsOpen.set(true);
    if (!this.selected()) this.search$.next(this.searchForm.get('query')?.value ?? '');
  }

  protected retry(): void {
    this.search$.next(this.searchForm.get('query')?.value ?? '');
  }

  protected onSelect(option: ClaGroupOption): void {
    this.selected.set(option);
    this.suppressNextEmit = true;
    this.searchForm
      .get('query')
      ?.setValue(option.claGroupName && option.claGroupName !== option.projectName ? `${option.projectName} — ${option.claGroupName}` : option.projectName);
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
}
