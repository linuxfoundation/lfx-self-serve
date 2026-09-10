// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { YOUTUBE_MAX_MEETING_TITLE_LENGTH } from '@lfx-one/shared/constants';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerDetailsAccessComponent } from './composer-details-access.component';

const HINT = 'Pre-filled for this meeting type — edit freely.';

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      MeetingComposerFormService,
      { provide: MessageService, useValue: { add: vi.fn() } },
      { provide: CommitteeService, useValue: {} },
      { provide: MeetingService, useValue: {} },
      { provide: SearchService, useValue: { searchUsers: () => of([]) } },
      { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
      { provide: PersonaService, useValue: { currentPersona: () => null } },
    ],
  });
}

/**
 * Covers the title's `aria-describedby` list and `aria-invalid`, read off the rendered field.
 * @description Both are gated on `touched`, which emits on neither `valueChanges` nor `statusChanges`.
 * That is the whole risk in this wiring: a blur is exactly when a required-field error appears, and a
 * gate keyed on the form service's `revision` would go stale for it. The template is rendered rather
 * than stubbed so every emitted id can be resolved against the DOM — an id naming a paragraph that is
 * not on the page describes the field with nothing, which is worse than describing it with silence.
 */
describe('ComposerDetailsAccessComponent — title description ids', () => {
  let fixture: ComponentFixture<ComposerDetailsAccessComponent>;
  let component: ComposerDetailsAccessComponent;
  let formService: MeetingComposerFormService;

  const titleInput = (): HTMLInputElement => fixture.nativeElement.querySelector('#composer-meeting-title') as HTMLInputElement;

  /**
   * The attribute as a screen reader would find it, checked against the page and against the signal.
   * @description Every read goes through here so the two invariants hold everywhere rather than in one
   * dedicated test: each id names an element that exists, and the DOM says what `titleDescribedBy` says.
   */
  const describedBy = (): string | null => {
    fixture.detectChanges();
    const value = titleInput().getAttribute('aria-describedby');

    for (const id of value?.split(' ') ?? []) {
      expect(fixture.nativeElement.querySelector(`#${id}`), `aria-describedby names "${id}", which is not on the page`).not.toBeNull();
    }
    expect(value).toBe(component['titleDescribedBy']());

    return value;
  };

  const ariaInvalid = (): string | null => {
    fixture.detectChanges();
    return titleInput().getAttribute('aria-invalid');
  };

  const maxlength = (): string | null => {
    fixture.detectChanges();
    return titleInput().getAttribute('maxlength');
  };

  beforeEach(async () => {
    configure();

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerDetailsAccessComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('names nothing on an untouched empty title', () => {
    // The error paragraph is gated on `touched` too, so there is nothing here to point at yet.
    expect(describedBy()).toBeNull();
    expect(ariaInvalid()).toBeNull();
  });

  it('points at the required error as soon as the field is blurred', () => {
    // Primed first on purpose: the read caches the computed, so a version keyed on `revision` alone
    // could only be caught going stale from a cached value — `markAsTouched()` bumps `revision` on
    // neither `valueChanges` nor `statusChanges`. `AbstractControl.events` is what closes that gap.
    expect(describedBy()).toBeNull();

    formService.form().get('title')?.markAsTouched();

    expect(describedBy()).toBe('composer-title-required-error');
    expect(ariaInvalid()).toBe('true');
  });

  it('drops the error once the title is filled', () => {
    formService.form().get('title')?.markAsTouched();
    expect(describedBy()).toBe('composer-title-required-error');

    formService.form().get('title')?.setValue('Composer meeting');

    expect(describedBy()).toBeNull();
    expect(ariaInvalid()).toBeNull();
  });

  it('lists the prefill hint before any blur, since the hint has no `touched` gate', () => {
    fixture.componentRef.setInput('titleHint', HINT);

    expect(describedBy()).toBe('composer-title-hint');
    expect(ariaInvalid()).toBeNull();
  });

  it('lists the prefill hint alongside the error', () => {
    fixture.componentRef.setInput('titleHint', HINT);
    formService.form().get('title')?.markAsTouched();

    expect(describedBy()).toBe('composer-title-hint composer-title-required-error');
  });

  it('lists the prefill hint alone once the prefilled title validates', () => {
    fixture.componentRef.setInput('titleHint', HINT);
    formService.form().get('title')?.setValue('Composer meeting');

    expect(describedBy()).toBe('composer-title-hint');
  });

  it('points at the maxlength error when the YouTube limit is exceeded', () => {
    formService.form().get('youtube_upload_enabled')?.setValue(true);
    formService
      .form()
      .get('title')
      ?.setValue('a'.repeat(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1));
    formService.form().get('title')?.markAsTouched();

    expect(describedBy()).toBe('composer-title-maxlength-error');
    expect(ariaInvalid()).toBe('true');
  });

  it('leaves the title uncapped while YouTube upload is off', () => {
    // The counter is not on the page either, so a cap here would enforce a limit nothing has
    // told the organizer about.
    expect(maxlength()).toBeNull();
  });

  it('caps typing at the YouTube limit the counter is warning about', () => {
    formService.form().get('youtube_upload_enabled')?.setValue(true);

    expect(maxlength()).toBe(String(YOUTUBE_MAX_MEETING_TITLE_LENGTH));
  });

  it('lifts the cap again when the upload toggle goes back off', () => {
    // `[attr.maxlength]` has to drop the attribute rather than write it as the string
    // "undefined" or "null", either of which the browser parses as no cap by accident.
    formService.form().get('youtube_upload_enabled')?.setValue(true);
    expect(maxlength()).toBe(String(YOUTUBE_MAX_MEETING_TITLE_LENGTH));

    formService.form().get('youtube_upload_enabled')?.setValue(false);

    expect(maxlength()).toBeNull();
  });

  it('still flags a title that was already over the limit before the toggle went on', () => {
    // The attribute caps typing; it never truncates. A title hydrated from an existing meeting,
    // or typed before the toggle was flipped, has to keep tripping the validator.
    const control = formService.form().get('title');
    control?.setValue('a'.repeat(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1));
    formService.form().get('youtube_upload_enabled')?.setValue(true);
    control?.markAsTouched();

    expect(maxlength()).toBe(String(YOUTUBE_MAX_MEETING_TITLE_LENGTH));
    expect(control?.value).toHaveLength(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1);
    expect(ariaInvalid()).toBe('true');
  });
});

/**
 * Covers the hand-typed organizer email, whose error was previously visual only.
 * @description One predicate now drives the paragraph, the id the input points at, and `aria-invalid`,
 * so the three cannot drift: the attribute can never name a paragraph the template did not render.
 */
describe('ComposerDetailsAccessComponent — organizer email error', () => {
  let fixture: ComponentFixture<ComposerDetailsAccessComponent>;
  let formService: MeetingComposerFormService;

  const emailInput = (): HTMLInputElement => fixture.nativeElement.querySelector('#composer-organizer-email') as HTMLInputElement;

  beforeEach(async () => {
    configure();

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });
    formService.switchToOwnerManualEntry();

    fixture = TestBed.createComponent(ComposerDetailsAccessComponent);
    fixture.componentRef.setInput('form', formService.form());
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('says nothing about an untouched email', () => {
    expect(emailInput().getAttribute('aria-invalid')).toBeNull();
    expect(emailInput().getAttribute('aria-describedby')).toBeNull();
    expect(fixture.nativeElement.querySelector('#composer-organizer-email-error')).toBeNull();
  });

  it('names the error paragraph once a malformed address has been blurred', () => {
    const control = formService.form().get('ownerEmail');
    control?.setValue('not-an-email');
    control?.markAsTouched();
    fixture.detectChanges();

    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(emailInput().getAttribute('aria-describedby')).toBe('composer-organizer-email-error');
    expect(fixture.nativeElement.querySelector('#composer-organizer-email-error')).not.toBeNull();
  });

  it('clears both once the address parses', () => {
    const control = formService.form().get('ownerEmail');
    control?.setValue('not-an-email');
    control?.markAsTouched();
    fixture.detectChanges();

    control?.setValue('organizer@example.com');
    fixture.detectChanges();

    expect(emailInput().getAttribute('aria-invalid')).toBeNull();
    expect(emailInput().getAttribute('aria-describedby')).toBeNull();
    expect(fixture.nativeElement.querySelector('#composer-organizer-email-error')).toBeNull();
  });
});
