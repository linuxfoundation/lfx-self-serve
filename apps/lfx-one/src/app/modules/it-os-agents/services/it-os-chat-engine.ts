// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import {
  ItOsActionResult,
  ItOsAgentMessage,
  ItOsChange,
  ItOsChangePayload,
  ItOsChangePolicy,
  ItOsChatAction,
  ItOsChatForm,
  ItOsScenario,
} from '@lfx-one/shared/interfaces';

import { esc } from './it-os-dns-html';

const THINK_MS = 500;
const STEP_MS = 420;

export const action = (label: string, run: () => void, primary = false): ItOsChatAction => ({ label, run, primary });

/**
 * Scripted conversation engine shared by the IT OS GitHub, email forwarding and mailing list agents (#4257),
 * ported from the UI prototype. Each agent matches messages against known intents and works on sample data
 * held in memory. Changes that need LF IT approval get a sample request id instead of applying.
 */
export abstract class ItOsChatEngine {
  public readonly messages = signal<ItOsAgentMessage[]>([]);
  /** "Viewing as": LF staff see fee amounts when they ask; external members are referred to the Formation Team. */
  public readonly staff = signal(true);
  public readonly scenario = signal('');
  public readonly busy = computed(() => this.messages().some((m) => m.typing || (m.steps !== undefined && (m.shown ?? 0) <= m.steps.length)));
  /** Bumped when the sample data changes so computed views re-read it. */
  public readonly version = signal(0);

  public abstract readonly scenarios: ItOsScenario[];

  protected abstract readonly policies: Record<string, ItOsChangePolicy>;
  protected abstract readonly payloadLabels: Record<string, string>;

  private nextRequest = 1042;
  /** Bumped on reset so timers from the previous run are ignored. */
  private generation = 0;

  /** Suggestion chips under the composer; they can depend on the sample data. */
  public abstract suggestions(): string[];

  // === Conversation ===

  public start(): void {
    if (this.messages().length === 0) this.greet();
  }

  public reset(): void {
    this.generation++;
    this.nextRequest = 1042;
    this.staff.set(true);
    this.resetData();
    this.messages.set([]);
    this.touch();
    this.greet();
  }

  /** Switch to a sample situation: resets this agent's data and conversation. */
  public setScenario(id: string): void {
    this.generation++;
    this.applyScenario(id);
    this.messages.set([]);
    this.touch();
    this.greet();
  }

  public send(text: string): void {
    const value = text.trim();
    if (!value || this.busy()) return;
    this.push({ fromUser: true, text: value });
    this.think(() => this.route(value));
  }

  public runAction(message: ItOsAgentMessage, chatAction: ItOsChatAction): void {
    if (message.used || this.busy()) return;
    message.used = true;
    this.push({ fromUser: true, text: chatAction.label });
    this.think(chatAction.run);
  }

  public toggleChange(change: ItOsChange, on: boolean): void {
    change.on = on;
    this.refresh();
  }

  public setField(form: ItOsChatForm, id: string, value: string | boolean): void {
    form.values[id] = value;
    this.refresh();
  }

  public cancelPlan(message: ItOsAgentMessage): void {
    if (!message.plan) return;
    message.plan.state = 'cancelled';
    this.push({ fromUser: true, text: 'Cancel' });
    this.think(() => this.bot('<p>OK, nothing changed.</p>'));
  }

  public confirmPlan(message: ItOsAgentMessage): void {
    const plan = message.plan;
    if (!plan || plan.state !== 'open') return;
    const skipped = plan.changes.filter((c) => !c.on);
    plan.state = 'done';
    plan.results = plan.changes.filter((c) => c.on).map((c) => this.submit(c.key, c.payload));
    this.touch();
    this.push({ fromUser: true, text: 'Confirm' });
    this.think(() => {
      const results = plan.results ?? [];
      const applied = results.filter((r) => !r.requestId);
      const requested = results.filter((r) => r.requestId);
      let html = applied.length ? `<p>Done: ${applied.map((r) => esc(r.title)).join('; ')}.</p>` : '';
      if (requested.length) {
        html += `<p>Sent to LF IT for approval: ${requested.map((r) => `${esc(r.title)} (${esc(r.requestId)})`).join('; ')}. LF IT reviews the request before anything changes.</p>`;
      }
      this.bot(html);
      message.after?.(skipped);
    });
  }

  // === Plan details (used by the template) ===

  public describe(change: ItOsChange): string {
    return this.policies[change.key].describe(change.payload);
  }

  public needsApproval(change: ItOsChange): boolean {
    return this.policies[change.key].needsApproval(change.payload);
  }

  public reason(change: ItOsChange): string {
    return this.policies[change.key].reason(change.payload);
  }

  public details(payload: ItOsChangePayload): { label: string; value: string }[] {
    return Object.keys(this.payloadLabels)
      .filter((key) => payload[key] !== undefined && payload[key] !== '' && payload[key] !== null)
      .map((key) => {
        const value = payload[key];
        return { label: this.payloadLabels[key], value: Array.isArray(value) ? value.join('\n') : String(value) };
      });
  }

  // === For each agent ===

  protected abstract greet(): void;
  protected abstract route(text: string): void;
  protected abstract apply(key: string, payload: ItOsChangePayload): void;
  protected abstract resetData(): void;
  protected abstract applyScenario(id: string): void;

  // === Message plumbing ===

  protected push(message: ItOsAgentMessage): void {
    this.messages.update((list) => [...list, message]);
  }

  protected bot(html: string, extra: Partial<ItOsAgentMessage> = {}): ItOsAgentMessage {
    const message: ItOsAgentMessage = { fromUser: false, html, ...extra };
    this.push(message);
    return message;
  }

  /** Proposes changes to confirm. Pass `on: false` in a change to leave it unticked. */
  protected plan(html: string, changes: (Omit<ItOsChange, 'on'> & { on?: boolean })[], after?: (skipped: ItOsChange[]) => void): ItOsAgentMessage {
    return this.bot(html, { plan: { changes: changes.map((c) => ({ ...c, on: c.on ?? true })), state: 'open' }, after });
  }

  /** Re-emit after a nested change (a toggled change, a step shown) so the view updates. */
  protected refresh(): void {
    this.messages.update((list) => [...list]);
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected later(fn: () => void, ms: number): void {
    const generation = this.generation;
    setTimeout(() => {
      if (generation === this.generation) fn();
    }, ms);
  }

  protected think(fn: () => void): void {
    const typing: ItOsAgentMessage = { fromUser: false, typing: true };
    this.push(typing);
    this.later(() => {
      this.messages.update((list) => list.filter((m) => m !== typing));
      fn();
      this.refresh();
    }, THINK_MS);
  }

  /** Shows progress steps one at a time, then runs `then`. */
  protected work(html: string, steps: string[], then: () => void): void {
    const message: ItOsAgentMessage = { fromUser: false, html, steps, shown: 1 };
    this.push(message);
    const tick = (): void => {
      message.shown = (message.shown ?? 1) + 1;
      if ((message.shown ?? 0) <= steps.length) {
        this.refresh();
        this.later(tick, STEP_MS);
      } else {
        then();
        this.refresh();
      }
    };
    this.later(tick, STEP_MS);
  }

  private submit(key: string, payload: ItOsChangePayload): ItOsActionResult {
    const policy = this.policies[key];
    const title = policy.describe(payload);
    if (policy.needsApproval(payload)) return { title, requestId: `REQ-${this.nextRequest++}` };
    this.apply(key, payload);
    return { title };
  }
}
