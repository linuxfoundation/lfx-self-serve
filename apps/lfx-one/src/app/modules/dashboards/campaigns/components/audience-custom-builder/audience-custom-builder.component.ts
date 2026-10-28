// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AudienceCustomService } from '@services/audience-custom.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';

import {
  AUDIENCE_CUSTOM_LIST_NAME_MAX_LENGTH,
  AUDIENCE_CUSTOM_CREATE_DEFINITE_FAILURES,
  AUDIENCE_CUSTOM_OPERATORS,
  AUDIENCE_CUSTOM_REUSE_RECOMMENDATIONS,
  AUDIENCE_SPEAKER_SCOPES,
} from '@lfx-one/shared/constants';
import { filter, skip } from 'rxjs';
import type {
  AudienceComposedList,
  AudienceCustomAnswer,
  AudienceCustomCriteria,
  AudienceCustomOperator,
  AudienceCustomPreset,
  AudienceCustomPreview,
  AudienceCustomQuestion,
  AudienceCustomSimilarList,
  AudienceDiscoveredEvent,
  AudienceListSearchResult,
  AudienceSpeakerScope,
} from '@lfx-one/shared/interfaces';

type FilterGroup = FormGroup<{ property: FormControl<string>; operator: FormControl<AudienceCustomOperator>; values: FormControl<string> }>;

/**
 * Splits a one-value-per-line field into trimmed, non-blank values. Lines, not commas: event names
 * and filter values contain commas ("Summit, Japan 2026"), and a comma split changed exact values
 * on a round trip the operator never edited.
 */
function splitValues(raw: string): string[] {
  return raw
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * "Build a custom audience" — the legacy builder's Custom Audience tab.
 *
 * Describe the audience in words, answer the questions the model raises, review and edit the
 * resulting criteria, preview what would be built, then create ONE HubSpot list. The created list
 * is emitted for the container to add to the Include selection, so compose, QA and attach treat it
 * like any other list.
 *
 * Self-contained by design: the flow has its own requests and states, none of which feed the tab's
 * discovery state. The model only drafts criteria — the service builds the HubSpot filter from them,
 * and nothing is created without an explicit confirmation.
 */
@Component({
  selector: 'lfx-audience-custom-builder',
  imports: [ReactiveFormsModule],
  templateUrl: './audience-custom-builder.component.html',
  styleUrl: './audience-custom-builder.component.scss',
})
export class AudienceCustomBuilderComponent {
  // === Services ===
  private readonly customService = inject(AudienceCustomService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly projectSlug = input.required<string>();
  public readonly disabled = input(false);
  /** The discovered event's name, used as the default label for list names. */
  public readonly eventName = input('');
  public readonly preset = input<AudienceCustomPreset | null>(null);
  /** Bumped by the container when its run resets (a new project or event): the builder starts over. */
  public readonly resetKey = input(0);

  // === Outputs ===
  public readonly created = output<AudienceComposedList>();
  /** An existing list the operator chose to reuse instead of creating one. */
  public readonly reuse = output<AudienceListSearchResult>();
  /** The event an event audience was planned from, so the tab can QA against it. */
  public readonly eventPlanned = output<AudienceDiscoveredEvent>();
  /** True while a create is in flight, so the container can hold back anything that would reset the builder. */
  public readonly creatingChange = output<boolean>();

  // === Constants ===
  protected readonly operators = AUDIENCE_CUSTOM_OPERATORS;
  protected readonly speakerScopes = AUDIENCE_SPEAKER_SCOPES;

  // === Forms ===
  protected readonly requestControl = new FormControl('', { nonNullable: true });
  /** At most 200 characters: HubSpot's list-search limit, which upstream refuses past rather than cuts. */
  protected readonly nameControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(AUDIENCE_CUSTOM_LIST_NAME_MAX_LENGTH)] });
  protected readonly nameMaxLength = AUDIENCE_CUSTOM_LIST_NAME_MAX_LENGTH;
  /**
   * The name as a signal, written on EVERY change: typing feeds it from valueChanges, and the silent
   * writes (a preview's name, start over) go through `setName`. Fed from valueChanges alone it kept
   * a stale over-long name after start over, holding Create on an empty field.
   */
  private readonly nameValue = signal('');
  /** An explicit name over the limit is a 400 upstream, so create waits until it fits. */
  protected readonly nameTooLong = computed(() => this.nameValue().trim().length > AUDIENCE_CUSTOM_LIST_NAME_MAX_LENGTH);
  protected readonly form = new FormGroup({
    cities: new FormControl('', { nonNullable: true }),
    countries: new FormControl('', { nonNullable: true }),
    contactLocation: new FormControl(false, { nonNullable: true }),
    eventRegistered: new FormControl(false, { nonNullable: true }),
    educationEnrolled: new FormControl(false, { nonNullable: true }),
    registeredFor: new FormControl('', { nonNullable: true }),
    gateEventHistory: new FormControl(false, { nonNullable: true }),
    gateListId: new FormControl('', { nonNullable: true }),
    speakersOn: new FormControl(false, { nonNullable: true }),
    speakerScope: new FormControl<AudienceSpeakerScope>('current_past', { nonNullable: true }),
    speakerListId: new FormControl('', { nonNullable: true }),
    speakerEventNames: new FormControl('', { nonNullable: true }),
    ambassadors: new FormControl(false, { nonNullable: true }),
    educationTopics: new FormControl('', { nonNullable: true }),
    educationTopicProperty: new FormControl('', { nonNullable: true }),
    pageViewUrls: new FormControl('', { nonNullable: true }),
    label: new FormControl('', { nonNullable: true }),
    propertyFilters: new FormArray<FilterGroup>([]),
  });

  // === Writable Signals ===
  /** Whether the criteria form is open (after an interpretation, or "fill in by hand"). */
  protected readonly editing = signal(false);
  protected readonly interpreting = signal(false);
  protected readonly interpretError = signal<string | null>(null);
  protected readonly questions = signal<AudienceCustomQuestion[]>([]);
  protected readonly notes = signal<string[]>([]);
  /** Existing lists that may already be this audience, ranked by the model. */
  protected readonly similar = signal<AudienceCustomSimilarList[]>([]);
  /** Ids reused from `similar`, so each button reads as done. */
  protected readonly reusedIds = signal<ReadonlySet<string>>(new Set<string>());
  /** The topic property the last preview resolved, shown so the operator sees what is filtered. */
  protected readonly topicProperty = signal<string | null>(null);
  /** The education properties the last preview offered; more than one shows a picker. */
  protected readonly topicCandidates = signal<string[]>([]);
  protected readonly answers = signal<AudienceCustomAnswer[]>([]);
  /** Each question's own free-text answer, keyed by question id — one shared box mixed them up. */
  protected readonly otherAnswers = signal<Readonly<Partial<Record<string, string>>>>({});
  /** The event page an event-audience preset plans from; kept across answers. */
  protected readonly eventUrl = signal('');
  protected readonly gate = signal<AudienceListSearchResult | null>(null);
  protected readonly preview = signal<AudienceCustomPreview | null>(null);
  protected readonly previewing = signal(false);
  protected readonly previewError = signal<string | null>(null);
  protected readonly confirming = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  /** Set when HubSpot did not confirm a create: the name to search for before trying again. */
  protected readonly unconfirmedName = signal<string | null>(null);
  protected readonly createdList = signal<AudienceComposedList | null>(null);
  /** A list created after its builder was gone: it exists, but was never added to step 2. */
  protected readonly strandedCreated = signal<AudienceComposedList | null>(null);

  // === Computed Signals ===
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly speakersOn = computed(() => this.formValue().speakersOn === true);
  protected readonly busy = computed(() => this.interpreting() || this.previewing() || this.creating());
  protected readonly locked = computed(() => this.disabled() || this.busy());
  /** The unclaimed outcome of this project's last create, held by the service. */
  private readonly strandedOutcome = computed(() => this.customService.createOutcome(this.projectSlug()));
  /** A create for this project still in flight from a builder that has since gone (navigation). */
  protected readonly createInFlightElsewhere = computed(() => (this.creating() ? null : this.customService.inFlightCreate(this.projectSlug())));
  /** The model's questions are blocking: a draft with any unanswered is provisional, and only preview may use it. */
  protected readonly questionsOpen = computed(() => this.questions().length > 0);
  /** Create stays disabled until a preview of the CURRENT criteria exists. */
  protected readonly canCreate = computed(
    () =>
      !!this.preview() && !this.locked() && !this.unconfirmedName() && this.createInFlightElsewhere() === null && !this.questionsOpen() && !this.nameTooLong()
  );
  /** The similar lists with their recommendation's label, so the template reads values, not methods. */
  protected readonly similarRows = computed(() =>
    this.similar().map((item) => ({ item, label: item.recommendation ? AUDIENCE_CUSTOM_REUSE_RECOMMENDATIONS[item.recommendation] : 'Not assessed' }))
  );
  /** Per filter row: whether its operator takes values (`is_known`/`is_unknown` do not). */
  protected readonly filterTakesValues = computed(() =>
    (this.formValue().propertyFilters ?? []).map((f) => f?.operator !== 'is_known' && f?.operator !== 'is_unknown')
  );
  protected readonly upperBoundText = computed(() => {
    const bound = this.preview()?.upperBound;
    return bound === undefined ? null : bound.toLocaleString('en-US');
  });

  // === Private state ===
  /** Guards replies: a reply to a superseded request must not overwrite newer state. */
  private seq = 0;
  /** Set on destroy: a create is deliberately not cancelled then, but its reply must not emit. */
  private destroyed = false;

  public get filterRows(): FormArray<FilterGroup> {
    return this.form.controls.propertyFilters;
  }

  public constructor() {
    this.nameControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.nameValue.set(value));
    // Any edit makes the preview describe criteria that no longer exist, so it is dropped — a
    // Create must always follow a preview of exactly what will be created.
    // The list name is not a criterion, so editing it keeps the preview (and the create state it holds).
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.invalidatePreview());

    toObservable(this.preset)
      .pipe(
        filter((preset): preset is AudienceCustomPreset => preset !== null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((preset) => this.applyPreset(preset));

    // A create whose builder was destroyed before it settled leaves its outcome with the service --
    // possibly after this builder mounted, so the outcome is watched, not read once. A create this
    // builder is running itself takes its own outcome in its reply handler first.
    toObservable(this.strandedOutcome)
      .pipe(
        filter((outcome) => outcome !== null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        if (!this.creating()) {
          this.claimStrandedOutcome(this.projectSlug());
        }
      });

    toObservable(this.resetKey)
      .pipe(skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onContextReset());
    this.destroyRef.onDestroy(() => (this.destroyed = true));
  }

  // === Protected Methods ===

  protected onInterpret(): void {
    const request = this.requestControl.value.trim();
    if (!request || this.locked()) {
      return;
    }
    this.answers.set([]);
    this.interpret(request);
  }

  protected onAnswer(question: AudienceCustomQuestion, answer: string): void {
    const text = answer.trim();
    if (!text || this.locked()) {
      return;
    }
    // A later answer to the same question replaces the earlier one.
    this.answers.update((list) => [
      ...list.filter((a) => a.questionId !== question.id),
      { questionId: question.id, question: question.question, answer: text },
    ]);
    this.otherAnswers.update((all) => ({ ...all, [question.id]: '' }));
    this.interpret(this.requestControl.value.trim());
  }

  /** Adds an existing list to Include instead of creating a new one. */
  protected onReuse(item: AudienceCustomSimilarList): void {
    if (this.disabled() || this.reusedIds().has(item.list.listId)) {
      return;
    }
    this.reusedIds.update((ids) => new Set([...ids, item.list.listId]));
    this.reuse.emit(item.list);
  }

  /** An explicit choice to set the model's questions aside and finish the criteria by hand. */
  protected onLeaveQuestions(): void {
    if (this.locked()) {
      return;
    }
    this.questions.set([]);
    this.onFillByHand();
  }

  protected onOtherInput(questionId: string, value: string): void {
    this.otherAnswers.update((all) => ({ ...all, [questionId]: value }));
  }

  protected onFillByHand(): void {
    this.editing.set(true);
    this.interpretError.set(null);
    if (!this.form.controls.label.value && this.eventName()) {
      this.form.controls.label.setValue(this.eventName());
    }
  }

  protected onAddFilter(): void {
    this.filterRows.push(this.filterGroup('', 'contains', ''));
  }

  protected onRemoveFilter(index: number): void {
    this.filterRows.removeAt(index);
  }

  protected onPreview(): void {
    if (this.locked()) {
      return;
    }
    const seq = ++this.seq;
    const project = this.projectSlug();
    this.previewing.set(true);
    this.previewError.set(null);
    this.confirming.set(false);
    this.customService
      .preview(project, this.request())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          if (seq !== this.seq) return;
          this.preview.set(preview);
          this.topicProperty.set(preview.criteria.educationTopicProperty ?? null);
          this.topicCandidates.set(preview.educationTopicCandidates);
          // Reflect the property the service actually used, without counting it as an edit.
          this.form.controls.educationTopicProperty.setValue(preview.criteria.educationTopicProperty ?? '', { emitEvent: false });
          this.previewing.set(false);
          if (!this.nameControl.value) {
            this.setName(preview.name);
          }
        },
        error: (err: HttpErrorResponse) => {
          if (seq !== this.seq) return;
          this.previewError.set(serverAuthoredMessage(err, 'Could not preview this audience. Check the criteria and try again.'));
          this.previewing.set(false);
        },
      });
  }

  protected onAskConfirm(): void {
    if (this.canCreate()) {
      this.confirming.set(true);
    }
  }

  protected onCancelConfirm(): void {
    this.confirming.set(false);
  }

  protected onCreate(): void {
    if (!this.canCreate() || !this.confirming()) {
      return;
    }
    const seq = ++this.seq;
    this.setCreating(true);
    this.createError.set(null);
    // Deliberately NOT bound to this component's lifetime: cancelling a non-idempotent create on
    // navigation would not stop HubSpot creating the list, only hide that it did. The service
    // tracks it in flight, so a remounted builder holds Create until it settles.
    this.customService.create(this.projectSlug(), this.request()).subscribe({
      next: (list) => {
        if (this.destroyed || seq !== this.seq) return;
        // Seen live, so the service need not keep it for a remounted builder.
        this.customService.takeCreateOutcome(this.projectSlug());
        this.setCreating(false);
        this.confirming.set(false);
        this.createdList.set(list);
        this.created.emit(list);
      },
      error: (err: HttpErrorResponse) => {
        if (this.destroyed || seq !== this.seq) return;
        this.customService.takeCreateOutcome(this.projectSlug());
        this.setCreating(false);
        this.confirming.set(false);
        if (!AUDIENCE_CUSTOM_CREATE_DEFINITE_FAILURES.includes(err.status)) {
          // Not retryable: a 502 partial, a timeout, a lost connection or any 5xx may each mean
          // HubSpot created the list. Create stays disabled until the operator starts over, so a
          // retry cannot make a second one.
          const body = err.status === 502 ? (err.error as { masterName?: string } | null) : null;
          this.unconfirmedName.set(body?.masterName || this.nameControl.value.trim() || this.preview()?.name || 'the custom list');
          return;
        }
        this.createError.set(serverAuthoredMessage(err, 'The list could not be created.'));
      },
    });
  }

  protected onStartOver(): void {
    this.seq++;
    this.requestControl.setValue('');
    this.setName('');
    this.resetCriteria({});
    this.editing.set(false);
    this.questions.set([]);
    this.notes.set([]);
    this.similar.set([]);
    this.reusedIds.set(new Set<string>());
    this.topicProperty.set(null);
    this.topicCandidates.set([]);
    this.answers.set([]);
    this.eventUrl.set('');
    this.gate.set(null);
    this.interpretError.set(null);
    this.unconfirmedName.set(null);
    this.strandedCreated.set(null);
    this.createdList.set(null);
    this.createError.set(null);
    this.interpreting.set(false);
    this.previewing.set(false);
    this.setCreating(false);
  }

  // === Private Methods ===

  private interpret(request: string): void {
    const seq = ++this.seq;
    this.interpreting.set(true);
    this.interpretError.set(null);
    this.customService
      .interpret(this.projectSlug(), { request, answers: this.answers(), ...(this.eventUrl() ? { eventUrl: this.eventUrl() } : {}) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (seq !== this.seq) return;
          this.interpreting.set(false);
          this.questions.set(result.questions);
          this.notes.set(result.notes);
          this.similar.set(result.similar);
          if (result.event) {
            this.eventPlanned.emit(result.event);
          }
          this.gate.set(result.gate ?? null);
          this.resetCriteria(result.criteria);
          if (!this.form.controls.label.value && this.eventName()) {
            this.form.controls.label.setValue(this.eventName());
          }
          this.editing.set(true);
        },
        error: (err: HttpErrorResponse) => {
          if (seq !== this.seq) return;
          this.interpreting.set(false);
          // No model configured is not a dead end: the criteria can be filled in by hand.
          if (err.status === 503) {
            // No model can answer its own questions now; finishing by hand is the only way on.
            this.questions.set([]);
            this.onFillByHand();
            this.interpretError.set(serverAuthoredMessage(err, 'Describing an audience is unavailable here. Fill in the criteria by hand instead.'));
            return;
          }
          this.interpretError.set(serverAuthoredMessage(err, 'Could not interpret that request. Rephrase it, or fill in the criteria by hand.'));
        },
      });
  }

  /** Picks up the outcome of a create whose builder was destroyed before it settled. */
  private claimStrandedOutcome(project: string): void {
    const outcome = this.customService.takeCreateOutcome(project);
    // The two are exclusive: a confirmed create settles an "unconfirmed" a reset recorded for it.
    if (outcome?.kind === 'unconfirmed') {
      this.strandedCreated.set(null);
      this.unconfirmedName.set(outcome.name);
    } else if (outcome?.kind === 'created') {
      this.unconfirmedName.set(null);
      this.strandedCreated.set(outcome.list);
    }
  }

  /** Writes the name without emitting (it is not a criterion), keeping `nameValue` in step. */
  private setName(name: string): void {
    this.nameControl.setValue(name, { emitEvent: false });
    this.nameValue.set(name);
  }

  /**
   * The container's run reset (a new project or event). Everything belongs to the old context, so
   * the builder starts over -- but a create caught in flight is recorded as unconfirmed, exactly as
   * the tab does for a stranded compose: its reply is about to be discarded, and losing it silently
   * is how a duplicate gets created later.
   */
  private onContextReset(): void {
    const stranded = this.creating() ? this.nameControl.value.trim() || this.preview()?.name || 'the custom list' : null;
    this.onStartOver();
    if (stranded) {
      this.unconfirmedName.set(stranded);
    }
  }

  private applyPreset(preset: AudienceCustomPreset): void {
    // A preset resets the builder, which would drop an in-flight create's reply: the list would
    // exist in HubSpot with nothing here to say so. The container holds presets back meanwhile.
    if (this.creating()) {
      return;
    }
    this.onStartOver();
    this.eventUrl.set(preset.eventUrl ?? '');
    if (preset.criteria) {
      this.resetCriteria(preset.criteria);
      this.editing.set(true);
    }
    if (preset.request) {
      this.requestControl.setValue(preset.request);
      if (!preset.criteria) {
        this.interpret(preset.request);
      }
    }
  }

  private resetCriteria(c: Partial<AudienceCustomCriteria>): void {
    this.filterRows.clear({ emitEvent: false });
    for (const f of c.propertyFilters ?? []) {
      this.filterRows.push(this.filterGroup(f.property, f.operator, f.values.join('\n')), { emitEvent: false });
    }
    this.form.patchValue({
      cities: (c.cities ?? []).join('\n'),
      countries: (c.countries ?? []).join('\n'),
      contactLocation: c.contactLocation === true,
      eventRegistered: c.eventRegistered === true,
      educationEnrolled: c.educationEnrolled === true,
      registeredFor: (c.registeredFor ?? []).join('\n'),
      gateEventHistory: c.gateEventHistory === true,
      gateListId: c.gateListId ?? '',
      speakersOn: !!c.speakers,
      speakerScope: c.speakers?.scope ?? 'current_past',
      speakerListId: c.speakers?.listId ?? '',
      speakerEventNames: (c.speakers?.eventNames ?? []).join('\n'),
      ambassadors: c.ambassadors === true,
      educationTopics: (c.educationTopics ?? []).join('\n'),
      educationTopicProperty: c.educationTopicProperty ?? '',
      pageViewUrls: (c.pageViewUrls ?? []).join('\n'),
      label: c.label ?? '',
    });
    this.invalidatePreview();
  }

  private request(): { criteria: AudienceCustomCriteria; name?: string } {
    const v = this.form.getRawValue();
    const criteria: AudienceCustomCriteria = {
      cities: splitValues(v.cities),
      countries: splitValues(v.countries),
      contactLocation: v.contactLocation,
      eventRegistered: v.eventRegistered,
      educationEnrolled: v.educationEnrolled,
      registeredFor: splitValues(v.registeredFor),
      gateEventHistory: v.gateEventHistory,
      propertyFilters: v.propertyFilters.map((f) => ({
        property: f.property.trim(),
        operator: f.operator,
        values: f.operator === 'is_known' || f.operator === 'is_unknown' ? [] : splitValues(f.values),
      })),
      ambassadors: v.ambassadors,
      educationTopics: splitValues(v.educationTopics),
      ...(v.educationTopicProperty.trim() ? { educationTopicProperty: v.educationTopicProperty.trim() } : {}),
      pageViewUrls: splitValues(v.pageViewUrls),
      ...(v.gateListId.trim() ? { gateListId: v.gateListId.trim() } : {}),
      ...(v.label.trim() ? { label: v.label.trim() } : {}),
      ...(v.speakersOn
        ? {
            speakers: {
              scope: v.speakerScope,
              eventNames: splitValues(v.speakerEventNames),
              ...(v.speakerListId.trim() ? { listId: v.speakerListId.trim() } : {}),
            },
          }
        : {}),
    };
    const name = this.nameControl.value.trim();
    return { criteria, ...(name ? { name } : {}) };
  }

  private filterGroup(property: string, operator: AudienceCustomOperator, values: string): FilterGroup {
    return new FormGroup({
      property: new FormControl(property, { nonNullable: true }),
      operator: new FormControl<AudienceCustomOperator>(operator, { nonNullable: true }),
      values: new FormControl(values, { nonNullable: true }),
    });
  }

  private setCreating(value: boolean): void {
    if (this.creating() !== value) {
      this.creating.set(value);
      this.creatingChange.emit(value);
    }
  }

  private invalidatePreview(): void {
    if (this.preview()) {
      this.preview.set(null);
    }
    this.confirming.set(false);
    this.previewError.set(null);
  }
}
