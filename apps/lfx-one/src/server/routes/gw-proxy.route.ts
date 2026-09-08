// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { GwProxyController } from '../controllers/gw-proxy.controller';

const router = Router();
const gwProxyController = new GwProxyController();

// Catch-all: every method, every sub-path under this router's `/api/gw` mount forwards to the
// same controller, which resolves the remaining path (and query string) off `req.url`.
router.use((req, res, next) => gwProxyController.proxy(req, res, next));

export default router;
