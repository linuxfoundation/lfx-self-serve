// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { GithubAccountChoice, GithubAccountOption } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { SelectableCardComponent } from '@components/selectable-card/selectable-card.component';

/**
 * "Which GitHub account are you signing as?" step, shown between the CLA-group picker and the
 * Console hand-off (#1252) when the contributor has linked more than one GitHub account.
 *
 * It exists because the account a CLA is recorded against used to be decided by whichever
 * record an identity search returned first, which is not a decision the contributor got to
 * make and not one that is stable across signings.
 *
 * The list comes from the server, which reads it from the identity provider for this session,
 * and the CLA service records the submitted account without re-deriving ownership. So the list
 * is not merely display data: an account that should not be in it would be recorded. This
 * component must present what it is given and nothing else — it must never accept an account
 * from the URL, from user input, or from anywhere but `config.data`.
 *
 * Closes with the chosen account's `githubId`, or `null` if the contributor backs out. The id
 * alone, because the parent already holds the list and resolves the rest from it rather than
 * taking a handle from here.
 */
@Component({
  selector: 'lfx-github-account-select',
  imports: [ReactiveFormsModule, ButtonComponent, SelectableCardComponent],
  templateUrl: './github-account-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GithubAccountSelectComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject<DynamicDialogConfig<{ accounts: GithubAccountOption[] }>>(DynamicDialogConfig);

  /**
   * Deliberately starts empty rather than preselecting the first account. A preselection is
   * indistinguishable from a choice once submitted, and the whole point of this step is that
   * the association stops being decided by list order.
   */
  protected readonly selectForm = new FormGroup({
    githubId: new FormControl<string | null>(null),
  });

  /**
   * The handle can be blank: the server maps a missing `profileData.nickname` to `''` rather
   * than guessing one. Labelling that option with the account number keeps the two accounts
   * distinguishable. The blank handle itself is left alone — what gets recorded is not this
   * component's to invent.
   */
  protected readonly accounts = signal<GithubAccountChoice[]>(
    (this.config.data?.accounts ?? []).map((account) => ({
      ...account,
      label: account.githubUsername || `GitHub account ${account.githubId}`,
    }))
  );
  protected readonly selectedId = signal<string | null>(null);

  public constructor() {
    this.selectForm.controls.githubId.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.selectedId.set(value));
  }

  protected onContinue(): void {
    const githubId = this.selectedId();
    if (!githubId) return;
    this.ref.close(githubId);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }
}
