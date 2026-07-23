// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, input, output, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import { NEWSLETTER_COMMITTEE_CATEGORY } from '@lfx-one/shared/constants';
import { Committee, NewsletterCommitteeOption, NewsletterRecipient } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { Popover, PopoverModule } from 'primeng/popover';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { EMPTY, finalize, map, startWith, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-audience-step',
  imports: [ReactiveFormsModule, SelectComponent, PopoverModule, ProgressSpinnerModule],
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

  // === Forms ===
  // The shared `form` input carries `committeeUids: string[]` end-to-end — recipient
  // count, save payload, review/list counts, and server validation all expect an
  // array. The picker is constrained to one group at a time, so this local form holds
  // the scalar selection; it's bridged to the shared array control in initSync().
  protected readonly audienceForm = new FormGroup({
    committeeUid: new FormControl<string | null>(null),
  });

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

  public constructor() {
    this.initSync();
  }

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

  // Bridges the local single-value `audienceForm` control to the shared array
  // control both directions: incoming committeeUids (draft hydration, audience
  // normalization) mirror into the local control with emitEvent: false so the
  // write-back below doesn't re-fire; user selections write back as a 1-element
  // array (or [] when cleared).
  private initSync(): void {
    effect(() => {
      const uid = this.committeeUidsValue()[0] ?? null;
      const control = this.audienceForm.controls.committeeUid;
      if (control.value !== uid) {
        control.setValue(uid, { emitEvent: false });
      }
    });

    this.audienceForm.controls.committeeUid.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((uid) => {
      this.form()
        .get('committeeUids')
        ?.setValue(uid ? [uid] : []);
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
