// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_CLA_MANAGER_REFUSAL_COPY, ORG_CLA_MANAGER_REMOVE_COPY } from '@lfx-one/shared/constants';
import type { OrgClaManager } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { UserService } from '@services/user.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import type { MockInstance } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaManagersComponent } from './org-easycla-managers.component';

describe('OrgEasyclaManagersComponent', () => {
  const ORG_UID = '0014100000Te2ovAAB';
  const SIGNATURE_ID = 'signature-uuid-1';

  const getManagers = vi.fn();
  const addManager = vi.fn();
  const removeManager = vi.fn();
  const addMessage = vi.fn();
  const openDialog = vi.fn();
  const viewerUsername = signal<string | null>('aporter');

  // The real service, spied on rather than stubbed: `p-confirmdialog` in the template subscribes
  // to its `requireConfirmation$`, which a bare object does not have.
  let confirmationService: ConfirmationService;
  let confirm: MockInstance<(confirmation: Confirmation) => ConfirmationService>;

  function manager(overrides: Partial<OrgClaManager> = {}): OrgClaManager {
    return { lfUsername: 'kmensah', name: 'Kwame Mensah', email: 'kwame.mensah@example.org', addedOn: '2024-05-02T11:00:00Z', ...overrides };
  }

  let fixture: ComponentFixture<OrgEasyclaManagersComponent>;
  let component: OrgEasyclaManagersComponent;

  async function render(signed = true): Promise<void> {
    fixture = TestBed.createComponent(OrgEasyclaManagersComponent);
    fixture.componentRef.setInput('orgUid', ORG_UID);
    fixture.componentRef.setInput('signatureId', SIGNATURE_ID);
    fixture.componentRef.setInput('signed', signed);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function acceptConfirmation(): void {
    confirm.mock.calls.at(-1)?.[0]?.accept?.();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    viewerUsername.set('aporter');
    confirmationService = new ConfirmationService();
    confirm = vi.spyOn(confirmationService, 'confirm');
    getManagers.mockReturnValue(of({ signatureId: SIGNATURE_ID, managers: [manager(), manager({ lfUsername: 'aporter', name: 'Ada Porter' })] }));
    addManager.mockReturnValue(of(manager()));
    removeManager.mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [OrgEasyclaManagersComponent],
      providers: [provideNoopAnimations(), { provide: MessageService, useValue: { add: addMessage } }],
    })
      .overrideComponent(OrgEasyclaManagersComponent, {
        set: {
          providers: [
            { provide: OrgLensClaService, useValue: { getManagers, addManager, removeManager } },
            { provide: UserService, useValue: { viewerUsername } },
            { provide: DialogService, useValue: { open: openDialog } },
            { provide: ConfirmationService, useValue: confirmationService },
          ],
        },
      })
      .compileComponents();
  });

  it('fetches nothing until the tab is opened', async () => {
    await render();

    expect(getManagers).not.toHaveBeenCalled();
  });

  it('fetches once the tab is opened, and not again on re-opening it', async () => {
    await render();

    component.loadIfNeeded();
    component.loadIfNeeded();
    await fixture.whenStable();

    expect(getManagers).toHaveBeenCalledTimes(1);
  });

  it('fetches nothing for an unsigned agreement, which has no managers and no add control', async () => {
    await render(false);

    component.loadIfNeeded();

    expect(getManagers).not.toHaveBeenCalled();
  });

  it('reports the roster length so the tab badge follows the list', async () => {
    const counts: number[] = [];
    await render();
    component.managerCountChanged.subscribe((count) => counts.push(count));

    component.loadIfNeeded();
    await fixture.whenStable();

    expect(counts).toEqual([2]);
  });

  it('renders the added date the way the rest of the agreement screen does, not as a raw instant', async () => {
    await render();

    component.loadIfNeeded();
    await fixture.whenStable();
    fixture.detectChanges();

    const added = fixture.nativeElement.querySelector('[data-testid="org-easycla-managers-added"]').textContent as string;
    expect(added).not.toContain('2024-05-02T11:00:00Z');
    expect(added).toContain('May 2, 2024');
  });

  it('renders an em dash for a manager upstream recorded no added date for', async () => {
    getManagers.mockReturnValue(of({ signatureId: SIGNATURE_ID, managers: [manager({ addedOn: undefined })] }));
    await render();

    component.loadIfNeeded();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-managers-added"]').textContent).toContain('—');
  });

  it('renders a load failure as a failure, never as an empty roster', async () => {
    getManagers.mockReturnValue(throwError(() => new Error('upstream down')));
    await render();

    component.loadIfNeeded();
    await fixture.whenStable();
    fixture.detectChanges();

    const html = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-managers-error"]')).toBeTruthy();
    expect(html).not.toContain('no CLA Managers yet');
  });

  it('retries a failed load', async () => {
    getManagers.mockReturnValueOnce(throwError(() => new Error('upstream down')));
    await render();
    component.loadIfNeeded();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid="org-easycla-managers-retry"] button').click();
    await fixture.whenStable();

    expect(getManagers).toHaveBeenCalledTimes(2);
  });

  it('drops a response that arrives after the viewer has moved to another agreement', async () => {
    const late = new Subject<{ signatureId: string; managers: OrgClaManager[] }>();
    const pending = new Subject<{ signatureId: string; managers: OrgClaManager[] }>();
    getManagers.mockReturnValueOnce(late).mockReturnValueOnce(pending);
    await render();
    component.loadIfNeeded();

    fixture.componentRef.setInput('signatureId', 'signature-a-different-agreement');
    fixture.detectChanges();
    await fixture.whenStable();

    late.next({ signatureId: SIGNATURE_ID, managers: [manager()] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-managers-table"]')).toBeFalsy();
  });

  it('re-fetches when the agreement changes with the tab already open', async () => {
    await render();
    component.loadIfNeeded();
    await fixture.whenStable();

    fixture.componentRef.setInput('signatureId', 'signature-uuid-2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getManagers).toHaveBeenCalledTimes(2);
    expect(getManagers).toHaveBeenLastCalledWith(ORG_UID, 'signature-uuid-2');
  });

  it('re-fetches when the organization changes for a same-id agreement', async () => {
    await render();
    component.loadIfNeeded();
    await fixture.whenStable();

    fixture.componentRef.setInput('orgUid', '0014100000Te2owAAB');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getManagers).toHaveBeenCalledTimes(2);
    expect(getManagers).toHaveBeenLastCalledWith('0014100000Te2owAAB', SIGNATURE_ID);
  });

  describe('removal', () => {
    it('uses second-person copy when the viewer is removing themselves', async () => {
      await render();
      component.loadIfNeeded();
      await fixture.whenStable();

      component['confirmRemove'](manager({ lfUsername: 'aporter', name: 'Ada Porter' }));

      expect(confirm.mock.calls.at(-1)?.[0].message).toBe(ORG_CLA_MANAGER_REMOVE_COPY.self);
    });

    it('names the other person when the viewer is removing somebody else', async () => {
      await render();
      component.loadIfNeeded();
      await fixture.whenStable();

      component['confirmRemove'](manager());

      expect(confirm.mock.calls.at(-1)?.[0].message).toBe(ORG_CLA_MANAGER_REMOVE_COPY.other('Kwame Mensah'));
    });

    it('makes the sole manager inoperable and says why, rather than hiding the control', async () => {
      getManagers.mockReturnValue(of({ signatureId: SIGNATURE_ID, managers: [manager()] }));
      await render();
      component.loadIfNeeded();
      await fixture.whenStable();
      fixture.detectChanges();

      const blocked = fixture.nativeElement.querySelector('[data-testid="org-easycla-managers-remove-blocked"]');
      expect(blocked).toBeTruthy();
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-managers-remove"]')).toBeFalsy();
    });

    it('re-reads the roster after a removal rather than splicing the row out', async () => {
      await render();
      component.loadIfNeeded();
      await fixture.whenStable();

      component['confirmRemove'](manager());
      acceptConfirmation();
      await fixture.whenStable();

      expect(removeManager).toHaveBeenCalledWith(ORG_UID, SIGNATURE_ID, 'kmensah');
      expect(getManagers).toHaveBeenCalledTimes(2);
    });
  });

  describe('refusals', () => {
    it.each([['no-lf-login'], ['not-authorized'], ['last-manager'], ['already-manager']] as const)(
      "renders this application's own copy for %s",
      async (refusal) => {
        addManager.mockReturnValue(throwError(() => ({ error: { upstreamCode: refusal } })));
        await render();
        component.loadIfNeeded();
        await fixture.whenStable();

        component['addManager']({ firstName: 'Ada', lastName: 'Porter', email: 'ada.porter@example.org' });
        await fixture.whenStable();

        expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: ORG_CLA_MANAGER_REFUSAL_COPY[refusal] }));
      }
    );

    it('falls back to the generic outcome for a classification it does not recognise', async () => {
      addManager.mockReturnValue(throwError(() => ({ error: { upstreamCode: 'something-new' } })));
      await render();

      component['addManager']({ firstName: 'Ada', lastName: 'Porter', email: 'ada.porter@example.org' });
      await fixture.whenStable();

      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ detail: ORG_CLA_MANAGER_REFUSAL_COPY.unknown }));
    });

    it('leaves the roster untouched when a write is refused', async () => {
      await render();
      component.loadIfNeeded();
      await fixture.whenStable();
      getManagers.mockClear();

      removeManager.mockReturnValue(throwError(() => ({ error: { upstreamCode: 'last-manager' } })));
      component['confirmRemove'](manager());
      acceptConfirmation();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getManagers).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelectorAll('[data-testid="org-easycla-managers-row"]')).toHaveLength(2);
    });
  });
});
