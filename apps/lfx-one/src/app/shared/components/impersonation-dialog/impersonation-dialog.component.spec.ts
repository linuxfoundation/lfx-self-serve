// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { IMPERSONATION_TARGET_USER_NOT_FOUND_CODE, IMPERSONATION_USER_NOT_FOUND_MESSAGE } from '@lfx-one/shared/constants';
import { ImpersonationSuggestion, RecentImpersonation, UserSearchResult } from '@lfx-one/shared/interfaces';
import { ImpersonationService } from '@services/impersonation.service';
import { SearchService } from '@services/search.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImpersonationDialogComponent } from './impersonation-dialog.component';

interface DialogHarness {
  targetUserForm: { controls: { targetUser: { value: string; setValue: (value: unknown) => void } } };
  suggestions: () => ImpersonationSuggestion[];
  error: () => string;
  submit: () => void;
  onSearchComplete: (event: AutoCompleteCompleteEvent) => void;
  onSuggestionSelected: (event: AutoCompleteSelectEvent) => void;
}

function directoryRow(overrides: Partial<UserSearchResult>): UserSearchResult {
  return {
    uid: 'uid-1',
    email: 'jane.doe@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    job_title: null,
    organization: null,
    type: 'committee_member',
    username: 'jdoe',
    ...overrides,
  };
}

describe('ImpersonationDialogComponent', () => {
  let fixture: ComponentFixture<ImpersonationDialogComponent>;
  let startImpersonation: ReturnType<typeof vi.fn>;
  let searchUsers: ReturnType<typeof vi.fn>;
  let recents: RecentImpersonation[];

  async function createDialog(dialogData?: Record<string, unknown>): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ImpersonationDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { closable: true, data: dialogData } },
        { provide: SearchService, useValue: { searchUsers } },
        {
          provide: ImpersonationService,
          useValue: {
            startImpersonation,
            getRecentImpersonations: () => recents,
            addRecentImpersonation: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImpersonationDialogComponent);
    await fixture.whenStable();
  }

  function dialog(): DialogHarness {
    return fixture.componentInstance as unknown as DialogHarness;
  }

  beforeEach(async () => {
    startImpersonation = vi.fn();
    searchUsers = vi.fn().mockReturnValue(of([]));
    recents = [];
    await createDialog();
  });

  async function submitAs(target: string, httpError: { error?: { error?: string; code?: string } }): Promise<void> {
    startImpersonation.mockReturnValueOnce(throwError(() => httpError));
    dialog().targetUserForm.controls.targetUser.setValue(target);
    dialog().submit();
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
    dialog().targetUserForm.controls.targetUser.setValue('jdoe');
    dialog().submit();
    await fixture.whenStable();

    expect(status()?.textContent).toContain('Starting impersonation...');
  });

  it('does not let the dialog be dismissed while the request is pending', async () => {
    const config = TestBed.inject(DynamicDialogConfig);
    expect(config.closable).toBe(true);

    startImpersonation.mockReturnValueOnce(NEVER);
    dialog().targetUserForm.controls.targetUser.setValue('jdoe');
    dialog().submit();
    await fixture.whenStable();

    expect(config.closable).toBe(false);
  });

  describe('single search field', () => {
    it('renders one field for name, email, or username and no separate context selector', () => {
      expect(fixture.nativeElement.querySelectorAll('lfx-autocomplete')).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('[data-test="impersonation-persona-select"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('input')?.getAttribute('placeholder')).toBe('e.g. John Doe, jdoe, or jdoe@example.com');
    });

    it('submits what was typed when nothing is picked', () => {
      startImpersonation.mockReturnValueOnce(NEVER);
      dialog().targetUserForm.controls.targetUser.setValue('  jdoe@example.com ');
      dialog().submit();

      expect(startImpersonation).toHaveBeenCalledWith('jdoe@example.com', false);
    });

    it('does not request impersonation with an empty field', () => {
      dialog().submit();

      expect(startImpersonation).not.toHaveBeenCalled();
    });

    it('puts a picked person’s username in the field and submits it', () => {
      const entry: ImpersonationSuggestion = { targetUser: 'jdoe', username: 'jdoe', email: 'jane.doe@example.com', name: 'Jane Doe' };
      dialog().onSuggestionSelected({ value: entry } as unknown as AutoCompleteSelectEvent);
      expect(dialog().targetUserForm.controls.targetUser.value).toBe('jdoe');

      startImpersonation.mockReturnValueOnce(NEVER);
      dialog().submit();
      expect(startImpersonation).toHaveBeenCalledWith('jdoe', false);
    });

    it('clears an earlier error when a person is picked', async () => {
      await submitAs('ghost', { error: { code: IMPERSONATION_TARGET_USER_NOT_FOUND_CODE } });
      expect(dialog().error()).not.toBe('');

      dialog().onSuggestionSelected({ value: { targetUser: 'jdoe', username: 'jdoe', email: 'j@example.com' } } as unknown as AutoCompleteSelectEvent);

      expect(dialog().error()).toBe('');
    });
  });

  describe('suggestions', () => {
    const recent: RecentImpersonation = { targetUser: 'asmith', username: 'asmith', email: 'alex.smith@example.com', name: 'Alex Smith', lastUsedAt: 1 };

    async function search(query: string): Promise<ImpersonationSuggestion[]> {
      dialog().onSearchComplete({ query } as AutoCompleteCompleteEvent);
      await fixture.whenStable();
      return dialog().suggestions();
    }

    beforeEach(async () => {
      recents = [recent];
      await createDialog();
    });

    it('offers the recents before anything is typed', () => {
      expect(dialog().suggestions()).toEqual([recent]);
    });

    it('lists every recent for an empty query without searching the directory', async () => {
      expect(await search('')).toEqual([recent]);
      expect(searchUsers).not.toHaveBeenCalled();
    });

    it('only filters the recents for a single character', async () => {
      expect(await search('z')).toEqual([]);
      expect(await search('a')).toEqual([recent]);
      expect(searchUsers).not.toHaveBeenCalled();
    });

    it('searches the directory as the admin once the query has two characters', async () => {
      await search('ja');

      expect(searchUsers).toHaveBeenCalledWith('ja', 'committee_member', true);
    });

    it('lists directory people with their username as the target and a composed name', async () => {
      searchUsers.mockReturnValue(of([directoryRow({})]));

      expect(await search('jane')).toEqual([{ targetUser: 'jdoe', username: 'jdoe', email: 'jane.doe@example.com', name: 'Jane Doe' }]);
    });

    it('lists matching recents ahead of directory people and does not repeat a person', async () => {
      searchUsers.mockReturnValue(
        of([directoryRow({ username: 'jdoe' }), directoryRow({ uid: 'uid-2', username: 'ASmith', email: 'alex.smith@example.com' })])
      );

      const suggestions = await search('al');

      // The recent leads; its directory row (same username, different case) is not listed again.
      expect(suggestions.map((s) => s.username)).toEqual(['asmith', 'jdoe']);
    });

    it('leaves out a directory person with no LF account', async () => {
      searchUsers.mockReturnValue(
        of([directoryRow({ username: null }), directoryRow({ uid: 'uid-2', username: '  ' }), directoryRow({ uid: 'uid-3', username: 'jdoe' })])
      );

      expect((await search('jane')).map((s) => s.username)).toEqual(['jdoe']);
    });

    it('falls back to the recents when the directory search yields nothing', async () => {
      searchUsers.mockReturnValue(of([]));

      expect(await search('al')).toEqual([recent]);
    });
  });

  describe('when opened from the banner to switch users', () => {
    it('starts the change as a switch', async () => {
      await createDialog({ switching: true });
      startImpersonation.mockReturnValue(NEVER);

      dialog().targetUserForm.controls.targetUser.setValue('jdoe');
      dialog().submit();

      expect(startImpersonation).toHaveBeenCalledWith('jdoe', true);
    });
  });
});
