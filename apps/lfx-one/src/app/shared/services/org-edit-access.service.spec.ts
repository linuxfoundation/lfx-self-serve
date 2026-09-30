// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgEditAccessService } from './org-edit-access.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const HELD = '0014100000Te2ovAAB';
const OTHER = '0014100000Te2QjAAJ';
const THIRD = '0012M00002oVGjxQAG';

interface Harness {
  service: OrgEditAccessService;
  selectedAccount: WritableSignal<{ uid: string; accountName: string }>;
  loaded: WritableSignal<boolean>;
  editCheck: Mock<(uid: string) => Observable<boolean>>;
  answers: Subject<boolean>[];
}

function setup(): Harness {
  const selectedAccount = signal({ uid: '', accountName: '' });
  const loaded = signal(true);
  const answers: Subject<boolean>[] = [];
  const editCheck: Mock<(uid: string) => Observable<boolean>> = vi.fn(() => {
    const answer = new Subject<boolean>();
    answers.push(answer);
    return answer.asObservable();
  });

  TestBed.configureTestingModule({
    providers: [
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgRoleGrantsService, useValue: { loaded, editorSet: signal(new Set([HELD])), editCheck } },
    ],
  });

  return { service: TestBed.inject(OrgEditAccessService), selectedAccount, loaded, editCheck, answers };
}

const account = (uid: string): { uid: string; accountName: string } => ({ uid, accountName: uid });

describe('OrgEditAccessService (#3136)', () => {
  let h: Harness;

  beforeEach(() => {
    TestBed.resetTestingModule();
    h = setup();
  });

  it('answers a roster editor from the roster, without asking the server', () => {
    h.selectedAccount.set(account(HELD));
    TestBed.tick();

    expect(h.service.canEditSelected()).toBe(true);
    expect(h.editCheck).not.toHaveBeenCalled();
  });

  it('does not ask the server until the roster has loaded', () => {
    h.loaded.set(false);
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();

    expect(h.editCheck).not.toHaveBeenCalled();
    expect(h.service.canEditSelected()).toBe(false);

    h.loaded.set(true);
    TestBed.tick();
    expect(h.editCheck).toHaveBeenCalledWith(OTHER);
  });

  it('opens edit affordances for a company-wide writer the roster does not list once the server confirms', () => {
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();
    expect(h.service.canEditSelected()).toBe(false);

    h.answers[0].next(true);
    expect(h.service.canEditSelected()).toBe(true);
  });

  it('keeps a read-only caller read-only when the server refuses', () => {
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();
    h.answers[0].next(false);

    expect(h.service.canEditSelected()).toBe(false);
  });

  it('never applies an answer to an organization other than the one it was asked for', () => {
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();
    h.answers[0].next(true);

    h.selectedAccount.set(account(THIRD));
    TestBed.tick();
    expect(h.editCheck).toHaveBeenLastCalledWith(THIRD);
    expect(h.service.canEditSelected()).toBe(false);

    h.answers[1].next(false);
    expect(h.service.canEditSelected()).toBe(false);
  });
});
