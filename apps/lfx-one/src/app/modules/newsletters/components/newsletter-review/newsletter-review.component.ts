// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, OnInit, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { NewsletterLayout } from '@lfx-one/shared/interfaces';
import { humanizeFieldKey, stripHtml } from '@lfx-one/shared/utils';
import { NewsletterManifestService } from '@services/newsletter-manifest.service';
import { EMPTY, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-review',
  imports: [ButtonComponent, TagComponent],
  templateUrl: './newsletter-review.component.html',
})
export class NewsletterReviewComponent implements OnInit {
  // === Services ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly manifestService = inject(NewsletterManifestService);

  // === Inputs ===
  public readonly form = input.required<FormGroup>();
  public readonly recipientCount = input<number | null>(null);
  public readonly recipientCountLoading = input<boolean>(false);
  public readonly savedLabel = input<string | null>(null);
  public readonly displayName = input<string>('');
  public readonly edName = input<string>('');
  public readonly edEmail = input<string>('');
  public readonly canSend = input<boolean>(false);
  public readonly canSendTest = input<boolean>(false);
  public readonly canPreview = input<boolean>(false);
  public readonly sending = input<boolean>(false);
  public readonly testSending = input<boolean>(false);
  public readonly deleting = input<boolean>(false);

  // === Outputs ===
  public readonly editAudience = output<void>();
  public readonly editContent = output<void>();
  public readonly editSend = output<void>();
  public readonly send = output<void>();
  public readonly sendTest = output<void>();
  public readonly preview = output<void>();
  public readonly delete = output<void>();

  // === Reactive form mirrors ===
  protected readonly committeeUids: Signal<string[]> = this.initControlValue<string[]>('committeeUids', []);
  protected readonly subjectValue: Signal<string> = this.initControlValue<string>('subject', '');
  protected readonly bodyValue: Signal<string> = this.initControlValue<string>('bodyHtml', '');
  protected readonly bodyLayoutValue: Signal<NewsletterLayout | null> = this.initControlValue<NewsletterLayout | null>('bodyLayout', null);

  // === Derived display values ===
  protected readonly committeeCount = computed(() => this.committeeUids().length);
  protected readonly groupsLabel = computed(() => {
    const count = this.committeeCount();
    return `${count} ${count === 1 ? 'group' : 'groups'}`;
  });
  protected readonly recipientsLabel = computed(() => {
    const count = this.recipientCount();
    if (count === null) return null;
    return `${count} ${count === 1 ? 'recipient' : 'recipients'}`;
  });
  // Label for the newsletter's block library (blocks-mode drafts only; empty for
  // html-only drafts). Prefer the catalog's curated label so the name matches
  // the composer picker exactly; fall back to humanizing the key when the
  // catalog hasn't loaded (e.g. landing straight on review without opening the
  // editor this session).
  protected readonly templateLabel = computed(() => {
    const key = this.bodyLayoutValue()?.template_key;
    if (!key) return '';
    return this.manifestService.templates().find((t) => t.key === key)?.label ?? humanizeFieldKey(key);
  });
  protected readonly subjectDisplay = computed(() => this.subjectValue().trim() || 'Untitled draft');
  protected readonly hasSubject = computed(() => this.subjectValue().trim().length > 0);
  protected readonly bodyPlainText = computed(() => stripHtml(this.bodyValue() ?? '').trim());
  protected readonly hasBody = computed(() => this.bodyPlainText().length > 0);
  protected readonly bodyPreview = computed(() => {
    const text = this.bodyPlainText();
    if (!text) return '';
    return text.length > 220 ? `${text.slice(0, 220)}…` : text;
  });
  protected readonly audienceEmpty = computed(() => this.committeeCount() === 0);
  protected readonly contentIncomplete = computed(() => !this.hasSubject() || !this.hasBody());

  public ngOnInit(): void {
    // Ensure the template catalog is available so `templateLabel` can show the
    // curated label. Cached + browser-only in the service, so this is a cheap
    // no-op when the composer already loaded it.
    this.manifestService.loadTemplates().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  private initControlValue<T>(controlName: string, fallback: T): Signal<T> {
    return toSignal(
      toObservable(this.form).pipe(
        switchMap((fg) => {
          const ctrl = fg.get(controlName);
          if (!ctrl) return EMPTY;
          return ctrl.valueChanges.pipe(startWith(ctrl.value as T));
        }),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: fallback }
    );
  }
}
