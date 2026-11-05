// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT, MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { MktgLastKnownAuthorName, MktgRevisionAuthor } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { AuthenticationError } from '../errors';
import { getEffectiveSub, isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';
import type { UserService } from './user.service';

/**
 * The last display name the directory returned per subject, shared by every instance
 * in this process (one BFF replica). When a lookup fails — it throws, or the directory
 * answers `success: false`, which it does for any upstream error — the entry is served
 * instead of no name, stale-if-error (RFC 5861 §4), for MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS
 * after the last success, so the responses a client gets within that window agree
 * about an author in this process. Only a successful lookup writes; a success with an
 * empty name clears the entry; an expired entry is swept; at most
 * MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT subjects are kept, the least recently resolved
 * dropped first. Another replica, an evicted subject or an expired entry answers with
 * no name until a lookup succeeds.
 */
const lastKnownAuthorNames = new Map<string, MktgLastKnownAuthorName>();

/** Test seam for the cross-request name memo — same shape as `FormationService.resetUserMetadataCacheForTests`. */
export function resetMktgDocumentAuthorNamesForTests(): void {
  lastKnownAuthorNames.clear();
}

/** One attribution policy for revisions and comments; share the instance within a document request flow. */
export class MktgDocumentAuthorService {
  private readonly authors = new WeakMap<Request, Map<string, Promise<MktgRevisionAuthor>>>();
  private userService?: Promise<UserService>;

  public constructor(private readonly lastKnown: Map<string, MktgLastKnownAuthorName> = lastKnownAuthorNames) {}

  /** #3773: store only the effective opaque subject; no operator/name/username fallback. */
  public captureAuthorId(req: Request): string | null {
    const userId = getEffectiveSub(req);
    if (!userId && !isImpersonating(req)) throw new AuthenticationError('A signed-in writer subject is required when not impersonating.');
    return userId;
  }

  /**
   * The display name for a stored subject, or `{ name: null }` when the directory has
   * none. Memoised per request so revisions and comments share one lookup; a failed
   * lookup (thrown, or `success: false`) serves the subject's last known name within its
   * window and logs `served_stale: true`, or logs `message` when no name is served.
   */
  public async resolveAuthor(
    req: Request,
    userId: string | null | undefined,
    operation = 'mktg_document_store_author',
    message = 'Author lookup failed — showing no name'
  ): Promise<MktgRevisionAuthor | null> {
    if (!userId) return null;
    let authors = this.authors.get(req);
    if (!authors) {
      authors = new Map();
      this.authors.set(req, authors);
    }
    let author = authors.get(userId);
    if (!author) {
      author = (async () => {
        try {
          this.userService ??= import('./user.service')
            .then(({ UserService }) => new UserService())
            .catch((error: unknown) => {
              this.userService = undefined;
              throw error;
            });
          const response = await (await this.userService).getUserInfo(req, userId);
          // success:false is any upstream error of the directory (lfx-v2-auth-service message_handler.go:299-304:
          // M2M token failure, Auth0 429/5xx), not only a miss — served stale like a thrown failure.
          if (!response.success) return this.staleOrNone(req, userId, operation, message);
          return this.remember(userId, response.data?.name || null);
        } catch (err) {
          // getUserInfo wraps timeouts/503s in ResourceNotFoundError (user.service.ts:158-164) — served stale too.
          return this.staleOrNone(req, userId, operation, message, err);
        }
      })();
      authors.set(userId, author);
    }
    return author;
  }

  /** A failed lookup: the subject's last known name within its window, logged as stale; else no name, logged with `message`. */
  private staleOrNone(req: Request, userId: string, operation: string, message: string, err?: unknown): MktgRevisionAuthor {
    const stale = this.lastKnownAuthor(userId);
    const detail = err === undefined ? {} : { err };
    if (stale.name) {
      logger.warning(req, operation, 'Author lookup failed — showing the last known name', { ...detail, served_stale: true });
    } else if (err === undefined) {
      logger.warning(req, operation, message);
    } else {
      logger.warning(req, operation, message, detail);
    }
    return stale;
  }

  /** A successful answer is the truth: a name re-arms the subject's entry; an empty name clears it. Expired entries are swept first. */
  private remember(userId: string, name: string | null): MktgRevisionAuthor {
    this.lastKnown.delete(userId);
    this.sweepExpired();
    if (name) {
      this.lastKnown.set(userId, { name, resolvedAt: Date.now() });
      // Insertion order is recency: the entry resolved least recently goes first.
      while (this.lastKnown.size > MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT) {
        const oldest = this.lastKnown.keys().next().value;
        if (oldest === undefined) break;
        this.lastKnown.delete(oldest);
      }
    }
    return { name };
  }

  /** Insertion order is resolvedAt order: drop expired entries from the head, stopping at the first live one. */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [userId, known] of this.lastKnown) {
      if (now - known.resolvedAt < MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS) break;
      this.lastKnown.delete(userId);
    }
  }

  /** The subject's last known name while within its window; an expired entry is dropped. A failure is never remembered. */
  private lastKnownAuthor(userId: string): MktgRevisionAuthor {
    const known = this.lastKnown.get(userId);
    if (!known) return { name: null };
    if (Date.now() - known.resolvedAt >= MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS) {
      this.lastKnown.delete(userId);
      return { name: null };
    }
    return { name: known.name };
  }
}
