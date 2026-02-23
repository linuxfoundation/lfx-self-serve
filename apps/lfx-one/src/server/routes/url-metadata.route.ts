// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { UrlMetadataController } from '../controllers/url-metadata.controller';

const router = Router();
const urlMetadataController = new UrlMetadataController();

// POST /api/url-metadata - Resolve titles for an array of URLs
router.post('/', urlMetadataController.resolveMetadata.bind(urlMetadataController));

export default router;
