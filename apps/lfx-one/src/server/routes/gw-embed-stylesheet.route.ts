// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';
import { GwEmbedStylesheetController } from '../controllers/gw-embed-stylesheet.controller';

const router = Router();
const controller = new GwEmbedStylesheetController();

// One hashed file name per request; the controller rejects anything that does not look like one.
router.get('/:name', (req, res, next) => controller.serve(req, res, next));

export default router;
