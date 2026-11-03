// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { IT_OS_BULK_SAMPLE } from '@lfx-one/shared/constants';
import { ItOsAgentMessage } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItOsMailingListAgentService } from './it-os-mailing-list-agent.service';

describe('ItOsMailingListAgentService', () => {
  let service: ItOsMailingListAgentService;

  const lastBot = (): ItOsAgentMessage => [...service.messages()].reverse().find((m) => !m.fromUser && !m.typing) as ItOsAgentMessage;
  const ask = (text: string): ItOsAgentMessage => {
    service.send(text);
    vi.runAllTimers();
    return lastBot();
  };
  const confirm = (message: ItOsAgentMessage): void => {
    service.confirmPlan(message);
    vi.runAllTimers();
  };
  const tsc = () => service.lists().find((l) => l.name === 'tsc');

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ItOsMailingListAgentService);
    service.reset();
  });

  afterEach(() => vi.useRealTimers());

  it('greets with the lists and flags tsc as out of sync', () => {
    const greeting = service.messages()[0];

    expect(greeting.html).toContain('4 sub-lists');
    expect(greeting.html).toContain('2 to add, 1 to remove, 1 email conflict');
    expect(greeting.actions?.[0].label).toBe('Show me tsc');
  });

  it('previews a sync, leaves the PM unticked and treats the list as in sync afterwards', () => {
    const reply = ask('Is tsc in sync with its committee?');
    const changes = reply.plan?.changes ?? [];

    expect(changes.map((c) => [service.describe(c), c.on])).toEqual([
      ['Add Lena Fischer (lena.fischer@example.com) to tsc', true],
      ['Add Sam Okafor (sokafor@example.com) to tsc', true],
      ['Remove pnair@example.org from tsc', false],
    ]);
    expect(reply.html).toContain('Email conflict: Ben Osei');

    confirm(reply);

    expect(lastBot().actions?.[0].label).toBe('Turn it on');
    expect(tsc()?.members).toContain('lena.fischer@example.com');
    expect(service.status()).toEqual({ ok: true, text: '5 lists, all in sync' });
  });

  it('creates a sub-list under main and refuses a second level', () => {
    const reply = ask('Create a sub-list called events');

    expect(reply.plan?.changes[0].payload).toMatchObject({ name: 'events', parent: 'main', visibility: 'Public', permission: 'Moderated Discussion' });
    expect(ask('create a sub-list called wg-docs under tsc').html).toContain('only go one level deep');
  });

  it('checks a bulk paste before adding anyone', () => {
    const form = ask('Bulk add subscribers to dev');
    expect(form.form?.fields[0].kind).toBe('textarea');

    service.setField(form.form ?? { fields: [], values: {} }, 'addresses', IT_OS_BULK_SAMPLE);
    service.runAction(form, form.actions?.[0] ?? { label: '', run: () => undefined });
    vi.runAllTimers();
    const reply = lastBot();

    expect(reply.html).toContain('Ready to add');
    expect(reply.html).toContain('Skipped, not valid: li.na@example');
    expect(reply.plan?.changes[0].payload['emails']).toHaveLength(9);
  });

  it('checks the sync rules before linking a list to a committee', () => {
    expect(ask('link dev to the Outreach Committee list to committee').html).toContain('only works with private lists');

    const reply = ask('Link security to the Security Response Team');
    confirm(reply);

    expect(lastBot().plan?.changes.map((c) => service.describe(c))).toEqual(['Add Lena Fischer (lena.fischer@example.com) to security']);
  });

  it('applies list changes without LF IT approval', () => {
    const reply = ask('add kenji@example.com to tsc');
    const change = reply.plan?.changes[0];

    expect(change && service.needsApproval(change)).toBe(false);
  });
});
