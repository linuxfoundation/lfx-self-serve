// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The time one request may spend parsing documents on the event loop, shared
 * by every source and document it reads (a Messaging Document generate reads
 * up to ten). Each parse takes what it used; once nothing is left, the
 * request's remaining documents are not parsed.
 */
export class MktgReadBudget {
  private remaining: number;

  public constructor(totalMillis: number) {
    this.remaining = totalMillis;
  }

  /** Milliseconds left, never negative. */
  public get remainingMillis(): number {
    return Math.max(0, this.remaining);
  }

  /** Charge one parse's time to the budget. */
  public spend(millis: number): void {
    this.remaining -= millis;
  }
}

/**
 * Bounds the document reading LFX One does for Marketing OS agents, which
 * cannot fetch or open files themselves. A read is a fetch (I/O) followed by
 * a parse (PDF, Word, HTML), so the gate bounds both:
 *
 * - Slots bound memory and fairness. A read (fetch and parse) holds a slot; a
 *   user holds at most `maxPerUser` at once and the process `maxPerProcess`,
 *   so the bodies buffered at one time stay bounded (each at most 20 MB) and
 *   one user cannot take every slot. Waiters start in arrival order; a user
 *   with `maxWaitingPerUser` reads already waiting is refused at once.
 * - Parses run one at a time across the process, each after a turn of the
 *   event loop. Every parse is bounded on its own (the PDF deadline and page
 *   cap, the Word markup cap and deadline, the HTML size cap), so other requests run
 *   between two documents instead of waiting for a whole batch.
 */
export class MktgDocumentReadGate {
  private readonly activeByUser = new Map<string, number>();
  private readonly waiting: { user: string; start: () => void }[] = [];
  private activeTotal = 0;
  private parsing: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly maxPerProcess: number,
    private readonly maxPerUser: number,
    private readonly maxWaitingPerUser: number
  ) {}

  /**
   * Run one read inside a slot of `user`'s, waiting for one if need be.
   *
   * @returns The read's result, or null when the user already has too many reads waiting
   */
  public async withSlot<T>(user: string, read: () => Promise<T>): Promise<T | null> {
    if (this.canStart(user)) {
      this.take(user);
    } else if (this.waiting.filter((waiter) => waiter.user === user).length >= this.maxWaitingPerUser) {
      return null;
    } else {
      // The slot is taken for this waiter by `release`, before `start` runs.
      await new Promise<void>((start) => this.waiting.push({ user, start }));
    }
    try {
      return await read();
    } finally {
      this.release(user);
    }
  }

  /** Run one parse alone, after a turn of the event loop; the next starts once it has settled. */
  public parse<T>(work: () => T | Promise<T>): Promise<T> {
    const run = this.parsing.then(
      () =>
        new Promise<T>((resolve, reject) => {
          setImmediate(() => {
            try {
              resolve(work());
            } catch (error) {
              reject(error);
            }
          });
        })
    );
    this.parsing = run.catch(() => undefined);
    return run;
  }

  /** Reads in flight for a user, and in the process (for tests and logs). */
  public inFlight(user?: string): number {
    return user === undefined ? this.activeTotal : (this.activeByUser.get(user) ?? 0);
  }

  private canStart(user: string): boolean {
    return this.activeTotal < this.maxPerProcess && (this.activeByUser.get(user) ?? 0) < this.maxPerUser;
  }

  private take(user: string): void {
    this.activeTotal += 1;
    this.activeByUser.set(user, (this.activeByUser.get(user) ?? 0) + 1);
  }

  private release(user: string): void {
    this.activeTotal -= 1;
    const left = (this.activeByUser.get(user) ?? 1) - 1;
    if (left === 0) {
      this.activeByUser.delete(user);
    } else {
      this.activeByUser.set(user, left);
    }
    // Start every waiter that now fits, oldest first (a freed user slot may unblock someone other than the next in line).
    for (let index = 0; index < this.waiting.length; ) {
      const waiter = this.waiting[index];
      if (this.canStart(waiter.user)) {
        this.waiting.splice(index, 1);
        this.take(waiter.user);
        waiter.start();
      } else {
        index += 1;
      }
    }
  }
}
