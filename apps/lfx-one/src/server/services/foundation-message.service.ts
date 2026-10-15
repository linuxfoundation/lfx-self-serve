// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_MESSAGE_CONTRACT_ID,
  FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS,
  FOUNDATION_MESSAGE_SOURCE_FIELDS,
  FOUNDATION_MESSAGE_SOURCE_MAX_CHARS,
  MKTG_ARTIFACT_SPECS,
} from '@lfx-one/shared/constants';
import {
  FoundationMessageEnvelope,
  FoundationMessageExistingDocument,
  FoundationMessageGenerationStart,
  FoundationMessagePersistReceipt,
  FoundationMessageResultResponse,
  FoundationMessageSourceKind,
  FoundationMessageStoredResponse,
  MktgIntakeDocument,
} from '@lfx-one/shared/interfaces';
import {
  buildFoundationMessageFormPayload,
  extractMktgEnvelopeCandidates,
  foundationMessageDerivatives,
  foundationMessageSourceUrl,
  renderFoundationMessageFormText,
  validateFoundationMessageEnvelope,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { MktgReadBudget } from '../helpers/mktg-document-read-gate.helper';
import { GithubReadmeService } from './github-readme.service';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { MktgSourceTextService } from './mktg-source-text.service';

/**
 * Messaging Document generation flow (messaging-document-output/v1; Guild
 * linux-foundation~foundation-message 2.0.0, Paul's messaging-document 1.0.0).
 *
 * 1. The agent cannot fetch, so LFX One reads everything to text first, in
 *    parallel: the GitHub README (through the GitHub API, as before), the
 *    website, press release and brand page (through the SSRF-safe fetcher),
 *    and every existing document given as a link. Uploaded files arrive
 *    already read. Nothing read here can fail the run: a source that could
 *    not be read goes to the agent as "not read", and the agent records it so.
 *    The parses share one time budget per generate (`generateParseBudgetMs`)
 *    and run one at a time through the process-wide read gate.
 * 2. The answers and texts become the agent's `messaging_document_intake_form`
 *    and are sent as the one rendered text message the agent parses back
 *    (`renderFoundationMessageFormText`, a verbatim mirror of its renderer;
 *    dec-qa-form-path-only). `GUILD_STRUCTURED_AGENT_INPUT=true` still flips to
 *    the structured transport for when Guild passes objects through.
 * 3. The authoritative output is the finalize tool RESULT riding raw session
 *    events. Every candidate is schema-validated and its document sha256
 *    recomputed before anything reaches the user, and the validated bundle is
 *    stored as a revision of the project's foundation-message document.
 */
export class FoundationMessageService {
  private readonly guildService = new GuildService();
  private readonly githubReadmeService = new GithubReadmeService();
  private readonly sourceTextService = new MktgSourceTextService();

  /**
   * The Marketing OS document store over the SHARED agent-artifact persistence
   * layer: every validated bundle is written through the artifact layer and
   * recorded as a revision of the project's foundation-message document (its
   * sidecar, brand seed and inputs record ride in the revision), whose latest
   * revision is what the stored read serves.
   */
  private readonly documentStore = new MktgDocumentStoreService();

  /** The foundation-message knobs for the shared persistence layer: key prefix, size cap, log namespace. */
  private readonly artifactSpec = MKTG_ARTIFACT_SPECS['foundation-message'];

  /**
   * Event-loop time one generate may spend parsing its sources and documents,
   * together. Ordinary pages and files take milliseconds each; only crafted
   * ones come near it, and those then stop rather than add up.
   */
  private readonly generateParseBudgetMs = 1_000;

  /** Structured `agent_input` transport, default OFF (Guild coerces objects to JSON text before the agent's preprocess). */
  private get structuredAgentInputEnabled(): boolean {
    return process.env['GUILD_STRUCTURED_AGENT_INPUT'] === 'true';
  }

  /**
   * Start a one-shot generation on a fresh session. Returns the session id —
   * which the caller binds to the requesting user via the owner token — and
   * the README fetch outcome, so a document generated without the README the
   * user named can say so.
   */
  public async startGeneration(
    req: Request,
    answers: Record<string, string>,
    documents: MktgIntakeDocument[],
    guildAgentHandle: string
  ): Promise<FoundationMessageGenerationStart> {
    const url = (kind: FoundationMessageSourceKind): string | null => foundationMessageSourceUrl(answers[FOUNDATION_MESSAGE_SOURCE_FIELDS[kind].urlKey]);
    const githubUrl = url('readme');
    const budget = new MktgReadBudget(this.generateParseBudgetMs);
    const page = async (kind: FoundationMessageSourceKind): Promise<string | undefined> => {
      const link = url(kind);
      return link === null ? undefined : ((await this.sourceTextService.readLink(req, link, FOUNDATION_MESSAGE_SOURCE_MAX_CHARS, budget)).text ?? undefined);
    };

    // Fetched in parallel (the read gate bounds how many at once), parsed one at a time: the generate POST waits for all of it.
    const [readme, website, pressRelease, brandPage, existingDocuments] = await Promise.all([
      githubUrl === null ? Promise.resolve(null) : this.githubReadmeService.fetchReadme(req, githubUrl),
      page('website'),
      page('press_release'),
      page('brand_page'),
      Promise.all(documents.map((document) => this.readDocument(req, document, budget))),
    ]);

    const payload = buildFoundationMessageFormPayload(answers, {
      sourceTexts: { website, readme: readme?.readme ?? undefined, press_release: pressRelease, brand_page: brandPage },
      documents: existingDocuments,
    });

    logger.info(req, 'foundation_message_generate', 'Composed the Messaging Document intake', {
      sources_given: [githubUrl, url('website'), url('press_release'), url('brand_page')].filter((link) => link !== null).length,
      sources_read: [readme?.readme, website, pressRelease, brandPage].filter((text) => !!text).length,
      documents: existingDocuments.length,
      documents_read: existingDocuments.filter((document) => document.text !== undefined).length,
      readme_skip_reason: readme?.outcome.skipReason,
    });

    const sessionId = this.structuredAgentInputEnabled
      ? await this.guildService.createSession(req, { agentInput: payload, handle: guildAgentHandle })
      : await this.guildService.createSession(req, { message: renderFoundationMessageFormText(payload), handle: guildAgentHandle });
    return { sessionId, ...(readme && { readme: readme.outcome }) };
  }

  /**
   * Fetch the session's current result: `pending` until a valid envelope
   * appears in the event stream, then `ready` with the validated document, its
   * copy primitives and (when the write succeeded) the persistence receipt of
   * the stored revision. `projectUid` decides the storage partition and is
   * entitlement-checked before anything is written; without it the document
   * is still returned, just not stored.
   */
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<FoundationMessageResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);

    if (!envelope) {
      return { status: 'pending' };
    }

    logger.info(req, 'foundation_message_result', 'Messaging Document ready', {
      project: envelope.project,
      version: envelope.version,
      mode: envelope.mode,
      shape: envelope.intake.shape,
      status: envelope.status,
      agent_version: envelope.agent.agent_version,
      document_chars: envelope.document_markdown.length,
    });

    const persistence = await this.persistEnvelope(req, envelope, sessionId, projectUid);

    return {
      status: 'ready',
      documentMarkdown: envelope.document_markdown,
      version: envelope.version,
      derivatives: foundationMessageDerivatives(envelope),
      projectName: envelope.project_name,
      project: envelope.project,
      documentStatus: envelope.status,
      ...(persistence && { persistence }),
    };
  }

  /**
   * The project's LATEST stored document — its latest revision, restored ones
   * included — which is what sibling agents (the ICP) attach. Falls back to the
   * pre-revision read path when the document has no revisions yet.
   */
  public async getStoredFoundationMessage(req: Request, project: string): Promise<FoundationMessageStoredResponse | null> {
    return this.documentStore.readLatest(req, this.artifactSpec, project);
  }

  /** One existing document as the agent takes it: a link is (re-)read here, a file's text is passed through. */
  private async readDocument(req: Request, document: MktgIntakeDocument, budget: MktgReadBudget): Promise<FoundationMessageExistingDocument> {
    const title = document.title.trim();
    if (document.kind === 'file') {
      return { title, text: document.text ?? '' };
    }
    const url = (document.url ?? '').trim();
    const read = await this.sourceTextService.readLink(req, url, FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS, budget);
    return read.text === null ? { title, url } : { title, url, text: read.text };
  }

  /**
   * Persist the validated bundle and record it as a new revision of the
   * project's foundation-message document. Every refusal and storage failure
   * degrades to null at WARN — the document still reaches the user, without a
   * receipt, and the next poll retries the idempotent write.
   */
  private async persistEnvelope(
    req: Request,
    envelope: FoundationMessageEnvelope,
    sessionId: string,
    projectUid?: string
  ): Promise<FoundationMessagePersistReceipt | null> {
    return this.documentStore.persistGeneration(req, this.artifactSpec, envelope, projectUid, sessionId);
  }

  /**
   * Scan raw event payloads (chronologically ordered) for envelope candidates
   * and return the authoritative one: the highest `version` among valid
   * candidates, the latest occurrence winning ties. The sha256 integrity gate
   * runs PER CANDIDATE, before version selection — a newer candidate that
   * fails the recompute must not shadow an older valid one.
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): FoundationMessageEnvelope | null {
    let best: FoundationMessageEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const payload of payloads) {
      for (const candidate of extractMktgEnvelopeCandidates(payload, FOUNDATION_MESSAGE_CONTRACT_ID)) {
        candidateCount++;
        const result = validateFoundationMessageEnvelope(candidate);
        if (!result.valid) {
          invalidCount++;
          logger.debug(req, 'foundation_message_result', 'Rejected envelope candidate', { errors: result.errors });
          continue;
        }
        // Safe: validateFoundationMessageEnvelope passed every schema gate.
        const envelope = candidate as FoundationMessageEnvelope;
        const recomputedSha = createHash('sha256').update(Buffer.from(envelope.document_markdown, 'utf8')).digest('hex');
        if (recomputedSha !== envelope.content_sha256) {
          invalidCount++;
          logger.warning(req, 'foundation_message_result', 'Envelope content_sha256 does not match the document bytes — discarding candidate', {
            expected: envelope.content_sha256,
            recomputed: recomputedSha,
          });
          continue;
        }
        if (!best || envelope.version >= best.version) {
          best = envelope;
        }
      }
    }

    logger.debug(req, 'foundation_message_result', 'Envelope scan complete', {
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!best,
    });

    return best;
  }
}
