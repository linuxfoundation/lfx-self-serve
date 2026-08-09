// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors weekly-brief.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired
// into this app's vitest config with Angular-free resolution, so shared runtime
// collaborators are mocked — except the pure brand-kit utils, which are re-exported
// through the mock from their real (Angular-free) source module so the spec
// exercises the real validation/extraction logic.
const guildMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getRawEventPayloads: vi.fn(),
}));

vi.mock('@lfx-one/shared/utils', async () => {
  const utils = await vi.importActual('../../../../../packages/shared/src/utils/brand-kit.utils');
  return utils;
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/brand-kit.constants');
  return constants;
});
vi.mock('./guild.service', () => ({
  GuildService: class {
    public createSession = guildMocks.createSession;
    public getRawEventPayloads = guildMocks.getRawEventPayloads;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { BrandKitService } from './brand-kit.service';

const req = { path: '/api/mktg-agents/brand-kit/result' } as unknown as Request;

const REQUIRED_HEADINGS = [
  '## How to Use This Document',
  '## 1. Project Definition',
  '## 2. Positioning',
  '## 3. Brand Personality & Voice',
  '## 4. Primary Audiences & Messaging',
  '## 5. Key Brand Strengths',
  '## 6. Competitive Differentiation & Guardrails',
  '## 7. Visual Identity',
  '## 8. Tagline Options',
  '## 9. Channel Quick Reference',
  '## Appendix A: Document Architecture',
  '## Appendix B: Source Intake',
];

function buildDocument(): string {
  const filler = 'Synthetic fixture prose for the Brand Kit structural gate. '.repeat(4);
  const sections = ['# TestOrbit Brand Kit', ''];
  for (const heading of REQUIRED_HEADINGS) {
    sections.push(heading, '', filler, '');
  }
  return sections.join('\n');
}

function buildEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const documentMarkdown = (overrides['document_markdown'] as string) ?? buildDocument();
  return {
    contract: 'brand-kit-output/v1',
    kind: 'brand-kit',
    project: 'testorbit',
    project_name: 'TestOrbit',
    version: 1,
    document_markdown: documentMarkdown,
    content_sha256: createHash('sha256').update(documentMarkdown, 'utf8').digest('hex'),
    intake: {
      mode: 'form',
      completed_at: '2026-08-07T00:00:00Z',
      answers: Array.from({ length: 7 }, (_, i) => ({ question_number: i + 1, question: `Q${i + 1}?`, answer: `A${i + 1}` })),
    },
    ...overrides,
  };
}

describe('BrandKitService', () => {
  let service: BrandKitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BrandKitService();
  });

  describe('startGeneration', () => {
    it('renders the batch-intake message and creates the session with the catalog handle', async () => {
      guildMocks.createSession.mockResolvedValue('session-1');
      const answers = {
        project_name: 'TestOrbit',
        github_url: 'https://github.com/test/orbit',
        one_line_description: 'A test project',
        primary_audience: 'Engineers',
        voice_adjectives: 'clear, bold, open',
        constraints: 'none',
        reference_brands: 'Kubernetes',
      };

      const sessionId = await service.startGeneration(req, answers, 'brand-kit');

      expect(sessionId).toBe('session-1');
      expect(guildMocks.createSession).toHaveBeenCalledOnce();
      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.handle).toBe('brand-kit');
      expect(params.message).toContain('BATCH INTAKE SUBMISSION');
      expect(params.message).toContain('A1. TestOrbit');
      expect(params.message).toContain('A7. Kubernetes');
    });
  });

  describe('getResult', () => {
    it('returns pending when no envelope is present in the events', async () => {
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'runtime_start' })]);

      await expect(service.getResult(req, 's')).resolves.toEqual({ status: 'pending' });
    });

    it('returns ready with the validated document from a tool-result envelope', async () => {
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: { envelope_json: JSON.stringify(envelope) } })]);

      const result = await service.getResult(req, 's');

      expect(result.status).toBe('ready');
      expect(result.documentMarkdown).toBe(envelope['document_markdown']);
      expect(result.project).toBe('testorbit');
      expect(result.projectName).toBe('TestOrbit');
      expect(result.version).toBe(1);
      expect(result.intakeMode).toBe('form');
    });

    it('suppresses an envelope whose content_sha256 does not match the document bytes', async () => {
      const tampered = buildEnvelope({ content_sha256: 'a'.repeat(64) });
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: tampered })]);

      await expect(service.getResult(req, 's')).resolves.toEqual({ status: 'pending' });
    });

    it('prefers the highest version among valid envelopes regardless of event order', async () => {
      const v2Doc = `${buildDocument()}\nRevised.`;
      const v1 = buildEnvelope();
      const v2 = buildEnvelope({ version: 2, document_markdown: v2Doc, content_sha256: createHash('sha256').update(v2Doc, 'utf8').digest('hex') });
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: v2 }), JSON.stringify({ type: 'llm_done', content: v1 })]);

      const result = await service.getResult(req, 's');

      expect(result.status).toBe('ready');
      expect(result.version).toBe(2);
    });

    it('ignores schema-invalid candidates (abridged __submit__ output)', async () => {
      const abridged = { contract: 'brand-kit-output/v1', kind: 'brand-kit', project: 'testorbit', version: 1, document_markdown: 'too short' };
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'runtime_done', content: abridged })]);

      await expect(service.getResult(req, 's')).resolves.toEqual({ status: 'pending' });
    });
  });
});
