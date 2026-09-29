// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { INSIGHTS_PUBLIC_API_DOCS_URL, INSIGHTS_TOKEN_INELIGIBLE, INSIGHTS_TOKEN_PREFIX } from '@lfx-one/shared/constants';
import {
  CreateInsightsTokenResponse,
  InsightsToken,
  InsightsTokenEligibility,
  InsightsTokenListItem,
  InsightsTokenRevealDialogData,
} from '@lfx-one/shared/interfaces';
import { formatRelativeTime } from '@lfx-one/shared/utils';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { UserService } from '@services/user.service';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, finalize, map, of, switchMap, take } from 'rxjs';

import { InsightsTokenCreateDialogComponent } from '../insights-token-create-dialog/insights-token-create-dialog.component';
import { InsightsTokenRevealDialogComponent } from '../insights-token-reveal-dialog/insights-token-reveal-dialog.component';

/**
 * LFX Insights API tokens group (IN-1233), rendered inside the Developer Settings API Token card
 * behind the `insights-public-api` flag. Relies on the parent's ConfirmationService, MessageService
 * and DialogService (and its `<p-toast>` / `<p-confirmDialog>`). Key Contacts only: the list loads
 * once eligibility allows it, matching the server gate. Read-only while impersonating: the list and
 * eligibility still load for the impersonated user, but create and revoke are disabled (the server
 * blocks them too).
 */
@Component({
  selector: 'lfx-insights-tokens',
  imports: [DatePipe, ButtonComponent],
  templateUrl: './insights-tokens.component.html',
})
export class InsightsTokensComponent {
  private readonly insightsTokensService = inject(InsightsTokensService);
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userService = inject(UserService);

  protected readonly docsUrl = INSIGHTS_PUBLIC_API_DOCS_URL;
  protected readonly impersonating = this.userService.impersonating;
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly revokingUid = signal<string | null>(null);
  private readonly tokens = signal<InsightsToken[]>([]);
  private readonly eligibility = signal<InsightsTokenEligibility>(INSIGHTS_TOKEN_INELIGIBLE);

  protected readonly canCreate = computed(() => this.eligibility().canCreate);
  protected readonly eligibilityCheckFailed = computed(() => this.eligibility().checkFailed);
  protected readonly hasTokens = computed(() => this.tokens().length > 0);
  protected readonly items: Signal<InsightsTokenListItem[]> = this.initItems();

  public constructor() {
    // Browser-only: token listings are live-credential metadata and never need to be in the SSR payload.
    afterNextRender(() => this.load());
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(false);

    // Tokens are Key-Contact-only on the server too, so the list is fetched only once eligibility allows it.
    this.insightsTokensService
      .getEligibility()
      .pipe(
        switchMap((eligibility) => {
          this.eligibility.set(eligibility);
          if (!eligibility.canCreate) {
            return of<InsightsToken[]>([]);
          }
          return this.insightsTokensService.getTokens().pipe(
            catchError(() => {
              this.loadError.set(true);
              return of<InsightsToken[]>([]);
            })
          );
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((tokens) => this.tokens.set(tokens));
  }

  protected openCreateDialog(): void {
    if (this.impersonating()) {
      return;
    }

    // `open()` returns null when a dialog of the same component is still registered,
    // which a quick double-click on "New token" can do.
    const ref: DynamicDialogRef | null = this.dialogService.open(InsightsTokenCreateDialogComponent, {
      header: '',
      width: '520px',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      // closeOnEscape defaults to true independently of closable; Escape mid-create would drop the one-time secret.
      closeOnEscape: false,
      dismissableMask: false,
      showHeader: false,
      contentStyle: { padding: '0' },
    });
    if (!ref) {
      return;
    }
    nameDynamicDialog(this.dialogService, ref, InsightsTokenCreateDialogComponent.headingId);

    // onClose emits before the leave animation ends, and that end drops the body's p-overflow-hidden.
    // Opening the reveal from onClose would lose its scroll lock, so wait for onDestroy (see profile-clas #2066).
    // Scoped to the dialog, not this component: a runtime flag change can remove this gated group while the
    // parent-owned dialog is still minting, and cancelling here would lose the one-time secret. take(1) ends both.
    ref.onClose.pipe(take(1)).subscribe((created: CreateInsightsTokenResponse | undefined) => {
      if (!created) {
        return;
      }
      this.tokens.update((tokens) => [created.token, ...tokens]);
      ref.onDestroy.pipe(take(1)).subscribe(() => this.openRevealDialog({ name: created.token.name, secret: created.secret }));
    });
  }

  protected confirmRevoke(token: InsightsToken): void {
    if (this.impersonating()) {
      return;
    }

    this.confirmationService.confirm({
      header: `Revoke “${token.name}”?`,
      message: "Anything using this token will stop working within 10 minutes. This can't be undone.",
      acceptLabel: 'Revoke token',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.revoke(token),
    });
  }

  private initItems(): Signal<InsightsTokenListItem[]> {
    return computed(() =>
      this.tokens().map((token) => ({
        token,
        maskedValue: `${INSIGHTS_TOKEN_PREFIX}${token.lookupId}${'*'.repeat(8)}`,
        lastUsedLabel: token.lastUsedAt ? `Last used ${formatRelativeTime(new Date(token.lastUsedAt))}` : 'Never used',
      }))
    );
  }

  private revoke(token: InsightsToken): void {
    this.revokingUid.set(token.uid);

    this.insightsTokensService
      .revokeToken(token.uid)
      .pipe(
        map(() => true),
        catchError((error) => {
          console.error('Failed to revoke LFX Insights API token:', error);
          return of(false);
        }),
        finalize(() => this.revokingUid.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((revoked) => {
        if (revoked) {
          this.tokens.update((tokens) => tokens.filter((t) => t.uid !== token.uid));
          this.messageService.add({ severity: 'success', summary: 'Token revoked.' });
          return;
        }
        this.messageService.add({ severity: 'error', summary: 'Revoke failed', detail: "We couldn't revoke the token. Please try again." });
      });
  }

  /** The secret lives only in this dialog's data; it is never kept in component state. */
  private openRevealDialog(data: InsightsTokenRevealDialogData): void {
    const ref: DynamicDialogRef | null = this.dialogService.open(InsightsTokenRevealDialogComponent, {
      header: '',
      width: '520px',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      // The secret is shown once; only the explicit Close button may dismiss it.
      closeOnEscape: false,
      dismissableMask: false,
      showHeader: false,
      contentStyle: { padding: '0' },
      data,
    });
    if (!ref) {
      return;
    }
    nameDynamicDialog(this.dialogService, ref, InsightsTokenRevealDialogComponent.headingId);
  }
}
