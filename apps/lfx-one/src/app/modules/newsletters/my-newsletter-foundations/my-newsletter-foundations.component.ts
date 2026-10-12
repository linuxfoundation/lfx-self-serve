// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MyNewsletterFoundation, MyNewsletterFoundationsState, NewsletterInviteDialogData } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { PersonaService } from '@services/persona.service';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, map, of, startWith, switchMap } from 'rxjs';

import { NewsletterFoundationCardComponent } from '../components/newsletter-foundation-card/newsletter-foundation-card.component';
import { NewsletterInviteDialogComponent } from '../components/newsletter-invite-dialog/newsletter-invite-dialog.component';

/**
 * Me-lens "My Newsletters" (#3483): one card per foundation the user receives newsletters from —
 * logo, name, how many issues they received — with a drill-down to that foundation's issues and,
 * for employees of Linux Foundation member companies on the list, an Invite action that emails a
 * colleague the member benefit.
 */
@Component({
  selector: 'lfx-my-newsletter-foundations',
  imports: [EmptyStateComponent, NewsletterFoundationCardComponent, SkeletonModule],
  providers: [DialogService],
  templateUrl: './my-newsletter-foundations.component.html',
})
export class MyNewsletterFoundationsComponent {
  // === Services ===
  private readonly newsletterService = inject(NewsletterService);
  private readonly personaService = inject(PersonaService);
  private readonly dialogService = inject(DialogService);
  private readonly retry$ = new BehaviorSubject<void>(undefined);

  // === Computed Signals ===
  protected readonly personaLoaded = this.personaService.personaLoaded;
  private readonly state: Signal<MyNewsletterFoundationsState> = this.initState();
  protected readonly loading = computed(() => this.state().loading);
  protected readonly error = computed(() => this.state().error);
  protected readonly foundations = computed(() => this.state().data?.foundations ?? []);
  protected readonly inviter = computed(() => this.state().data?.inviter ?? { eligible: false, company_name: null });
  protected readonly incomplete = computed(() => this.state().data?.complete === false);
  protected readonly skeletons = [1, 2, 3];

  // === Public Methods ===
  public onRetry(): void {
    this.retry$.next(undefined);
  }

  // === Protected Methods ===
  protected onInvite(foundation: MyNewsletterFoundation): void {
    this.dialogService.open(NewsletterInviteDialogComponent, {
      header: 'Invite a colleague',
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { foundation } satisfies NewsletterInviteDialogData,
    });
  }

  // === Private Initializers ===
  private initState(): Signal<MyNewsletterFoundationsState> {
    const pending: MyNewsletterFoundationsState = { loading: true, error: false, data: null };
    return toSignal(
      this.retry$.pipe(
        switchMap(() =>
          this.newsletterService.getMyNewsletterFoundations().pipe(
            map((data): MyNewsletterFoundationsState => ({ loading: false, error: false, data })),
            catchError((error: unknown) => {
              console.error('[MyNewsletterFoundations] Failed to load newsletters', error);
              return of<MyNewsletterFoundationsState>({ loading: false, error: true, data: null });
            }),
            startWith(pending)
          )
        )
      ),
      { initialValue: pending }
    );
  }
}
