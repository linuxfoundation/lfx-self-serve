// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors brand-kit.service.spec.ts / foundation-message.service.spec.ts: the
// `@lfx-one/shared/*` alias isn't wired into this app's vitest config with
// Angular-free resolution, so shared runtime collaborators are mocked — except
// the pure ICP + envelope utils, which are re-exported through the mock from
// their real (Angular-free) source modules so the spec exercises the real
// payload/validation logic.
const guildMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getRawEventPayloads: vi.fn(),
}));
const readmeMocks = vi.hoisted(() => ({
  fetchReadme: vi.fn(),
}));
const objectStoreMocks = vi.hoisted(() => ({
  putContentAddressedObject: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
}));
const loggerMocks = vi.hoisted(() => ({
  startOperation: vi.fn(() => 0),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@lfx-one/shared/utils', async () => {
  const icp = await vi.importActual('../../../../../packages/shared/src/utils/icp.utils');
  const envelope = await vi.importActual('../../../../../packages/shared/src/utils/mktg-envelope.utils');
  return { ...(icp as object), ...(envelope as object) };
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/icp.constants');
  return constants;
});
vi.mock('./guild.service', () => ({
  GuildService: class {
    public createSession = guildMocks.createSession;
    public getRawEventPayloads = guildMocks.getRawEventPayloads;
  },
}));
vi.mock('./github-readme.service', () => ({
  GithubReadmeService: class {
    public fetchReadme = readmeMocks.fetchReadme;
  },
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public putContentAddressedObject = objectStoreMocks.putContentAddressedObject;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));
vi.mock('./logger.service', () => ({
  logger: loggerMocks,
}));

import type { Request } from 'express';

import {
  ICP_DIMENSION_FIELDS,
  ICP_PERSONA_FIELDS,
  ICP_REQUIRED_HEADINGS,
  ICP_REQUIRED_SUBHEADINGS,
  ICP_REVISED_INTAKE_FEEDBACK,
} from '@lfx-one/shared/constants';

import { IcpService } from './icp.service';

const req = { path: '/api/mktg-agents/icp/result' } as unknown as Request;

/** The run's LFX project uid — the storage partition, resolved server-side. */
const PROJECT_UID = 'proj-uid-1';

const answers = (): Record<string, string> => ({
  project_name: 'TestOrbit',
  github_url: 'https://github.com/example-org/testorbit',
  business_outcome: 'Membership growth',
});

const structure = () => ({
  icps: [
    { label: 'Cloud-native platform vendors', personas: ['Platform Architect', 'VP of Engineering'] },
    { label: 'Enterprise adopters', personas: ['Head of Infrastructure', 'Staff SRE'] },
  ],
  fit_warmth_attributes: ['Kubernetes footprint', 'Contributor headcount', 'Existing LF membership', 'Public adoption signal'],
  disqualifiers: 'confirmed' as const,
});

function buildDocument(): string {
  const spine = structure();
  const filler = 'Synthetic fixture prose for the ICP structural gates. '.repeat(4);
  const lines: string[] = ['# TestOrbit ICP & Target Markets', ''];
  for (const heading of ICP_REQUIRED_HEADINGS) {
    lines.push(heading, '');
    if (heading === '## 1. Market Segment Overview') {
      lines.push(...ICP_REQUIRED_SUBHEADINGS.flatMap((sub) => [sub, '', filler, '']));
      continue;
    }
    lines.push(filler, '');
  }
  lines.push(...ICP_DIMENSION_FIELDS.map((field) => `- ${field}: covered`));
  lines.push(...ICP_PERSONA_FIELDS.map((field) => `- ${field}: covered`));
  lines.push(...spine.icps.map((icp) => `- ${icp.label}`));
  lines.push(...spine.icps.flatMap((icp) => icp.personas.map((persona) => `- ${persona}`)));
  lines.push(...spine.fit_warmth_attributes.map((attribute) => `- ${attribute}`));
  return lines.join('\n');
}

function buildEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const documentMarkdown = (overrides['document_markdown'] as string) ?? buildDocument();
  return {
    contract: 'icp-output/v1',
    kind: 'icp',
    project: 'testorbit',
    project_name: 'TestOrbit',
    version: 1,
    document_markdown: documentMarkdown,
    content_sha256: createHash('sha256').update(documentMarkdown, 'utf8').digest('hex'),
    business_outcome: 'Membership growth',
    structure: structure(),
    inputs: { brand_kit_provided: false, message_foundation_provided: false, live_membership_data_provided: false },
    intake: {
      mode: 'form',
      completed_at: '2026-09-10T00:00:00Z',
      answers: [
        { question_number: 1, question: 'Q1', answer: 'A1' },
        { question_number: 2, question: 'Q2', answer: 'A2' },
        { question_number: 4, question: 'Q4', answer: 'A4' },
      ],
    },
    ...overrides,
  };
}

/** A raw Guild event payload carrying the finalize tool result's envelope. */
const toolResultPayload = (envelope: Record<string, unknown>): string => JSON.stringify({ content: [{ envelope_json: JSON.stringify(envelope) }] });

describe('IcpService', () => {
  let service: IcpService;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GUILD_STRUCTURED_AGENT_INPUT'];
    readmeMocks.fetchReadme.mockResolvedValue({ readme: '# TestOrbit', outcome: { fetched: true, source: 'repository' } });
    objectStoreMocks.putContentAddressedObject.mockResolvedValue(true);
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT_UID, slug: 'testorbit', writer: true });
    guildMocks.createSession.mockResolvedValue('session-1');
    service = new IcpService();
  });

  describe('startGeneration', () => {
    it('renders the agent’s batch message and routes with the catalog handle', async () => {
      const result = await service.startGeneration(req, answers(), {}, 'icp');

      expect(result).toEqual({ sessionId: 'session-1', readme: { fetched: true, source: 'repository' } });
      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.handle).toBe('icp');
      expect(params.agentInput).toBeUndefined();
      expect(params.message).toContain('BATCH INTAKE SUBMISSION (form mode');
      expect(params.message).toContain('A1a. TestOrbit');
      expect(params.message).toContain('===== BEGIN GITHUB README =====');
    });

    it('never blocks the run when the README fetch produced nothing', async () => {
      readmeMocks.fetchReadme.mockResolvedValue({ readme: null, outcome: { fetched: false, skipReason: 'no-readme' } });

      const result = await service.startGeneration(req, answers(), {}, 'icp');

      expect(result.readme).toEqual({ fetched: false, skipReason: 'no-readme' });
      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.message).toContain('No README content was provided.');
      expect(loggerMocks.warning).toHaveBeenCalled();
    });

    it('attaches the sibling documents the run resolved, and says so to the agent', async () => {
      await service.startGeneration(
        req,
        { ...answers(), brand_kit_markdown: '# TestOrbit Brand Kit', message_foundation_markdown: '# TestOrbit Message Foundation' },
        {},
        'icp'
      );

      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.message).toContain('A1c. Yes — the full Brand Kit and Message Foundation documents are provided below.');
      expect(params.message).toContain('# TestOrbit Brand Kit');
    });

    it('tells the agent to proceed lower-confidence when neither sibling document exists', async () => {
      await service.startGeneration(req, answers(), {}, 'icp');

      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.message).toContain('A1c. No — neither document exists yet for this project.');
    });

    it('carries the version directive on an edit-inputs resubmit with no user feedback', async () => {
      await service.startGeneration(req, answers(), { priorVersion: 2 }, 'icp');

      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.message).toContain('FEEDBACK on draft v2 — regenerate incorporating it and finalize as version 3:');
      expect(params.message).toContain(ICP_REVISED_INTAKE_FEEDBACK);
    });

    it('sends the typed payload as a structured agent input when the transport flag is on', async () => {
      process.env['GUILD_STRUCTURED_AGENT_INPUT'] = 'true';

      await service.startGeneration(req, answers(), {}, 'icp');

      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.message).toBeUndefined();
      expect(params.agentInput).toMatchObject({ type: 'icp_intake_form', project_name: 'TestOrbit' });
    });
  });

  describe('getResult', () => {
    it('stays pending until a valid envelope appears', async () => {
      guildMocks.getRawEventPayloads.mockResolvedValue(['the agent is thinking about segments']);

      await expect(service.getResult(req, 'session-1', PROJECT_UID)).resolves.toEqual({ status: 'pending' });
      expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
    });

    it('returns the validated document and persists it under the ICP key prefix', async () => {
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(envelope)]);

      const result = await service.getResult(req, 'session-1', PROJECT_UID);

      expect(result.status).toBe('ready');
      expect(result.documentMarkdown).toBe(envelope['document_markdown']);
      expect(result.persistence).toEqual({
        s3_key: `icp/${PROJECT_UID}/${envelope['content_sha256'] as string}.md`,
        content_sha256: envelope['content_sha256'],
        project: PROJECT_UID,
        version: 1,
      });
      const [, purpose, key, , contentType] = objectStoreMocks.putContentAddressedObject.mock.calls[0];
      expect(purpose).toBe('marketing-os-artifacts');
      expect(key).toBe(`icp/${PROJECT_UID}/${envelope['content_sha256'] as string}.md`);
      expect(contentType).toBe('text/markdown; charset=utf-8');
    });

    it('discards a candidate whose content_sha256 does not match the document bytes', async () => {
      const tampered = buildEnvelope({ content_sha256: 'f'.repeat(64) });
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(tampered)]);

      await expect(service.getResult(req, 'session-1', PROJECT_UID)).resolves.toEqual({ status: 'pending' });
    });

    it('discards a candidate that fails the contract’s structure gates', async () => {
      const broken = buildEnvelope({ structure: { ...structure(), fit_warmth_attributes: ['only one'] } });
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(broken)]);

      await expect(service.getResult(req, 'session-1', PROJECT_UID)).resolves.toEqual({ status: 'pending' });
    });

    it('prefers the highest version among valid candidates', async () => {
      const v1 = buildEnvelope();
      const v2 = buildEnvelope({ version: 2 });
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(v2), toolResultPayload(v1)]);

      const result = await service.getResult(req, 'session-1', PROJECT_UID);

      expect(result.version).toBe(2);
    });

    it('returns the document without a receipt when the caller lacks the project writer grant', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT_UID, slug: 'testorbit', writer: false });
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);

      const result = await service.getResult(req, 'session-1', PROJECT_UID);

      expect(result.status).toBe('ready');
      expect(result.persistence).toBeUndefined();
      expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
    });

    it('never persists into a partition the client named rather than the server resolved', async () => {
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);

      const result = await service.getResult(req, 'session-1', '../other-project');

      expect(result.status).toBe('ready');
      expect(result.persistence).toBeUndefined();
      expect(projectMocks.getProjectById).not.toHaveBeenCalled();
    });

    it('returns the document without a receipt when there is no project scope', async () => {
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);

      const result = await service.getResult(req, 'session-1');

      expect(result.status).toBe('ready');
      expect(result.persistence).toBeUndefined();
    });

    it('degrades to a receipt-less ready result when the object-store write fails', async () => {
      objectStoreMocks.putContentAddressedObject.mockRejectedValue(new Error('bucket unreachable'));
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);

      const result = await service.getResult(req, 'session-1', PROJECT_UID);

      expect(result.status).toBe('ready');
      expect(result.persistence).toBeUndefined();
      expect(loggerMocks.warning).toHaveBeenCalled();
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });

    it('refreshes the stored metadata only for a strictly newer draft', async () => {
      guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope({ version: 3 }))]);

      await service.getResult(req, 'session-1', PROJECT_UID);

      const options = objectStoreMocks.putContentAddressedObject.mock.calls[0][7] as { refreshMetadataWhen: (stored: Record<string, string>) => boolean };
      expect(options.refreshMetadataWhen({ version: '2' })).toBe(true);
      expect(options.refreshMetadataWhen({ version: '3' })).toBe(false);
      expect(options.refreshMetadataWhen({})).toBe(true);
    });
  });
});
