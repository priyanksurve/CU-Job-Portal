const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDatabase = require('./config/db');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const applicationRoutes = require('./routes/applications');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
const port = process.env.PORT || 5000;

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:', 'http:'],
            connectSrc: ["'self'", 'https://api.adzuna.com', 'http://api.adzuna.com'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"]
        }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '100kb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', (req, res) => {
    res.json({ success: true, service: 'job-portal-api', status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'eX2.html')));

app.use(notFound);
app.use(errorHandler);

async function startServer() {
    try {
        await connectDatabase();
    } catch (dbError) {
        console.warn('MongoDB connection note:', dbError.message);
        console.log('JobPortal server continuing in live-aggregator mode.');
    }
    app.listen(port, () => console.log(`JobPortal API listening on http://localhost:${port}`));
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Unable to start server:', error.message);
        process.exit(1);
    });
}

module.exports = app;
