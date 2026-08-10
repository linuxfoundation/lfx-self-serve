// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';

import { CommitteeSettingsTabComponent } from './committee-settings-tab.component';

/**
 * Covers the invariants that are only asserted in prose comments on this component: the
 * dirty-gated save payload, the dirty-value-survives-refresh behavior, the impersonation-specific
 * re-disable inside the shared canEdit/impersonating subscription, and the four saveSettings
 * error-code branches. The sibling CommitteeSettingsComponent (presentational) has its own spec;
 * this one exercises the parent that actually owns the save/refresh/authorization logic.
 */
describe('CommitteeSettingsTabComponent — Slack webhook (LFXV2-3080)', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;
  let updateCommittee: ReturnType<typeof vi.fn>;
  let impersonating: WritableSignal<boolean>;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    has_slack_webhook: false,
  } as Committee;

  beforeEach(async () => {
    updateCommittee = vi.fn(() => of(COMMITTEE));
    impersonating = signal(false);

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: CommitteeService, useValue: { updateCommittee, getCommittee: vi.fn(() => of(COMMITTEE)) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([])),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        // Real service, not a fake: PrimeNG's <p-confirmDialog> in the template subscribes to
        // ConfirmationService's internal Subjects directly in its constructor — a useValue fake
        // without them throws "Cannot read properties of undefined (reading 'subscribe')" the
        // moment the fixture renders. The service itself has no external dependencies.
        ConfirmationService,
        { provide: UserService, useValue: { impersonating } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  });

  it('omits chat_webhook_url from the save payload when the control is pristine', () => {
    component.saveSettings();

    expect(updateCommittee).toHaveBeenCalledOnce();
    const payload = updateCommittee.mock.calls[0][1];
    expect(payload).not.toHaveProperty('chat_webhook_url');
  });

  it('includes chat_webhook_url in the save payload when the control is dirty', () => {
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    component.saveSettings();

    const payload = updateCommittee.mock.calls[0][1];
    expect(payload.chat_webhook_url).toBe('https://hooks.slack.com/services/T1/B1/X');
  });

  it('preserves a dirty chat_webhook_url value across a committee input refresh instead of nulling it', async () => {
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    fixture.componentRef.setInput('committee', { ...COMMITTEE, name: 'Renamed' });
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.value).toBe('https://hooks.slack.com/services/T1/B1/X');
  });

  it('nulls chat_webhook_url on a committee refresh when the control is pristine (untouched)', async () => {
    fixture.componentRef.setInput('committee', { ...COMMITTEE, name: 'Renamed' });
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.value).toBeNull();
  });

  it('disables chat_webhook_url when impersonating flips true while canEdit stays true — the rest of the form stays enabled', async () => {
    expect(component.form.controls.chat_webhook_url.disabled).toBe(false);

    impersonating.set(true);
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.disabled).toBe(true);
    expect(component.form.controls.chat_channel.disabled).toBe(false);
  });

  it('re-disables chat_webhook_url after a canEdit-driven form.enable() re-enables every control', async () => {
    impersonating.set(true);
    await fixture.whenStable();
    expect(component.form.controls.chat_webhook_url.disabled).toBe(true);

    // Auditor toggle: canEdit flips off then back on — form.enable() re-enables every control;
    // the impersonation re-disable must still apply afterward, in the same subscription.
    fixture.componentRef.setInput('canEdit', false);
    await fixture.whenStable();
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.disabled).toBe(true);
  });

  it('surfaces the SLACK_WEBHOOK_NOT_PERSISTED 409 without resetting the dirty control, and still emits committeeUpdated', () => {
    updateCommittee.mockReturnValueOnce(throwError(() => ({ status: 409, error: { code: 'SLACK_WEBHOOK_NOT_PERSISTED', error: 'Could not store webhook' } })));
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    const emitted: void[] = [];
    component.committeeUpdated.subscribe(() => emitted.push(undefined));

    component.saveSettings();

    expect(component.form.controls.chat_webhook_url.dirty).toBe(true);
    expect(component.form.controls.chat_webhook_url.value).toBe('https://hooks.slack.com/services/T1/B1/X');
    expect(emitted).toHaveLength(1);
  });

  it('surfaces IMPERSONATION_READ_ONLY (403) without emitting committeeUpdated', () => {
    updateCommittee.mockReturnValueOnce(throwError(() => ({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })));
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    const emitted: void[] = [];
    component.committeeUpdated.subscribe(() => emitted.push(undefined));

    component.saveSettings();

    expect(emitted).toHaveLength(0);
  });

  it('surfaces NOT_PROJECT_WRITER (403) without emitting committeeUpdated — nothing on the save persisted', () => {
    updateCommittee.mockReturnValueOnce(throwError(() => ({ status: 403, error: { code: 'NOT_PROJECT_WRITER' } })));

    const emitted: void[] = [];
    component.committeeUpdated.subscribe(() => emitted.push(undefined));

    component.saveSettings();

    expect(emitted).toHaveLength(0);
  });
});
