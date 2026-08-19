// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, OnInit, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { TagComponent } from '@components/tag/tag.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS, NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES } from '@lfx-one/shared/constants';
import { NewsletterLayout, NewsletterScheduleWindowError } from '@lfx-one/shared/interfaces';
import { humanizeFieldKey, stripHtml } from '@lfx-one/shared/utils';
import { NewsletterManifestService } from '@services/newsletter-manifest.service';
import { EMPTY, startWith, switchMap } from 'rxjs';

// See newsletter-send-step.component.ts's identical constant — this component and the
// send step render the same "when should this go out?" picker as two radio cards rather
// than a segmented toggle, so each choice reads as its own labeled option instead of a
// settings flip.
const SEND_MODE_OPTIONS: { value: 'now' | 'schedule'; label: string; description: string; icon: string }[] = [
  { value: 'now', label: 'Send immediately', description: 'Goes out as soon as you confirm', icon: 'fa-regular fa-paper-plane' },
  { value: 'schedule', label: 'Schedule for later', description: 'Pick a date and time to send', icon: 'fa-regular fa-clock' },
];

const SCHEDULE_WINDOW_MESSAGES: Record<NewsletterScheduleWindowError, string> = {
  past: 'This time has passed — pick a new one.',
  tooSoon: `Pick a time at least ${NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES} minutes from now, so it can still be cancelled if needed.`,
  tooFar: 'Pick a time within the next 72 hours.',
  invalidFormat: 'Enter a valid time, like 9:30 AM.',
};

// Upfront explanation of the schedule window and the settlement lag, so the rules show
// before the picker ever produces an error — see SCHEDULE_WINDOW_MESSAGES for the reactive
// versions of the same constraints once a pick actually falls outside them.
const SCHEDULE_RULES_TEXT = `Pick a time at least ${NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES} minutes from now (so it can still be cancelled) and within the next ${NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS} hours. Delivery can lag up to a few minutes behind the time shown here.`;

@Component({
  selector: 'lfx-newsletter-review',
  imports: [ButtonComponent, TagComponent, CalendarComponent, TimePickerComponent],
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
  public readonly committeesError = input<string | null>(null);
  public readonly committeesLoading = input<boolean>(false);
  public readonly scheduleMinDate = input<Date | null>(null);
  public readonly scheduleMaxDate = input<Date | null>(null);
  public readonly scheduleMinDateTime = input<Date | null>(null);
  public readonly scheduleSummary = input<string>('');
  public readonly scheduleWindowError = input<NewsletterScheduleWindowError | null>(null);
  public readonly canSchedule = input<boolean>(false);
  public readonly scheduling = input<boolean>(false);
  public readonly isScheduleReadOnly = input<boolean>(false);
  public readonly cancelingSchedule = input<boolean>(false);

  // === Outputs ===
  public readonly editAudience = output<void>();
  public readonly editContent = output<void>();
  public readonly editSend = output<void>();
  public readonly send = output<void>();
  public readonly sendTest = output<void>();
  public readonly schedule = output<void>();
  public readonly cancelSchedule = output<void>();
  public readonly preview = output<void>();
  public readonly delete = output<void>();
  public readonly retryCommittees = output<void>();

  // === Reactive form mirrors ===
  protected readonly committeeUids: Signal<string[]> = this.initControlValue<string[]>('committeeUids', []);
  protected readonly subjectValue: Signal<string> = this.initControlValue<string>('subject', '');
  protected readonly bodyValue: Signal<string> = this.initControlValue<string>('bodyHtml', '');
  protected readonly bodyLayoutValue: Signal<NewsletterLayout | null> = this.initControlValue<NewsletterLayout | null>('bodyLayout', null);
  protected readonly sendMode: Signal<'now' | 'schedule'> = this.initControlValue<'now' | 'schedule'>('sendMode', 'now');

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
    const layout = this.bodyLayoutValue();
    if (!layout) return ''; // html-only draft: no library
    const key = layout.template_key;
    // A keyless layout (a new draft, or one saved before per-newsletter selection)
    // renders with project-NEUTRAL chrome over the block superset — NOT a specific
    // library. Labelling it with the default library's name (e.g. "AAIF User
    // Community") would misstate what gets sent, so show a neutral label; a
    // present key uses the catalog's curated label (or a humanized key).
    if (!key) return 'Default (neutral)';
    return this.manifestService.templates().find((t) => t.key === key)?.label ?? humanizeFieldKey(key);
  });
  protected readonly subjectDisplay = computed(() => this.subjectValue().trim() || 'Untitled draft');
  protected readonly hasSubject = computed(() => this.subjectValue().trim().length > 0);
  protected readonly bodyPlainText = computed(() => stripHtml(this.bodyValue() ?? '').trim());
  // A blocks-mode draft is "filled" as soon as it has composed blocks, even
  // before render-on-write syncs body_html back — otherwise the review card
  // wrongly shows "Add body content" (and hides Preview) for a valid layout
  // draft. Mirrors the manage component's layout-aware `bodyFilled`.
  protected readonly hasBody = computed(() => {
    const layout = this.bodyLayoutValue();
    // Layout-authoritative, mirroring the manage component: a present layout is
    // content only when it has blocks (an emptied layout is not); fall back to
    // the plain-text body only for html-only (simple) drafts.
    if (layout) return (layout.blocks?.length ?? 0) > 0;
    return this.bodyPlainText().length > 0;
  });
  protected readonly bodyPreview = computed(() => {
    const text = this.bodyPlainText();
    if (!text) return '';
    return text.length > 220 ? `${text.slice(0, 220)}…` : text;
  });
  protected readonly audienceEmpty = computed(() => this.committeeCount() === 0);
  protected readonly contentIncomplete = computed(() => !this.hasSubject() || !this.hasBody());

  protected readonly sendModeOptions = SEND_MODE_OPTIONS;
  protected readonly scheduleRulesText = SCHEDULE_RULES_TEXT;
  protected readonly scheduleWindowMessage = computed<string | null>(() => {
    const error = this.scheduleWindowError();
    return error ? SCHEDULE_WINDOW_MESSAGES[error] : null;
  });

  public ngOnInit(): void {
    // Ensure the template catalog is available so `templateLabel` can show the
    // curated label. Cached + browser-only in the service, so this is a cheap
    // no-op when the composer already loaded it.
    this.manifestService.loadTemplates().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  // See newsletter-send-step.component.ts's identical method — the radio cards bind
  // directly to the form control (like the date/time pickers below already do) rather
  // than emitting an output.
  protected selectSendMode(mode: 'now' | 'schedule'): void {
    this.form().controls['sendMode']?.setValue(mode);
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
