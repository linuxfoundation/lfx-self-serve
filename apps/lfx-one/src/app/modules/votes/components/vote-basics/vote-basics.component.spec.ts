// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PollType } from '@lfx-one/shared/enums';
import { CommitteeReference } from '@lfx-one/shared/interfaces';
import { trimmedMinLength, trimmedRequired, validCommitteeReference, validTimeFormat, voteDeadlineValidator } from '@lfx-one/shared/validators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeSelectorComponent } from '@components/committee-selector/committee-selector.component';

import { VoteBasicsComponent } from './vote-basics.component';

// The real selector pulls in the CommitteeService/ProjectContextService DI graph; the behavior
// under test lives in minDate/close_date, so a same-selector stub keeps the template renderable.
@Component({ selector: 'lfx-committee-selector', template: '' })
class StubCommitteeSelectorComponent {
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly multiple = input<boolean>(false);
  public readonly required = input<boolean>(false);
  public readonly label = input<string>('');
  public readonly description = input<string>('');
  public readonly placeholder = input<string>('');
  public readonly testIdPrefix = input<string>('');
}

// Mirrors the step-1 slice of vote-manage's createFormGroup() — every control the template
// references must exist or Angular throws NG01203, and close_date carries the real required validator.
function buildForm(): FormGroup {
  return new FormGroup(
    {
      title: new FormControl('', [trimmedRequired(), trimmedMinLength(3), Validators.maxLength(200)]),
      description: new FormControl(''),
      committee: new FormControl<CommitteeReference | null>(null, [Validators.required, validCommitteeReference()]),
      eligible_participants: new FormControl('', [Validators.required]),
      poll_type: new FormControl<PollType>(PollType.GENERIC, { nonNullable: true }),
      close_date: new FormControl<Date | null>(null, [Validators.required]),
      close_time: new FormControl<string>('11:59 PM', { nonNullable: true, validators: [Validators.required, validTimeFormat()] }),
      timezone: new FormControl<string>('Pacific/Honolulu', { nonNullable: true, validators: [Validators.required] }),
      allow_abstain: new FormControl<boolean>(false, { nonNullable: true }),
      allow_vote_change: new FormControl<boolean>(true, { nonNullable: true }),
    },
    { validators: voteDeadlineValidator() }
  );
}

describe('VoteBasicsComponent — stale close_date on timezone switch', () => {
  // Pinned so Honolulu (Sep 15) and Sydney (Sep 16) sit on different calendar days — the minDate
  // jump that strands a picked date exists only across a zone day boundary. Only Date is faked,
  // leaving timers real so fixture.whenStable() resolves normally.
  const NOW = new Date('2026-09-16T09:30:00.000Z');

  let fixture: ComponentFixture<VoteBasicsComponent>;
  let form: FormGroup;
  let formValue: WritableSignal<Record<string, unknown>>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await TestBed.configureTestingModule({
      imports: [VoteBasicsComponent],
      providers: [provideRouter([]), provideNoopAnimations()],
    })
      .overrideComponent(VoteBasicsComponent, {
        remove: { imports: [CommitteeSelectorComponent] },
        add: { imports: [StubCommitteeSelectorComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(VoteBasicsComponent);
    form = buildForm();
    formValue = signal(form.getRawValue());
    form.valueChanges.subscribe(() => formValue.set(form.getRawValue()));
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('formValue', formValue);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders against the full form shape with minDate floored to the initial zone’s today', async () => {
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="vote-close-date-calendar"]')).not.toBeNull();
    // NOW is Sep 15 in Honolulu — minDate carries the selected zone's current day in host-local fields.
    const minDate = fixture.componentInstance.minDate();
    expect([minDate.getFullYear(), minDate.getMonth(), minDate.getDate()]).toEqual([2026, 8, 15]);
  });

  it('renders the allow vote change select bound to its default Yes (#4723)', async () => {
    await fixture.whenStable();

    const select = fixture.nativeElement.querySelector('[data-testid="vote-allow-vote-change-select"]');
    expect(select).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="allow-vote-change"]')?.textContent?.trim()).toBe('Allow voters to change their vote');
    expect(fixture.componentInstance.allowVoteChangeOptions.map((o) => [o.label, o.value])).toEqual([
      ['Yes', true],
      ['No', false],
    ]);
    expect(form.get('allow_vote_change')?.value).toBe(true);
  });

  it('advances the minDate floor when an unrelated edit lands after midnight in the selected zone', async () => {
    await fixture.whenStable();
    const before = fixture.componentInstance.minDate();
    // NOW is 23:30 on Sep 15 in Honolulu.
    expect([before.getFullYear(), before.getMonth(), before.getDate()]).toEqual([2026, 8, 15]);

    // 31 minutes later Honolulu rolls to Sep 16 — a title keystroke re-reads the full form value,
    // and the floor must follow the zone's calendar rather than staying memoized on the old day.
    vi.setSystemTime(new Date('2026-09-16T10:01:00.000Z'));
    form.get('title')!.setValue('Board election');
    await fixture.whenStable();

    const after = fixture.componentInstance.minDate();
    expect([after.getFullYear(), after.getMonth(), after.getDate()]).toEqual([2026, 8, 16]);
  });

  it('keeps the same minDate instance across same-day edits — same-floor recomputes never re-fire', async () => {
    await fixture.whenStable();
    const before = fixture.componentInstance.minDate();

    form.get('title')!.setValue('Board election');
    await fixture.whenStable();

    // equal() on the epoch retains the previous Date instance, so clearStaleCloseDate stays silent.
    expect(fixture.componentInstance.minDate()).toBe(before);
  });

  it('clears a picked close_date stranded when the timezone switch moves minDate past it', async () => {
    const closeDate = form.get('close_date')!;
    closeDate.setValue(new Date(2026, 8, 15)); // Sep 15 — today in Honolulu at NOW, valid under the old floor
    await fixture.whenStable();
    expect(closeDate.value).toBeInstanceOf(Date);

    let emissions = 0;
    closeDate.valueChanges.subscribe(() => emissions++);
    form.get('timezone')!.setValue('Australia/Sydney');
    // A real UI pick fires the select's onChange — the gate keys on that event, so a bare
    // programmatic setValue (hydration-shaped) never arms it.
    fixture.componentInstance.onTimezoneUserPick('Australia/Sydney');
    await fixture.whenStable();

    expect(closeDate.value).toBeNull();
    expect(emissions).toBe(1); // one setValue(null) emission — minDate's equal-dedupe keeps same-floor recomputes from re-firing
    expect(closeDate.errors).toEqual({ required: true });
    // markAsTouched surfaces the required error immediately — setValue alone leaves touched false.
    expect(closeDate.touched).toBe(true);
    await fixture.whenStable();
    const calendarField = fixture.nativeElement.querySelector('[data-testid="vote-close-date-calendar"]')?.closest('div');
    const error = calendarField?.querySelector('p.text-red-500');
    expect(error?.textContent).toContain('Close date is required.');
    // The group validator skips unset controls — no stale futureDateTime/nonexistentWallTime.
    expect(form.errors?.['futureDateTime'] ?? null).toBeNull();
    expect(form.errors?.['nonexistentWallTime'] ?? null).toBeNull();
  });

  it('never clears a hydrated past deadline — not on load, not on a later timezone switch', async () => {
    const closeDate = form.get('close_date')!;
    form.get('timezone')!.setValue('Australia/Sydney');
    closeDate.setValue(new Date(2020, 0, 1)); // edit-mode hydration shape: a past-deadline vote patched in
    await fixture.whenStable();
    expect(closeDate.value).toBeInstanceOf(Date);

    form.get('timezone')!.setValue('Pacific/Honolulu');
    await fixture.whenStable();

    // Already below the previous minDate, so the guard treats it as the parent form's concern.
    expect(closeDate.value).toBeInstanceOf(Date);
  });

  it('preserves a recently-past deadline hydrated in a single patchValue after the effect has stabilized', async () => {
    // Let the effect stabilize on the empty create form — the Honolulu floor is now recorded.
    await fixture.whenStable();

    // Real edit-hydration shape: vote-manage patches timezone + close_date in one patchValue.
    // The vote lapsed in Sydney (Sep 15 00:30 Sydney wall; Sydney is already on Sep 16 at NOW), so
    // the carrier lands between the old Honolulu floor (Sep 15) and the new Sydney floor (Sep 16) —
    // the exact window a pure floor-comparison would strand. Hydration is not a user zone switch.
    form.patchValue({ close_date: new Date(2026, 8, 15, 0, 30), timezone: 'Australia/Sydney' });
    await fixture.whenStable();

    expect(form.get('close_date')!.value).toBeInstanceOf(Date);

    // The hydrated carrier survives a full Sydney → Honolulu → Sydney round-trip: the gate keys on
    // the select's own change event and programmatic setValue never fires it — hydration-shaped
    // writes never clear, no matter how often the subscriber re-observes the value.
    form.get('timezone')!.setValue('Pacific/Honolulu');
    await fixture.whenStable();
    form.get('timezone')!.setValue('Australia/Sydney');
    await fixture.whenStable();

    expect(form.get('close_date')!.value).toBeInstanceOf(Date);
  });

  it('clears a hydrated but still-valid date stranded by a user-initiated timezone switch', async () => {
    // Edit-hydration shape: patchValue lands a vote whose close date is still valid in its zone
    // (Sep 15 — Honolulu's today at NOW — under the Honolulu floor), leaving the form pristine.
    form.patchValue({ close_date: new Date(2026, 8, 15), timezone: 'Pacific/Honolulu' });
    await fixture.whenStable();
    const closeDate = form.get('close_date')!;
    expect(closeDate.value).toBeInstanceOf(Date);

    // Organizer changes only the timezone: Sydney is already on Sep 16, stranding the Sep 15 date.
    const timezone = form.get('timezone')!;
    timezone.setValue('Australia/Sydney');
    fixture.componentInstance.onTimezoneUserPick('Australia/Sydney'); // a real UI select fires onChange
    await fixture.whenStable();

    expect(closeDate.value).toBeNull();
    expect(closeDate.errors).toEqual({ required: true });
    expect(closeDate.touched).toBe(true);
  });

  it('never clears a vote hydrated after an earlier pick left a stale arm — the reused :id/edit shape', async () => {
    await fixture.whenStable(); // floor: Sep 15 (Honolulu)

    // Vote A: the organizer touched the zone (Honolulu → Sydney → Honolulu round-trip), arming the
    // gate and leaving the pick stale when they navigate away.
    form.get('timezone')!.setValue('Australia/Sydney');
    await fixture.whenStable();
    form.get('timezone')!.setValue('Pacific/Honolulu');
    fixture.componentInstance.onTimezoneUserPick('Pacific/Honolulu');
    form.get('timezone')!.markAsDirty(); // a real pick both fires onChange and marks dirty — the old gate's stale trigger
    await fixture.whenStable();

    // Navigating A/edit → B/edit reuses this component and patchValues vote B in. B is a lapsed
    // Sydney draft whose Sep 15 carrier lands between the Honolulu floor (Sep 15) and the Sydney
    // floor (Sep 16) — the exact window the old sticky-dirty gate wiped on load.
    form.patchValue({ close_date: new Date(2026, 8, 15), timezone: 'Australia/Sydney' });
    await fixture.whenStable();

    // The stale Honolulu arm must not read as a switch to Sydney: hydration is not a user pick.
    expect(form.get('close_date')!.value).toBeInstanceOf(Date);
  });

  it('never clears on a post-midnight floor advance — a day rollover is not a zone switch', async () => {
    const closeDate = form.get('close_date')!;
    // A real pick arms the gate (Sydney, floor Sep 16), then the organizer picks a valid date.
    form.get('timezone')!.setValue('Australia/Sydney');
    fixture.componentInstance.onTimezoneUserPick('Australia/Sydney');
    form.get('timezone')!.markAsDirty(); // a real pick both fires onChange and marks dirty — the old gate's stale trigger
    await fixture.whenStable();
    closeDate.setValue(new Date(2026, 8, 16)); // Sep 16 — Sydney's today at NOW
    await fixture.whenStable();
    expect(closeDate.value).toBeInstanceOf(Date);

    // A day later Sydney is on Sep 17: an unrelated title edit re-reads the full form value and
    // advances the floor. The stale armed pick must not read as a fresh zone switch — the group
    // validator, not this subscriber, owns flagging the now-past deadline.
    vi.setSystemTime(new Date('2026-09-17T09:30:00.000Z'));
    form.get('title')!.setValue('Board election');
    await fixture.whenStable();

    expect(closeDate.value).toBeInstanceOf(Date);
    expect(form.errors?.['futureDateTime']).toBeTruthy(); // surfaced by the validator, not by wiping the date
  });

  it('never clears on a rollover after a same-day switch between equal-offset zones', async () => {
    await fixture.whenStable(); // floor: Sep 15 (Honolulu)

    // First pick: Honolulu → New York moves the floor epoch (UTC-10 → UTC-4 at NOW), so the
    // subscriber observes it and records New York as the previous zone.
    form.get('timezone')!.setValue('America/New_York');
    fixture.componentInstance.onTimezoneUserPick('America/New_York');
    await fixture.whenStable();

    // Same-day switch between zones sharing an offset: New York and Toronto are both UTC-4 in
    // September, so the floor epoch is identical — epoch-only equality would never emit for this
    // pick, leaving previousTimezone stale and the Toronto arm unconsumed.
    form.get('timezone')!.setValue('America/Toronto');
    fixture.componentInstance.onTimezoneUserPick('America/Toronto');
    await fixture.whenStable();

    const closeDate = form.get('close_date')!;
    closeDate.setValue(new Date(2026, 8, 16)); // Sep 16 — New York/Toronto's today at NOW
    await fixture.whenStable();
    expect(closeDate.value).toBeInstanceOf(Date);

    // Past midnight in Toronto, an unrelated edit advances the floor. The suppressed same-day pick
    // must not resurface as a zone switch — the validator, not this subscriber, owns the flag.
    vi.setSystemTime(new Date('2026-09-17T04:01:00.000Z')); // 00:01 EDT on Sep 17
    form.get('title')!.setValue('Board election');
    await fixture.whenStable();

    expect(closeDate.value).toBeInstanceOf(Date);
    expect(form.errors?.['futureDateTime']).toBeTruthy(); // surfaced by the validator, not by wiping the date
  });
});

describe('VoteBasicsComponent — voting method (#2921)', () => {
  let fixture: ComponentFixture<VoteBasicsComponent>;
  let form: FormGroup;
  let scrollIntoView: typeof HTMLElement.prototype.scrollIntoView;

  const element = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  const render = async (pollType: PollType, inputs: Record<string, unknown> = {}): Promise<void> => {
    form.get('poll_type')?.setValue(pollType);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
  };

  beforeEach(async () => {
    // jsdom lacks the browser APIs used by PrimeNG's real select overlay.
    scrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }));
    await TestBed.configureTestingModule({
      imports: [VoteBasicsComponent],
      providers: [provideRouter([]), provideNoopAnimations()],
    })
      .overrideComponent(VoteBasicsComponent, {
        remove: { imports: [CommitteeSelectorComponent] },
        add: { imports: [StubCommitteeSelectorComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(VoteBasicsComponent);
    form = buildForm();
    const formValue = signal(form.getRawValue());
    form.valueChanges.subscribe(() => formValue.set(form.getRawValue()));
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('formValue', formValue);
  });

  afterEach(async () => {
    // Let PrimeNG's overlay alignment finish before restoring browser shims.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.destroy();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.unstubAllGlobals();
  });

  it('enables Condorcet in the rendered creation select without coming-soon copy', async () => {
    await render(PollType.GENERIC);
    element('vote-method-select')!.querySelector<HTMLElement>('[role="combobox"]')!.click();
    await fixture.whenStable();

    const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
    const condorcet = options.find((option) => option.textContent?.includes('Condorcet IRV'))!;
    const plurality = options.find((option) => option.textContent?.includes('Plurality'))!;
    expect(condorcet.getAttribute('data-p-disabled')).not.toBe('true');
    expect(condorcet.textContent).not.toContain('Coming soon');
    expect(plurality.getAttribute('data-p-disabled')).not.toBe('true');
    condorcet.click();
    await fixture.whenStable();

    expect(form.get('poll_type')?.value).toBe(PollType.CONDORCET_IRV);
  });

  it('offers Plurality and Condorcet IRV, describing the selected one', async () => {
    await render(PollType.CONDORCET_IRV);

    expect(element('vote-method-select')).not.toBeNull();
    expect(fixture.componentInstance.methodOptions.map((option) => [option.label, option.value])).toEqual([
      ['Plurality', PollType.GENERIC],
      ['Condorcet IRV', PollType.CONDORCET_IRV],
    ]);
    expect(element('vote-method-description')?.textContent).toContain('Voters rank the options.');
    expect(element('vote-method-locked')).toBeNull();
  });

  it('explains the lock in edit mode', async () => {
    await render(PollType.CONDORCET_IRV, { isEditMode: true });

    expect(element('vote-method-locked')?.textContent).toContain("The voting method can't be changed after the vote is created.");
    expect(element('vote-method-select')?.textContent).toContain('Condorcet IRV');
    expect(element('vote-method-select')?.textContent).not.toContain('Coming soon');
    expect(element('vote-method-description')?.textContent).toContain('Voters rank the options.');
  });

  it.each([
    [PollType.MAJORITY, 'Majority vote'],
    [PollType.INSTANT_RUNOFF_VOTE, 'Instant runoff vote'],
    [PollType.MEEK_STV, 'Meek STV'],
  ])('shows the locked %s method even when it is not offered for creation', async (pollType, label) => {
    form.get('poll_type')?.disable();
    await render(pollType, { isEditMode: true });

    expect(element('vote-method-select')?.textContent).toContain(label);
    expect(element('vote-method-description')?.textContent?.trim()).not.toBe('');
    expect(form.get('poll_type')?.disabled).toBe(true);
    expect(form.get('poll_type')?.value).toBe(pollType);
    expect(fixture.componentInstance.methodOptions.map((option) => option.value)).toEqual([PollType.GENERIC, PollType.CONDORCET_IRV]);
  });

  it('warns when Condorcet IRV has fewer than three eligible voters', async () => {
    await render(PollType.CONDORCET_IRV, { eligibleVoterCountState: { status: 'loaded', count: 2 } });

    expect(element('vote-basics-min-voters-warning')?.textContent).toContain('Condorcet IRV needs at least 3 eligible voters. This group has 2.');
    expect(element('vote-basics-min-voters-unchecked')).toBeNull();
  });

  it.each([
    ['three eligible voters', PollType.CONDORCET_IRV, { status: 'loaded', count: 3 }],
    ['a count still loading', PollType.CONDORCET_IRV, { status: 'loading', count: null }],
    ['a plurality vote', PollType.GENERIC, { status: 'loaded', count: 1 }],
  ])('shows no warning for %s', async (_label, pollType, state) => {
    await render(pollType, { eligibleVoterCountState: state });

    expect(element('vote-basics-min-voters-warning')).toBeNull();
  });

  it('notes, without blocking, when the eligible count could not be checked', async () => {
    await render(PollType.CONDORCET_IRV, { eligibleVoterCountState: { status: 'error', count: null } });

    expect(element('vote-basics-min-voters-unchecked')?.textContent).toContain("We couldn't check how many people are eligible to vote.");
    expect(element('vote-basics-min-voters-warning')).toBeNull();
  });
});
