// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, effect, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { ClaGroupOption } from '@lfx-one/shared/interfaces';
import { DialogModule } from 'primeng/dialog';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

/**
 * "Sign a CLA" picker for the hand-off (#1251), following the approved M2 prototype: search,
 * pick from the results, confirm the selection, then continue.
 *
 * The two-step shape is the prototype's, not an embellishment — the contributor confirms *which*
 * project they are about to sign for before leaving the application, because the next screen is
 * a different product and a legal act.
 *
 * Purely presentational. The query is emitted rather than filtered here, so the results always
 * come from the server route; when #1250 lands the real four-source search behind that route,
 * this component does not change.
 */
@Component({
  selector: 'lfx-cla-group-select',
  imports: [DialogModule, ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './cla-group-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClaGroupSelectComponent {
  public readonly options = input<ClaGroupOption[]>([]);
  public readonly loading = input<boolean>(false);
  public readonly error = input<boolean>(false);

  /** True while the hand-off URL is being resolved — keeps the CTA busy and blocks a second click. */
  public readonly starting = input<boolean>(false);

  public readonly visible = model<boolean>(false);

  public readonly search = output<string>();
  public readonly confirmed = output<ClaGroupOption>();
  public readonly retry = output<void>();

  protected readonly searchForm = new FormGroup({
    query: new FormControl(''),
  });

  protected readonly selected = signal<ClaGroupOption | null>(null);
  protected readonly resultsOpen = signal(false);

  /** Set while writing the chosen project's name back into the field, so it is not re-searched. */
  private suppressNextEmit = false;

  public constructor() {
    // Every open starts clean. A selection left over from last time would sit above a stale
    // result list, and the CTA would be armed for a project the contributor never re-picked.
    effect(() => {
      if (this.visible()) this.reset();
    });

    this.searchForm
      .get('query')!
      .valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        // A typed character invalidates the confirmed choice: the summary and CTA must never
        // describe a project the text no longer matches.
        if (this.suppressNextEmit) {
          this.suppressNextEmit = false;
          return;
        }

        this.selected.set(null);
        this.resultsOpen.set(true);
        this.search.emit(value ?? '');
      });
  }

  protected onFocus(): void {
    this.resultsOpen.set(true);
    if (!this.selected()) this.search.emit(this.searchForm.get('query')?.value ?? '');
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
    if (!option || this.starting()) return;
    this.confirmed.emit(option);
  }

  protected onCancel(): void {
    this.visible.set(false);
  }

  private reset(): void {
    this.suppressNextEmit = true;
    this.searchForm.get('query')?.setValue('');
    this.selected.set(null);
    this.resultsOpen.set(false);
  }
}
