// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT, MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { MktgRevisionAuthor } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { AuthenticationError } from '../errors';
import { getEffectiveSub, isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';
import type { UserService } from './user.service';

/** A display name the directory returned for a subject, and when the lookup that returned it succeeded. */
export interface MktgLastKnownAuthorName {
  name: string;
  resolvedAt: number;
}

/**
 * The last display name the directory returned per subject, shared by every instance
 * in this process (one BFF replica). When a lookup fails (a timeout, a 503, an invalid
 * body) the entry is served instead of no name, stale-if-error (RFC 5861 §4), for
 * MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS after the last success, so the responses a client
 * gets within that window agree about an author in this process. Only a successful
 * lookup writes; a directory answer with no name (`success: false`, or an empty name)
 * clears the entry; at most MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT subjects are kept, the
 * least recently resolved dropped first. Another replica, an evicted subject or an
 * expired entry can still answer with no name once until its own lookup succeeds.
 */
const lastKnownAuthorNames = new Map<string, MktgLastKnownAuthorName>();

/** Specs only: start from an empty process-wide cache, as server-helpers.md asks of module-level state. */
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
   * none: `success: false` is the directory's explicit miss (as the project service
   * reads it), never an outage. Memoised per request so revisions and comments share one
   * lookup; a lookup that throws serves the subject's last known name within its window
   * and logs `served_stale: true`, or logs `message` when no name is served.
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
          if (!response.success) {
            logger.warning(req, operation, message);
            return this.remember(userId, null);
          }
          return this.remember(userId, response.data?.name || null);
        } catch (err) {
          const stale = this.lastKnownAuthor(userId);
          if (stale.name) {
            logger.warning(req, operation, 'Author lookup failed — showing the last known name', { err, served_stale: true });
          } else {
            logger.warning(req, operation, message, { err });
          }
          return stale;
        }
      })();
      authors.set(userId, author);
    }
    return author;
  }

  /** The directory's answer is the truth: a name re-arms the subject's entry; no name clears it. */
  private remember(userId: string, name: string | null): MktgRevisionAuthor {
    this.lastKnown.delete(userId);
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
