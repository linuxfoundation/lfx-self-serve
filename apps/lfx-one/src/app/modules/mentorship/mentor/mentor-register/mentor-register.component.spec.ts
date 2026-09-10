// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { MentorshipMentorProgramRequest, MentorshipProgram, MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { UserService } from '@services/user.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorRegisterComponent } from './mentor-register.component';

/**
 * The real editor lazy-loads TipTap and mounts it against `document` in `afterNextRender`,
 * which the test environment tears down underneath it. The introduction field's behavior
 * under test is the validation gate, not the editor, so stand it down here.
 */
@Component({
  selector: 'lfx-rich-editor',
  template: '',
})
class StubRichEditorComponent {
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly placeholder = input<string>('');
  public readonly editorStyle = input<Record<string, string>>({});
  public readonly dataTest = input<string>();
}

describe('MentorRegisterComponent', () => {
  const program = (id: string, name: string): MentorshipProgram => ({
    id,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    projectName: 'LF Energy',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 2, mentees: 1, graduated: 0 },
    createdOn: '2026-05-01',
    updatedOn: '2026-07-02',
  });

  const programs: MentorshipProgramsResponse = { data: [program('mp_gridflow', 'GridFlow Ingestion')], total: 1 };

  /** Stands in for requests the mentor already raised. The component itself starts empty. */
  const existingRequests: MentorshipMentorProgramRequest[] = [
    { id: 'req_gridflow', programId: 'mp_gridflow', programName: 'GridFlow Ingestion', status: 'accepted' },
  ];

  let fixture: ComponentFixture<MentorRegisterComponent>;
  let component: MentorRegisterComponent;
  let toast: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const errorText = (testId: string): string | null => element().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? null;

  /** Fills every required field, so a spec can isolate the one it means to break. */
  const fillValidForm = (): void => {
    component['form'].patchValue({
      introduction: '<p>Maintainer on two CNCF projects.</p>',
      skills: ['Go'],
      complianceAccepted: true,
      termsAccepted: true,
    });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    toast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorRegisterComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: toast } },
        { provide: MentorshipService, useValue: { getPrograms: () => of(programs) } },
        // The profile card at the top of the page fetches these three itself.
        {
          provide: UserService,
          useValue: {
            getCurrentUserProfile: () => of(null),
            getUserEmails: () => of(null),
            getIdentities: () => of([]),
            effectiveAvatarUrl: () => '',
          },
        },
      ],
    });

    await TestBed.overrideComponent(MentorRegisterComponent, {
      remove: { imports: [RichEditorComponent] },
      add: { imports: [StubRichEditorComponent] },
    }).compileComponents();

    fixture = TestBed.createComponent(MentorRegisterComponent);
    component = fixture.componentInstance;

    // Stand down only `confirm`, on the page's own instance: the rendered `<p-confirmDialog>`
    // subscribes to the real service, so replacing the service wholesale breaks the dialog.
    // Accept by default, so a spec that means to test the cancel path says so explicitly.
    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    confirm = vi.fn((options: Confirmation) => {
      options.accept?.();
      return confirmationService;
    });
    confirmationService.confirm = confirm;

    fixture.detectChanges();
  });

  it('renders every section of the registration form', () => {
    for (const section of ['programs', 'introduction', 'skills', 'resume', 'compliance']) {
      expect(element().querySelector(`[data-testid="mentorship-mentor-${section}"]`)).not.toBeNull();
    }
    expect(element().querySelector('#mentorship-mentor-terms-text')).not.toBeNull();
  });

  it('leads with the LFX profile card, so the mentor sees what the admin will receive', () => {
    const sections = [...element().querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid'));

    expect(sections.indexOf('mentorship-profile-card')).toBeLessThan(sections.indexOf('mentorship-mentor-programs'));
  });

  it('starts with no program requests, rather than showing requests the mentor never made', () => {
    expect(component['requests']()).toEqual([]);
    expect(element().querySelector('[data-testid^="mentorship-mentor-request-row-"]')).toBeNull();
  });

  it('keeps errors hidden until the mentor tries to submit', () => {
    // An empty form is invalid from the outset, but saying so before they act is noise.
    expect(component['errors']()).toEqual({});
    expect(errorText('mentorship-mentor-introduction-error')).toBeNull();

    component['onSubmit']();
    fixture.detectChanges();

    expect(errorText('mentorship-mentor-introduction-error')).toBe('Introduction is required.');
    expect(errorText('mentorship-mentor-compliance-error')).toBe('Please confirm the compliance statement.');
  });

  it('warns rather than succeeds when a required field is missing', () => {
    fillValidForm();
    component['form'].controls.termsAccepted.setValue(false);

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'warn', detail: 'Please accept the terms and conditions.' });
  });

  it('registers a mentor who has withdrawn from every program, since applying is optional', () => {
    fillValidForm();
    component['requests'].set([]);

    component['onSubmit']();

    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success' });
  });

  it('confirms submission once the form is complete', () => {
    fillValidForm();

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success' });
    // Errors go back into hiding, so a second visit to the form starts clean.
    expect(component['errors']()).toEqual({});
  });

  it('raises a pending request for a picked program', () => {
    component['onAddProgram'](program('mp_gridflow', 'GridFlow Ingestion'));

    expect(component['requests']().at(-1)).toMatchObject({ programId: 'mp_gridflow', programName: 'GridFlow Ingestion', status: 'pending' });
  });

  it('ignores a program already requested, so it cannot be queued twice', () => {
    component['requests'].set([...existingRequests]);
    const [existing] = existingRequests;

    component['onAddProgram'](program(existing.programId, existing.programName));

    expect(component['requests']().length).toBe(existingRequests.length);
  });

  it('drops a withdrawn request once the mentor confirms', () => {
    component['requests'].set([...existingRequests]);
    const [existing] = existingRequests;

    component['onWithdraw'](existing.id);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(component['requests']().some((request) => request.id === existing.id)).toBe(false);
  });

  it('keeps the request when the mentor backs out of the confirmation', () => {
    confirm.mockImplementationOnce(() => undefined);
    component['requests'].set([...existingRequests]);

    component['onWithdraw'](existingRequests[0].id);

    expect(component['requests']()).toEqual(existingRequests);
  });

  it('sends Cancel back to the mentorship admin page', () => {
    const cancel = element().querySelector('[data-testid="mentorship-mentor-cancel"] a');

    expect(cancel?.getAttribute('href')).toBe('/mentorship/admin');
  });
});
