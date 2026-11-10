// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import {
  NEWSLETTER_PUBLICATION_FROM_NAME_MAX_LENGTH,
  NEWSLETTER_PUBLICATION_NAME_MAX_LENGTH,
  NEWSLETTER_PUBLICATION_REPLY_TO_MAX_LENGTH,
  NEWSLETTER_TEMPLATE_LABELS,
} from '@lfx-one/shared/constants';
import { NewsletterPublication, NewsletterPublicationOption, NewsletterPublicationRequest } from '@lfx-one/shared/interfaces';
import { getNewsletterPublicationErrorMessage } from '@lfx-one/shared/utils';
import { NewsletterManifestService } from '@services/newsletter-manifest.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { reconcileRouteProjectContext } from '@shared/utils/entity-project-context.util';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { finalize, map, Observable } from 'rxjs';

const NO_TEMPLATE_OPTION: NewsletterPublicationOption = { label: 'Each edition picks its own template', value: '' };

/**
 * Creates or edits a publication: its name, template set, sender name and reply-to (#4349). The
 * default audience is not edited here, but PUT is full-replace, so a loaded publication's audience
 * is kept and sent back.
 */
@Component({
  selector: 'lfx-newsletter-publication-form',
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, InputTextComponent, MessageComponent, SelectComponent, SkeletonModule],
  templateUrl: './newsletter-publication-form.component.html',
})
export class NewsletterPublicationFormComponent {
  protected readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly newsletterService = inject(NewsletterService);
  private readonly manifestService = inject(NewsletterManifestService);
  private readonly projectService = inject(ProjectService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);

  public readonly form = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(NEWSLETTER_PUBLICATION_NAME_MAX_LENGTH)],
    }),
    templateKey: new FormControl<string>('', { nonNullable: true }),
    fromName: new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(NEWSLETTER_PUBLICATION_FROM_NAME_MAX_LENGTH)] }),
    replyToEmail: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.email, Validators.maxLength(NEWSLETTER_PUBLICATION_REPLY_TO_MAX_LENGTH)],
    }),
  });

  protected readonly publicationUid: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((params) => params.get('publicationUid'))), {
    initialValue: this.route.snapshot.paramMap.get('publicationUid'),
  });
  private readonly routeProjectUid: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((params) => params.get('projectUid'))), {
    initialValue: this.route.snapshot.paramMap.get('projectUid'),
  });
  protected readonly projectUid: Signal<string> = computed(() => this.routeProjectUid() ?? '');
  // A saved edition opened this form, so saving or going back returns to it rather than to create.
  private readonly returnToNewsletterUid: string | null = this.route.snapshot.queryParamMap.get('returnTo');
  protected readonly backLink: Signal<string[]> = computed(() =>
    this.returnToNewsletterUid ? [this.projectUid(), this.returnToNewsletterUid, 'edit'] : ['create']
  );
  protected readonly isEditMode = computed(() => this.publicationUid() !== null);
  protected readonly loading = signal<boolean>(false);
  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  private readonly loadedPublication = signal<NewsletterPublication | null>(null);
  protected readonly templateOptions: Signal<NewsletterPublicationOption[]> = this.initTemplateOptions();

  public constructor() {
    reconcileRouteProjectContext(this.routeProjectUid, this.projectService, this.projectContextService, this.router, this.destroyRef);
    this.manifestService.loadTemplates(this.projectUid()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    this.initLoadPublication();
  }

  protected onSubmit(): void {
    if (this.saving() || this.form.disabled) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage.set(null);
    this.saving.set(true);
    this.save$()
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (publication) => {
          this.messageService.add({ severity: 'success', summary: 'Publication saved', detail: `${publication.name} was saved.` });
          this.goBack(publication.id);
        },
        error: (err: HttpErrorResponse) => this.errorMessage.set(this.saveErrorMessage(err)),
      });
  }

  private save$(): Observable<NewsletterPublication> {
    const payload = this.buildPayload();
    const uid = this.publicationUid();
    const loaded = this.loadedPublication();
    if (uid && loaded) {
      return this.newsletterService.updatePublication(this.projectUid(), uid, loaded.version, payload);
    }
    return this.newsletterService.createPublication(this.projectUid(), payload);
  }

  // PUT clears an omitted optional field, so a blank field is omitted on purpose and the default
  // audience, which this form does not edit, is sent back as it was loaded.
  private buildPayload(): NewsletterPublicationRequest {
    const value = this.form.getRawValue();
    const fromName = value.fromName.trim();
    const replyToEmail = value.replyToEmail.trim();
    return {
      name: value.name.trim(),
      template_key: value.templateKey || undefined,
      from_name: fromName || undefined,
      reply_to_email: replyToEmail || undefined,
      committee_uids: this.loadedPublication()?.committee_uids ?? [],
    };
  }

  private saveErrorMessage(err: HttpErrorResponse): string {
    if (err.status === 412) {
      return 'Someone else changed this publication while you were editing. Reload the page to get the latest version.';
    }
    if (err.status === 400) {
      const message = getNewsletterPublicationErrorMessage(extractErrorMessage(err, ''));
      if (message) return message;
    }
    return extractErrorMessage(err, 'The publication could not be saved. Please try again.');
  }

  private goBack(publicationUid: string): void {
    if (this.returnToNewsletterUid) {
      this.router.navigate(this.backLink(), { relativeTo: this.route.parent, queryParams: { returnTo: null }, queryParamsHandling: 'merge' });
      return;
    }
    this.router.navigate(['create'], { relativeTo: this.route.parent, queryParams: { publication: publicationUid }, queryParamsHandling: 'merge' });
  }

  private initTemplateOptions(): Signal<NewsletterPublicationOption[]> {
    return computed(() => [
      NO_TEMPLATE_OPTION,
      ...this.manifestService.templates().map((template) => ({ label: NEWSLETTER_TEMPLATE_LABELS[template.key] ?? template.label, value: template.key })),
    ]);
  }

  private initLoadPublication(): void {
    const uid = this.publicationUid();
    if (!uid) return;
    this.loading.set(true);
    this.newsletterService
      .getPublication(this.projectUid(), uid)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (publication) => {
          this.loadedPublication.set(publication);
          this.form.patchValue({
            name: publication.name,
            templateKey: publication.template_key ?? '',
            fromName: publication.from_name ?? '',
            replyToEmail: publication.reply_to_email ?? '',
          });
          if (publication.implicit) {
            this.form.disable();
            this.errorMessage.set('This publication was created automatically for a single newsletter, so it cannot be changed.');
          }
        },
        error: (err: HttpErrorResponse) => {
          // Saving without the loaded version would create a new publication instead of updating this one.
          this.form.disable();
          this.errorMessage.set(extractErrorMessage(err, 'The publication could not be loaded.'));
        },
      });
  }
}
