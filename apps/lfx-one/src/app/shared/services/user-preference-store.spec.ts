// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, DestroyRef, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserPreferenceStore } from './user-preference-store';

import type { ParseResult, PreferenceContext, UserPreferenceStoreConfig, UserPreferenceTransport } from '@lfx-one/shared/interfaces';

interface Doc {
  ids: string[];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('UserPreferenceStore', () => {
  const ctxA: PreferenceContext = { userId: 'u1', projectId: 'p1' };
  const ctxB: PreferenceContext = { userId: 'u1', projectId: 'p2' };

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  function createStore(overrides: Partial<UserPreferenceStoreConfig<Doc>> = {}): {
    store: UserPreferenceStore<Doc>;
    transport: UserPreferenceTransport;
  } {
    const transport: UserPreferenceTransport = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const store = new UserPreferenceStore<Doc>({
      transport,
      destroyRef: TestBed.inject(DestroyRef),
      injector: TestBed.inject(Injector),
      isBrowser: true,
      preferenceName: (projectId) => `Social Listening Bookmarks - ${projectId}`,
      initial: () => ({ ids: [] }),
      parse: (raw) => ({ data: JSON.parse(raw) as Doc }),
      serialize: (data) => JSON.stringify(data),
      ...overrides,
    });
    return { store, transport };
  }

  // Effects (toObservable) fire on tick; Promise-backed transport settles on the macrotask flush.
  async function flush(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('loads and parses the stored value when the context is set', async () => {
    const onLoaded = vi.fn();
    const { store, transport } = createStore({ onLoaded });
    (transport.get as ReturnType<typeof vi.fn>).mockResolvedValue('{"ids":["a"]}');

    store.setContext(ctxA);
    await flush();

    expect(transport.get).toHaveBeenCalledWith('Social Listening Bookmarks - p1');
    expect(store.state()).toEqual({ data: { ids: ['a'] }, loading: false, readOnly: false, error: null });
    expect(onLoaded).toHaveBeenCalledWith({ data: { ids: ['a'] } });
  });

  it('resets to initial and reports null when the preference does not exist', async () => {
    const onLoaded = vi.fn();
    const { store } = createStore({ onLoaded });

    store.setContext(ctxA);
    await flush();

    expect(store.state()).toEqual({ data: { ids: [] }, loading: false, readOnly: false, error: null });
    expect(onLoaded).toHaveBeenCalledWith(null);
  });

  it('propagates readOnly from the parse result', async () => {
    const { store, transport } = createStore({ parse: (raw): ParseResult<Doc> => ({ data: JSON.parse(raw) as Doc, readOnly: true }) });
    (transport.get as ReturnType<typeof vi.fn>).mockResolvedValue('{"ids":["a"]}');

    store.setContext(ctxA);
    await flush();

    expect(store.state().readOnly).toBe(true);
  });

  it('sets state.error and fires onLoadError when the load fails', async () => {
    const onLoadError = vi.fn();
    const failure = new Error('boom');
    const { store, transport } = createStore({ onLoadError });
    (transport.get as ReturnType<typeof vi.fn>).mockRejectedValue(failure);

    store.setContext(ctxA);
    await flush();

    expect(store.state()).toEqual({ data: { ids: [] }, loading: false, readOnly: false, error: failure });
    expect(onLoadError).toHaveBeenCalledWith(failure);
  });

  it('does not reload when setContext re-emits an equal (userId, projectId)', async () => {
    const { store, transport } = createStore();

    store.setContext(ctxA);
    await flush();
    store.setContext({ ...ctxA });
    await flush();
    expect(transport.get).toHaveBeenCalledTimes(1);

    store.setContext(ctxB);
    await flush();
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(transport.get).toHaveBeenLastCalledWith('Social Listening Bookmarks - p2');
  });

  it('drops a late load response from a cancelled context', async () => {
    const { store, transport } = createStore();
    const slowGet = deferred<string | null>();
    (transport.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(slowGet.promise).mockResolvedValue('{"ids":["b"]}');

    store.setContext(ctxA);
    await flush();
    store.setContext(ctxB);
    await flush();
    slowGet.resolve('{"ids":["STALE"]}');
    await flush();

    expect(store.state().data).toEqual({ ids: ['b'] });
  });

  it('commits optimistically, runs writes in submission order, and guards the rollback', async () => {
    const { store, transport } = createStore();
    const putA = deferred<undefined>();
    const putB = deferred<undefined>();
    (transport.put as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(putA.promise)
      // Commit A's reconcile retry must also fail for the commit to error at all.
      .mockRejectedValueOnce(new Error('retry lost'))
      .mockReturnValueOnce(putB.promise);
    const onErrorA = vi.fn();
    const onSuccessB = vi.fn();

    store.setContext(ctxA);
    await flush();

    store.commit({ next: { ids: ['a'] }, onError: onErrorA });
    store.commit({ next: { ids: ['a', 'b'] }, onSuccess: onSuccessB });
    expect(store.state().data).toEqual({ ids: ['a', 'b'] });

    // concatMap serialization: the second write has not started while the first is in flight.
    expect(transport.put).toHaveBeenCalledTimes(1);

    putA.reject(new Error('lost'));
    await flush();

    // Guarded rollback: state has since moved to commit B's value, so the snapshot must not be restored.
    expect(store.state().data).toEqual({ ids: ['a', 'b'] });
    expect(onErrorA).toHaveBeenCalled();

    putB.resolve(undefined);
    await flush();

    expect(transport.put).toHaveBeenNthCalledWith(1, 'Social Listening Bookmarks - p1', '{"ids":["a"]}');
    expect(transport.put).toHaveBeenNthCalledWith(2, 'Social Listening Bookmarks - p1', '{"ids":["a"]}');
    expect(transport.put).toHaveBeenNthCalledWith(3, 'Social Listening Bookmarks - p1', '{"ids":["a","b"]}');
    expect(onSuccessB).toHaveBeenCalled();
    expect(store.state().data).toEqual({ ids: ['a', 'b'] });
  });

  it('rebases a queued write against post-rollback state so a failed mutation is not resurrected', async () => {
    const { store, transport } = createStore();
    const putA = deferred<undefined>();
    (transport.put as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(putA.promise)
      // Commit A's reconcile retry must also fail for the commit to error at all.
      .mockRejectedValueOnce(new Error('retry lost'))
      .mockResolvedValue(undefined);

    store.setContext(ctxA);
    await flush();

    // A's targeted rollback removes only 'a', preserving B's optimistic 'b'; B rebases its payload at dequeue.
    store.commit({
      next: { ids: ['a'] },
      rollback: () => store.replace({ ids: store.state().data.ids.filter((id) => id !== 'a') }),
    });
    store.commit({
      next: { ids: ['a', 'b'] },
      rebase: (current) => ({ ids: current.ids.includes('b') ? current.ids : [...current.ids, 'b'] }),
    });
    expect(store.state().data).toEqual({ ids: ['a', 'b'] });

    putA.reject(new Error('lost'));
    await flush();

    // B's eager snapshot contained 'a', but the rebased payload reflects the rolled-back state.
    expect(transport.put).toHaveBeenCalledTimes(3);
    expect(transport.put).toHaveBeenNthCalledWith(3, 'Social Listening Bookmarks - p1', '{"ids":["b"]}');
    expect(store.state().data).toEqual({ ids: ['b'] });
  });

  it('restores the snapshot on failure when no later optimistic update landed', async () => {
    const { store, transport } = createStore();
    (transport.get as ReturnType<typeof vi.fn>).mockResolvedValue('{"ids":["x"]}');
    (transport.put as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('lost'));
    (transport.get as ReturnType<typeof vi.fn>).mockResolvedValue('{"ids":["x"]}');

    store.setContext(ctxA);
    await flush();
    expect(store.state().data).toEqual({ ids: ['x'] });

    store.commit({ next: { ids: ['x', 'y'] } });
    await flush();

    expect(store.state().data).toEqual({ ids: ['x'] });
  });

  it('applies non-optimistic commits only after the write succeeds', async () => {
    const { store, transport } = createStore();
    const put = deferred<undefined>();
    (transport.put as ReturnType<typeof vi.fn>).mockReturnValue(put.promise);

    store.setContext(ctxA);
    await flush();

    store.commit({ next: { ids: ['a'] }, optimistic: false });
    await flush();
    expect(store.state().data).toEqual({ ids: [] });

    put.resolve(undefined);
    await flush();
    expect(store.state().data).toEqual({ ids: ['a'] });
  });

  it('cancels an in-flight write on context change without firing success or rollback', async () => {
    const { store, transport } = createStore();
    const put = deferred<undefined>();
    (transport.put as ReturnType<typeof vi.fn>).mockReturnValue(put.promise);
    const onSuccess = vi.fn();
    const onError = vi.fn();

    store.setContext(ctxA);
    await flush();

    store.commit({ next: { ids: ['a'] }, onSuccess, onError });
    await flush();
    store.setContext(null);
    put.resolve(undefined);
    await flush();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(store.state().data).toEqual({ ids: [] });
  });

  it('deletes instead of writing when shouldDeleteOnEmpty matches', async () => {
    const { store, transport } = createStore({ shouldDeleteOnEmpty: (data) => data.ids.length === 0 });

    store.setContext(ctxA);
    await flush();

    store.commit({ next: { ids: [] } });
    await flush();

    expect(transport.delete).toHaveBeenCalledWith('Social Listening Bookmarks - p1');
    expect(transport.put).not.toHaveBeenCalled();
  });

  it('reconciles a failed write that landed anyway: re-GET match means success', async () => {
    const { store, transport } = createStore();
    (transport.put as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    (transport.get as ReturnType<typeof vi.fn>).mockResolvedValue('{"ids":["a"]}');
    const onSuccess = vi.fn();
    const onError = vi.fn();

    store.setContext(ctxA);
    await flush();
    (transport.get as ReturnType<typeof vi.fn>).mockClear();

    store.commit({ next: { ids: ['a'] }, onSuccess, onError });
    await flush();

    // The re-GET saw the committed value, so the commit is a success and no rollback happens.
    expect(onSuccess).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(store.state().data).toEqual({ ids: ['a'] });
    expect(transport.put).toHaveBeenCalledTimes(1);
  });

  it('treats a null context as no-op for commits', async () => {
    const { store, transport } = createStore();

    store.commit({ next: { ids: ['a'] } });
    await flush();

    expect(transport.put).not.toHaveBeenCalled();
    expect(transport.delete).not.toHaveBeenCalled();
  });

  it('never touches the transport when isBrowser is false (SSR)', async () => {
    const { store, transport } = createStore({ isBrowser: false });

    store.setContext(ctxA);
    store.commit({ next: { ids: ['a'] } });
    await flush();

    expect(transport.get).not.toHaveBeenCalled();
    expect(transport.put).not.toHaveBeenCalled();
    expect(transport.delete).not.toHaveBeenCalled();
    expect(store.state()).toEqual({ data: { ids: [] }, loading: false, readOnly: false, error: null });
  });
});
