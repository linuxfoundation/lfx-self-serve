// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The whole result path runs for real (controller, run tracker, the five agent services, the document store and the
// artifact layer) over an in-memory object store: only Guild's events, the project lookup and the owner token are faked.
const store = vi.hoisted(() => ({ objects: new Map<string, { body: string; metadata: Record<string, string>; lastModified: Date }>(), clock: 0 }));
const guild = vi.hoisted(() => ({ events: vi.fn(), interrupt: vi.fn() }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = async (_req: unknown, uid: string) => ({ uid, writer: true });
  },
}));
vi.mock('../utils/mktg-session-token.util', () => ({ createSessionOwnerToken: vi.fn(), verifySessionOwnerToken: () => true }));
vi.mock('../services/guild.service', async (original) => {
  const actual = await original<typeof import('../services/guild.service')>();
  return {
    GuildService: class extends actual.GuildService {
      public override getRawEventPayloads = guild.events;
      public override interruptSession = guild.interrupt;
    },
  };
});
vi.mock('../services/object-store.service', () => ({
  ObjectStoreService: class {
    public ensureBucket = async () => undefined;
    public readiness = async () => true;
    public async headObject(_req: unknown, _purpose: string, key: string) {
      return store.objects.get(key)?.metadata ?? null;
    }
    public async getObject(_req: unknown, _purpose: string, key: string) {
      const object = store.objects.get(key);
      return object ? { body: object.body, metadata: object.metadata, etag: String(object.lastModified.getTime()) } : null;
    }
    public getPrivateObject(req: unknown, purpose: string, key: string) {
      return this.getObject(req, purpose, key);
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string) {
      return [...store.objects].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async putConditionalObject(
      _req: unknown,
      _purpose: string,
      key: string,
      input: { body: Buffer; metadata?: Record<string, string>; ifMatch?: string; ifNoneMatch?: string }
    ) {
      const previous = store.objects.get(key);
      if ((input.ifNoneMatch && previous) || (input.ifMatch && input.ifMatch !== String(previous?.lastModified.getTime()))) return false;
      return this.write(key, input.body, input.metadata);
    }
    public async putPrivateObjectIfAbsent(_req: unknown, _purpose: string, key: string, input: { body: Buffer }) {
      return !store.objects.has(key) && this.write(key, input.body);
    }
    public async putContentAddressedObject(
      _req: unknown,
      _purpose: string,
      key: string,
      body: Buffer,
      _type: string,
      _cache: string,
      metadata?: Record<string, string>,
      options: { refreshMetadataWhen?: (value: Record<string, string>) => boolean } = {}
    ) {
      const previous = store.objects.get(key);
      return (!previous || !!options.refreshMetadataWhen?.(previous.metadata)) && this.write(key, body, metadata);
    }
    private write(key: string, body: Buffer, metadata: Record<string, string> = {}): boolean {
      store.clock += 1000;
      store.objects.set(key, { body: Buffer.from(body).toString('utf8'), metadata, lastModified: new Date(store.clock) });
      return true;
    }
  },
}));

import {
  BOILERPLATES_FINALIZE_TOOL,
  BRAND_KIT_FINALIZE_TOOL,
  FAQ_FINALIZE_TOOL,
  FOUNDATION_MESSAGE_FINALIZE_TOOL,
  ICP_FINALIZE_TOOL,
  ICP_REQUIRED_HEADINGS,
  ICP_REQUIRED_SUBHEADINGS,
} from '@lfx-one/shared/constants';

import { MktgDocumentRunService } from '../services/mktg-document-run.service';
import { MktgAgentsController } from './mktg-agents.controller';

const PROJECT = 'proj-uid-1';
const fixture = (name: string) => (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../../packages/shared/src/utils/__fixtures__/${name}`, import.meta.url), 'utf8'));

/** An ICP envelope that passes the agent's structural gates; the other four come from the shared package's fixtures. */
function icpEnvelope(): Record<string, unknown> {
  const icps = [
    { label: 'Cloud-native platform vendors', personas: ['Platform Architect', 'VP of Engineering'] },
    { label: 'Enterprise adopters', personas: ['Head of Infrastructure', 'Staff SRE'] },
  ];
  const attributes = ['Kubernetes footprint', 'Contributor headcount', 'Existing LF membership', 'Public adoption signal'];
  const filler = 'Synthetic fixture prose for the ICP structural gates. '.repeat(4);
  const lines = ['# TestOrbit ICP & Target Markets', ''];
  for (const heading of ICP_REQUIRED_HEADINGS) {
    const section = /^## (\d+)\./.exec(heading)?.[1];
    lines.push(heading, '', filler, '');
    lines.push(...ICP_REQUIRED_SUBHEADINGS.filter((sub) => section && sub.startsWith(`### ${section}.`)).flatMap((sub) => [sub, '', filler, '']));
  }
  lines.push(...[...icps.map((icp) => icp.label), ...icps.flatMap((icp) => icp.personas), ...attributes].map((entry) => `- ${entry}`));
  const markdown = lines.join('\n');
  return {
    contract: 'icp-output/v1',
    kind: 'icp',
    project: 'testorbit',
    project_name: 'TestOrbit',
    version: 1,
    document_markdown: markdown,
    content_sha256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
    business_outcome: 'Membership growth',
    structure: { icps, fit_warmth_attributes: attributes, disqualifiers: 'confirmed' },
    inputs: { brand_kit_provided: false, message_foundation_provided: false, live_membership_data_provided: false, existing_documents_provided: false },
    intake: {
      mode: 'form',
      completed_at: '2026-09-10T00:00:00Z',
      answers: [1, 2, 4].map((number) => ({ question_number: number, question: `Q${number}`, answer: `A${number}` })),
    },
  };
}

/** Each result endpoint with its run's agent key (also its path segment), its finalize tool and a valid envelope. */
const ENDPOINTS = [
  { method: 'brandKitResult', agentKey: 'brand-kit', tool: BRAND_KIT_FINALIZE_TOOL, envelope: fixture('brand-kit-report-v2.envelope.json') },
  {
    method: 'foundationMessageResult',
    agentKey: 'foundation-message',
    tool: FOUNDATION_MESSAGE_FINALIZE_TOOL,
    envelope: fixture('framework-report-v2.envelope.json'),
  },
  { method: 'boilerplatesResult', agentKey: 'boilerplates', tool: BOILERPLATES_FINALIZE_TOOL, envelope: fixture('boilerplates.envelope.json') },
  { method: 'icpResult', agentKey: 'icp', tool: ICP_FINALIZE_TOOL, envelope: icpEnvelope },
  { method: 'faqResult', agentKey: 'faq', tool: FAQ_FINALIZE_TOOL, envelope: fixture('faq-envelope.json') },
] as const;

/** The finalize tool's result as Guild records it: a `tool_result` paired by id with the agent's `tool_use`. */
const finalized = (tool: string, envelope: Record<string, unknown>): string[] => [
  JSON.stringify({
    type: 'llm_start',
    payload: JSON.stringify({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'synthetic-finalize', name: tool, input: {} }] },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'synthetic-finalize',
              content: [{ type: 'text', text: JSON.stringify({ envelope_json: JSON.stringify(envelope) }) }],
            },
          ],
        },
      ],
    }),
  }),
];

describe.each(ENDPOINTS)('$method: the result poll of a closed run', ({ method, agentKey, tool, envelope }) => {
  const session = `synthetic-${agentKey}-session`;
  const runKey = `document-runs/${PROJECT}/${createHash('sha256').update(session).digest('hex')}.json`;
  const revisions = (): string[] => [...store.objects.keys()].filter((key) => key.startsWith(`documents/${PROJECT}/${agentKey}/living/0`));
  let next: NextFunction & ReturnType<typeof vi.fn>;
  let json: ReturnType<typeof vi.fn>;

  /** The tab that started the run polls its result, with the creator's owner token and the run's project. */
  async function poll(): Promise<void> {
    const req = {
      path: `/api/mktg-agents/${agentKey}/result`,
      body: { sessionId: session, ownerToken: 'synthetic-proof', project: PROJECT },
      oidc: { user: { sub: 'synthetic-writer' } },
    } as unknown as Request;
    await new MktgAgentsController()[method](req, { json } as unknown as Response, next);
  }

  beforeEach(async () => {
    store.objects.clear();
    guild.events.mockReset();
    MktgDocumentRunService['terminalCache'].clear();
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
    json = vi.fn();
    await new MktgDocumentRunService().start({ oidc: { user: { sub: 'synthetic-writer' } } } as unknown as Request, PROJECT, agentKey, session);
    // The agent finished late: its document waits in the session, and reading it is what stores it.
    guild.events.mockResolvedValue(finalized(tool, envelope()));
  });

  it('stores the document of a run that is still open, as a revision', async () => {
    await poll();
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', persistence: expect.objectContaining({ project: PROJECT }) }));
    expect(revisions()).toHaveLength(1);
  });

  it.each(['discarded', 'superseded'])('refuses a %s run before anything is read: a stale tab stores no late revision', async (state) => {
    Object.assign(store.objects.get(runKey)?.metadata ?? {}, { state, 'closed-at': '2026-11-28T10:00:00.000Z' });
    const before = JSON.stringify([...store.objects]);
    await poll();
    expect(revisions()).toEqual([]);
    expect(JSON.stringify([...store.objects])).toBe(before);
    expect(guild.events).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, code: 'MKTG_RUN_CLOSED' }));
    expect(json).not.toHaveBeenCalled();
  });
});
