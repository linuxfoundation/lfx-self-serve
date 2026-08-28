// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { GithubAccountChoice, GithubAccountOption, GithubAccountSelectResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { SelectableCardComponent } from '@components/selectable-card/selectable-card.component';

/**
 * "Which GitHub account are you signing as?" step, shown between the CLA-group picker and the
 * Console hand-off (#1252). It is shown for every account list the server returns, an empty
 * one included.
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
 * With no linked account it becomes a blocking empty state rather than an empty list: the
 * contributor is told why they cannot continue at the point they tried to, instead of being
 * moved elsewhere and left to work out that the CLA group they picked was dropped (#1917).
 *
 * That block is written out here rather than delegated to `lfx-empty-state` because that
 * component takes `title` as a required input and the design has no title — an icon, one
 * sentence, one action. Reusing it would mean inventing a heading, and the wording here is
 * required to be the design's. Its page-level proportions — a card, `p-8 md:p-16`, an 80px icon
 * badge — are the second reason; every other use of it in the app is a page or a table, not a
 * 32rem dialog. The action still takes that component's own outlined treatment, so the two
 * agree on everything but size.
 *
 * Closes with the chosen account's `githubId`, with `linkAccounts` if they asked to link one,
 * or `null` if they backed out. The id alone, because the parent already holds the list and
 * resolves the rest from it rather than taking a handle from here.
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
  protected readonly hasAccounts = computed(() => this.accounts().length > 0);

  public constructor() {
    this.selectForm.controls.githubId.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.selectedId.set(value));
  }

  protected onContinue(): void {
    const githubId = this.selectedId();
    if (!githubId) return;
    this.ref.close({ githubId } satisfies GithubAccountSelectResult);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }

  /**
   * Asks the caller to take the contributor to Identities. Navigating from here instead would
   * put routing in a dialog, which nothing else in this flow does.
   */
  protected onLinkAccounts(): void {
    this.ref.close({ linkAccounts: true } satisfies GithubAccountSelectResult);
  }
}
