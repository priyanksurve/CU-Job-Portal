const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
    const authorization = req.get('authorization');
    const token = authorization && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication token is required' });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        return next();
    } catch {
        return res.status(401).json({ success: false, message: 'Invalid or expired authentication token' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'You do not have permission for this action' });
        }
        return next();
    };
}

module.exports = { requireAuth, requireRole };
