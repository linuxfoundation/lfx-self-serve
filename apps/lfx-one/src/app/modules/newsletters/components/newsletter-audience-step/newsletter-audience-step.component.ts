// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { NEWSLETTER_COMMITTEE_CATEGORY } from '@lfx-one/shared/constants';
import { Committee, NewsletterCommitteeOption, NewsletterRecipient } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { Popover, PopoverModule } from 'primeng/popover';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { EMPTY, finalize, map, startWith, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-audience-step',
  imports: [ReactiveFormsModule, MultiSelectComponent, PopoverModule, ProgressSpinnerModule],
  templateUrl: './newsletter-audience-step.component.html',
})
export class NewsletterAudienceStepComponent {
  // === Services ===
  private readonly newsletterService = inject(NewsletterService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  // Committees are fetched once by the parent (NewsletterManageComponent) and
  // passed down here rather than re-fetched — the upstream endpoint fans out
  // through fetchAllQueryResources, so a second full traversal per mount is wasteful
  // and can produce inconsistent loading/error states between parent and child.
  public readonly form = input.required<FormGroup>();
  public readonly projectUid = input.required<string>();
  public readonly committees = input<Committee[]>([]);
  public readonly committeesLoading = input<boolean>(false);
  public readonly committeesError = input<string | null>(null);
  public readonly recipientCount = input<number | null>(null);
  public readonly recipientCountLoading = input<boolean>(false);

  // === Outputs ===
  public readonly retryCommittees = output<void>();

  // === Signals ===
  protected readonly recipients = signal<NewsletterRecipient[]>([]);
  protected readonly recipientsLoading = signal<boolean>(false);
  protected readonly recipientsError = signal<string | null>(null);
  protected readonly recipientsPopover = viewChild<Popover>('recipientsPopover');

  // === Reactive data ===
  protected readonly committeeUidsValue: Signal<string[]> = this.initCommitteeUidsValue();

  protected readonly committeeOptions = computed<NewsletterCommitteeOption[]>(() =>
    this.committees()
      .filter((c) => c.category === NEWSLETTER_COMMITTEE_CATEGORY)
      .map((c) => ({
        label: c.name || 'Unnamed group',
        value: c.uid,
        category: c.category || 'Other',
      }))
  );
  protected readonly selectedCount: Signal<number> = computed(() => this.committeeUidsValue().length);
  protected readonly hasCommittees = computed(() => this.committeeOptions().length > 0);

  protected onShowRecipients(event: Event): void {
    const popover = this.recipientsPopover();
    if (!popover) return;
    popover.toggle(event);

    const uids: string[] = this.form().get('committeeUids')?.value ?? [];
    if (uids.length === 0) {
      this.recipients.set([]);
      this.recipientsError.set(null);
      return;
    }

    const projectUid = this.projectUid();
    if (!projectUid) return;
    this.recipientsLoading.set(true);
    this.recipientsError.set(null);
    this.newsletterService
      .getRecipients(projectUid, { committee_uids: uids })
      .pipe(
        take(1),
        finalize(() => this.recipientsLoading.set(false))
      )
      .subscribe({
        next: (res) => this.recipients.set(res.recipients ?? []),
        error: () => {
          this.recipients.set([]);
          this.recipientsError.set('Could not load recipients. Please try again.');
        },
      });
  }

  private initCommitteeUidsValue(): Signal<string[]> {
    return toSignal(
      toObservable(this.form).pipe(
        switchMap((fg) => {
          const control = fg.get('committeeUids');
          if (!control) return EMPTY;
          return control.valueChanges.pipe(startWith(control.value));
        }),
        map((v): string[] => (Array.isArray(v) ? (v as string[]) : [])),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: [] as string[] }
    );
  }
}
