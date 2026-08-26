// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, signal, Signal, computed } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { extractStructuredErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, map, merge, switchMap, take, EMPTY, Subject } from 'rxjs';

import { CreatePublicationDialogComponent } from '../components/create-publication-dialog/create-publication-dialog.component';

@Component({
  selector: 'lfx-newsletter-publication-list',
  standalone: true,
  imports: [ButtonComponent, CardComponent, EmptyStateComponent, TagComponent, SkeletonModule],
  templateUrl: './newsletter-publication-list.component.html',
  styleUrl: './newsletter-publication-list.component.scss',
  providers: [DialogService],
})
export class NewsletterPublicationListComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  // === Writable Signals ===
  protected readonly publications = signal<NewsletterPublication[]>([]);
  // Start true: the context signal drives the first load on the next microtask,
  // so initialising to false would flash the empty state for one tick before
  // the skeletons appear.
  protected readonly loading = signal<boolean>(true);
  // Distinguishes "genuinely zero publications" from "the load failed" —
  // both otherwise land on the same `publications() = []` state, but they
  // need different empty-state copy and CTAs: a failed load's "create a
  // publication" CTA would risk creating a duplicate of a publication the
  // user already has and can't currently see, landing them on an upstream
  // 409 for a mistake the UI itself set up.
  protected readonly loadFailed = signal<boolean>(false);

  // === Reactive context ===
  public readonly projectUid: Signal<string> = this.projectContextService.activeContextUid;
  protected readonly hasPublications: Signal<boolean> = computed(() => this.publications().length > 0);
  // Manual re-trigger for retryLoad(), merged alongside the reactive
  // projectUid() stream below — a signal alone can't be "re-emitted" without
  // an actual value change, and the retry needs to reload the *same* uid.
  private readonly retry$ = new Subject<void>();

  public constructor() {
    this.initLoadOnContext();
  }

  protected goToPublicationEditions(publication: NewsletterPublication): void {
    // The publication's own project_uid travels in the URL, not this.projectUid()
    // (ambient active context) — the whole point of carrying projectUid in the
    // editions route (see newsletters.routes.ts) is that a deep link resolves
    // the publication's own project even beside a stale/different active
    // context; sourcing it from activeContextUid() here would silently defeat
    // that for the one navigation that creates these links in the first place.
    // 'editions' disambiguates the route from the shareable reader permalink.
    this.router.navigate([publication.project_uid, publication.id, 'editions'], { relativeTo: this.route });
  }

  // Publications are the top-level object the two-level model is built
  // around — editions get filed under one, not the other way round — so both
  // the header action and the empty-state CTA collect a publication here
  // first, rather than dropping straight into the edition composer the way
  // this used to (that earlier version created an unfiled edition instead,
  // which inverted the model: it let editions exist before any publication
  // did). The dialog owns the actual createPublication call (see its own doc
  // comment for why) — this only opens it and, on success, navigates.
  protected openCreatePublicationDialog(): void {
    const projectUid = this.projectUid();
    if (!projectUid) {
      // Reachable from this same empty-state CTA (activeContextUid can be
      // '' — see initLoadOnContext's own `!uid` branch) — the old
      // goToCreate() this replaced navigated unconditionally, so a silent
      // no-op here would be a regression: the click needs to explain itself
      // rather than visibly do nothing.
      this.messageService.add({ severity: 'warn', summary: 'Select a project first', detail: 'Choose a project before creating a publication.' });
      return;
    }
    const ref = this.dialogService.open(CreatePublicationDialogComponent, {
      header: 'Create Publication',
      width: '480px',
      modal: true,
      closable: true,
      draggable: false,
      data: { projectUid },
    });
    ref?.onClose.pipe(take(1)).subscribe((publication: NewsletterPublication | null | undefined) => {
      if (publication) {
        // Land straight on the new (necessarily empty) publication's editions
        // view — the natural next action, adding its first edition, is right
        // there, rather than back on this list looking at the row it just made.
        this.goToPublicationEditions(publication);
        return;
      }
      if (publication === null) {
        // The dialog's own cancel() closes with `null` specifically to mark
        // this: it self-guards against both a failed attempt and a create
        // still in flight (not just via the template's own [disabled]
        // binding on its Cancel button — see cancel()'s own doc comment for
        // why), so a `null` close means nothing could have reached upstream
        // on this path and there is nothing a retry could surface. Paying
        // for a refetch here would be the common case (every ordinary
        // Cancel) covering a race that this signal already rules out.
        return;
      }
      // Reached by dismissing the dialog (X/Escape) — PrimeNG's own close
      // affordances close with no argument (`undefined`) regardless of
      // whether a create request was still in flight: the dialog's own
      // takeUntilDestroyed unsubscribes at that point, which aborts the
      // request client-side, but doesn't guarantee upstream never received
      // it — the create may already have landed before the abort reached
      // it. Re-listing rather than assuming "nothing happened" is what
      // surfaces that publication instead of silently stranding it.
      this.retryLoad();
    });
  }

  // Publications only group editions that were filed under one on create;
  // unfiled editions and opt-out management (NewsletterListComponent's
  // 'optout' tab, hidden whenever a :pubId is present) have no other entry
  // point once this page replaces the flat list as the `/newsletters`
  // landing route. 'list' is a sibling of this component's own route (see
  // newsletters.routes.ts), same relativeTo anchor as goToPublicationEditions
  // above.
  protected goToList(): void {
    this.router.navigate(['list'], { relativeTo: this.route });
  }

  protected retryLoad(): void {
    this.retry$.next();
  }

  private initLoadOnContext(): void {
    merge(
      toObservable(this.projectUid).pipe(map((uid) => ({ uid, isContextChange: true }))),
      this.retry$.pipe(map(() => ({ uid: this.projectUid(), isContextChange: false })))
    )
      .pipe(
        switchMap(({ uid, isContextChange }) => {
          if (isContextChange) {
            // A genuine project switch invalidates whatever's on screen —
            // clear it and show the skeleton while the new context loads.
            this.publications.set([]);
            this.loadFailed.set(false);
            this.loading.set(true);
          } else if (this.publications().length === 0) {
            // A retry with nothing worth preserving on screen (the
            // error-state Retry button, or a dismissal with an empty list) —
            // show the skeleton like a normal load, so Retry gives feedback
            // instead of leaving the error panel sitting there inert (and
            // inviting repeat clicks) until the request lands.
            this.loading.set(true);
          }
          // A retry on an already-populated list (a dismissal — X/Escape, or
          // Cancel after a failed attempt — over the create dialog; a
          // no-op-safe explicit Cancel never reaches retryLoad() at all, see
          // openCreatePublicationDialog) is the one case left quiet:
          // `loading`/`publications` stay untouched here and are only
          // updated below once the new result (or error) actually lands, so
          // it doesn't wipe the list and flash an empty skeleton over
          // content that's still valid.
          if (!uid) {
            this.publications.set([]);
            this.loadFailed.set(false);
            this.loading.set(false);
            return EMPTY;
          }
          // The upstream list is paginated, and this page has no paging
          // controls, so follow the page tokens and show the whole set.
          return this.newsletterService.listAllPublications(uid).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loading.set(false);
              // Only surface the dedicated error state when there's nothing
              // already on screen worth preserving — a background retry that
              // fails shouldn't hide a still-valid list behind it; the toast
              // below still reports the failure either way.
              if (this.publications().length === 0) {
                this.loadFailed.set(true);
              }
              console.error('Failed to load publications', err);
              this.showLoadError(err);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        this.loading.set(false);
        this.loadFailed.set(false);
        this.publications.set(result.publications);
      });
  }

  private showLoadError(err: HttpErrorResponse, summary = 'Could not load publications'): void {
    // extractStructuredErrorMessage, not err.error?.message directly: the
    // BFF's error envelope keys the upstream reason as `error`, not
    // `message` (see BaseApiError.toResponse) — reading `.message` here
    // always misses it. Not extractErrorMessage either: its own fallback is
    // Angular's raw "Http failure response for ..." string for a body-less
    // failure, which isn't a real answer to put in a toast.
    this.messageService.add({
      severity: 'error',
      summary,
      detail: extractStructuredErrorMessage(err) ?? 'Please try again later.',
    });
  }
}
