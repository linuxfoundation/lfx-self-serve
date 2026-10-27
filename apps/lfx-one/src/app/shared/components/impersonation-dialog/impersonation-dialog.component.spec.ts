// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  IMPERSONATION_SEARCH_NO_ACCOUNT_MESSAGE,
  IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
  IMPERSONATION_USER_NOT_FOUND_MESSAGE,
} from '@lfx-one/shared/constants';
import { UserSearchOption } from '@lfx-one/shared/interfaces';
import { ImpersonationService } from '@services/impersonation.service';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserSearchComponent } from '@components/user-search/user-search.component';

import { ImpersonationDialogComponent } from './impersonation-dialog.component';

describe('ImpersonationDialogComponent', () => {
  let fixture: ComponentFixture<ImpersonationDialogComponent>;
  let startImpersonation: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    startImpersonation = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ImpersonationDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { closable: true } },
        {
          provide: ImpersonationService,
          useValue: {
            startImpersonation,
            getRecentImpersonations: () => [],
            addRecentImpersonation: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImpersonationDialogComponent);
    await fixture.whenStable();
  });

  async function submitAs(target: string, httpError: { error?: { error?: string; code?: string } }): Promise<void> {
    startImpersonation.mockReturnValueOnce(throwError(() => httpError));
    const component = fixture.componentInstance as unknown as {
      targetUserForm: { controls: { targetUser: { setValue: (value: string) => void } } };
      submit: () => void;
    };
    component.targetUserForm.controls.targetUser.setValue(target);
    component.submit();
    await fixture.whenStable();
  }

  it('shows the locate copy for TARGET_USER_NOT_FOUND instead of the raw token-exchange 400', async () => {
    await submitAs('HWilson', {
      error: {
        code: IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
        error: 'token exchange request failed: upstream returned status 400',
      },
    });

    const alert = fixture.nativeElement.querySelector('[data-testid="impersonation-error"]');
    expect(alert?.textContent).toContain(IMPERSONATION_USER_NOT_FOUND_MESSAGE);
    expect(alert?.textContent).not.toContain('token exchange request failed');
    expect(alert?.textContent).not.toContain('upstream returned status 400');
  });

  it('shows a generic fallback for other failures instead of upstream text', async () => {
    await submitAs('jdoe', {
      error: {
        code: 'CTE_NATS_ERROR',
        error: 'Impersonation token exchange failed: TIMEOUT',
      },
    });

    const alert = fixture.nativeElement.querySelector('[data-testid="impersonation-error"]');
    expect(alert?.textContent).toContain('We could not start impersonation. Please try again.');
    expect(alert?.textContent).not.toContain('TIMEOUT');
  });

  it('keeps a live status region mounted and fills it only while loading', async () => {
    const status = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="impersonation-loading-status"]');
    expect(status()).not.toBeNull();
    expect(status()?.textContent?.trim()).toBe('');

    startImpersonation.mockReturnValueOnce(NEVER);
    const component = fixture.componentInstance as unknown as {
      targetUserForm: { controls: { targetUser: { setValue: (value: string) => void } } };
      submit: () => void;
    };
    component.targetUserForm.controls.targetUser.setValue('jdoe');
    component.submit();
    await fixture.whenStable();

    expect(status()?.textContent).toContain('Starting impersonation...');
  });

  it('does not let the dialog be dismissed while the request is pending', async () => {
    const config = TestBed.inject(DynamicDialogConfig);
    expect(config.closable).toBe(true);

    startImpersonation.mockReturnValueOnce(NEVER);
    const component = fixture.componentInstance as unknown as {
      targetUserForm: { controls: { targetUser: { setValue: (value: string) => void } } };
      submit: () => void;
    };
    component.targetUserForm.controls.targetUser.setValue('jdoe');
    component.submit();
    await fixture.whenStable();

    expect(config.closable).toBe(false);
  });

  it('renders the name search ahead of the exact email or username field', () => {
    const search = fixture.nativeElement.querySelector('lfx-user-search');
    expect(search).not.toBeNull();
    expect(search.querySelector('input')?.getAttribute('placeholder')).toBe('e.g. John Doe');
    expect(fixture.nativeElement.querySelector('[data-test="impersonation-target-input"]')).not.toBeNull();
  });

  // The pick and clear tests below drive the real lfx-user-search child, so they fail if the
  // template's bindings to it (form, outputs) are renamed or disconnected.
  function dialog() {
    return fixture.componentInstance as unknown as {
      targetUserForm: { controls: { targetUser: { value: string; setValue: (value: string) => void } } };
      submit: () => void;
    };
  }

  function nameSearch(): UserSearchComponent {
    return fixture.debugElement.query(By.directive(UserSearchComponent)).componentInstance as UserSearchComponent;
  }

  function pick(overrides: Partial<UserSearchOption>): void {
    const user: UserSearchOption = {
      uid: 'uid-1',
      email: 'jane.doe@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      job_title: null,
      organization: null,
      type: 'committee_member',
      username: null,
      ...overrides,
    };
    nameSearch().onUserSelected({ value: user } as unknown as AutoCompleteSelectEvent);
  }

  function searchBoxValue(): string {
    return (fixture.nativeElement.querySelector('lfx-user-search input') as HTMLInputElement).value;
  }

  it('keeps the picked person’s name in the search box', async () => {
    pick({ username: 'jdoe' });
    await fixture.whenStable();

    expect(searchBoxValue()).toBe('Jane Doe');
    expect(dialog().targetUserForm.controls.targetUser.value).toBe('jdoe');
  });

  it('falls back to the username when the picked person has no name', async () => {
    pick({ username: 'jdoe', first_name: '', last_name: '' });
    await fixture.whenStable();

    expect(searchBoxValue()).toBe('jdoe');
  });

  it('drops the shown name once the target is edited to someone else', async () => {
    pick({ username: 'jdoe' });
    await fixture.whenStable();

    dialog().targetUserForm.controls.targetUser.setValue('asmith');
    await fixture.whenStable();

    expect(searchBoxValue()).toBe('');
    expect(dialog().targetUserForm.controls.targetUser.value).toBe('asmith');
  });

  it('puts the picked person’s username in the target and submits it', async () => {
    pick({ username: 'jdoe' });
    await fixture.whenStable();
    expect(dialog().targetUserForm.controls.targetUser.value).toBe('jdoe');

    startImpersonation.mockReturnValueOnce(throwError(() => ({ error: { code: 'CTE_NATS_ERROR' } })));
    dialog().submit();
    expect(startImpersonation).toHaveBeenCalledWith('jdoe', null, false);
  });

  it('rejects a pick with no LF account without filling the target', async () => {
    pick({ username: null });
    await fixture.whenStable();

    const alert = fixture.nativeElement.querySelector('[data-testid="impersonation-error"]');
    expect(alert?.textContent).toContain(IMPERSONATION_SEARCH_NO_ACCOUNT_MESSAGE);
    expect(dialog().targetUserForm.controls.targetUser.value).toBe('');
  });

  it('clears an earlier target and its shown name when a later pick is rejected', async () => {
    pick({ username: 'jdoe' });
    await fixture.whenStable();
    expect(dialog().targetUserForm.controls.targetUser.value).toBe('jdoe');

    pick({ username: null, first_name: 'Sam', last_name: 'Roe' });
    await fixture.whenStable();

    expect(dialog().targetUserForm.controls.targetUser.value).toBe('');
    expect(searchBoxValue()).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="impersonation-error"]')?.textContent).toContain(IMPERSONATION_SEARCH_NO_ACCOUNT_MESSAGE);

    // Start can no longer act on the earlier person while the rejection is showing.
    dialog().submit();
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it('clears a previous rejection when a valid person is picked', async () => {
    pick({ username: null });
    await fixture.whenStable();
    pick({ username: 'jdoe' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="impersonation-error"]')).toBeNull();
  });

  it('keeps the target when the name search is cleared, and empties the shown name', async () => {
    pick({ username: 'jdoe' });
    nameSearch().onSearchClear();
    await fixture.whenStable();

    expect(dialog().targetUserForm.controls.targetUser.value).toBe('jdoe');
    expect(searchBoxValue()).toBe('');
  });

  it('does not throw or request impersonation when the search is cleared with no target', async () => {
    nameSearch().onSearchClear();
    await fixture.whenStable();

    expect(dialog().targetUserForm.controls.targetUser.value).toBe('');
    expect(() => dialog().submit()).not.toThrow();
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it('searches the directory as the target when starting from the navbar', () => {
    expect(nameSearch().asImpersonator()).toBe(false);
  });

  describe('when opened from the banner to switch users', () => {
    it('searches the directory as the admin and starts the change as a switch', async () => {
      TestBed.resetTestingModule();
      startImpersonation = vi.fn().mockReturnValue(NEVER);
      await TestBed.configureTestingModule({
        imports: [ImpersonationDialogComponent],
        providers: [
          provideNoopAnimations(),
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
          { provide: DynamicDialogConfig, useValue: { closable: true, data: { switching: true } } },
          { provide: ImpersonationService, useValue: { startImpersonation, getRecentImpersonations: () => [], addRecentImpersonation: vi.fn() } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(ImpersonationDialogComponent);
      await fixture.whenStable();

      expect(nameSearch().asImpersonator()).toBe(true);

      dialog().targetUserForm.controls.targetUser.setValue('jdoe');
      dialog().submit();
      expect(startImpersonation).toHaveBeenCalledWith('jdoe', null, true);
    });
  });
});
