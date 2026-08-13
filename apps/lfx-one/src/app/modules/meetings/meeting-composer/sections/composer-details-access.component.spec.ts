// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { YOUTUBE_MAX_MEETING_TITLE_LENGTH } from '@lfx-one/shared/constants';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerDetailsAccessComponent } from './composer-details-access.component';

/**
 * Covers the title's `aria-describedby` list. The paragraphs it points at are gated on `touched`, which
 * emits on neither `valueChanges` nor `statusChanges` — so a list that gated on it too would go stale for
 * exactly the case the errors exist for.
 */
describe('ComposerDetailsAccessComponent — title description ids', () => {
  let fixture: ComponentFixture<ComposerDetailsAccessComponent>;
  let component: ComposerDetailsAccessComponent;
  let formService: MeetingComposerFormService;

  const describedBy = (): string | null => component['titleDescribedBy']();

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
      ],
    });
    TestBed.overrideComponent(ComposerDetailsAccessComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerDetailsAccessComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('points at the required error on an empty title', () => {
    expect(describedBy()).toBe('composer-title-required-error');
  });

  it('still points at the required error after a blur-only touch', () => {
    // Primed first on purpose: the read is what caches the computed, and a `touched`-gated version could
    // only be caught going stale from a cached value — nothing bumps `revision` on `markAsTouched()`.
    expect(describedBy()).toBe('composer-title-required-error');

    formService.form().get('title')?.markAsTouched();

    expect(describedBy()).toBe('composer-title-required-error');
  });

  it('drops the error once the title is filled', () => {
    expect(describedBy()).toBe('composer-title-required-error');

    formService.form().get('title')?.setValue('Composer meeting');

    expect(describedBy()).toBeNull();
  });

  it('lists the prefill hint alongside the error', () => {
    fixture.componentRef.setInput('titleHint', 'Pre-filled for this meeting type — edit freely.');

    expect(describedBy()).toBe('composer-title-hint composer-title-required-error');
  });

  it('lists the prefill hint alone once the prefilled title validates', () => {
    fixture.componentRef.setInput('titleHint', 'Pre-filled for this meeting type — edit freely.');
    formService.form().get('title')?.setValue('Composer meeting');

    expect(describedBy()).toBe('composer-title-hint');
  });

  it('points at the maxlength error when the YouTube limit is exceeded', () => {
    formService.form().get('youtube_upload_enabled')?.setValue(true);
    formService
      .form()
      .get('title')
      ?.setValue('a'.repeat(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1));

    expect(describedBy()).toBe('composer-title-maxlength-error');
  });
});
