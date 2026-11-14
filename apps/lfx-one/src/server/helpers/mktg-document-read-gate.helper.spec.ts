// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MktgDocumentReadGate } from './mktg-document-read-gate.helper';

/** A read that stays in flight until `finish` is called. */
function heldRead(): { read: () => Promise<string>; finish: (value: string) => void; started: () => boolean } {
  let finish: (value: string) => void = () => undefined;
  let started = false;
  const done = new Promise<string>((resolve) => (finish = resolve));
  return {
    read: () => {
      started = true;
      return done;
    },
    finish: (value: string) => finish(value),
    started: () => started,
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('MktgDocumentReadGate slots', () => {
  it('holds a user to their slots, lets other users through, and starts waiters as slots free', async () => {
    const gate = new MktgDocumentReadGate(3, 2, 5);
    const [a1, a2, a3, b1] = [heldRead(), heldRead(), heldRead(), heldRead()];

    const runs = [gate.withSlot('a', a1.read), gate.withSlot('a', a2.read), gate.withSlot('a', a3.read), gate.withSlot('b', b1.read)];
    await tick();

    expect([a1.started(), a2.started(), a3.started(), b1.started()]).toEqual([true, true, false, true]);
    expect(gate.inFlight('a')).toBe(2);
    expect(gate.inFlight()).toBe(3);

    a1.finish('a1');
    await tick();
    expect(a3.started()).toBe(true);

    [a2, a3, b1].forEach((held, index) => held.finish(['a2', 'a3', 'b1'][index]));
    expect(await Promise.all(runs)).toEqual(['a1', 'a2', 'a3', 'b1']);
    expect(gate.inFlight()).toBe(0);
  });

  it('caps the whole process, whoever asks', async () => {
    const gate = new MktgDocumentReadGate(2, 2, 5);
    const [a, b, c] = [heldRead(), heldRead(), heldRead()];

    const runs = [gate.withSlot('a', a.read), gate.withSlot('b', b.read), gate.withSlot('c', c.read)];
    await tick();
    expect(c.started()).toBe(false);

    a.finish('a');
    await tick();
    expect(c.started()).toBe(true);
    b.finish('b');
    c.finish('c');
    expect(await Promise.all(runs)).toEqual(['a', 'b', 'c']);
  });

  it('refuses a user with too many reads waiting, and frees a slot when a read throws', async () => {
    const gate = new MktgDocumentReadGate(4, 1, 1);
    const [first, second] = [heldRead(), heldRead()];

    const running = gate.withSlot('a', first.read);
    const waiting = gate.withSlot('a', second.read);
    expect(await gate.withSlot('a', async () => 'third')).toBeNull();

    first.finish('first');
    second.finish('second');
    expect([await running, await waiting]).toEqual(['first', 'second']);

    await expect(gate.withSlot('a', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(gate.inFlight('a')).toBe(0);
  });
});

describe('MktgDocumentReadGate parses', () => {
  it('runs one parse at a time, with the event loop turning between two parses', async () => {
    const gate = new MktgDocumentReadGate(4, 4, 4);
    const order: string[] = [];

    const first = gate.parse(() => {
      order.push('parse 1');
      // Another request's work, arriving while parse 1 holds the loop: it runs before parse 2 starts.
      setImmediate(() => order.push('other request'));
    });
    const second = gate.parse(() => order.push('parse 2'));
    await Promise.all([first, second]);

    expect(order).toEqual(['parse 1', 'other request', 'parse 2']);
  });

  it('starts the next parse only once an async parse has settled', async () => {
    const gate = new MktgDocumentReadGate(4, 4, 4);
    const order: string[] = [];

    const first = gate.parse(async () => {
      order.push('parse 1 starts');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('parse 1 ends');
    });
    const second = gate.parse(() => order.push('parse 2'));
    await Promise.all([first, second]);

    expect(order).toEqual(['parse 1 starts', 'parse 1 ends', 'parse 2']);
  });

  it('rejects a parse that throws without stopping the ones after it', async () => {
    const gate = new MktgDocumentReadGate(4, 4, 4);

    const failing = gate.parse(() => {
      throw new Error('bad bytes');
    });
    const next = gate.parse(() => 'read');

    await expect(failing).rejects.toThrow('bad bytes');
    expect(await next).toBe('read');
  });
});
