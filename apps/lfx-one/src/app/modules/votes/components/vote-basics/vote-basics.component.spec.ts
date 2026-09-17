// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
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
      close_date: new FormControl<Date | null>(null, [Validators.required]),
      close_time: new FormControl<string>('11:59 PM', { nonNullable: true, validators: [Validators.required, validTimeFormat()] }),
      timezone: new FormControl<string>('Pacific/Honolulu', { nonNullable: true, validators: [Validators.required] }),
      allow_abstain: new FormControl<boolean>(false, { nonNullable: true }),
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
});
