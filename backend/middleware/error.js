function notFound(req, res) {
    res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(error, req, res, next) {
    console.error(error);
    const status = error.statusCode || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    res.status(status).json({ success: false, message });
}

module.exports = { notFound, errorHandler };
