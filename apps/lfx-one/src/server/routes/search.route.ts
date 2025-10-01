// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { SearchController } from '../controllers/search.controller';

const router = Router();
const searchController = new SearchController();

// User search route
router.get('/users', (req, res, next) => searchController.searchUsers(req, res, next));

export default router;
