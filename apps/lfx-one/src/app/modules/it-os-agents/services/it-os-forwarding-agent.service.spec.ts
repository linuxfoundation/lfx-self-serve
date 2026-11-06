// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ItOsAgentMessage } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItOsForwardingAgentService } from './it-os-forwarding-agent.service';

describe('ItOsForwardingAgentService', () => {
  let service: ItOsForwardingAgentService;

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
  const describeAll = (message: ItOsAgentMessage): string[] => message.plan?.changes.map((c) => service.describe(c)) ?? [];

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ItOsForwardingAgentService);
    service.reset();
  });

  afterEach(() => vi.useRealTimers());

  it('turns on the standard addresses without LF IT approval', () => {
    const formMessage = ask('Set up the standard addresses');
    expect(formMessage.form?.fields.some((f) => f.id === 'pick-security')).toBe(true);

    service.runAction(formMessage, formMessage.actions?.[0] ?? { label: '', run: () => undefined });
    vi.runAllTimers();
    const plan = lastBot();
    const change = plan.plan?.changes[0];

    expect(change?.key).toBe('fwd.enable');
    expect(change && service.needsApproval(change)).toBe(false);

    confirm(plan);

    expect(service.enabled()).toBe(true);
    expect(service.forwards().map((f) => f.alias)).toEqual(['support', 'operations', 'membership', 'marketing', 'pr', 'legal', 'conduct']);
  });

  it('adds a forward that is not in the standard from a plain sentence', () => {
    const reply = ask('i also need heather@examplefoundation.org to forward to heather@example.com');

    expect(reply.html).toContain("isn't one of LF's standard addresses");
    expect(describeAll(reply)).toEqual(['Turn on email forwarding for examplefoundation.org with 1 address']);

    confirm(reply);

    expect(service.forwards()).toEqual([{ alias: 'heather', dest: 'heather@example.com' }]);
  });

  it('asks where a new address goes, then uses the answer', () => {
    expect(ask('add a forward for press-kit@').html).toContain('Where should');
    expect(ask('pnair@example.org').plan?.changes[0].payload).toEqual({ aliases: ['press-kit@ → pnair@example.org'] });
  });

  it('suggests the primary domain when the address has a typo', () => {
    const reply = ask('add heather@examplefloundation.org to heather@example.com');

    expect(reply.html).toContain('Did you mean');
    expect(reply.actions?.[0].label).toBe('Yes, forward heather@examplefoundation.org');
  });

  it('points addresses the standard does not allow to the right one', () => {
    expect(ask('Can we add info@?').html).toContain('Use support@ instead');
  });

  it('checks existing forwards against the standard and proposes fixes', () => {
    service.setScenario('review');
    const reply = ask('Check our forwards against the standard');

    expect(describeAll(reply)).toEqual([
      'Send support@examplefoundation.org to LF support (Intercom)',
      'Replace info@examplefoundation.org with an auto-reply pointing to support@',
      'Replace ed@examplefoundation.org with an auto-reply pointing to operations@',
      'Replace admin@examplefoundation.org with an auto-reply pointing to support@',
      'Forward pr@examplefoundation.org to support@examplefoundation.org',
      'Forward legal@examplefoundation.org to operations@examplefoundation.org',
    ]);

    confirm(reply);
    confirm(ask('security@ → r.chen@example.com, neha.sharma@example.com'));

    expect(service.status()).toEqual({ ok: true, text: 'Forwards match the guidelines' });
    expect(ask('check again').html).toContain('except');
  });

  it('never mentions costs unless asked', () => {
    const reply = ask('add careers@ to jrivera@example.org');
    const text = [reply.html, ...(reply.plan?.changes.map((c) => service.reason(c)) ?? [])].join(' ');

    expect(text).not.toMatch(/cost|fee|\$|included|budget/i);
  });
});
