// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { NEWSLETTER_COMMITTEE_CATEGORY } from '@lfx-one/shared/constants';
import { Committee, NewsletterAudienceEmailAdd, NewsletterCommitteeOption, NewsletterRecipient } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { Popover, PopoverModule } from 'primeng/popover';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { finalize, take } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-audience-step',
  imports: [ReactiveFormsModule, SelectComponent, PopoverModule, ProgressSpinnerModule, InputTextComponent, ButtonComponent],
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
  // Mirrors the host's `committeeUidsValue` signal rather than re-deriving one from
  // `committeeUids.valueChanges` — the host's is kept in sync even through
  // `patchValue({ emitEvent: false })` draft hydration, which a local valueChanges-based
  // signal here would miss entirely.
  public readonly committeeUidsValue = input<string[]>([]);
  public readonly recipientCount = input<number | null>(null);
  public readonly recipientCountLoading = input<boolean>(false);
  // Per-email add state is owned by the host (this panel is destroyed on step
  // navigation, so in-flight adds and their statuses must outlive it).
  public readonly emailAdds = input<NewsletterAudienceEmailAdd[]>([]);

  // === Outputs ===
  public readonly retryCommittees = output<void>();
  // Raw email string as typed; validation, dedupe, and state live on the host.
  public readonly addEmail = output<string>();

  // === Forms ===
  // The shared `form` input carries `committeeUids: string[]` end-to-end — recipient
  // count, save payload, review/list counts, and server validation all expect an
  // array. The picker is constrained to one group at a time, so this local form holds
  // the scalar selection; it's bridged to the shared array control in initSync().
  protected readonly audienceForm = new FormGroup({
    committeeUid: new FormControl<string | null>(null),
  });

  // Inline "add email to the selected group" input. Submitting emits the raw
  // value to the host and clears the control immediately — adds are async and
  // never block further typing or step navigation.
  protected readonly emailAddForm = new FormGroup({
    email: new FormControl<string>('', { nonNullable: true }),
  });

  // === Signals ===
  protected readonly recipients = signal<NewsletterRecipient[]>([]);
  protected readonly recipientsLoading = signal<boolean>(false);
  protected readonly recipientsError = signal<string | null>(null);
  protected readonly recipientsPopover = viewChild<Popover>('recipientsPopover');

  // === Reactive data ===
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
  protected readonly selectedCommitteeUid = computed<string | null>(() => this.committeeUidsValue()[0] ?? null);
  // Fallback reads as "the selected group" in the banner sentence.
  protected readonly selectedCommitteeName = computed<string>(() => {
    const uid = this.selectedCommitteeUid();
    if (!uid) return 'selected';
    const committee = this.committees().find((c) => c.uid === uid);
    return committee?.name || 'selected';
  });
  // Adds are scoped per group: switching groups swaps the visible list, and
  // entries for a previously selected group reappear on switch-back.
  protected readonly visibleEmailAdds = computed<NewsletterAudienceEmailAdd[]>(() => {
    const uid = this.selectedCommitteeUid();
    if (!uid) return [];
    return this.emailAdds().filter((e) => e.committeeUid === uid);
  });

  public constructor() {
    this.initSync();
  }

  protected onAddEmail(): void {
    const value = this.emailAddForm.controls.email.value;
    if (!value.trim()) return;
    this.addEmail.emit(value);
    this.emailAddForm.controls.email.setValue('');
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
  // array (or [] when cleared). Narrowing a legacy multi-group draft to a single
  // uid is the host's job (NewsletterManageComponent.initAudienceNormalization),
  // not this component's — Review can be mounted instead of this step on reopen.
  private initSync(): void {
    toObservable(this.committeeUidsValue)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((committeeUids) => {
        const uid = committeeUids[0] ?? null;
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
}
