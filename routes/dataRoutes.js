const express = require('express');
const router = express.Router();

const Signup = require('../models/Signup');
const ExpaApplication = require('../models/ExpaApplication');
const MemberInfo = require('../models/MemberInfo');
const { getAggregations } = require('../services/aggregationService');

// Async wrapper for error handling
const asyncHandler = fn => (req, res, next) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
};

// --- ROUTES ---

router.get('/signups', asyncHandler(async (req, res) => {
    const signups = await Signup.getAll();
    res.json(signups);
}));

router.get('/applications', asyncHandler(async (req, res) => {
    const apps = await ExpaApplication.getAll();
    res.json(apps);
}));

router.get('/members', asyncHandler(async (req, res) => {
    const members = await MemberInfo.getAll();
    res.json(members);
}));

// --- UNIFIED DASHBOARD ROUTE ---

router.get('/data', asyncHandler(async (req, res) => {
    const data = await getAggregations();
    res.json(data);
}));

// --- GRANULAR ENTITY ROUTES ---

// Generic handler for entity collections and specific IDs
const handleEntityRequest = (entityName) => async (req, res) => {
    const data = await getAggregations();
    const entities = data[entityName] || [];

    if (req.params.id) {
        const entity = entities.find(e => e.id === req.params.id);
        if (!entity) return res.status(404).json({ error: `${entityName} not found` });
        return res.json(entity);
    }
    res.json(entities);
};

router.get('/data/members', asyncHandler(handleEntityRequest('members')));
router.get('/data/members/:id', asyncHandler(handleEntityRequest('members')));

router.get('/data/departments', asyncHandler(handleEntityRequest('departments')));
router.get('/data/departments/:id', asyncHandler(handleEntityRequest('departments')));

router.get('/data/universities', asyncHandler(handleEntityRequest('universities')));
router.get('/data/universities/:id', asyncHandler(handleEntityRequest('universities')));

router.get('/data/products', asyncHandler(handleEntityRequest('products')));
router.get('/data/products/:id', asyncHandler(handleEntityRequest('products')));

module.exports = router;
