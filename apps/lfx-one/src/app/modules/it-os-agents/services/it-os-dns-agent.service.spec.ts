// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { IT_OS_FORMATION_TEXT, IT_OS_SAMPLE_DOMAINS } from '@lfx-one/shared/constants';
import { ItOsChatMessage } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItOsDnsAgentService } from './it-os-dns-agent.service';

describe('ItOsDnsAgentService', () => {
  let service: ItOsDnsAgentService;

  const lastBot = (): ItOsChatMessage => [...service.messages()].reverse().find((m) => !m.fromUser && !m.typing) as ItOsChatMessage;
  const ask = (text: string): ItOsChatMessage => {
    service.send(text);
    vi.runAllTimers();
    return lastBot();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ItOsDnsAgentService);
    service.reset();
  });

  afterEach(() => vi.useRealTimers());

  it('greets with what it already knows and offers to transfer the waiting domains', () => {
    const greeting = service.messages()[0];

    expect(greeting.html).toContain('LF manages <b>60 domains</b>');
    expect(greeting.actions?.[0].label).toBe('Transfer all 6');
  });

  it('sends turning auto-renew off to LF IT for approval', () => {
    const reply = ask('Stop renewing examplefdn.io');
    const proposal = reply.plan?.proposals[0];

    expect(proposal?.payload).toEqual({ domain: 'examplefdn.io', on: false });
    expect(proposal && service.needsApproval(proposal)).toBe(true);

    service.confirmPlan(reply);
    vi.runAllTimers();

    expect(reply.plan?.results?.[0].requestId).toBe('REQ-1042');
    expect(service.domainBy('examplefdn.io')?.autoRenew).toBe(true);
  });

  it("applies a routine record change at once and doesn't need approval", () => {
    const reply = ask('Point blog at our GitHub Pages site');
    const proposal = reply.plan?.proposals[0];

    expect(proposal?.payload).toMatchObject({ domain: 'examplefoundation.org', type: 'CNAME', name: 'blog', content: 'example-foundation.github.io' });
    expect(proposal && service.needsApproval(proposal)).toBe(false);

    service.confirmPlan(reply);
    vi.runAllTimers();

    expect(service.domainBy('examplefoundation.org')?.records?.some((r) => r.name === 'blog' && r.type === 'CNAME')).toBe(true);
  });

  it('warns about the Pantheon multisite charge and offers a URL redirect instead', () => {
    const reply = ask('Point events at our Pantheon site');

    expect(reply.html).toContain('another Pantheon multisite site');
    expect(reply.plan?.proposals[0].payload).toMatchObject({ type: 'URL', name: 'events', content: 'https://examplefoundation.org' });
  });

  it('refers external members to the Formation Team without amounts', () => {
    service.staff.set(false);

    const reply = ask('What do we pay for domains?');

    expect(reply.html).toBe(`<p>${IT_OS_FORMATION_TEXT}</p>`);
  });

  it("tells the user pointing a waiting domain's nameservers at LF needs no approval", () => {
    service.staff.set(true);
    const reply = ask('Transfer examplesummit.org');
    const copy = reply.actions?.find((a) => a.label === 'Looks right, copy them');
    expect(copy).toBeDefined();

    if (copy) service.runAction(reply, copy);
    vi.runAllTimers();

    const nameservers = service.messages().find((m) => m.nameservers);
    expect(nameservers?.html).toContain("doesn't need LF IT approval");
  });

  it('recreates registrar URL forwarding as URL records instead of copying its records', () => {
    service.send('Transfer examplecon.com');
    vi.runAllTimers();

    const verdict = service.messages().find((m) => m.html?.includes('URL forwarding'));
    expect(verdict).toBeDefined();
    const blocked = lastBot();
    const recheck = blocked.actions?.[0];
    if (recheck) service.runAction(blocked, recheck);
    vi.runAllTimers();

    const copy = service.messages().find((m) => m.zoneUpload);
    expect(copy?.html).toContain('https://example-conf.org');
    expect(copy?.html).not.toContain('203.0.113.80');
  });

  it('restores the starting sample data on reset', () => {
    ask('Point blog at 192.0.2.50');
    service.reset();

    expect(service.domains().length).toBe(IT_OS_SAMPLE_DOMAINS.length);
    expect(service.domainBy('examplefoundation.org')?.records?.some((r) => r.name === 'blog')).toBe(false);
    expect(service.messages().length).toBe(1);
  });
});
