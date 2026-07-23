// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MyNewslettersController } from '../controllers/my-newsletters.controller';

const router = Router();
const myNewslettersController = new MyNewslettersController();

// Recipient-facing newsletter archive: user sees sent newsletters for committees they belong to.
// Mounted at `/api/newsletters/my-newsletters` in server.ts.
// Authorization: user bearer token required (authGuard on frontend); upstream service verifies membership.

// GET /api/newsletters/my-newsletters - list recipient archive with pagination
router.get('/', (req, res, next) => myNewslettersController.listArchive(req, res, next));

// GET /api/newsletters/my-newsletters/:newsletterUid - fetch specific newsletter with full body_html
router.get('/:newsletterUid', (req, res, next) => myNewslettersController.getArchiveDetail(req, res, next));

export default router;
