// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SelectComponent } from '@components/select/select.component';
import { NEWSLETTER_PUBLICATION_ONE_OFF_OPTION } from '@lfx-one/shared/constants';
import { NewsletterPublication, NewsletterPublicationOption } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

/**
 * Chooses the publication a new newsletter is an edition of (#4349). Rendered by the manage page
 * only behind the enhanced-editor flag. A publication can no longer be changed once a draft is
 * saved, so a saved edition shows its publication read-only.
 */
@Component({
  selector: 'lfx-newsletter-publication-picker',
  imports: [ReactiveFormsModule, SelectComponent, ConfirmDialogModule],
  templateUrl: './newsletter-publication-picker.component.html',
})
export class NewsletterPublicationPickerComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly newsletterService = inject(NewsletterService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  public readonly projectUid = input.required<string>();
  public readonly selected = input<NewsletterPublication | null>(null);
  public readonly preselectUid = input<string | null>(null);
  public readonly readOnly = input<boolean>(false);
  public readonly hasContent = input<boolean>(false);
  public readonly layoutTemplateKey = input<string | null>(null);
  // The saved edition the picker sits on, so the publication form can return to it.
  public readonly returnToNewsletterUid = input<string | null>(null);
  // True when leaving for the publication form would lose work the newsletter has not saved yet.
  public readonly unsavedChanges = input<boolean>(false);

  public readonly publicationChange = output<NewsletterPublication | null>();

  protected readonly form = new FormGroup({ publication: new FormControl<string>('', { nonNullable: true }) });
  protected readonly publications = signal<NewsletterPublication[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly returnQueryParams = computed(() => (this.returnToNewsletterUid() ? { returnTo: this.returnToNewsletterUid() } : {}));
  protected readonly options: Signal<NewsletterPublicationOption[]> = computed(() => [
    NEWSLETTER_PUBLICATION_ONE_OFF_OPTION,
    ...this.publications().map((publication) => ({ label: publication.name, value: publication.id })),
  ]);

  public constructor() {
    // Keeps the control on the parent's selection, including across step navigation.
    toObservable(this.selected)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((publication) => this.form.controls.publication.setValue(publication?.id ?? '', { emitEvent: false }));
    this.form.controls.publication.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((uid) => this.onSelect(uid));
    this.initPublications();
  }

  /** Opens the publication form, asking first when the newsletter has unsaved work it would lose. */
  protected openPublicationForm(path: string[]): void {
    const navigate = () =>
      void this.router.navigate([this.projectUid(), 'publications', ...path], {
        relativeTo: this.route.parent,
        queryParams: this.returnQueryParams(),
        queryParamsHandling: 'merge',
      });
    if (!this.unsavedChanges()) {
      navigate();
      return;
    }
    this.confirmationService.confirm({
      key: 'newsletter-publication-picker',
      header: 'Leave this newsletter?',
      message: 'This newsletter has changes that are not saved yet. They will be lost if you open the publication form now. Continue?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Leave',
      rejectLabel: 'Stay',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: navigate,
    });
  }

  private onSelect(uid: string): void {
    const publication = this.publications().find((item) => item.id === uid) ?? null;
    const templateKey = publication?.template_key;
    if (!templateKey || !this.hasContent() || this.layoutTemplateKey() === templateKey) {
      this.publicationChange.emit(publication);
      return;
    }
    this.confirmationService.confirm({
      key: 'newsletter-publication-picker',
      header: 'Change publication?',
      message: 'This publication uses a different template set, so the content you have written will be removed. Continue?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Change publication',
      rejectLabel: 'Keep current',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      // The picker can turn read-only while the dialog is open (the first save started), and then
      // the change no longer applies, so the control goes back to the selection.
      accept: () => (this.readOnly() ? this.resetToSelected() : this.publicationChange.emit(publication)),
      reject: () => this.resetToSelected(),
    });
  }

  private resetToSelected(): void {
    this.form.controls.publication.setValue(this.selected()?.id ?? '', { emitEvent: false });
  }

  private initPublications(): void {
    toObservable(this.projectUid)
      .pipe(
        filter((projectUid) => !!projectUid && !this.readOnly()),
        tap((projectUid) => {
          // Drop the previous project's list and selection first, so neither can be saved against
          // this project while its list loads or after the load fails.
          this.publications.set([]);
          if (this.selected() && this.selected()?.project_uid !== projectUid) this.publicationChange.emit(null);
          this.loading.set(true);
          this.loadFailed.set(false);
        }),
        switchMap((projectUid) =>
          this.newsletterService.listAllPublications(projectUid).pipe(
            catchError((error: unknown) => {
              console.error('[NewsletterPublicationPicker] Failed to load publications', error);
              this.loadFailed.set(true);
              return of<NewsletterPublication[]>([]);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((publications) => {
        this.loading.set(false);
        this.publications.set(publications);
        this.applyLoadedSelection(publications);
      });
  }

  private applyLoadedSelection(publications: NewsletterPublication[]): void {
    const preselected = publications.find((publication) => publication.id === this.preselectUid());
    if (preselected) {
      this.publicationChange.emit(preselected);
      return;
    }
    // A switch to another project invalidates the selection.
    const selected = this.selected();
    if (selected && !this.loadFailed() && !publications.some((publication) => publication.id === selected.id)) {
      this.publicationChange.emit(null);
    }
  }
}
