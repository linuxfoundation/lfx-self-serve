// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_FILE_EXTENSIONS, FOUNDATION_MESSAGE_MAX_FILE_BYTES, FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER } from '@lfx-one/shared/constants';
import { MktgReadText } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MktgDocumentReadGate } from '../helpers/mktg-document-read-gate.helper';
import { MktgDocumentText } from '../helpers/mktg-document-text.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';

/**
 * Reads the files a Marketing OS agent needs to text, because the agents
 * cannot open files themselves: the Messaging Document's uploaded existing
 * documents (PDF, Word, Markdown, text). Links are not read here — the
 * Messaging Document agent fetches its own sources and document links.
 * Never throws: whatever cannot be read comes back with its reason, and the
 * form tells the requester.
 *
 * Every read goes through one process-wide `MktgDocumentReadGate`: at most
 * four reads per user and eight per process at once, and one parse at a time
 * with the event loop turning between them, so a request full of crafted
 * documents slows itself down rather than the BFF.
 */
export class MktgSourceTextService {
  /** Shared by every instance: the bounds are per process. */
  private static readonly gate = new MktgDocumentReadGate(8, 4, 12);

  /** Read an uploaded file to text, capped at `maxChars` with an explicit marker. */
  public async readFile(req: Request, fileName: string, bytes: Buffer, maxChars: number): Promise<MktgReadText> {
    const lower = fileName.toLowerCase();
    if (!FOUNDATION_MESSAGE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
      return this.none('unsupported');
    }
    if (bytes.byteLength > FOUNDATION_MESSAGE_MAX_FILE_BYTES) {
      return this.none('too-large');
    }
    const read = await MktgSourceTextService.gate.withSlot(this.user(req), async () => this.cap(await this.parse(bytes), maxChars));
    if (read === null) {
      logger.debug(req, 'mktg_source_text', 'Refused a file read as busy — the user has too many waiting', {});
      return this.none('busy');
    }
    return read;
  }

  /** Parse bytes to text through the gate, one document at a time on the event loop. */
  private async parse(bytes: Buffer): Promise<MktgReadText> {
    return MktgSourceTextService.gate.parse(() => MktgDocumentText.read(bytes));
  }

  /** Whose slots a read takes: the signed-in user, else the client address. */
  private user(req: Request): string {
    return getEffectiveUsername(req) ?? `ip:${req.ip ?? 'unknown'}`;
  }

  private cap(read: MktgReadText, maxChars: number): MktgReadText {
    if (read.text === null || read.text.length <= maxChars) {
      return read;
    }
    return { ...read, text: `${read.text.slice(0, maxChars)}${FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER}`, truncated: true };
  }

  private none(reason: MktgReadText['reason']): MktgReadText {
    return { text: null, truncated: false, reason };
  }
}
