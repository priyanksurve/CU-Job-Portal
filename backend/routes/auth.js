const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const credentialsValidation = [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
];

function sendValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    return next();
}

function createToken(user) {
    return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

function hashOtp(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
}

function createMailTransport() {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        const error = new Error('Password reset email is not configured on the server');
        error.statusCode = 503;
        throw error;
    }
    return nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
}

router.post('/forgot-password', body('email').isEmail().withMessage('A valid email is required').normalizeEmail(), sendValidationErrors, async (req, res, next) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (user) {
            const otp = crypto.randomInt(100000, 1000000).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            await createMailTransport().sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: user.email,
                subject: 'Your JobPortal password reset code',
                text: `Your password reset OTP is ${otp}. It expires in 10 minutes.`
            });
            user.resetOtpHash = hashOtp(otp);
            user.resetOtpExpiresAt = expiresAt;
            await user.save();
        }
        return res.json({ success: true, message: 'If an account exists for that email, an OTP has been sent.' });
    } catch (error) {
        return next(error);
    }
});

router.post('/reset-password', [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be a 6-digit code'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], sendValidationErrors, async (req, res, next) => {
    try {
        const user = await User.findOne({ email: req.body.email }).select('+resetOtpHash +resetOtpExpiresAt');
        const validOtp = user && user.resetOtpHash && user.resetOtpExpiresAt > new Date() && user.resetOtpHash === hashOtp(req.body.otp);
        if (!validOtp) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

        user.passwordHash = await bcrypt.hash(req.body.password, 12);
        user.resetOtpHash = undefined;
        user.resetOtpExpiresAt = undefined;
        await user.save();
        return res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        return next(error);
    }
});

router.post('/register', [
    body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be between 2 and 80 characters'),
    ...credentialsValidation,
    body('role').optional().isIn(['candidate', 'employer']).withMessage('Role must be candidate or employer')
], sendValidationErrors, async (req, res, next) => {
    try {
        const { name, email, password, role = 'candidate' } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(409).json({ success: false, message: 'An account with this email already exists' });

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await User.create({ name, email, passwordHash, role });
        return res.status(201).json({ success: true, token: createToken(user), user: user.toSafeJSON() });
    } catch (error) {
        return next(error);
    }
});

router.post('/login', credentialsValidation, sendValidationErrors, async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).select('+passwordHash');
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        return res.json({ success: true, token: createToken(user), user: user.toSafeJSON() });
    } catch (error) {
        return next(error);
    }
});

router.put('/profile', requireAuth, [
    body('name').optional().trim().isLength({ min: 2, max: 80 }).withMessage('Name must be between 2 and 80 characters'),
    body('headline').optional().trim().isLength({ max: 120 }).withMessage('Headline is too long'),
    body('location').optional().trim().isLength({ max: 120 }).withMessage('Location is too long'),
    body('bio').optional().trim().isLength({ max: 1000 }).withMessage('About section is too long'),
    body('skills').optional().isArray({ max: 20 }).withMessage('Skills must be a list')
], sendValidationErrors, async (req, res, next) => {
    try {
        const { name, headline, location, bio, skills } = req.body;
        const user = await User.findByIdAndUpdate(
            req.user.sub,
            { ...(name !== undefined && { name }), profile: { headline, location, bio, skills } },
            { new: true, runValidators: true }
        );
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        return res.json({ success: true, user: user.toSafeJSON() });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
