// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { ClaManager, ClaManagerList, ClaManagerRequestMode, ClaManagerRequestResult } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyClasService } from '@services/my-clas.service';

import { ContactClaManagerComponent, type ContactClaManagerDialogData } from './contact-cla-manager.component';

const SIG = '3fee6d72-0c80-4145-99c2-fb382b3a93fb';
const JANE: ClaManager = { lfUsername: 'jdoe', name: 'Jane Doe' };
const ALEX: ClaManager = { lfUsername: 'akim', name: 'Alex Kim' };

describe('ContactClaManagerComponent', () => {
  let fixture: ComponentFixture<ContactClaManagerComponent>;
  let close: ReturnType<typeof vi.fn>;
  let getClaManagers: ReturnType<typeof vi.fn>;
  let createClaManagerRequest: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  async function setup(
    mode: ClaManagerRequestMode,
    list: ClaManagerList | 'error' = { signatureId: SIG, managers: [JANE, ALEX], resultCount: 2 }
  ): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();
    add = vi.fn();
    getClaManagers = vi.fn(() => (list === 'error' ? throwError(() => new Error('boom')) : of(list)));
    createClaManagerRequest = vi.fn(() =>
      of<ClaManagerRequestResult>({
        requestId: 'r-1',
        signatureId: SIG,
        requestType: mode === 'contact' ? 'approval' : mode,
        status: 'sent',
        recipients: [JANE.lfUsername],
      })
    );

    const data: ContactClaManagerDialogData = { signatureId: SIG, projectName: 'CNCF', mode };

    TestBed.configureTestingModule({
      imports: [ContactClaManagerComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: MessageService, useValue: { add } },
        { provide: MyClasService, useValue: { getClaManagers, createClaManagerRequest } },
      ],
    });

    fixture = TestBed.createComponent(ContactClaManagerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function send(): void {
    (fixture.componentInstance as unknown as { onSend: () => void }).onSend();
  }

  function uncheck(lfUsername: string): void {
    (fixture.componentInstance as unknown as { toggleManager: (id: string, event: Event) => void }).toggleManager(lfUsername, {
      target: { checked: false },
    } as unknown as Event);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await setup('approval');
  });

  it('shows v17 approval copy naming the project', () => {
    expect(query('contact-cla-manager-hint')?.textContent).toContain('re-approve your ECLA for CNCF');
  });

  it('checks every manager by default', () => {
    expect(query('contact-cla-manager-jdoe')).not.toBeNull();
    expect((query('contact-cla-manager-jdoe') as HTMLInputElement).checked).toBe(true);
    expect((query('contact-cla-manager-akim') as HTMLInputElement).checked).toBe(true);
  });

  it('posts approval for the checked LF usernames on Send', async () => {
    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createClaManagerRequest).toHaveBeenCalledWith(SIG, {
      requestType: 'approval',
      recipients: expect.arrayContaining(['jdoe', 'akim']),
    });
    expect(close).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Request sent' }));
  });

  it('disables Send when no manager is checked', async () => {
    uncheck('jdoe');
    uncheck('akim');

    send();
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('posts only the remaining checked manager after one is unchecked', async () => {
    uncheck('akim');
    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createClaManagerRequest).toHaveBeenCalledWith(SIG, {
      requestType: 'approval',
      recipients: ['jdoe'],
    });
  });

  it('posts removal when opened in removal mode', async () => {
    await setup('removal');
    expect(query('contact-cla-manager-hint')?.textContent).toContain('invalidate it on your behalf');

    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createClaManagerRequest).toHaveBeenCalledWith(SIG, expect.objectContaining({ requestType: 'removal' }));
  });

  it('does not POST on contact Send', async () => {
    await setup('contact');
    expect(query('contact-cla-manager-hint')?.textContent).toContain('Send a message to the CLA manager(s) for CNCF');

    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createClaManagerRequest).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(null);
    expect(add).not.toHaveBeenCalled();
  });

  it('shows support copy and no Send when no managers resolve', async () => {
    await setup('removal', { signatureId: SIG, managers: [], resultCount: 0 });

    expect(query('contact-cla-manager-empty')?.textContent).toContain('No CLA manager is currently reachable');
    expect(query('contact-cla-manager-send')).toBeNull();
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('hides Send when the manager list fails to load', async () => {
    await setup('approval', 'error');

    expect(query('contact-cla-manager-send')).toBeNull();
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });
});
