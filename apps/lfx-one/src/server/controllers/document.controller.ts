// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { URL } from 'url';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { DocumentService } from '../services/document.service';

const UID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Allowlist of hostnames permitted for the server-side download proxy.
// Populated from DOCUMENT_DOWNLOAD_HOST_ALLOWLIST (comma-separated) at startup.
// The allowlist MUST be configured — requests are rejected when it is empty.
const ALLOWED_DOWNLOAD_HOSTS = new Set<string>(
  (process.env['DOCUMENT_DOWNLOAD_HOST_ALLOWLIST'] ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

// Block literal private/reserved IP hostnames as a secondary guard.
// Note: does not prevent DNS rebinding — the allowlist is the primary SSRF control.
const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // link-local / AWS IMDS
  /^::1$/,
  /^fc[0-9a-f]{2}:/i, // IPv6 ULA
  /^fe80:/i, // IPv6 link-local
];

/**
 * Returns the server-controlled allowlist entry that matches the given hostname,
 * or undefined if the hostname is not permitted.
 * Using the allowlist entry (not the user-supplied hostname) as the fetch target
 * ensures the hostname in the outgoing request is server-controlled.
 */
function resolveAllowedHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  if (!host.includes('.') || PRIVATE_IP_PATTERNS.some((p) => p.test(host))) return undefined;
  return ALLOWED_DOWNLOAD_HOSTS.has(host) ? host : undefined;
}

/**
 * Controller for handling My Documents HTTP requests
 */
export class DocumentController {
  private documentService: DocumentService = new DocumentService();

  /**
   * GET /documents/download?url=<encoded>&filename=<name> - proxy-download a file server-side
   */
  public async downloadFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'download_document', {});

    try {
      const rawUrl = req.query['url'] as string | undefined;
      const filename = (req.query['filename'] as string | undefined) || 'download';

      if (!rawUrl) {
        throw ServiceValidationError.forField('url', 'url query parameter is required');
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw ServiceValidationError.forField('url', 'Invalid URL');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw ServiceValidationError.forField('url', 'Only http and https URLs are supported');
      }

      // resolveAllowedHost returns a server-controlled string from ALLOWED_DOWNLOAD_HOSTS,
      // not a derivative of user input — this breaks the SSRF taint flow at the hostname.
      const allowedHost = resolveAllowedHost(parsed.hostname);
      if (!allowedHost) {
        throw ServiceValidationError.forField('url', 'URL hostname is not allowed');
      }

      // Reconstruct the URL using the server-controlled hostname from the allowlist.
      // path/search come from the user but the host is provably from our Set.
      // redirect: 'error' prevents redirect-based SSRF — any redirect causes fetch to throw.
      const safeUrl = new URL(`${parsed.protocol}//${allowedHost}${parsed.pathname}${parsed.search}`);
      const upstream = await fetch(safeUrl, { redirect: 'error' });
      if (!upstream.ok) {
        throw new Error(`Upstream responded with ${upstream.status}`);
      }

      if (!upstream.body) {
        throw new Error('Upstream returned no response body');
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const contentLength = upstream.headers.get('content-length');

      // RFC 5987: emit both ASCII fallback filename= and filename*=UTF-8'' for full Unicode support.
      // Strip quotes and control characters from the ASCII fallback to keep the header safe.
      const safeAscii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      const encoded = encodeURIComponent(filename);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`);
      if (contentLength) res.setHeader('Content-Length', contentLength);

      // Use pipeline() so stream errors propagate and connections aren't left hanging.
      await pipeline(Readable.fromWeb(upstream.body as any), res);

      logger.success(req, 'download_document', startTime, { filename });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /documents - get all documents for the current user
   */
  public async getMyDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_documents', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const { project_uid, committee_uid } = req.query as Record<string, string | undefined>;

      if (project_uid && !UID_PATTERN.test(project_uid)) {
        throw ServiceValidationError.forField('project_uid', 'Invalid project_uid format');
      }
      if (committee_uid && !UID_PATTERN.test(committee_uid)) {
        throw ServiceValidationError.forField('committee_uid', 'Invalid committee_uid format');
      }

      const documents = await this.documentService.getMyDocuments(req, req.query as Record<string, any>);

      logger.success(req, 'get_my_documents', startTime, {
        document_count: documents.length,
      });

      res.json(documents);
    } catch (error) {
      next(error);
    }
  }
}
