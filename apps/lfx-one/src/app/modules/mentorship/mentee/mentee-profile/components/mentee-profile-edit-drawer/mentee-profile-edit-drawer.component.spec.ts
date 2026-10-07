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
  MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
  MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails, MentorshipMenteeProfileUpdateRequest, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { RichEditorComponent } from '../../../../../../shared/components/rich-editor/rich-editor.component';
import { SelectComponent } from '../../../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { DrawerModule } from 'primeng/drawer';
import { MenteeProfileEditDrawerComponent } from './mentee-profile-edit-drawer.component';
import { MenteeProfileEditDrawerService } from './mentee-profile-edit-drawer.service';

const PROFILE: MentorshipMenteeProfileDetails = {
  aboutMe: '<p>Hello world</p>',
  skillsHave: ['Go', 'Python'],
  skillsWant: ['Kubernetes'],
  additionalNotes: 'Comfortable working asynchronously.',
  country: 'KE',
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

@Component({ selector: 'lfx-rich-editor', template: '' })
class StubRichEditorComponent {
  readonly form = input<FormGroup>();
  readonly control = input('');
  readonly placeholder = input('');
  readonly editorStyle = input<Record<string, string>>({});
  readonly ariaLabelledBy = input('');
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

@Component({ selector: 'lfx-select', template: '' })
class StubSelectComponent {
  readonly form = input<FormGroup>();
  readonly control = input('');
  readonly options = input<unknown[]>([]);
  readonly inputId = input('');
  readonly placeholder = input('');
  readonly size = input('');
  readonly styleClass = input('');
  readonly filter = input(false);
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

  function introductionErrorElement(): HTMLElement | null {
    return element().querySelector('[data-testid="mentee-profile-edit-about-me-error"]');
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
          imports: [DrawerModule, ButtonComponent, RichEditorComponent, SelectComponent, TextareaComponent, SkillsPickerComponent],
        },
        add: {
          imports: [StubDrawerComponent, StubRichEditorComponent, StubSelectComponent, StubTextareaComponent, StubSkillsPickerComponent, StubButtonComponent],
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

  it('seeds the form from the profile context on open, keeping the About Me HTML as stored', () => {
    const raw = comp['form'].getRawValue();

    expect(raw.introduction).toBe('<p>Hello world</p>');
    expect(raw.skillsHave).toEqual(PROFILE.skillsHave);
    expect(raw.skillsWant).toEqual(PROFILE.skillsWant);
    expect(raw.additionalNotes).toBe(PROFILE.additionalNotes);
    expect(raw.country).toBe('KE');
    expect(raw).not.toHaveProperty('resumeFileName');
  });

  it('binds the country to a filterable dropdown of the ISO countries', () => {
    const select = stub<StubSelectComponent>('lfx-select');

    expect(select.control()).toBe('country');
    expect(select.form()).toBe(comp['form']);
    expect(select.filter()).toBe(true);
    expect(select.options()).toContainEqual({ label: 'Kenya', value: 'KE' });
    expect(element().querySelector('label[for="mentee-profile-edit-country"]')).not.toBeNull();
  });

  it('requires a country before saving a profile stored without one, and shows the error after Save', () => {
    drawer.open({ ...PROFILE, country: undefined });
    fixture.detectChanges();
    comp['form'].controls.additionalNotes.setValue('Weekends only.');

    expect(comp['countryError']()).toBeUndefined();
    comp['onSave']();
    fixture.detectChanges();

    expect(updateMenteeProfile).not.toHaveBeenCalled();
    expect(drawer.isOpen()).toBe(true);
    expect(element().querySelector('[data-testid="mentee-profile-edit-country-error"]')?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE);

    comp['form'].controls.country.setValue('NG');
    fixture.detectChanges();
    expect(comp['countryError']()).toBeUndefined();
  });

  it('binds the introduction to the rich editor the register form uses', () => {
    const editor = stub<StubRichEditorComponent>('lfx-rich-editor');

    expect(editor.control()).toBe('introduction');
    expect(editor.form()).toBe(comp['form']);
    expect(editor.ariaLabelledBy()).toBe('mentee-profile-edit-about-me-label');
    expect(element().querySelector('#mentee-profile-edit-about-me-label')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentee-profile-edit-about-me-counter"]')).toBeNull();
  });

  it('seeds a multi-paragraph introduction without flattening it', () => {
    const aboutMe = '<p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p>';
    drawer.open({ ...PROFILE, aboutMe });
    fixture.detectChanges();

    expect(comp['form'].controls.introduction.value).toBe(aboutMe);
  });

  it('leaves an untouched stored introduction out of the request, even one over the raw max', () => {
    drawer.open({ ...PROFILE, aboutMe: `<p>${'a'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX)}</p>` });
    fixture.detectChanges();
    comp['form'].controls.additionalNotes.setValue('Weekends only.');

    comp['onSave']();
    fixture.detectChanges();

    expect(introductionErrorElement()).toBeNull();
    expect(updateMenteeProfile).toHaveBeenCalledWith({
      skillSet: { skillsHave: ['Go', 'Python'], skillsWant: ['Kubernetes'], additionalNotes: 'Weekends only.' },
    });
  });

  it('emits valueChanges when seeding so skills pickers receive the profile', () => {
    const emitted: unknown[] = [];
    const sub = comp['form'].valueChanges.subscribe((value) => emitted.push(value));

    drawer.open({ ...PROFILE, skillsHave: ['Rust'] });
    fixture.detectChanges();
    sub.unsubscribe();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[emitted.length - 1]).toEqual(expect.objectContaining({ skillsHave: ['Rust'] }));
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

    it('sends only skillSet when only the skills changed, and never the introduction or demographics', () => {
      comp['form'].controls.skillsHave.setValue(['Go', 'Python', 'Rust']);

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledTimes(1);
      const request = updateMenteeProfile.mock.calls[0][0];
      expect(request).toEqual({
        skillSet: { skillsHave: ['Go', 'Python', 'Rust'], skillsWant: ['Kubernetes'], additionalNotes: 'Comfortable working asynchronously.' },
      });
      expect(Object.keys(request)).toEqual(['skillSet']);
    });

    it('sends only the country when only it changed', () => {
      comp['form'].controls.country.setValue('NG');

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledWith({ country: 'NG' });
    });

    it('sends only the introduction HTML when only it changed', () => {
      comp['form'].controls.introduction.setValue('<p>Line one</p><p>Line two</p>');

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledWith({ introduction: '<p>Line one</p><p>Line two</p>' });
    });

    it('requires an introduction, as register does, and sends nothing when it was cleared', () => {
      comp['form'].controls.introduction.setValue('');

      comp['onSave']();
      fixture.detectChanges();

      expect(updateMenteeProfile).not.toHaveBeenCalled();
      expect(introductionErrorElement()?.getAttribute('role')).toBe('alert');
      expect(introductionErrorElement()?.textContent?.trim()).toBe('Introduction is required.');
      expect(drawer.isOpen()).toBe(true);
    });

    it('holds the introduction to the 3000 character register limit', () => {
      comp['form'].controls.introduction.setValue(`<p>${'a'.repeat(3001)}</p>`);

      comp['onSave']();
      fixture.detectChanges();

      expect(updateMenteeProfile).not.toHaveBeenCalled();
      expect(introductionErrorElement()?.textContent?.trim()).toBe('Introduction must be 3000 characters or fewer.');
    });

    it('shows no introduction error before Save and clears it once the text is valid', () => {
      comp['form'].controls.introduction.setValue('');
      fixture.detectChanges();
      expect(introductionErrorElement()).toBeNull();

      comp['onSave']();
      fixture.detectChanges();
      expect(introductionErrorElement()).not.toBeNull();

      comp['form'].controls.introduction.setValue('<p>Back again</p>');
      fixture.detectChanges();
      expect(introductionErrorElement()).toBeNull();
    });

    it('clears the error and sends nothing when the introduction is reverted to the stored HTML', () => {
      comp['form'].controls.introduction.setValue('');
      comp['onSave']();
      fixture.detectChanges();
      expect(introductionErrorElement()).not.toBeNull();

      comp['form'].controls.introduction.setValue(PROFILE.aboutMe);
      fixture.detectChanges();
      expect(introductionErrorElement()).toBeNull();

      comp['onSave']();

      expect(updateMenteeProfile).not.toHaveBeenCalled();
      expect(drawer.isOpen()).toBe(false);
    });

    it('never sends a profile link', () => {
      comp['form'].controls.additionalNotes.setValue('Weekends only.');

      comp['onSave']();

      const serialized = JSON.stringify(updateMenteeProfile.mock.calls[0][0]);
      expect(serialized).not.toContain('resume');
      expect(serialized).not.toContain('profile_links');
      expect(serialized).not.toContain('profileLinks');
    });

    it('shows the formatting message and sends nothing when the introduction HTML exceeds the raw max', () => {
      comp['form'].controls.introduction.setValue(`<p>a</p>${'<p></p>'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX)}`);

      comp['onSave']();
      fixture.detectChanges();

      expect(updateMenteeProfile).not.toHaveBeenCalled();
      expect(introductionErrorElement()?.textContent?.trim()).toBe(MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE);
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
      comp['form'].controls.introduction.setValue('<p>Typed introduction</p>');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(status, body)));

      comp['onSave']();
      fixture.detectChanges();

      expect(drawer.isOpen()).toBe(true);
      expect(savedEvents).toEqual([]);
      expect(messageAdd).not.toHaveBeenCalled();
      expect(comp['form'].controls.introduction.value).toBe('<p>Typed introduction</p>');
      expect(errorElement()?.getAttribute('role')).toBe('alert');
      expect(errorElement()?.textContent?.trim()).toBe(message);
      expect(comp['saving']()).toBe(false);
    });

    it('shows the server-authored message for the BFF validation 400 and the impersonation 403', () => {
      comp['form'].controls.introduction.setValue('<p>Typed introduction</p>');
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
  });

  it('renders the save and cancel action buttons', () => {
    const actions = element().querySelector('[data-testid="mentee-profile-edit-drawer-actions"]');

    expect(actions?.querySelector('[data-testid="mentee-profile-edit-drawer-save"]')).toBeTruthy();
    expect(actions?.querySelector('[data-testid="mentee-profile-edit-drawer-cancel"]')).toBeTruthy();
    expect(comp['saveLabel']).toBe(MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL);
  });

  it('renders About Me, both skill pickers and additional notes, with no resume', () => {
    expect(element().querySelector('[data-testid="mentee-profile-edit-about"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-profile-edit-skills"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-profile-edit-additional-notes"]')).toBeTruthy();
    expect(element().querySelectorAll('lfx-mentorship-skills-picker').length).toBe(2);
    expect(element().querySelector('[data-testid^="mentee-profile-edit-resume"]')).toBeNull();
  });
});
