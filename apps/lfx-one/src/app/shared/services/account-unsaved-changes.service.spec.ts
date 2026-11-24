// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ACCOUNT_CHANGES_REVERTED_MESSAGE } from '@lfx-one/shared/constants';
import { AccountPageForm } from '@lfx-one/shared/interfaces';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscardChangesModalComponent } from '../components/discard-changes-modal/discard-changes-modal.component';
import { AccountUnsavedChangesService } from './account-unsaved-changes.service';

describe('AccountUnsavedChangesService', () => {
  let service: AccountUnsavedChangesService;
  let open: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let closed: Subject<boolean | undefined>;
  let dirty: ReturnType<typeof signal<boolean>>;
  let saving: ReturnType<typeof signal<boolean>>;
  let page: AccountPageForm & { save: ReturnType<typeof vi.fn<() => void>>; revert: ReturnType<typeof vi.fn<() => void>> };
  let destroyCallbacks: (() => void)[];
  const destroyRef = { onDestroy: (callback: () => void) => destroyCallbacks.push(callback) } as unknown as DestroyRef;

  // Each registration adds a window listener, so the page goes at the end of every test.
  afterEach(() => destroyCallbacks.forEach((callback) => callback()));

  beforeEach(() => {
    TestBed.resetTestingModule();
    closed = new Subject();
    close = vi.fn();
    open = vi.fn(() => ({ closed, close }));
    show = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: UiModalService, useValue: { open } },
        { provide: UiToastService, useValue: { show } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    service = TestBed.inject(AccountUnsavedChangesService);
    dirty = signal(false);
    saving = signal(false);
    page = { dirty, saving, save: vi.fn<() => void>(), revert: vi.fn<() => void>() };
    destroyCallbacks = [];
  });

  it('follows the registered page, and forgets it when the page goes', () => {
    service.register(page, destroyRef);
    dirty.set(true);
    expect(service.dirty()).toBe(true);

    destroyCallbacks.forEach((callback) => callback());
    expect(service.dirty()).toBe(false);
  });

  it('saves through the page, but not while a save is running', () => {
    service.register(page, destroyRef);
    service.save();
    expect(page.save).toHaveBeenCalledTimes(1);

    saving.set(true);
    service.save();
    expect(page.save).toHaveBeenCalledTimes(1);
  });

  it('reverts through the page and says so', () => {
    service.register(page, destroyRef);
    service.revert();

    expect(page.revert).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith({ variant: 'dark', message: ACCOUNT_CHANGES_REVERTED_MESSAGE });
  });

  it('lets a page with nothing unsaved go without asking', async () => {
    service.register(page, destroyRef);

    expect(await firstValueFrom(service.confirmLeave())).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])('asks before leaving unsaved changes; a close with %s leaves: %s', async (result, leaves) => {
    service.register(page, destroyRef);
    dirty.set(true);

    const answer = firstValueFrom(service.confirmLeave());
    expect(open).toHaveBeenCalledWith(DiscardChangesModalComponent, expect.objectContaining({ role: 'alertdialog' }));
    closed.next(result);

    expect(await answer).toBe(leaves);
  });

  it('closes the dialog when a newer navigation drops the one that opened it', () => {
    service.register(page, destroyRef);
    dirty.set(true);

    service.confirmLeave().subscribe().unsubscribe();

    expect(close).toHaveBeenCalled();
  });

  it("blocks a reload with the browser's prompt only while there are unsaved changes", () => {
    service.register(page, destroyRef);
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    dirty.set(true);
    expect(unload()).toBe(true);

    destroyCallbacks.forEach((callback) => callback());
    expect(unload()).toBe(false);
  });
});
