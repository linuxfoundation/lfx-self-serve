// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { GwProxyController } from '../controllers/gw-proxy.controller';
import { requireGwEmbedAccess } from '../middleware/require-gw-embed-access.middleware';

const router = Router();
const gwProxyController = new GwProxyController();

// Catch-all: every method, every sub-path under this router's `/api/gw` mount forwards to the
// same controller, which resolves the remaining path (and query string) off `req.url`.
//
// `requireGwEmbedAccess` runs first so the authorization check happens before any request body is
// read or streamed upstream — a denied caller must not get to push 100MB through the limiter. The
// controller still makes its own flag + bearer check; that one answers a uniform 404 to avoid
// disclosing the pilot, while this one answers 403 to a caller who is authenticated but lacks the
// newsletter access the UI requires.
router.use(requireGwEmbedAccess, (req, res, next) => gwProxyController.proxy(req, res, next));

export default router;
