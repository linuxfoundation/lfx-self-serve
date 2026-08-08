// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { PublicNewsletterView } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, finalize, of, switchMap } from 'rxjs';

import { NewsletterPreviewComponent } from '../components/newsletter-preview/newsletter-preview.component';

/**
 * Public "View Online" page for a sent newsletter edition (LFXV2-2579).
 *
 * Unauthenticated by design — reached without a session, matching this route's
 * `auth: 'public'` classification in auth.middleware.ts. Access is gated
 * entirely by the Go service (project_uid match + status=sent, else 404), so
 * this component never checks permissions itself and never attaches a bearer
 * token: `NewsletterService.getPublicView` calls the `/public/api/...` route.
 */
@Component({
  selector: 'lfx-newsletter-public-view',
  imports: [DatePipe, EmptyStateComponent, SkeletonModule, NewsletterPreviewComponent],
  templateUrl: './newsletter-public-view.component.html',
})
export class NewsletterPublicViewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly newsletterService = inject(NewsletterService);

  protected readonly view = signal<PublicNewsletterView | null>(null);
  protected readonly loading = signal<boolean>(true);
  protected readonly loadError = signal<string | null>(null);

  public constructor() {
    // Both segments are required per newsletters.routes.ts, so the URL alone
    // carries everything needed — no ambient project context to wait on.
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const id = params.get('id');
          const projectUid = params.get('projectUid');
          if (!id || !projectUid) {
            this.loading.set(false);
            this.loadError.set('This newsletter link is missing required information.');
            return of(null);
          }
          this.loading.set(true);
          this.loadError.set(null);
          return this.newsletterService.getPublicView(projectUid, id).pipe(
            catchError((err: HttpErrorResponse) => {
              if (err.status === 404) {
                // Expected: the edition isn't sent / doesn't exist — quiet, user-facing message only.
                this.loadError.set('This newsletter is no longer available.');
              } else {
                console.error('Failed to load public newsletter view', err);
                this.loadError.set('Could not load this newsletter. Please try again.');
              }
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((data) => {
        this.view.set(data);
      });
  }
}
