// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicProfileController } from '../controllers/public-profile.controller';

const router = Router();
const publicProfileController = new PublicProfileController();

// GET /public/api/profile/:username - get a user's public profile artifact (public access, no authentication required)
router.get('/:username', (req, res, next) => publicProfileController.getPublicProfile(req, res, next));

export default router;
