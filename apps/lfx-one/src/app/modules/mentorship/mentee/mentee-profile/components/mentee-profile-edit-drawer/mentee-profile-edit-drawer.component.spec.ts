// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, output } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ERROR_CODES,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX,
  MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE,
  MENTORSHIP_MENTEE_PROFILE_RESUME_COMING_SOON_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails, MentorshipMenteeProfileUpdateRequest, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { DrawerModule } from 'primeng/drawer';
import { MenteeProfileEditDrawerComponent } from './mentee-profile-edit-drawer.component';
import { MenteeProfileEditDrawerService } from './mentee-profile-edit-drawer.service';

const PROFILE: MentorshipMenteeProfileDetails = {
  aboutMe: '<p>Hello world</p>',
  skillsHave: ['Go', 'Python'],
  skillsWant: ['Kubernetes'],
  additionalNotes: 'Comfortable working asynchronously.',
  resumeFileName: 'resume.pdf',
  resumeUrl: 'https://example.com/resume.pdf',
};

/* eslint-disable @angular-eslint/component-selector */
@Component({
  selector: 'p-drawer',
  template: '<ng-content /><ng-content select="[pTemplate=header]" />',
})
class StubDrawerComponent {
  readonly visible = input(false);
  readonly position = input('right');
  readonly modal = input(false);
  readonly closable = input(true);
  readonly dismissible = input(true);
  readonly closeOnEscape = input(true);
  readonly styleClass = input('');
}

@Component({ selector: 'lfx-textarea', template: '' })
class StubTextareaComponent {
  readonly form = input<FormGroup>();
  readonly control = input('');
  readonly rows = input(3);
  readonly styleClass = input('');
  readonly maxlength = input<number | undefined>(undefined);
  readonly inputId = input('');
  readonly ariaDescribedBy = input('');
  readonly dataTest = input('');
}

@Component({ selector: 'lfx-mentorship-skills-picker', template: '' })
class StubSkillsPickerComponent {
  readonly form = input<FormGroup>();
  readonly label = input('');
  readonly idPrefix = input('');
  readonly control = input('skills');
  readonly error = input<string | undefined>(undefined);
}

@Component({ selector: 'lfx-mentorship-resume-section', template: '' })
class StubResumeSectionComponent {
  readonly form = input<FormGroup>();
  readonly intro = input('');
  readonly bordered = input(true);
  readonly comingSoonSummary = input<string | null>(null);
  readonly idPrefix = input('');
}

@Component({ selector: 'lfx-button', template: '' })
class StubButtonComponent {
  readonly label = input('');
  readonly type = input('');
  readonly variant = input('');
  readonly severity = input('');
  readonly size = input('');
  readonly disabled = input<boolean | undefined>(false);
  readonly loading = input(false);
  readonly onClick = output<MouseEvent>();
}
/* eslint-enable @angular-eslint/component-selector */

describe('MenteeProfileEditDrawerComponent', () => {
  let fixture: ComponentFixture<MenteeProfileEditDrawerComponent>;
  let comp: MenteeProfileEditDrawerComponent;
  let drawer: MenteeProfileEditDrawerService;
  let messageAdd: ReturnType<typeof vi.fn>;
  let updateMenteeProfile: ReturnType<typeof vi.fn<(request: MentorshipMenteeProfileUpdateRequest) => Observable<MentorshipMenteeProfileUpdateResponse>>>;
  let savedEvents: MentorshipMenteeProfileUpdateResponse[];

  const SAVED_RESPONSE: MentorshipMenteeProfileUpdateResponse = { profile: { ...PROFILE, additionalNotes: 'Updated notes.' } };

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function errorElement(): HTMLElement | null {
    return element().querySelector('[data-testid="mentee-profile-edit-drawer-error"]');
  }

  function stub<T>(selector: string): T {
    return fixture.debugElement.query(By.css(selector)).componentInstance as T;
  }

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(async () => {
    messageAdd = vi.fn();
    updateMenteeProfile = vi.fn(() => of(SAVED_RESPONSE));
    savedEvents = [];
    drawer = new MenteeProfileEditDrawerService();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MenteeProfileEditDrawerComponent],
      providers: [
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: MentorshipMenteeService, useValue: { updateMenteeProfile } },
        { provide: MenteeProfileEditDrawerService, useValue: drawer },
      ],
    })
      .overrideComponent(MenteeProfileEditDrawerComponent, {
        remove: {
          imports: [DrawerModule, ButtonComponent, TextareaComponent, SkillsPickerComponent, ResumeSectionComponent],
        },
        add: {
          imports: [StubDrawerComponent, StubTextareaComponent, StubSkillsPickerComponent, StubResumeSectionComponent, StubButtonComponent],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MenteeProfileEditDrawerComponent);
    comp = fixture.componentInstance;
    comp.saved.subscribe((response) => savedEvents.push(response));
    drawer.open(PROFILE);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('seeds the form from the profile context on open, converting About Me HTML to plain text', () => {
    const raw = comp['form'].getRawValue();

    expect(raw.introduction).toBe('Hello world');
    expect(raw.skillsHave).toEqual(PROFILE.skillsHave);
    expect(raw.skillsWant).toEqual(PROFILE.skillsWant);
    expect(raw.additionalNotes).toBe(PROFILE.additionalNotes);
    expect(raw.resumeFileName).toBe(PROFILE.resumeFileName);
  });

  it('preserves paragraph breaks when seeding a multi-paragraph introduction', () => {
    drawer.open({ ...PROFILE, aboutMe: '<p>First paragraph.</p><p>Second paragraph.</p>' });
    fixture.detectChanges();

    expect(comp['form'].controls.introduction.value).toBe('First paragraph.\nSecond paragraph.');
  });

  it('caps a register-length introduction past the shared 3000 cap and keeps the counter in sync', () => {
    const overLimit = 'a'.repeat(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX + 500);
    drawer.open({ ...PROFILE, aboutMe: `<p>${overLimit}</p>` });
    fixture.detectChanges();

    expect(comp['form'].controls.introduction.value).toBe('a'.repeat(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX));
    expect(comp['aboutMeLength']()).toBe(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
  });

  it('keeps a register-length introduction that sits at the shared 3000 cap', () => {
    const atCap = 'a'.repeat(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
    drawer.open({ ...PROFILE, aboutMe: `<p>${atCap}</p>` });
    fixture.detectChanges();

    expect(comp['form'].controls.introduction.value).toBe(atCap);
    expect(comp['aboutMeLength']()).toBe(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
  });

  it('seeds a stored aboutMe over the raw cap without running the quadratic strip on all of it (lfx-self-serve-ops#37)', () => {
    // `aboutMe` comes back from the API, so it can exceed what the register form allows. Converting
    // this nested-bracket payload in full would take seconds and trip the test timeout; the raw-cap
    // slice bounds it.
    const hostile = `${'<'.repeat(100_000)}${'>'.repeat(100_000)}`;
    expect(hostile.length).toBeGreaterThan(MENTORSHIP_RICH_TEXT_RAW_MAX);

    drawer.open({ ...PROFILE, aboutMe: hostile });
    fixture.detectChanges();

    expect(comp['aboutMeLength']()).toBeLessThanOrEqual(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
  });

  it.each([
    ['<strong>c</strong>', 'tag'],
    ['&amp;', 'entity'],
  ])('drops a %s the raw-cap cut splits instead of seeding it as literal text (%s)', (token) => {
    // Markup-heavy but within the 3000 plain-text cap: the cut lands two characters into `token`.
    const head = `<p>${'<strong>a</strong>'.repeat(900)}`;
    const filler = 'b'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX - head.length - 2);
    drawer.open({ ...PROFILE, aboutMe: `${head}${filler}${token}</p>` });
    fixture.detectChanges();

    expect(comp['form'].controls.introduction.value).toBe(`${'a'.repeat(900)}${filler}`);
  });

  it('drops an emoji the raw-cap cut splits instead of seeding a lone surrogate', () => {
    // The emoji's two UTF-16 units straddle the cut, so a plain slice would keep only the high surrogate.
    const head = `<p>${'<strong>a</strong>'.repeat(900)}`;
    const filler = 'b'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX - head.length - 1);
    drawer.open({ ...PROFILE, aboutMe: `${head}${filler}😀tail</p>` });
    fixture.detectChanges();

    expect(comp['form'].controls.introduction.value).toBe(`${'a'.repeat(900)}${filler}`);
  });

  it('emits valueChanges when seeding so skills pickers and resume receive the profile', () => {
    const emitted: unknown[] = [];
    const sub = comp['form'].valueChanges.subscribe((value) => emitted.push(value));

    drawer.open({ ...PROFILE, skillsHave: ['Rust'], resumeFileName: 'seeded-resume.pdf' });
    fixture.detectChanges();
    sub.unsubscribe();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[emitted.length - 1]).toEqual(
      expect.objectContaining({
        skillsHave: ['Rust'],
        resumeFileName: 'seeded-resume.pdf',
      })
    );
  });

  it('derives the resume filename from the URL when the profile has no resumeFileName', () => {
    drawer.open({ ...PROFILE, resumeFileName: undefined, resumeUrl: 'https://example.com/files/url-only-resume.pdf' });
    fixture.detectChanges();

    expect(comp['form'].controls.resumeFileName.value).toBe('url-only-resume.pdf');
  });

  it('does not close or toast when Save is pressed with empty required skill pickers', () => {
    drawer.open({ ...PROFILE, skillsHave: [], skillsWant: [] });
    fixture.detectChanges();

    comp['onSave']();

    expect(drawer.isOpen()).toBe(true);
    expect(messageAdd).not.toHaveBeenCalled();
    expect(updateMenteeProfile).not.toHaveBeenCalled();
    expect(comp['form'].controls.skillsHave.touched).toBe(true);
    expect(comp['form'].controls.skillsWant.touched).toBe(true);
    expect(comp['skillsHaveError']()).toBe('Add at least one skill you currently have.');
    expect(comp['skillsWantError']()).toBe('Add at least one skill you would like to improve.');
  });

  it('clears the filled picker error while the other required picker stays invalid', () => {
    drawer.open({ ...PROFILE, skillsHave: [], skillsWant: [] });
    fixture.detectChanges();
    comp['onSave']();

    comp['form'].controls.skillsHave.setValue(['Go']);
    fixture.detectChanges();

    expect(comp['skillsHaveError']()).toBeUndefined();
    expect(comp['skillsWantError']()).toBe('Add at least one skill you would like to improve.');
    expect(drawer.isOpen()).toBe(true);
    expect(messageAdd).not.toHaveBeenCalled();
  });

  describe('save', () => {
    it('closes the drawer without a request, toast or saved event when nothing changed', () => {
      comp['onSave']();

      expect(updateMenteeProfile).not.toHaveBeenCalled();
      expect(messageAdd).not.toHaveBeenCalled();
      expect(savedEvents).toEqual([]);
      expect(drawer.isOpen()).toBe(false);
    });

    it('sends only skillSet when only the skills changed, and never the introduction, demographics or resume', () => {
      comp['form'].controls.skillsHave.setValue(['Go', 'Python', 'Rust']);

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledTimes(1);
      const request = updateMenteeProfile.mock.calls[0][0];
      expect(request).toEqual({
        skillSet: { skillsHave: ['Go', 'Python', 'Rust'], skillsWant: ['Kubernetes'], additionalNotes: 'Comfortable working asynchronously.' },
      });
      expect(Object.keys(request)).toEqual(['skillSet']);
    });

    it('sends only the plain-text introduction when only it changed', () => {
      comp['form'].controls.introduction.setValue('Line one\nLine two');

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledWith({ introduction: 'Line one\nLine two' });
    });

    it('sends an empty string when the introduction was cleared', () => {
      comp['form'].controls.introduction.setValue('');

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledWith({ introduction: '' });
    });

    it('never sends the resume filename or a profile link', () => {
      comp['form'].controls.resumeFileName.setValue('renamed-resume.pdf');
      comp['form'].controls.additionalNotes.setValue('Weekends only.');

      comp['onSave']();

      const serialized = JSON.stringify(updateMenteeProfile.mock.calls[0][0]);
      expect(serialized).not.toContain('resume');
      expect(serialized).not.toContain('profile_links');
      expect(serialized).not.toContain('profileLinks');
    });

    it('shows the inline message and sends nothing when the introduction HTML would exceed the raw max', () => {
      comp['form'].controls.introduction.setValue('a\n\n'.repeat(1000));

      comp['onSave']();
      fixture.detectChanges();

      expect(updateMenteeProfile).not.toHaveBeenCalled();
      expect(errorElement()?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE);
      expect(drawer.isOpen()).toBe(true);
    });

    it('emits saved with the response, toasts, and closes the drawer on success', () => {
      comp['form'].controls.additionalNotes.setValue('Updated notes.');

      comp['onSave']();

      expect(savedEvents).toEqual([SAVED_RESPONSE]);
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY }));
      expect(drawer.isOpen()).toBe(false);
    });

    it.each([
      [400, { error: 'composed upstream string' }, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[400]],
      [404, null, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[404]],
      [409, null, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[409]],
      [500, null, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK],
    ])('keeps the drawer open with the typed input and shows the message for a %i', (status, body, message) => {
      comp['form'].controls.introduction.setValue('Typed introduction');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(status, body)));

      comp['onSave']();
      fixture.detectChanges();

      expect(drawer.isOpen()).toBe(true);
      expect(savedEvents).toEqual([]);
      expect(messageAdd).not.toHaveBeenCalled();
      expect(comp['form'].controls.introduction.value).toBe('Typed introduction');
      expect(errorElement()?.getAttribute('role')).toBe('alert');
      expect(errorElement()?.textContent?.trim()).toBe(message);
      expect(comp['saving']()).toBe(false);
    });

    it('shows the server-authored message for the BFF validation 400 and the impersonation 403', () => {
      comp['form'].controls.introduction.setValue('Typed introduction');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(400, { error: 'introduction must be a string', code: ERROR_CODES.VALIDATION_ERROR })));
      comp['onSave']();
      fixture.detectChanges();
      expect(errorElement()?.textContent?.trim()).toBe('introduction must be a string');

      const message = 'This action is not available while impersonating a user';
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE })));
      comp['onSave']();
      fixture.detectChanges();
      expect(errorElement()?.textContent?.trim()).toBe(message);
      expect(drawer.isOpen()).toBe(true);
    });

    it('moves focus to the error alert once it renders, so it is reachable when Save sits below the fold', () => {
      comp['form'].controls.additionalNotes.setValue('Weekends only.');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(409)));

      comp['onSave']();
      fixture.detectChanges();

      const alert = errorElement();
      expect(alert?.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(alert);
    });

    it('clears the error when the next Save starts', () => {
      comp['form'].controls.additionalNotes.setValue('Weekends only.');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(409)));
      comp['onSave']();
      expect(comp['errorMessage']()).not.toBe('');
      updateMenteeProfile.mockReturnValueOnce(new Subject<MentorshipMenteeProfileUpdateResponse>());
      comp['onSave']();
      expect(comp['errorMessage']()).toBe('');
    });

    it('clears the error when the form is edited', () => {
      comp['form'].controls.additionalNotes.setValue('Weekends only.');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(409)));
      comp['onSave']();
      expect(comp['errorMessage']()).not.toBe('');

      comp['form'].controls.additionalNotes.setValue('Weekends only, please.');

      expect(comp['errorMessage']()).toBe('');
    });

    it('clears the error when the drawer is re-seeded', () => {
      comp['form'].controls.additionalNotes.setValue('Weekends only.');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(409)));
      comp['onSave']();
      expect(comp['errorMessage']()).not.toBe('');

      drawer.close();
      drawer.open(PROFILE);
      fixture.detectChanges();

      expect(comp['errorMessage']()).toBe('');
    });

    it('re-sends the request with the same input after a failure', () => {
      comp['form'].controls.additionalNotes.setValue('Weekends only.');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(500)));
      comp['onSave']();

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledTimes(2);
      expect(updateMenteeProfile.mock.calls[1][0]).toEqual(updateMenteeProfile.mock.calls[0][0]);
      expect(drawer.isOpen()).toBe(false);
    });
  });

  describe('while saving', () => {
    let pending: Subject<MentorshipMenteeProfileUpdateResponse>;

    beforeEach(() => {
      pending = new Subject<MentorshipMenteeProfileUpdateResponse>();
      updateMenteeProfile.mockReturnValue(pending);
      comp['form'].controls.additionalNotes.setValue('Weekends only.');
      comp['onSave']();
      fixture.detectChanges();
    });

    it('disables Save and Cancel and makes the drawer non-dismissable', () => {
      expect(comp['saving']()).toBe(true);
      expect(stub<StubButtonComponent>('[data-testid="mentee-profile-edit-drawer-save"]').loading()).toBe(true);
      expect(stub<StubButtonComponent>('[data-testid="mentee-profile-edit-drawer-save"]').disabled()).toBe(true);
      expect(stub<StubButtonComponent>('[data-testid="mentee-profile-edit-drawer-cancel"]').disabled()).toBe(true);

      const drawerStub = stub<StubDrawerComponent>('p-drawer');
      expect(drawerStub.closable()).toBe(false);
      expect(drawerStub.dismissible()).toBe(false);
      expect(drawerStub.closeOnEscape()).toBe(false);
    });

    it('makes the fields inert but leaves the actions reachable, so an edit cannot diverge from the submitted snapshot', () => {
      const fields = element().querySelector('[data-testid="mentee-profile-edit-drawer-fields"]');

      expect(fields?.hasAttribute('inert')).toBe(true);
      expect(fields?.querySelector('[data-testid="mentee-profile-edit-about"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentee-profile-edit-drawer-actions"]')?.closest('[inert]')).toBeNull();
    });

    it('lifts inert once the request fails', () => {
      pending.error(httpError(500));
      fixture.detectChanges();

      expect(element().querySelector('[data-testid="mentee-profile-edit-drawer-fields"]')?.hasAttribute('inert')).toBe(false);
    });

    it('ignores close requests', () => {
      comp['onVisibleChange'](false);
      comp['onCancel']();

      expect(drawer.isOpen()).toBe(true);
    });

    it('sends no second request for another Save', () => {
      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledTimes(1);
    });

    it('re-enables the actions and closes once the request succeeds', () => {
      pending.next(SAVED_RESPONSE);
      pending.complete();
      fixture.detectChanges();

      expect(comp['saving']()).toBe(false);
      expect(savedEvents).toEqual([SAVED_RESPONSE]);
      expect(drawer.isOpen()).toBe(false);
    });
  });

  describe('skill limits', () => {
    it('marks more than the maximum number of skills invalid and shows the limit message after Save', () => {
      comp['form'].controls.skillsHave.setValue(Array.from({ length: MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS + 1 }, (_, index) => `Skill ${index}`));

      comp['onSave']();

      expect(comp['form'].controls.skillsHave.valid).toBe(false);
      expect(comp['skillsHaveError']()).toBe(MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE);
      expect(updateMenteeProfile).not.toHaveBeenCalled();
    });

    it('marks a skill over the maximum length invalid', () => {
      comp['form'].controls.skillsWant.setValue(['a'.repeat(MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH + 1)]);

      comp['onSave']();

      expect(comp['skillsWantError']()).toBe(MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE);
      expect(updateMenteeProfile).not.toHaveBeenCalled();
    });

    it('accepts the maximum number of skills at the maximum length', () => {
      comp['form'].controls.skillsHave.setValue(
        Array.from({ length: MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS }, (_, index) => `${index}`.padEnd(MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH, 'x'))
      );

      expect(comp['form'].controls.skillsHave.valid).toBe(true);
    });
  });

  it('keeps the resume inert with the coming-soon summary', () => {
    expect(stub<StubResumeSectionComponent>('lfx-mentorship-resume-section').comingSoonSummary()).toBe(MENTORSHIP_MENTEE_PROFILE_RESUME_COMING_SOON_SUMMARY);
  });

  it('closes the drawer on cancel without a toast', () => {
    comp['onCancel']();

    expect(drawer.isOpen()).toBe(false);
    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('closes the drawer on visibleChange(false)', () => {
    comp['onVisibleChange'](false);

    expect(drawer.isOpen()).toBe(false);
  });

  it('renders the drawer body when the drawer is open', () => {
    expect(element().querySelector('[data-testid="mentee-profile-edit-drawer-body"]')).toBeTruthy();
  });

  it('renders the header subtitle and About Me prompts', () => {
    expect(comp['subtitle']).toBe(MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE);
    expect(element().querySelectorAll('[data-testid="mentee-profile-edit-about-prompts"] li').length).toBe(4);
    expect(element().querySelector('[data-testid="mentee-profile-edit-about-me-counter"]')?.textContent?.trim()).toBe(
      `11 / ${MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX}`
    );
  });

  it('counts emoji as one character against the About Me code-point cap', () => {
    const atCap = '😀'.repeat(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
    const introduction = comp['form'].controls.introduction;

    introduction.setValue(atCap);
    expect(introduction.valid).toBe(true);
    expect(comp['aboutMeLength']()).toBe(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);

    introduction.setValue(atCap + '😀');
    expect(introduction.value).toBe(atCap);
    expect(comp['aboutMeLength']()).toBe(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
  });

  it('renders the save and cancel action buttons', () => {
    const actions = element().querySelector('[data-testid="mentee-profile-edit-drawer-actions"]');

    expect(actions?.querySelector('[data-testid="mentee-profile-edit-drawer-save"]')).toBeTruthy();
    expect(actions?.querySelector('[data-testid="mentee-profile-edit-drawer-cancel"]')).toBeTruthy();
    expect(comp['saveLabel']).toBe(MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL);
  });

  it('renders About Me, both skill pickers, additional notes, and resume', () => {
    expect(element().querySelector('[data-testid="mentee-profile-edit-about"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-profile-edit-skills"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-profile-edit-additional-notes"]')).toBeTruthy();
    expect(element().querySelectorAll('lfx-mentorship-skills-picker').length).toBe(2);
    expect(element().querySelector('lfx-mentorship-resume-section')).toBeTruthy();
  });
});
