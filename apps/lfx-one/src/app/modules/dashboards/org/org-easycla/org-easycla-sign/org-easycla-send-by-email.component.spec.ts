// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CCLA_SIGN_COPY, ORG_CLA_AUTHORITY_NAME_MAX_LENGTH } from '@lfx-one/shared/constants';
import type { OrgClaSendByEmailDialogData, OrgClaSignResponse } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
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

  async function render(): Promise<ComponentFixture<OrgEasyclaSendByEmailComponent>> {
    config = { data };
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
    const sent = requestCorporateSignature.mock.calls[0][1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('authorityAcked');
    expect(sent).not.toHaveProperty('embargoAcked');
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

  it('wraps the dialog in a polite live region', async () => {
    const fixture = await render();
    const dialog = fixture.nativeElement.querySelector('[data-testid="org-easycla-send-by-email-dialog"]') as HTMLElement;

    expect(dialog.getAttribute('role')).toBe('status');
    expect(dialog.getAttribute('aria-live')).toBe('polite');
  });
});
