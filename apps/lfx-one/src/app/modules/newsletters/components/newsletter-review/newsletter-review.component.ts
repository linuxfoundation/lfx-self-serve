// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { stripHtml } from '@lfx-one/shared/utils';
import { EMPTY, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-review',
  imports: [ButtonComponent, TagComponent],
  templateUrl: './newsletter-review.component.html',
})
export class NewsletterReviewComponent {
  // === Services ===
  private readonly destroyRef = inject(DestroyRef);

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
  public readonly sending = input<boolean>(false);
  public readonly testSending = input<boolean>(false);
  public readonly deleting = input<boolean>(false);
  public readonly committeesError = input<string | null>(null);
  public readonly committeesLoading = input<boolean>(false);

  // === Outputs ===
  public readonly editAudience = output<void>();
  public readonly editContent = output<void>();
  public readonly editSend = output<void>();
  public readonly send = output<void>();
  public readonly sendTest = output<void>();
  public readonly preview = output<void>();
  public readonly delete = output<void>();
  public readonly retryCommittees = output<void>();

  // === Reactive form mirrors ===
  protected readonly committeeUids: Signal<string[]> = this.initControlValue<string[]>('committeeUids', []);
  protected readonly subjectValue: Signal<string> = this.initControlValue<string>('subject', '');
  protected readonly bodyValue: Signal<string> = this.initControlValue<string>('bodyHtml', '');

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
