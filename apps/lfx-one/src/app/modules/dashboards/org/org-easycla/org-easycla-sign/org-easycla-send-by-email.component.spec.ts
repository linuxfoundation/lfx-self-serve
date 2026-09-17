// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CCLA_SIGN_COPY, ORG_CLA_AUTHORITY_NAME_MAX_LENGTH, ORG_CLA_AUTHORITY_NAME_MIN_LENGTH } from '@lfx-one/shared/constants';
import type { OrgClaSendByEmailDialogData, OrgClaSignResponse } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaSendByEmailComponent } from './org-easycla-send-by-email.component';

describe('OrgEasyclaSendByEmailComponent', () => {
  const requestCorporateSignature = vi.fn();
  const close = vi.fn();
  let config: DynamicDialogConfig<OrgClaSendByEmailDialogData>;

  const data: OrgClaSendByEmailDialogData = {
    orgUid: '0014100000Te0xxAAC',
    projectSfid: 'a09410000182dD2AAI',
    claGroupId: 'd5d3f4f0-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    companyName: 'Acme Robotics',
  };

  async function render(overrides: Partial<OrgClaSendByEmailDialogData> = {}): Promise<ComponentFixture<OrgEasyclaSendByEmailComponent>> {
    config = { data: { ...data, ...overrides } };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaSendByEmailComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: config },
        { provide: OrgLensClaService, useValue: { requestCorporateSignature } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaSendByEmailComponent);
    fixture.detectChanges();
    return fixture;
  }

  function form(fixture: ComponentFixture<OrgEasyclaSendByEmailComponent>) {
    return (
      fixture.componentInstance as unknown as {
        form: { controls: Record<string, { setValue: (v: string) => void }> };
      }
    ).form;
  }

  function sendButton(fixture: ComponentFixture<OrgEasyclaSendByEmailComponent>): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-send"] button') as HTMLButtonElement;
  }

  beforeEach(() => {
    requestCorporateSignature.mockReset();
    close.mockReset();
  });

  it('names the company in the prototype body and does not show the attestation checkboxes', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain(CCLA_SIGN_COPY.sendByEmail.body('Acme Robotics'));
    expect(text).not.toContain(CCLA_SIGN_COPY.attestation.authorityLabel);
    expect(text).not.toContain(CCLA_SIGN_COPY.attestation.embargoLabel);
  });

  it('cannot send until both a name and an email address are given', async () => {
    const fixture = await render();

    expect(sendButton(fixture).disabled).toBe(true);

    form(fixture).controls['name'].setValue('Alex Contributor');
    fixture.detectChanges();
    expect(sendButton(fixture).disabled).toBe(true);

    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    expect(sendButton(fixture).disabled).toBe(false);
  });

  it('cannot send when the signatory name is longer than the shared cap', async () => {
    const fixture = await render();

    form(fixture).controls['name'].setValue('A'.repeat(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH + 1));
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    expect(sendButton(fixture).disabled).toBe(true);
  });

  /**
   * The producer declares `authority_name` `minLength: 2`. A single character reaches its
   * generated request validation, which answers a status the BFF does not relabel — so the POST
   * comes back as generic failure copy naming no field. Refusing at the control keeps the manager
   * in the form, where the mistake is visible.
   */
  it('cannot send a one-character signatory name, which the producer would refuse', async () => {
    const fixture = await render();

    form(fixture).controls['name'].setValue('A');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    expect(sendButton(fixture).disabled).toBe(true);

    form(fixture).controls['name'].setValue('Al');
    fixture.detectChanges();
    expect(sendButton(fixture).disabled).toBe(false);
  });

  it('does not let a trailing space buy the second character', async () => {
    const fixture = await render();

    form(fixture).controls['name'].setValue('A ');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    expect(sendButton(fixture).disabled).toBe(true);
  });

  /**
   * Send is disabled while either field fails, so the form cannot be submitted to collect the
   * browser's own validation. Without this text a value that looks finished and is not leaves the
   * button dead with no explanation on screen and nothing at all announced.
   */
  it('explains a name too short to send, and points the input at that explanation', async () => {
    const fixture = await render();

    form(fixture).controls['name'].setValue('A');
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-name-error"]');
    expect(error?.textContent).toContain(CCLA_SIGN_COPY.sendByEmail.nameError(ORG_CLA_AUTHORITY_NAME_MIN_LENGTH));

    // The text alone is not the fix. Without these two a screen-reader user reaches a field that
    // sounds valid and a Send button that never enables.
    const input = fixture.nativeElement.querySelector('#org-easycla-send-by-email-name');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe(error?.id);
  });

  it('explains a malformed address, and points that input at its own explanation', async () => {
    const fixture = await render();

    form(fixture).controls['email'].setValue('contributor@');
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-email-error"]');
    expect(error?.textContent).toContain(CCLA_SIGN_COPY.sendByEmail.emailError);

    const input = fixture.nativeElement.querySelector('#org-easycla-send-by-email-email');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe(error?.id);
  });

  /**
   * `name` and `email` would ask the browser for the person at the keyboard, and this form names
   * someone else. Accepting that autofill mails the CCLA to the requester rather than the
   * signatory, and the mailed lock then refuses a second attempt on that agreement.
   */
  it('does not offer the requester their own saved identity for the signatory', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('#org-easycla-send-by-email-name')?.getAttribute('autocomplete')).toBe('off');
    expect(fixture.nativeElement.querySelector('#org-easycla-send-by-email-email')?.getAttribute('autocomplete')).toBe('off');
  });

  /**
   * The producer counts runes, so `𠮷` is one character to it and two UTF-16 units here. Counting
   * units would enable Send and hand upstream a name it refuses.
   */
  it('cannot send a single non-BMP code point, which the producer counts as one character', async () => {
    const fixture = await render();

    form(fixture).controls['name'].setValue('𠮷');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();

    expect(sendButton(fixture).disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-name-error"]')).not.toBeNull();

    form(fixture).controls['name'].setValue('𠮷𠮷');
    fixture.detectChanges();
    expect(sendButton(fixture).disabled).toBe(false);
  });

  /**
   * The cap is the producer's, counted in code points. A native `maxlength` counts UTF-16 units
   * and would stop a non-BMP name at half of it — refusing, from the input itself, a length
   * `isSendableAuthorityName` and the producer both accept.
   */
  it('accepts a full-length non-BMP name, which a UTF-16 cap would have halved', async () => {
    const fixture = await render();
    const atTheCap = '𠮷'.repeat(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH);
    expect(atTheCap.length).toBe(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH * 2);

    form(fixture).controls['name'].setValue(atTheCap);
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-name-error"]')).toBeNull();
    expect(sendButton(fixture).disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('#org-easycla-send-by-email-name')?.getAttribute('maxlength')).toBeNull();
  });

  /**
   * Reachable precisely because nothing truncates the input now. Without its own message the
   * too-long case borrows the floor's text and tells the manager to enter *more* characters.
   */
  it('names the cap when the name is past it, rather than repeating the minimum', async () => {
    const fixture = await render();

    form(fixture).controls['name'].setValue('a'.repeat(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH + 1));
    fixture.detectChanges();

    const shown = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-name-error"]')?.textContent ?? '';
    expect(shown).toContain(CCLA_SIGN_COPY.sendByEmail.nameTooLongError(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH));
    expect(shown).not.toContain(CCLA_SIGN_COPY.sendByEmail.nameError(ORG_CLA_AUTHORITY_NAME_MIN_LENGTH));
    expect(sendButton(fixture).disabled).toBe(true);
  });

  /**
   * The dialog is capped at 90vw with 1.5rem of content padding either side, so a phone has under
   * 300px for Cancel plus a send label that is a full sentence. Without wrapping, the action that
   * leaves the viewport is the primary one.
   */
  it('lets the footer actions wrap rather than pushing Send off a narrow viewport', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-actions"]')?.className).toContain('flex-wrap');
  });

  it('says nothing about a field nobody has filled in yet', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-name-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-email-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('#org-easycla-send-by-email-name')?.getAttribute('aria-invalid')).toBeNull();
  });

  /**
   * Required in Angular alone is invisible. Both controls are mandatory and an empty one shows no
   * error by design, so without this a screen-reader user who filled in one field has nothing
   * saying the other is needed — only a Send button that never enables.
   */
  it('announces both fields as required, which an empty-field silence otherwise hides', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('#org-easycla-send-by-email-name')?.getAttribute('aria-required')).toBe('true');
    expect(fixture.nativeElement.querySelector('#org-easycla-send-by-email-email')?.getAttribute('aria-required')).toBe('true');
  });

  it('withdraws the explanation once the field is sendable', async () => {
    const fixture = await render();

    form(fixture).controls['name'].setValue('A');
    form(fixture).controls['email'].setValue('contributor@');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-name-error"]')).not.toBeNull();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-name-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-email-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('#org-easycla-send-by-email-name')?.getAttribute('aria-describedby')).toBeNull();
  });

  /**
   * The producer's own email pattern caps the TLD at ten letters and leaves `'` out of the local
   * part. Mirroring it here would refuse a valid address as a Self Serve validation error for a
   * constraint that belongs upstream, so the shape check stays looser on purpose.
   */
  it('sends addresses the producer pattern would refuse, rather than owning that constraint', async () => {
    const fixture = await render();

    for (const email of ["o'brien@example.org", 'signatory@example.international']) {
      form(fixture).controls['name'].setValue('Alex Contributor');
      form(fixture).controls['email'].setValue(email);
      fixture.detectChanges();
      expect(sendButton(fixture).disabled, email).toBe(false);
    }
  });

  it('posts sendAsEmail with the named signatory and never the two attestations', async () => {
    requestCorporateSignature.mockReturnValue(of({ signUrl: '', signatureId: '' } satisfies OrgClaSignResponse));
    const fixture = await render();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();

    expect(requestCorporateSignature).toHaveBeenCalledWith(data.orgUid, {
      projectSfid: data.projectSfid,
      claGroupId: data.claGroupId,
      sendAsEmail: true,
      authorityName: 'Alex Contributor',
      authorityEmail: 'contributor@example.org',
    });
    expect(requestCorporateSignature).toHaveBeenCalledTimes(1);
    const sent = requestCorporateSignature.mock.calls[0][1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('authorityAcked');
    expect(sent).not.toHaveProperty('embargoAcked');
  });

  it('tells the opener the request has started so a context change cannot close it', async () => {
    const onRequestStarted = vi.fn();
    requestCorporateSignature.mockReturnValue(NEVER);
    const fixture = await render({ onRequestStarted });

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();

    expect(onRequestStarted).toHaveBeenCalledTimes(1);
  });

  it('tells the opener the mail was sent so Close cannot start a second copy', async () => {
    const onMailed = vi.fn();
    requestCorporateSignature.mockReturnValue(of({ signUrl: '', signatureId: 'sig-1' } satisfies OrgClaSignResponse));
    const fixture = await render({ onMailed });

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    expect(onMailed).toHaveBeenCalledTimes(1);
  });

  it('does not tell the opener the mail was sent when the request failed', async () => {
    const onMailed = vi.fn();
    requestCorporateSignature.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: {} })));
    const fixture = await render({ onMailed });

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    expect(onMailed).not.toHaveBeenCalled();
  });

  it('stays in Org Lens and names the address when the mail is sent, even if a signing URL came back', async () => {
    requestCorporateSignature.mockReturnValue(
      of({ signUrl: 'https://demo.docusign.net/Signing/StartInSession.aspx?t=abc123', signatureId: 'sig-1' } satisfies OrgClaSignResponse)
    );
    const fixture = await render();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(CCLA_SIGN_COPY.sendByEmail.successBody('contributor@example.org'));
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-sent"]')).not.toBeNull();
  });

  it('shows a refusal the CLA service explained, including a 400', async () => {
    const refusal = 'A name and email address are required';
    requestCorporateSignature.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: refusal, code: 'VALIDATION_ERROR' } })));
    const fixture = await render();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-failure-message"]')?.textContent).toContain(refusal);
  });

  /**
   * A 400 is not proof the BFF wrote the message. `gatewayFetch` rethrows a non-OK upstream
   * response under the upstream's own status with a message composed from the wire, and the 403-
   * only relabelling does not touch it — so keying on the status alone put
   * `…: 400 Bad Request` on screen. The producer's `authority_email` pattern refuses addresses
   * this dialog allows on purpose, which is what makes the path reachable rather than theoretical.
   */
  it('does not show an upstream 400 that carries no BFF validation code', async () => {
    const technical = 'Failed to request the corporate CLA signature: 400 Bad Request';
    requestCorporateSignature.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: technical, code: 'UPSTREAM_ERROR' } })));
    const fixture = await render();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue("o'brien@example.org");
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    const shown = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-failure-message"]')?.textContent ?? '';
    expect(shown).toContain(CCLA_SIGN_COPY.sendByEmail.failureBody);
    expect(shown).not.toContain('400 Bad Request');
  });

  it("shows a 403 refusal in the CLA service's own words", async () => {
    const refusal = 'This organization requires additional trade compliance review.';
    requestCorporateSignature.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { error: refusal, code: 'FORBIDDEN' } })));
    const fixture = await render();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-failure-message"]')?.textContent).toContain(refusal);
  });

  it('uses send-by-email failure copy, not the self-sign prepare sentence, when the service did not explain', async () => {
    requestCorporateSignature.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: {} })));
    const fixture = await render();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    const shown = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-failure-message"]')?.textContent ?? '';
    expect(shown).toContain(CCLA_SIGN_COPY.sendByEmail.failureBody);
    expect(shown).not.toContain(CCLA_SIGN_COPY.failure.body);
  });

  it('does not put a 5xx BFF sentence on screen', async () => {
    const leaked = 'Failed to request the corporate CLA signature: 500 Internal Server Error';
    requestCorporateSignature.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: leaked, code: 'UPSTREAM_ERROR' } })));
    const fixture = await render();

    form(fixture).controls['name'].setValue('Alex Contributor');
    form(fixture).controls['email'].setValue('contributor@example.org');
    fixture.detectChanges();
    sendButton(fixture).click();
    fixture.detectChanges();

    const shown = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-failure-message"]')?.textContent ?? '';
    expect(shown).toContain(CCLA_SIGN_COPY.sendByEmail.failureBody);
    expect(shown).not.toContain(leaked);
  });

  it('wraps the dialog in a polite live region', async () => {
    const fixture = await render();
    const dialog = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-dialog"]') as HTMLElement;

    expect(dialog.getAttribute('role')).toBe('status');
    expect(dialog.getAttribute('aria-live')).toBe('polite');
  });
});
