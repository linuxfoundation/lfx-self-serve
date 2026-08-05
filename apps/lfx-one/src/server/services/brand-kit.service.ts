// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_MAX_DOCUMENT_BYTES } from '@lfx-one/shared/constants';
import { BrandKitEnvelope, BrandKitPersistReceipt } from '@lfx-one/shared/interfaces';
import { buildBrandKitObjectKey, extractBrandKitEnvelopeCandidates, validateBrandKitEnvelope } from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from './logger.service';
import { GuildService } from './guild.service';
import { ObjectStoreService } from './object-store.service';

/**
 * Brand Kit session-consumer — the BFF write path of dec-brand-kit-storage-v1.
 *
 * Scans a finished Guild session for the `finalize_brand_kit` tool-result
 * envelope (the authoritative typed output per the live-smoke A3 verdict — the
 * `__submit__`-ed text may be prose or abridged and is never trusted),
 * validates it per contract §3, and persists the raw `document_markdown`
 * bytes to versioned object storage under the content-addressed key
 * `brand-kit/{project}/{content_sha256}.md`.
 *
 * v1 defers all graph writes: the returned receipt carries exactly the fields
 * needed for later Artifact minting (wi-lfx-one-service-actor).
 */
export class BrandKitService {
  private readonly guildService = new GuildService();
  private readonly objectStore = new ObjectStoreService();

  /**
   * Validate + persist the final Brand Kit document of a Guild session.
   * Throws ServiceValidationError when no valid envelope is found.
   */
  public async persistFromSession(req: Request, sessionId: string): Promise<BrandKitPersistReceipt> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);

    const envelope = this.findAuthoritativeEnvelope(req, payloads);
    if (!envelope) {
      throw ServiceValidationError.forField('sessionId', 'No valid Brand Kit output envelope was found in this session.', {
        operation: 'brand_kit_persist',
        service: 'brand_kit_service',
        path: req.path,
      });
    }

    // Contract §3 step 2: recompute the sha over the UTF-8 bytes and require
    // equality — envelope integrity rests wholly on the BFF (A2/A3 verdicts).
    const documentBytes = Buffer.from(envelope.document_markdown, 'utf8');
    const recomputedSha = createHash('sha256').update(documentBytes).digest('hex');
    if (recomputedSha !== envelope.content_sha256) {
      throw ServiceValidationError.forField('content_sha256', 'Envelope content_sha256 does not match the document bytes.', {
        operation: 'brand_kit_persist',
        service: 'brand_kit_service',
        path: req.path,
      });
    }

    // Contract §3 step 4: size gate (defense in depth — also checked byte-accurately
    // by the shared validator via TextEncoder).
    if (documentBytes.length > BRAND_KIT_MAX_DOCUMENT_BYTES) {
      throw ServiceValidationError.forField('document_markdown', 'Document exceeds the 20 MB object size cap.', {
        operation: 'brand_kit_persist',
        service: 'brand_kit_service',
        path: req.path,
      });
    }

    // Contract §3 step 5: key derived from validated fields only.
    const key = buildBrandKitObjectKey(envelope.project, recomputedSha);

    const written = await this.objectStore.putObjectIfAbsent(req, key, documentBytes, 'text/markdown; charset=utf-8');

    logger.info(req, 'brand_kit_persist', 'Brand Kit document persisted', {
      key,
      written,
      project: envelope.project,
      version: envelope.version,
      intake_mode: envelope.intake.mode,
    });

    return {
      s3_key: key,
      content_sha256: recomputedSha,
      project: envelope.project,
      version: envelope.version,
      intake_mode: envelope.intake.mode,
    };
  }

  /**
   * Scan raw event payloads (chronologically ordered by the Guild service)
   * for envelope candidates and return the authoritative one: the highest
   * `version` among valid candidates, with the latest occurrence winning ties
   * (later events supersede earlier drafts within a session).
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): BrandKitEnvelope | null {
    let best: BrandKitEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const payload of payloads) {
      for (const candidate of extractBrandKitEnvelopeCandidates(payload)) {
        candidateCount++;
        const result = validateBrandKitEnvelope(candidate);
        if (result.valid) {
          if (!best || candidate.version >= best.version) {
            best = candidate;
          }
        } else {
          invalidCount++;
          logger.debug(req, 'brand_kit_persist', 'Rejected envelope candidate', { errors: result.errors });
        }
      }
    }

    logger.debug(req, 'brand_kit_persist', 'Envelope scan complete', {
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!best,
    });

    return best;
  }
}
