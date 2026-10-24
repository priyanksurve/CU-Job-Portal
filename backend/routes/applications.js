const express = require('express');
const { body, validationResult } = require('express-validator');
const Application = require('../models/Application');
const Job = require('../models/Job');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/:jobId', requireAuth, [
    body('coverLetter').optional().trim().isLength({ max: 3000 }).withMessage('Cover letter is too long')
], async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });

    try {
        const job = await Job.findById(req.params.jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
        const application = await Application.create({ applicant: req.user.sub, job: job._id, coverLetter: req.body.coverLetter });
        return res.status(201).json({ success: true, data: application });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: 'You have already applied to this job' });
        return next(error);
    }
});

router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const applications = await Application.find({ applicant: req.user.sub }).sort({ createdAt: -1 }).populate('job');
        return res.json({ success: true, count: applications.length, data: applications });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
