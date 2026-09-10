// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAINTAINER_MEETING_TYPES,
  MEETING_TYPE_OPTIONS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
  YOUTUBE_MEETING_TITLE_WARNING_LENGTH,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { Meeting } from '@lfx-one/shared/interfaces';
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
 * Covers the meeting-type card list a maintainer sees in edit mode.
 * @description `getSelectableMeetingTypeOptions` narrows the list to `MAINTAINER_MEETING_TYPES` for
 * this persona, so a meeting stored with any other type has to be threaded back in by hand or the
 * select renders empty over a populated control. The persona and the stored meeting both have to be
 * in place before the computed runs, so this describe builds its own TestBed rather than reusing
 * `configure()`, which pins the persona to `null` and stubs `MeetingService` with `{}`.
 */
describe('ComposerDetailsAccessComponent \u2014 maintainer editing a stored type', () => {
  /** Opens the section in edit mode over a meeting saved with `meetingType`, as a maintainer. */
  async function openAsMaintainer(meetingType: string): Promise<ComposerDetailsAccessComponent> {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: SearchService, useValue: { searchUsers: () => of([]) } },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => 'maintainer' } },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn().mockReturnValue(of({ id: 'meeting-1', title: 'Saved meeting', meeting_type: meetingType } as Meeting)),
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    });

    const formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    const fixture = TestBed.createComponent(ComposerDetailsAccessComponent);
    fixture.componentRef.setInput('form', formService.form());
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  it('keeps the stored Board card a maintainer cannot otherwise pick', async () => {
    const component = await openAsMaintainer(MeetingType.BOARD);
    const options = component['meetingTypeOptions']();
    const values = options.map((option) => option.value);

    // The whole card, not just the value: the unknown-type fallback below would also put `Board` in
    // this list, as a generic `Existing meeting type` tile. Board is a type the app knows — the
    // organizer has to keep seeing its real icon, colour and description.
    expect(MAINTAINER_MEETING_TYPES).not.toContain(MeetingType.BOARD);
    expect(options.filter((option) => option.value === MeetingType.BOARD)[0]).toEqual(
      MEETING_TYPE_OPTIONS.filter((option) => option.value === MeetingType.BOARD)[0]
    );
    // The retention is scoped to the stored type, not a hole in the persona filter: every other type
    // outside the maintainer set stays out of the list.
    expect(values).not.toContain(MeetingType.MARKETING);
    expect(values).not.toContain(MeetingType.LEGAL);
  });

  it('synthesizes a card for a stored type this build has none for', async () => {
    const component = await openAsMaintainer('Retrospective');
    const option = component['meetingTypeOptions']().filter((entry) => entry.value === ('Retrospective' as MeetingType))[0];

    // Without the synthesized entry the select renders blank over a control holding `Retrospective`,
    // and the first save quietly rewrites the organizer's meeting to whatever they pick instead.
    expect(option).toBeDefined();
    expect(option.label).toBe('Retrospective');
  });
});

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
 * Covers what a screen reader hears as the title approaches the YouTube limit.
 * @description The visible counter cannot be the live region: it changes on every keystroke, so it
 * would read the running number out and bury the threshold underneath it. The announcement is a
 * separate region, and it is mounted unconditionally — enabling YouTube upload over a title that is
 * already too long would otherwise *insert* an already-populated region, and an insertion is not
 * reliably announced.
 */
describe('ComposerDetailsAccessComponent — YouTube title limit announcement', () => {
  let fixture: ComponentFixture<ComposerDetailsAccessComponent>;
  let formService: MeetingComposerFormService;

  const region = (): HTMLElement => {
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="composer-title-youtube-announcement"]') as HTMLElement;
  };
  const announcement = (): string => region().textContent?.trim() ?? '';
  const counter = (): HTMLElement | null => {
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="composer-title-youtube-counter"]');
  };
  const enableUpload = (): void => formService.form().get('youtube_upload_enabled')?.setValue(true);
  const setTitle = (length: number): void => formService.form().get('title')?.setValue('a'.repeat(length));

  beforeEach(async () => {
    configure();
    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerDetailsAccessComponent);
    fixture.componentRef.setInput('form', formService.form());
    await fixture.whenStable();
  });

  it('keeps the region on the page with nothing to say while uploads are off', () => {
    setTitle(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1);

    expect(region()).not.toBeNull();
    expect(announcement()).toBe('');
  });

  it('turns enabling the upload into a content change rather than an inserted region', () => {
    // The reported bug: the region used to live inside the `@if`, so this transition mounted it with
    // its text already written. Holding the same node across the toggle is what makes it an update.
    setTitle(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1);
    const before = region();

    enableUpload();

    expect(region()).toBe(before);
    expect(announcement()).toContain('over the');
  });

  it('stays silent while the title still has room to spare', () => {
    enableUpload();
    setTitle(YOUTUBE_MEETING_TITLE_WARNING_LENGTH - 1);

    expect(announcement()).toBe('');
  });

  it('holds one sentence steady across every keystroke inside the warning band', () => {
    enableUpload();
    setTitle(YOUTUBE_MEETING_TITLE_WARNING_LENGTH);
    const atThreshold = announcement();

    setTitle(YOUTUBE_MEETING_TITLE_WARNING_LENGTH + 1);

    expect(atThreshold).toContain('nearing');
    expect(announcement()).toBe(atThreshold);
  });

  it('changes what it says when the limit itself is passed', () => {
    enableUpload();
    setTitle(YOUTUBE_MAX_MEETING_TITLE_LENGTH);
    const atLimit = announcement();

    setTitle(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1);

    expect(atLimit).toContain('nearing');
    expect(announcement()).toContain('over the');
  });

  it('goes quiet again once the title is shortened back under the warning band', () => {
    enableUpload();
    setTitle(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1);
    expect(announcement()).toContain('over the');

    setTitle(1);

    expect(announcement()).toBe('');
  });

  it('leaves the visible counter out of the live region entirely', () => {
    enableUpload();

    const visible = counter();
    expect(visible).not.toBeNull();
    expect(visible?.getAttribute('aria-live')).toBeNull();
    expect(visible?.getAttribute('role')).toBeNull();
    expect(visible?.textContent?.trim()).toBe(`0/${YOUTUBE_MAX_MEETING_TITLE_LENGTH}`);
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
