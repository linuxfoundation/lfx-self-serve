// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { IMPERSONATION_TARGET_USER_NOT_FOUND_CODE, IMPERSONATION_USER_NOT_FOUND_MESSAGE } from '@lfx-one/shared/constants';
import { ImpersonationSuggestion, RecentImpersonation, UserSearchResult } from '@lfx-one/shared/interfaces';
import { ImpersonationService } from '@services/impersonation.service';
import { SearchService } from '@services/search.service';
import { UserService } from '@services/user.service';
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
  onEnter: () => void;
  onSearchCleared: () => void;
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

  let currentImpersonator: { email: string } | null;
  let currentUser: { email: string; 'https://sso.linuxfoundation.org/claims/username': string } | null;

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
        { provide: UserService, useValue: { user: signal(currentUser), impersonator: signal(currentImpersonator) } },
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
    currentUser = null;
    currentImpersonator = null;
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

    const jane: ImpersonationSuggestion = { targetUser: 'jdoe', username: 'jdoe', email: 'jane.doe@example.com', name: 'Jane Doe' };

    function pick(entry: ImpersonationSuggestion): void {
      dialog().onSuggestionSelected({ value: entry } as unknown as AutoCompleteSelectEvent);
    }

    function details(): string | undefined {
      return fixture.nativeElement.querySelector('[data-testid="impersonation-picked-details"]')?.textContent?.replace(/\s+/g, ' ').trim();
    }

    it('shows a picked person’s name in the field, not their username', () => {
      pick(jane);

      expect(dialog().targetUserForm.controls.targetUser.value).toBe('Jane Doe');
    });

    it('falls back to the username, then the email, when the person has no name', () => {
      pick({ ...jane, name: undefined });
      expect(dialog().targetUserForm.controls.targetUser.value).toBe('jdoe');

      pick({ ...jane, name: undefined, username: '' });
      expect(dialog().targetUserForm.controls.targetUser.value).toBe('jane.doe@example.com');
    });

    it('lists the picked person’s username and email under the field', async () => {
      expect(details()).toBeUndefined();

      pick(jane);
      await fixture.whenStable();

      expect(details()).toBe('Username jdoe · Email jane.doe@example.com');
    });

    it('submits the picked person’s username while the field shows their name', () => {
      pick(jane);
      startImpersonation.mockReturnValueOnce(NEVER);

      dialog().submit();

      expect(startImpersonation).toHaveBeenCalledWith('jdoe', false);
    });

    it('submits on Enter once a person is picked', () => {
      pick(jane);
      startImpersonation.mockReturnValueOnce(NEVER);

      dialog().onEnter();

      expect(startImpersonation).toHaveBeenCalledWith('jdoe', false);
    });

    it('drops the pick and its details, and submits the typed text, once the name is edited', async () => {
      pick(jane);
      dialog().targetUserForm.controls.targetUser.setValue('someone.else');
      await fixture.whenStable();
      startImpersonation.mockReturnValueOnce(NEVER);

      dialog().submit();

      expect(details()).toBeUndefined();
      expect(startImpersonation).toHaveBeenCalledWith('someone.else', false);
    });

    it('drops the pick when the field is cleared', async () => {
      pick(jane);
      dialog().targetUserForm.controls.targetUser.setValue('');
      await fixture.whenStable();

      expect(details()).toBeUndefined();
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

    it('sends the typed text to the directory with its case intact', async () => {
      await search('  Jane.Doe@Example.com ');

      expect(searchUsers).toHaveBeenCalledWith('Jane.Doe@Example.com', 'committee_member', true);
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

    it('cancels a pending lookup and restores the recents when the field is cleared', async () => {
      searchUsers.mockReturnValue(of([directoryRow({})]));
      expect((await search('jane')).map((s) => s.username)).toEqual(['jdoe']);

      dialog().onSearchCleared();
      await fixture.whenStable();

      expect(dialog().suggestions()).toEqual([recent]);
    });

    it('falls back to the recents when the directory search yields nothing', async () => {
      searchUsers.mockReturnValue(of([]));

      expect(await search('al')).toEqual([recent]);
    });
  });

  describe('Enter', () => {
    const recent: RecentImpersonation = { targetUser: 'asmith', username: 'asmith', email: 'alex.smith@example.com', name: 'Alex Smith', lastUsedAt: 1 };

    beforeEach(async () => {
      recents = [recent];
      await createDialog();
      startImpersonation.mockReturnValue(NEVER);
    });

    it('leaves a half-typed name to the suggestion list instead of submitting it', () => {
      dialog().targetUserForm.controls.targetUser.setValue('al');

      dialog().onEnter();

      expect(startImpersonation).not.toHaveBeenCalled();
    });

    it('submits text that exactly matches a suggestion', () => {
      dialog().targetUserForm.controls.targetUser.setValue('ASmith');

      dialog().onEnter();

      expect(startImpersonation).toHaveBeenCalledWith('ASmith', false);
    });

    it('submits typed text when nothing is suggested', async () => {
      dialog().onSearchComplete({ query: 'zz' } as AutoCompleteCompleteEvent);
      await fixture.whenStable();
      dialog().targetUserForm.controls.targetUser.setValue('zz.exact');

      dialog().onEnter();

      expect(startImpersonation).toHaveBeenCalledWith('zz.exact', false);
    });
  });

  describe('own identities in the recents', () => {
    const admin: RecentImpersonation = { targetUser: 'admin', username: 'admin', email: 'admin@example.com', lastUsedAt: 3 };
    const other: RecentImpersonation = { targetUser: 'jdoe', username: 'jdoe', email: 'jane.doe@example.com', lastUsedAt: 2 };

    it('leaves the signed-in admin out when starting', async () => {
      recents = [admin, other];
      currentUser = { email: 'ADMIN@example.com', 'https://sso.linuxfoundation.org/claims/username': 'admin' };
      await createDialog();

      expect(
        dialog()
          .suggestions()
          .map((s) => s.username)
      ).toEqual(['jdoe']);
    });

    it('leaves the impersonating admin out, as well as the current target, when switching', async () => {
      recents = [admin, other, { targetUser: 'asmith', username: 'asmith', email: 'alex.smith@example.com', lastUsedAt: 1 }];
      currentUser = { email: 'alex.smith@example.com', 'https://sso.linuxfoundation.org/claims/username': 'asmith' };
      currentImpersonator = { email: 'Admin@example.com' };
      await createDialog({ switching: true });

      expect(
        dialog()
          .suggestions()
          .map((s) => s.username)
      ).toEqual(['jdoe']);
    });
  });

  describe('when opened from the banner to switch users', () => {
    it('leaves the current target out of the recents but keeps the others', async () => {
      recents = [
        { targetUser: 'asmith', username: 'asmith', email: 'alex.smith@example.com', lastUsedAt: 1 },
        { targetUser: 'jdoe', username: 'jdoe', email: 'jane.doe@example.com', lastUsedAt: 2 },
      ];
      currentUser = { email: 'ALEX.SMITH@example.com', 'https://sso.linuxfoundation.org/claims/username': 'asmith' };
      await createDialog({ switching: true });

      expect(
        dialog()
          .suggestions()
          .map((s) => s.username)
      ).toEqual(['jdoe']);
    });

    it('starts the change as a switch', async () => {
      await createDialog({ switching: true });
      startImpersonation.mockReturnValue(NEVER);

      dialog().targetUserForm.controls.targetUser.setValue('jdoe');
      dialog().submit();

      expect(startImpersonation).toHaveBeenCalledWith('jdoe', true);
    });
  });
});
