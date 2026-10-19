// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_SPECS,
  MKTG_SLIDES_EXPORT_CONTRACT_ID,
  MKTG_SLIDES_EXPORT_ERROR_SETTLE_MS,
  MKTG_SLIDES_EXPORT_ERROR_TEARDOWN_MS,
  MKTG_SLIDES_EXPORT_FOLDER_ID,
  MKTG_SLIDES_EXPORT_GUILD_HANDLE,
  MKTG_SLIDES_EXPORT_LOGO_CONTENT_TYPE,
  MKTG_SLIDES_EXPORT_LOGO_KEY_PREFIX,
  MKTG_SLIDES_EXPORT_MAX_LOGO_URL_CHARS,
  MKTG_SLIDES_EXPORT_POLL,
  MKTG_SLIDES_EXPORT_RECORD_SCHEMA,
  MKTG_REVISION_CONTENT_TYPE,
} from '@lfx-one/shared/constants';
import {
  BrandKitRevision,
  MktgDocumentType,
  MktgRevisionSummary,
  MktgSlidesExportAgentKey,
  MktgSlidesExportEnvelope,
  MktgSlidesExportForm,
  MktgSlidesExportLastResponse,
  MktgSlidesExportLogoNote,
  MktgSlidesExportRecord,
  MktgSlidesExportResultContext,
  MktgSlidesExportResultResponse,
  MktgSlidesExportRevisionRef,
  MktgSlidesExportStarted,
  MktgSlidesExportStartInput,
  MktgStoredRevision,
} from '@lfx-one/shared/interfaces';
import {
  buildMktgSlidesExportPrefix,
  buildMktgSlidesExportRecordKey,
  classifyMktgSlidesExportFailure,
  extractMktgEnvelopeCandidates,
  mktgSlidesExportContentJson,
  mktgSlidesExportDeckTitle,
  mktgSlidesExportFailed,
  mktgSlidesExportOneLine,
  mktgSlidesExportToday,
  parseMktgSlidesExportRecordKey,
  readBrandKitRevision,
  readFoundationMessageContent,
  readMktgSlidesExportRecord,
  renderMktgSlidesExportFormMessage,
  validateMktgSlidesExportEnvelope,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { ConflictError, ResourceNotFoundError } from '../errors';
import { getAvatarCdnPrefix } from '../utils/avatar-url.util';
import { rasterizeLogoSvg } from '../utils/mktg-logo-png.util';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ObjectStoreService } from './object-store.service';

/**
 * Export to Google Slides (slides-export-output/v1; Guild
 * linux-foundation~slides-export, a coded agent with no model).
 *
 * 1. Start: the asset is read from the document store, never from the
 *    browser — the revision the page names, as LFX One stores it: a
 *    framework revision's `{mf, icp, mh, nums}` plus the project's stored
 *    Brand Kit tokens when it has a kit (so the deck takes its colours and
 *    typeface), a kit revision's tokens. The deck goes to the Marketing OS
 *    folder (`folder_id`) or, on an update, refreshes the deck of the
 *    document's last export (`deck_id`, from the stored export record, never
 *    the browser). The form is sent as the one rendered text message the
 *    exporter parses back, with the `@slides-export` mention on a line of
 *    its own so the intake header line stays intact.
 * 2. The logo: the Slides API fetches a public PNG, JPEG or GIF; the kit
 *    stores SVG. This server draws the stored kit's primary logo as a PNG
 *    (never bytes from the browser: what is published is always the kit's
 *    own logo) and publishes it to the public, CDN-fronted image bucket
 *    under a content-addressed key.
 *    Where there is no public URL (local development: no CDN prefix, and the
 *    object store is not reachable from Google) no logo is sent: the deck
 *    still takes the kit's colours and typeface, and the result says so.
 * 3. Result: the exporter's final output — the envelope as text on its
 *    `agent_notification_message` — is validated and its `content_sha256`
 *    recomputed; the deck is then kept as an export record beside the
 *    revision it was made from (`slides-exports/{project}/{agentKey}/
 *    {documentId}/{time}-{sha}.json`, immutable and content-addressed, no
 *    personal identity). An error event, or a final output that is not an
 *    envelope, is a failed export, answered with a plain message only.
 *    The server polls every export it starts to its end itself, so the
 *    record is kept even when no browser does (the page left mid-export);
 *    the browser's polls write the same content-addressed record, once.
 */
export class MktgSlidesExportService {
  private readonly guildService = new GuildService();
  private readonly documentStore = new MktgDocumentStoreService();
  private readonly objectStore = new ObjectStoreService();

  /** Start an export on a fresh session. Throws a 404 when the revision is not stored, a 409 when it holds nothing to export or there is no deck to update. */
  public async startExport(req: Request, input: MktgSlidesExportStartInput): Promise<MktgSlidesExportStarted> {
    const found = await this.documentStore.readExportRevision(req, input.project, input.type, input.documentId, input.selector);
    if (!found) {
      throw new ResourceNotFoundError('Stored revision to export', input.selector.revisionId ?? input.selector.contentSha256, {
        operation: 'mktg_slides_export_start',
        service: 'mktg_slides_export_service',
        path: req.path,
        code: 'REVISION_NOT_STORED',
      });
    }

    const { assets, kit } = await this.exportAssets(req, input, found.revision);

    let deckId: string | undefined;
    if (input.mode === 'update') {
      const last = await this.readLastExport(req, input.project, input.agentKey, input.documentId);
      if (!last) {
        throw new ConflictError('There is no earlier deck to update. Create a new deck instead.', 'NO_DECK_TO_UPDATE', {
          operation: 'mktg_slides_export_start',
          service: 'mktg_slides_export_service',
          path: req.path,
        });
      }
      deckId = last.deckId;
    }

    const logo = await this.publishLogo(req, input.project, kit);
    const projectName = mktgSlidesExportOneLine(input.projectName) || input.project;
    const runDate = mktgSlidesExportToday();
    const form: MktgSlidesExportForm = {
      project_name: projectName,
      run_date: runDate,
      ...(deckId
        ? { deck_id: deckId }
        : { folder_id: MKTG_SLIDES_EXPORT_FOLDER_ID, deck_title: mktgSlidesExportDeckTitle(input.agentKey, projectName, runDate) }),
      ...(logo.url && { logo_url: logo.url }),
      assets,
    };

    logger.info(req, 'mktg_slides_export_start', 'Composed the Slides export intake', {
      agent: input.agentKey,
      revision: found.summary.number,
      mode: input.mode,
      assets: Object.keys(assets),
      has_logo: !!logo.url,
      logo_note: logo.note,
    });

    const sessionId = await this.guildService.createSession(req, {
      message: renderMktgSlidesExportFormMessage(form),
      handle: MKTG_SLIDES_EXPORT_GUILD_HANDLE,
      mentionOnOwnLine: true,
    });

    this.finishInBackground(req, sessionId, {
      project: input.project,
      type: input.type,
      agentKey: input.agentKey,
      documentId: input.documentId,
      revisionId: found.summary.id,
    });

    return { sessionId, revision: this.revisionRef(found.summary), mode: input.mode, logoNote: logo.note };
  }

  /**
   * The session's result: `ready` with the export record once a valid
   * envelope is the exporter's output (the record is kept beside the
   * revision; a failed write is logged and the deck still returned),
   * `failed` with a plain message on an error, `pending` otherwise.
   */
  public async getResult(req: Request, sessionId: string, context: MktgSlidesExportResultContext): Promise<MktgSlidesExportResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const { envelope, otherOutput } = this.readOutputs(req, payloads);

    if (envelope) {
      const found = await this.documentStore.readExportRevision(req, context.project, context.type, context.documentId, { revisionId: context.revisionId });
      if (!found) {
        throw new ResourceNotFoundError('Exported revision', context.revisionId, {
          operation: 'mktg_slides_export_result',
          service: 'mktg_slides_export_service',
          path: req.path,
        });
      }
      const record = this.buildRecord(context, found.summary, envelope);
      await this.keepRecord(req, record);
      logger.info(req, 'mktg_slides_export_result', 'Slides export ready', {
        agent: context.agentKey,
        mode: envelope.mode,
        slides: envelope.slide_count,
        kit: envelope.content.branded.kit,
        logo: envelope.content.branded.logo,
        logos_skipped: envelope.content.branded.logos_skipped,
        agent_version: envelope.agent.agent_version,
      });
      return { status: 'ready', record };
    }

    const failureText = otherOutput ?? this.readErrorText(payloads);
    if (failureText !== null) {
      const { failure, deckLink } = classifyMktgSlidesExportFailure(failureText);
      logger.warning(req, 'mktg_slides_export_result', 'Slides export failed', {
        agent: context.agentKey,
        failure,
        has_deck: !!deckLink,
        detail: failureText.slice(0, 500),
      });
      return mktgSlidesExportFailed(failure, deckLink);
    }

    return { status: 'pending' };
  }

  /** The document's last export and its latest stored revision. */
  public async getLast(
    req: Request,
    project: string,
    type: MktgDocumentType,
    agentKey: MktgSlidesExportAgentKey,
    documentId: string
  ): Promise<MktgSlidesExportLastResponse> {
    const [last, found] = await Promise.all([
      this.readLastExport(req, project, agentKey, documentId),
      this.documentStore.readExportRevision(req, project, type, documentId, {}),
    ]);
    return { last, latestRevision: found ? this.revisionRef(found.latest) : null };
  }

  /**
   * Poll a started export to its end on the server, on the browser's
   * interval and within its deadline: `getResult` keeps the record of a ready
   * deck, so the deck is never left without one when the page that started
   * it goes before the end (the next visit would offer Create again and make
   * a second deck). A failed poll is logged and the next one tries again.
   * The timers never hold the process open; an export still running when the
   * server stops is kept by the browser's own polls, as before.
   */
  private finishInBackground(req: Request, sessionId: string, context: MktgSlidesExportResultContext): void {
    const deadline = Date.now() + MKTG_SLIDES_EXPORT_POLL.timeoutMs;
    const schedule = (): void => {
      if (Date.now() + MKTG_SLIDES_EXPORT_POLL.intervalMs > deadline) {
        logger.warning(req, 'mktg_slides_export_finish', 'Slides export still pending at its deadline — no record kept by the server', {
          session_id: sessionId,
          agent: context.agentKey,
        });
        return;
      }
      setTimeout(() => void poll(), MKTG_SLIDES_EXPORT_POLL.intervalMs).unref();
    };
    const poll = async (): Promise<void> => {
      try {
        const result = await this.getResult(req, sessionId, context);
        if (result.status !== 'pending') {
          return;
        }
      } catch (error) {
        logger.warning(req, 'mktg_slides_export_finish', 'Server-side export poll failed — trying again', { session_id: sessionId, err: error });
      }
      schedule();
    };
    schedule();
  }

  /**
   * The assets object as the exporter reads it, and the kit whose logo the
   * deck carries: a framework revision's content with the project's stored
   * kit tokens when there is a kit, or a kit revision's tokens.
   */
  private async exportAssets(
    req: Request,
    input: MktgSlidesExportStartInput,
    revision: MktgStoredRevision
  ): Promise<{ assets: MktgSlidesExportForm['assets']; kit: BrandKitRevision | null }> {
    const nothing = (what: string): ConflictError =>
      new ConflictError(`This revision holds no ${what} to export.`, 'NOTHING_TO_EXPORT', {
        operation: 'mktg_slides_export_start',
        service: 'mktg_slides_export_service',
        path: req.path,
      });

    if (input.agentKey === 'brand-kit') {
      const kit = readBrandKitRevision(revision.record.bundle.sidecar);
      if (!kit) {
        throw nothing('brand kit');
      }
      // The kit's own export sends the stored kit with its chapters, so the deck
      // lays out the whole book (slides-export >= 1.1.0); its tokens alone only
      // make the short deck. A framework export below sends the tokens: they
      // brand that deck without adding the kit's pages to it.
      const { projectName, version, generatedAt, websiteUrl, chapters } = kit;
      return { assets: { kit: { kit: kit.kit, chapters, projectName, version, generatedAt, websiteUrl } }, kit };
    }

    const framework = revision.record.bundle.format === 'json' ? readFoundationMessageContent(revision.record.bundle.markdown) : null;
    if (!framework) {
      throw nothing('messaging framework');
    }
    const stored = await this.documentStore.readLatest(req, MKTG_ARTIFACT_SPECS['brand-kit'], input.project, { withSidecar: true });
    const kit = readBrandKitRevision(stored?.sidecar ?? null);
    return { assets: kit ? { framework, kit: kit.kit } : { framework }, kit };
  }

  /**
   * Draw the stored kit's primary SVG logo as a PNG and publish it where
   * Google can fetch it, or say why not. The URL is the public image
   * bucket's, which exists only where a CDN prefix is configured, so the
   * drawing is skipped where there is none.
   */
  private async publishLogo(
    req: Request,
    project: string,
    kit: BrandKitRevision | null
  ): Promise<{ url: string | null; note: MktgSlidesExportLogoNote | null }> {
    const svg = kit?.chapters.logo.files.primary?.svg;
    if (!svg) {
      return { url: null, note: 'no-logo' };
    }

    let cdnPrefix: string | null;
    try {
      cdnPrefix = getAvatarCdnPrefix();
    } catch (error) {
      logger.warning(req, 'mktg_slides_export_logo', 'The public image prefix is misconfigured — exporting without the logo', { err: error });
      return { url: null, note: 'not-published' };
    }
    if (!cdnPrefix) {
      logger.debug(req, 'mktg_slides_export_logo', 'No public image URL in this environment — exporting without the logo', {});
      return { url: null, note: 'not-public' };
    }

    const drawn = await rasterizeLogoSvg(svg);
    if (drawn.png === null) {
      logger.warning(req, 'mktg_slides_export_logo', 'The kit logo could not be drawn as a PNG — exporting without it', {
        reason: drawn.reason,
        detail: drawn.detail,
        svg_chars: svg.length,
      });
      return { url: null, note: 'not-drawn' };
    }

    const png = Buffer.from(drawn.png);
    const key = `${MKTG_SLIDES_EXPORT_LOGO_KEY_PREFIX}/${project}/${createHash('sha256').update(png).digest('hex')}.png`;
    try {
      const { url } = await this.objectStore.putPublicImage(req, key, png, MKTG_SLIDES_EXPORT_LOGO_CONTENT_TYPE);
      if (!url || url.length > MKTG_SLIDES_EXPORT_MAX_LOGO_URL_CHARS) {
        return { url: null, note: 'not-public' };
      }
      return { url, note: null };
    } catch (error) {
      logger.warning(req, 'mktg_slides_export_logo', 'The logo could not be published — exporting without it', { key, bytes: png.length, err: error });
      return { url: null, note: 'not-published' };
    }
  }

  /**
   * The exporter's outputs in the session: the latest valid envelope, and the
   * last final output that is not one (an exporter that answered with
   * something else has failed). Only the runtime's final outputs are read —
   * `agent_notification_message` events — never a tool's result, where a
   * deck's own text comes back from Slides.
   */
  private readOutputs(req: Request, payloads: string[]): { envelope: MktgSlidesExportEnvelope | null; otherOutput: string | null } {
    let envelope: MktgSlidesExportEnvelope | null = null;
    let otherOutput: string | null = null;
    for (const payload of payloads) {
      const output = this.finalOutputText(payload);
      if (output === null) {
        continue;
      }
      const valid = extractMktgEnvelopeCandidates(output.text, MKTG_SLIDES_EXPORT_CONTRACT_ID).filter((candidate) => this.isValidEnvelope(req, candidate));
      if (valid.length > 0) {
        // Safe: isValidEnvelope passed every schema gate and the sha recompute.
        envelope = valid[valid.length - 1] as MktgSlidesExportEnvelope;
      } else if (output.final) {
        otherOutput = output.text;
      }
    }
    return { envelope, otherOutput };
  }

  /** A notification's text, and whether it is a final output (`content.data`) rather than a plain notice. */
  private finalOutputText(payload: string): { text: string; final: boolean } | null {
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return null;
    }
    if (!this.isRecord(event) || event['type'] !== 'agent_notification_message') {
      return null;
    }
    const content = event['content'];
    if (typeof content === 'string') {
      return { text: content, final: false };
    }
    if (!this.isRecord(content) || content['data'] === undefined || content['data'] === null) {
      return null;
    }
    const data = content['data'];
    return { text: typeof data === 'string' ? data : JSON.stringify(data), final: true };
  }

  private isValidEnvelope(req: Request, candidate: unknown): boolean {
    const result = validateMktgSlidesExportEnvelope(candidate);
    if (!result.valid) {
      logger.debug(req, 'mktg_slides_export_result', 'Rejected envelope candidate', { errors: result.errors });
      return false;
    }
    const envelope = candidate as MktgSlidesExportEnvelope;
    const recomputed = createHash('sha256')
      .update(Buffer.from(mktgSlidesExportContentJson(envelope.content), 'utf8'))
      .digest('hex');
    if (recomputed !== envelope.content_sha256) {
      logger.warning(req, 'mktg_slides_export_result', 'Envelope content_sha256 does not match the content JSON — discarding candidate', {
        expected: envelope.content_sha256,
        recomputed,
      });
      return false;
    }
    return true;
  }

  /**
   * The text of the session's last error event (a runtime or agent error,
   * never a tool's) once it has settled, or null. A session can recover from
   * an error (a dropped connection retried), so an error with later activity
   * beyond the run's teardown is not a failure, and a recent one is not yet:
   * the next poll looks again.
   */
  private readErrorText(payloads: string[], now: number = Date.now()): string | null {
    let error: { text: string; at: number } | null = null;
    let lastActivity = Number.NEGATIVE_INFINITY;
    for (const payload of payloads) {
      let event: unknown;
      try {
        event = JSON.parse(payload);
      } catch {
        // Not JSON: not an event this reader can attribute.
        continue;
      }
      if (!this.isRecord(event)) {
        continue;
      }
      const type = typeof event['type'] === 'string' ? event['type'] : '';
      const at = typeof event['created_at'] === 'string' ? Date.parse(event['created_at']) : Number.NaN;
      if (/error|fail/i.test(type) && !/tool/i.test(type)) {
        const content = event['content'];
        error = { text: typeof content === 'string' ? content : JSON.stringify(content ?? type), at };
      } else if (Number.isFinite(at)) {
        lastActivity = Math.max(lastActivity, at);
      }
    }
    if (!error) {
      return null;
    }
    // An error without a readable time cannot be aged: it stands.
    if (!Number.isFinite(error.at)) {
      return error.text;
    }
    const recovered = lastActivity > error.at + MKTG_SLIDES_EXPORT_ERROR_TEARDOWN_MS;
    const settled = now - error.at >= MKTG_SLIDES_EXPORT_ERROR_SETTLE_MS;
    return !recovered && settled ? error.text : null;
  }

  private buildRecord(context: MktgSlidesExportResultContext, summary: MktgRevisionSummary, envelope: MktgSlidesExportEnvelope): MktgSlidesExportRecord {
    return {
      schema: MKTG_SLIDES_EXPORT_RECORD_SCHEMA,
      project: context.project,
      agentKey: context.agentKey,
      documentId: context.documentId,
      revisionId: summary.id,
      revisionNumber: summary.number,
      contentSha256: summary.contentSha256,
      mode: envelope.mode,
      deckId: envelope.deck.id,
      link: envelope.deck.link,
      title: envelope.deck.title,
      slideCount: envelope.slide_count,
      assets: envelope.content.assets,
      branded: envelope.content.branded,
      exportedAt: envelope.generated_at,
      agentVersion: envelope.agent.agent_version,
    };
  }

  /**
   * Keep the record: content-addressed by its bytes, so every poll of the
   * same finished session writes nothing new. A failed write is logged; the
   * deck still reaches the user.
   */
  private async keepRecord(req: Request, record: MktgSlidesExportRecord): Promise<void> {
    const body = JSON.stringify(record);
    const sha = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    const key = buildMktgSlidesExportRecordKey(record.project, record.agentKey, record.documentId, Date.parse(record.exportedAt), sha);
    try {
      await this.objectStore.putContentAddressedObject(req, 'marketing-os-artifacts', key, Buffer.from(body, 'utf8'), MKTG_REVISION_CONTENT_TYPE, 'private', {
        mode: record.mode,
      });
    } catch (error) {
      logger.warning(req, 'mktg_slides_export_record', 'Export record write failed — the deck is returned without being kept', { key, err: error });
    }
  }

  /** The newest export record of a document that passes its integrity checks, or null. Throws on a storage failure. */
  private async readLastExport(req: Request, project: string, agentKey: MktgSlidesExportAgentKey, documentId: string): Promise<MktgSlidesExportRecord | null> {
    const prefix = buildMktgSlidesExportPrefix(project, agentKey, documentId);
    const listed = (await this.objectStore.listObjects(req, 'marketing-os-artifacts', prefix))
      .map((object) => ({ key: object.key, parsed: parseMktgSlidesExportRecordKey(object.key, prefix) }))
      .filter((entry): entry is { key: string; parsed: { time: string; sha: string } } => entry.parsed !== null)
      .sort((a, b) => b.key.localeCompare(a.key));

    for (const entry of listed) {
      const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', entry.key);
      if (!object || createHash('sha256').update(Buffer.from(object.body, 'utf8')).digest('hex') !== entry.parsed.sha) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(object.body);
      } catch {
        continue;
      }
      const record = readMktgSlidesExportRecord(parsed);
      if (record && record.project === project && record.agentKey === agentKey && record.documentId === documentId) {
        return record;
      }
      logger.warning(req, 'mktg_slides_export_record', 'Stored export record does not match its key or schema — skipping', { key: entry.key });
    }
    return null;
  }

  private revisionRef(summary: MktgRevisionSummary): MktgSlidesExportRevisionRef {
    return { id: summary.id, number: summary.number, contentSha256: summary.contentSha256 };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
