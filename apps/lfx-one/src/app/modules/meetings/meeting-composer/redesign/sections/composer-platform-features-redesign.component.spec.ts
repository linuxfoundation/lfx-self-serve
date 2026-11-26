// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../../meeting-composer-form.service';
import { ComposerPlatformFeaturesRedesignComponent } from './composer-platform-features-redesign.component';

/** Same class without its template, for the computed-signal tests. */
@Component({ selector: 'lfx-state-only-platform-features', template: '' })
class StateOnlyPlatformFeaturesComponent extends ComposerPlatformFeaturesRedesignComponent {}

describe('ComposerPlatformFeaturesRedesignComponent', () => {
  let fixture: ComponentFixture<ComposerPlatformFeaturesRedesignComponent>;
  let formService: MeetingComposerFormService;

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function render(stateOnly = false): Promise<void> {
    fixture = TestBed.createComponent(stateOnly ? StateOnlyPlatformFeaturesComponent : ComposerPlatformFeaturesRedesignComponent);
    fixture.componentRef.setInput('form', formService.form());
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function toggle(key: string): HTMLButtonElement | HTMLInputElement {
    return query(`composer-feature-${key}`)!.querySelector('button, input') as HTMLButtonElement;
  }

  beforeEach(() => {
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
    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create' }, { featureDefaultsOn: true });
  });

  it('starts with recording and AI summary on, and transcripts and YouTube available', async () => {
    await render();
    const form = formService.form();

    expect(form.get('recording_enabled')?.value).toBe(true);
    expect(form.get('zoom_ai_enabled')?.value).toBe(true);
    expect(form.get('transcript_enabled')?.enabled).toBe(true);
    expect(toggle('transcript_enabled').disabled).toBe(false);
    expect(query('composer-feature-note-transcript_enabled')).toBeNull();
    expect(query('composer-ai-approval-checkbox')).not.toBeNull();
  });

  it('turns transcripts and YouTube off and explains why when recording goes off', async () => {
    await render();
    formService.form().get('transcript_enabled')?.setValue(true);
    formService.form().get('recording_enabled')?.setValue(false);
    fixture.detectChanges();

    expect(formService.form().get('transcript_enabled')?.value).toBe(false);
    expect(toggle('transcript_enabled').disabled).toBe(true);
    expect(query('composer-feature-note-transcript_enabled')?.textContent).toContain('Turn on recording to use this');
    expect(query('composer-feature-note-youtube_upload_enabled')?.textContent).toContain('Turn on recording to use this');
  });

  it('lists every platform and disables the unavailable ones', async () => {
    await render();
    const teams = query('composer-platform-Microsoft Teams')?.querySelector('input') as HTMLInputElement;

    expect(teams.disabled).toBe(true);
    expect(query('composer-platform-chips')?.textContent).toContain('Microsoft Teams (Soon)');
  });

  it('shows the reminder timing and one error for an out-of-range hour', async () => {
    await render();
    formService.form().get('auto_email_reminder_enabled')?.setValue(true);
    fixture.detectChanges();
    expect(query('composer-reminder')).not.toBeNull();

    const hours = formService.form().get('reminderHours');
    hours?.setValue(30);
    hours?.markAsTouched();
    fixture.detectChanges();

    expect(query('composer-reminder-error')?.textContent).toContain('Set the reminder to a whole number of hours between 2 and 24.');
  });

  it('names what the artifact setting covers and hides it with both features off', async () => {
    await render();
    expect(query('composer-artifact-visibility-label')?.textContent).toContain('Who can access recordings & summaries');

    formService.form().get('zoom_ai_enabled')?.setValue(false);
    fixture.detectChanges();
    expect(query('composer-artifact-visibility-label')?.textContent).toContain('Who can access recordings');

    formService.form().get('recording_enabled')?.setValue(false);
    fixture.detectChanges();
    expect(query('composer-artifact-visibility-select')).toBeNull();
  });

  it('labels the artifact setting for summaries alone', async () => {
    await render(true);
    formService.form().get('recording_enabled')?.setValue(false);

    expect(fixture.componentInstance['artifactVisibilityLabel']()).toBe('Who can access summaries');
  });
});
