// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ClaManager, ClaManagerRequestMode, ContactClaManagerDialogData, MyClaAgreement } from '@lfx-one/shared/interfaces';
import { MyClasService } from '@services/my-clas.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountClaRequestDialogComponent } from './account-cla-request-dialog.component';

const JANE: ClaManager = { lfUsername: 'jdoe', name: 'Jane Doe' };
const ALEX: ClaManager = { lfUsername: 'akim', name: 'Alex Kim' };
const CCLA: MyClaAgreement = {
  id: 'sig-1',
  kind: 'ECLA',
  claGroupName: 'Project One',
  projectName: 'Project One',
  companyName: 'Acme Motors',
  signedOn: '2022-01-01T18:40:42Z',
  status: 'needs_attention',
  statusReason: 'not_on_approval_list',
  pdfAvailable: false,
};

describe('AccountClaRequestDialogComponent', () => {
  async function render(mode: ClaManagerRequestMode, agreement: MyClaAgreement = CCLA) {
    const close = vi.fn();
    const createClaManagerRequest = vi.fn(() =>
      of({ requestId: 'r-1', signatureId: agreement.id, requestType: mode, status: 'sent', recipients: [JANE.lfUsername] })
    );
    const legacy: ContactClaManagerDialogData = { signatureId: agreement.id, projectName: 'Project One', mode };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: DIALOG_DATA, useValue: { agreement, mode } },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: legacy } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: MyClasService,
          useValue: { getClaManagers: () => of({ signatureId: agreement.id, managers: [JANE, ALEX], resultCount: 2 }), createClaManagerRequest },
        },
      ],
    });
    const fixture = TestBed.createComponent(AccountClaRequestDialogComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    return { fixture, host, query, close, createClaManagerRequest };
  }

  it('asks for approval in the design’s words, naming the company and project', async () => {
    const { host, query } = await render('approval');

    expect(host.querySelector('[data-testid="ui-modal-title"]')?.textContent).toContain('Request CCLA approval');
    expect(query('account-cla-request-text')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'We’ll ask the CLA managers at Acme Motors to add you to the Project One Corporate CLA approval list.'
    );
    expect(query('account-cla-request-message')?.textContent).toContain('Message (optional)');
  });

  it('asks for removal in the design’s words', async () => {
    const { host, query } = await render('removal');

    expect(host.querySelector('[data-testid="ui-modal-title"]')?.textContent).toContain('Request removal from CCLA');
    expect(query('account-cla-request-text')?.textContent?.replace(/\s+/g, ' ')).toContain('to remove you from the Project One Corporate CLA approval list.');
  });

  it('names the managers without a company when the agreement has none', async () => {
    const { query } = await render('approval', { ...CCLA, companyName: undefined });

    expect(query('account-cla-request-text')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'We’ll ask the CLA managers to add you to the Project One Corporate CLA approval list.'
    );
  });

  it('announces a message error', async () => {
    const { fixture, query } = await render('contact');
    const textarea = query('account-cla-request-message')?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input'));
    textarea.value = '';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(query('account-cla-request-message-alert')?.textContent?.trim()).toBe('A message is required.');
  });

  it('sends the request to the chosen managers and closes', async () => {
    const { query, close, createClaManagerRequest } = await render('approval');
    expect(query('account-cla-request-manager-jdoe')).not.toBeNull();

    query('account-cla-request-send')?.querySelector('button')?.click();

    expect(createClaManagerRequest).toHaveBeenCalledWith('sig-1', { requestType: 'approval', recipients: ['jdoe', 'akim'] });
    expect(close).toHaveBeenCalled();
  });

  it('links to the CCLA console only for a CLA manager of the agreement', async () => {
    const plain = await render('removal');
    expect(plain.query('account-cla-request-console')).toBeNull();

    TestBed.resetTestingModule();
    const manager = await render('removal', { ...CCLA, claManager: true, claGroupId: 'cg-1' });
    expect(manager.query('account-cla-request-console')?.getAttribute('href')).toBeTruthy();
  });
});
