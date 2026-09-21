// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_COMING_SOON_DETAIL,
  MENTORSHIP_COMING_SOON_TOAST_LIFE,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX,
  MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
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
  readonly idPrefix = input('');
}

@Component({ selector: 'lfx-button', template: '' })
class StubButtonComponent {
  readonly label = input('');
  readonly type = input('');
  readonly variant = input('');
  readonly severity = input('');
  readonly size = input('');
  readonly onClick = output<MouseEvent>();
}
/* eslint-enable @angular-eslint/component-selector */

describe('MenteeProfileEditDrawerComponent', () => {
  let fixture: ComponentFixture<MenteeProfileEditDrawerComponent>;
  let comp: MenteeProfileEditDrawerComponent;
  let drawer: MenteeProfileEditDrawerService;
  let messageAdd: ReturnType<typeof vi.fn>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    messageAdd = vi.fn();
    drawer = new MenteeProfileEditDrawerService();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MenteeProfileEditDrawerComponent],
      providers: [
        { provide: MessageService, useValue: { add: messageAdd } },
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
    drawer.open(PROFILE);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('seeds the form from the profile context on open, stripping HTML from About Me', () => {
    const raw = comp['form'].getRawValue();

    expect(raw.introduction).toBe('Hello world');
    expect(raw.skillsHave).toEqual(PROFILE.skillsHave);
    expect(raw.skillsWant).toEqual(PROFILE.skillsWant);
    expect(raw.additionalNotes).toBe(PROFILE.additionalNotes);
    expect(raw.resumeFileName).toBe(PROFILE.resumeFileName);
  });

  it('fires the coming-soon toast and closes the drawer on save', () => {
    comp['onSave']();

    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL,
        detail: MENTORSHIP_COMING_SOON_DETAIL,
        life: MENTORSHIP_COMING_SOON_TOAST_LIFE,
      })
    );
    expect(drawer.isOpen()).toBe(false);
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
