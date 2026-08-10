// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SLACK_INCOMING_WEBHOOK_URL_PATTERN } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommitteeSettingsComponent } from './committee-settings.component';

/** Mirrors committee-settings-tab.component.ts's real FormGroup shape — every control the template's other cards (member visibility, join mode, feature toggles) reference via formControlName must exist or Angular throws NG01203. chat_webhook_url carries the real Validators.pattern too, not just the same key, so a test asserting form-invalid behavior around it is actually exercising that validator. */
function buildForm(): FormGroup {
  return new FormGroup({
    member_visibility: new FormControl('hidden'),
    join_mode: new FormControl('invite_only'),
    business_email_required: new FormControl(false),
    enable_voting: new FormControl(false),
    is_audit_enabled: new FormControl(false),
    public: new FormControl(false),
    sso_group_enabled: new FormControl(false),
    show_meeting_attendees: new FormControl(false),
    chat_channel: new FormControl<string | null>(null),
    website: new FormControl<string | null>(null),
    chat_webhook_url: new FormControl<string | null>(null, [Validators.pattern(SLACK_INCOMING_WEBHOOK_URL_PATTERN)]),
  });
}

describe('CommitteeSettingsComponent — Slack webhook card', () => {
  let fixture: ComponentFixture<CommitteeSettingsComponent>;
  let form: FormGroup;

  beforeEach(async () => {
    // provideRouter/provideNoopAnimations are needed by sibling cards this component also
    // renders (the info banner's lfx-message uses an animation trigger; lfx-button supports
    // routerLink) — not by the Slack webhook card itself, but the whole component compiles as
    // one unit.
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsComponent],
      providers: [provideRouter([]), provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(CommitteeSettingsComponent);
    form = buildForm();
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('showSlackWebhook', true);
  });

  // data-testid lands on <lfx-button>'s host element, two Angular component boundaries above the
  // native <button> PrimeNG's <p-button> actually renders internally — .click() on the host
  // itself doesn't reach it, so this queries the descendant native button.
  function button(testId: string): HTMLButtonElement {
    const el = fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`);
    if (!el) throw new Error(`no native button rendered inside ${testId}`);
    return el as HTMLButtonElement;
  }

  it('shows the Configured badge, not the input, when slackWebhookInputVisible is false', async () => {
    fixture.componentRef.setInput('slackWebhookInputVisible', false);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="settings-slack-webhook-configured"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="settings-slack-webhook-input"]')).toBeNull();
  });

  it('shows the input, not the badge, when slackWebhookInputVisible is true', async () => {
    fixture.componentRef.setInput('slackWebhookInputVisible', true);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="settings-slack-webhook-input"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="settings-slack-webhook-configured"]')).toBeNull();
  });

  it("Remove clears and dirties the control, and emits startEditingSlackWebhookUrl — saveSettings' payload gate keys off exactly this dirty flag", async () => {
    form.controls['chat_webhook_url'].setValue('https://hooks.slack.com/services/T1/B1/X');
    form.controls['chat_webhook_url'].markAsPristine();
    fixture.componentRef.setInput('slackWebhookInputVisible', false);
    await fixture.whenStable();

    const emitted: void[] = [];
    fixture.componentInstance.startEditingSlackWebhookUrl.subscribe(() => emitted.push(undefined));

    button('settings-slack-webhook-remove-button').click();

    expect(form.controls['chat_webhook_url'].value).toBe('');
    expect(form.controls['chat_webhook_url'].dirty).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it('Cancel resets the control to pristine/null and emits cancelEditingSlackWebhookUrl — unblocks [disabled]="form.invalid" on a half-typed URL', async () => {
    form.controls['chat_webhook_url'].setValue('https://not-a-valid-slack-url');
    form.controls['chat_webhook_url'].markAsDirty();
    fixture.componentRef.setInput('slackWebhookInputVisible', true);
    await fixture.whenStable();
    // The claim this test is actually pinning: a half-typed URL genuinely wedges the form via
    // the real Validators.pattern, not just a same-named control with no validator attached.
    expect(form.invalid).toBe(true);

    const emitted: void[] = [];
    fixture.componentInstance.cancelEditingSlackWebhookUrl.subscribe(() => emitted.push(undefined));

    button('settings-slack-webhook-cancel-button').click();

    expect(form.controls['chat_webhook_url'].value).toBeNull();
    expect(form.controls['chat_webhook_url'].pristine).toBe(true);
    expect(form.valid).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it('disables Cancel (like Remove and Replace) when the form is disabled — read-only Auditor access must not leave one live control in an otherwise disabled card', async () => {
    fixture.componentRef.setInput('slackWebhookInputVisible', true);
    form.disable();
    await fixture.whenStable();

    const cancelButton = button('settings-slack-webhook-cancel-button');
    expect(cancelButton.disabled).toBe(true);

    const emitted: void[] = [];
    fixture.componentInstance.cancelEditingSlackWebhookUrl.subscribe(() => emitted.push(undefined));
    cancelButton.click();
    await fixture.whenStable();

    expect(emitted).toHaveLength(0);
  });

  it('does not render the Slack webhook card at all when showSlackWebhook is false (e.g. the create/edit wizard, whose form has no chat_webhook_url control)', async () => {
    fixture.componentRef.setInput('showSlackWebhook', false);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="settings-slack-webhook-card"]')).toBeNull();
  });
});
