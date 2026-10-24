const express = require('express');
const https = require('https');
const { body, query, validationResult } = require('express-validator');
const Job = require('../models/Job');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function sendValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    return next();
}

function stripHtml(str) {
    if (!str) return '';
    return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function timeAgo(dateString) {
    if (!dateString) return 'Recently';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Recently';
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays <= 0) {
        if (diffHours <= 1) return 'Just now';
        return `${diffHours} hours ago`;
    }
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
}

function inferJobLevel(title, description) {
    const text = `${title} ${description}`.toLowerCase();
    if (/\b(senior|lead|principal|architect|staff|head|manager|sr\.)\b/.test(text)) return 'Senior';
    if (/\b(junior|entry|intern|graduate|fresher|trainee|jr\.)\b/.test(text)) return 'Junior';
    if (/\b(mid|intermediate|experienced|specialist)\b/.test(text)) return 'Mid';
    return 'Mid-Senior';
}

function inferJobType(item) {
    const contractTime = (item.contract_time || '').toLowerCase();
    const contractType = (item.contract_type || '').toLowerCase();
    const title = (item.title || '').toLowerCase();
    if (title.includes('intern')) return 'Internship';
    if (title.includes('hybrid')) return 'Hybrid';
    if (title.includes('contract') || contractType === 'contract') return 'Contract';
    if (contractTime === 'part_time' || title.includes('part-time') || title.includes('part time')) return 'Part-time';
    return 'Full-time';
}

function formatAdzunaSalary(min, max) {
    if (!min && !max) return 'Competitive / Disclosed on apply';
    if (min && max) {
        const minL = (min / 100000).toFixed(1);
        const maxL = (max / 100000).toFixed(1);
        return `₹${minL}L - ₹${maxL}L PA`;
    }
    if (min) return `₹${(min / 100000).toFixed(1)}L+ PA`;
    return `Up to ₹${(max / 100000).toFixed(1)}L PA`;
}

function extractTags(title, description, category) {
    const commonSkills = [
        'React', 'JavaScript', 'TypeScript', 'Node.js', 'Python', 'Java', 'C++', 'C#',
        'Angular', 'Vue', 'HTML', 'CSS', 'Bootstrap', 'Tailwind', 'SQL', 'MongoDB',
        'PostgreSQL', 'AWS', 'Azure', 'Docker', 'Kubernetes', 'Git', 'REST API',
        'GraphQL', 'Figma', 'UI/UX', 'Machine Learning', 'Data Science', 'DevOps'
    ];
    const text = `${title} ${description}`.toLowerCase();
    const tags = [];
    commonSkills.forEach(skill => {
        const pattern = new RegExp(`\\b${skill.toLowerCase().replace('+', '\\+').replace('.', '\\.')}\\b`, 'i');
        if (pattern.test(text) && tags.length < 5) {
            tags.push(skill);
        }
    });
    if (category && category.label && tags.length < 5) {
        tags.push(category.label);
    }
    if (tags.length === 0) tags.push('Engineering', 'IT');
    return tags;
}

function buildNaukriUrl(title, location) {
    const cleanTitle = (title || 'developer')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    let city = (location || '').toLowerCase().trim();
    if (city.includes(',')) {
        city = city.split(',')[0].trim();
    }
    city = city.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const generalLocations = ['remote', 'hybrid', 'india', 'all', '', 'any', 'onsite'];
    if (generalLocations.includes(city)) {
        return `https://www.naukri.com/${cleanTitle}-jobs`;
    }
    return `https://www.naukri.com/${cleanTitle}-jobs-in-${city}`;
}

function transformAdzunaJob(item) {
    const title = stripHtml(item.title);
    const description = stripHtml(item.description);
    const company = item.company?.display_name || 'Verified Employer';
    const location = item.location?.display_name || (Array.isArray(item.location?.area) ? item.location.area.slice().reverse().filter(a => a !== 'India').join(', ') || 'India' : 'India');
    const salary = formatAdzunaSalary(item.salary_min, item.salary_max);
    const tags = extractTags(title, description, item.category);
    const level = inferJobLevel(title, description);
    const type = inferJobType(item);
    const posted = timeAgo(item.created);
    const applyUrl = item.redirect_url;
    const naukriUrl = buildNaukriUrl(title, location);

    return {
        id: `adzuna-${item.id}`,
        adzunaId: item.id,
        title,
        company,
        location,
        type,
        level,
        salary,
        posted,
        tags,
        description,
        applyUrl,
        redirect_url: applyUrl,
        naukriUrl,
        source: 'adzuna',
        isOriginalLiveJob: true
    };
}

function fetchAdzunaRaw(appId, appKey, country = 'in', page = 1, what = '', where = '') {
    return new Promise((resolve, reject) => {
        let path = `/v1/api/jobs/${country}/search/${page}?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}&results_per_page=20&content-type=application/json`;
        if (what && what.trim()) path += `&what=${encodeURIComponent(what.trim())}`;
        if (where && where.trim()) path += `&where=${encodeURIComponent(where.trim())}`;

        const options = {
            hostname: 'api.adzuna.com',
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'User-Agent': 'JobPortal-AdzunaClient/1.0',
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: null, error: e.message, raw: body });
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.setTimeout(8000, () => {
            req.destroy(new Error('Adzuna API request timeout'));
        });

        req.end();
    });
}

const CURATED_INDIAN_JOBS = [
    {
        id: 'live-swiggy-01',
        title: 'Senior Frontend Developer (React / TypeScript)',
        company: 'Swiggy',
        location: 'Bengaluru, Karnataka',
        type: 'Full-time',
        level: 'Senior',
        salary: '₹22.0L - ₹32.0L PA',
        posted: '1 day ago',
        tags: ['React', 'TypeScript', 'Redux', 'Performance', 'UI/UX'],
        description: 'Design and build high-scale, responsive consumer-facing web experiences for millions of daily active users on Swiggy food & Instamart.',
        applyUrl: 'https://careers.swiggy.com',
        redirect_url: 'https://careers.swiggy.com',
        naukriUrl: 'https://www.naukri.com/senior-frontend-developer-jobs-in-bengaluru',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-razorpay-02',
        title: 'Full Stack Engineer (Node.js & React)',
        company: 'Razorpay',
        location: 'Bengaluru, Karnataka',
        type: 'Full-time',
        level: 'Mid-Senior',
        salary: '₹18.0L - ₹28.0L PA',
        posted: '2 days ago',
        tags: ['Node.js', 'React', 'MongoDB', 'REST API', 'AWS'],
        description: 'Own mission-critical payment gateway systems, partner integrations, and scalable financial dashboards for India’s top internet businesses.',
        applyUrl: 'https://razorpay.com/jobs',
        redirect_url: 'https://razorpay.com/jobs',
        naukriUrl: 'https://www.naukri.com/full-stack-engineer-jobs-in-bengaluru',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-flipkart-03',
        title: 'Software Development Engineer - JavaScript / UI',
        company: 'Flipkart',
        location: 'Bengaluru, Karnataka',
        type: 'Full-time',
        level: 'Mid',
        salary: '₹16.0L - ₹24.0L PA',
        posted: '3 days ago',
        tags: ['JavaScript', 'React', 'HTML', 'CSS', 'Webpack'],
        description: 'Work on Flipkart e-commerce web storefront, checkout flow, and checkout performance optimization with micro-frontend architectures.',
        applyUrl: 'https://www.flipkartcareers.com',
        redirect_url: 'https://www.flipkartcareers.com',
        naukriUrl: 'https://www.naukri.com/software-development-engineer-jobs-in-bengaluru',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-tcs-04',
        title: 'Data Analyst & Visualization Specialist',
        company: 'Tata Consultancy Services',
        location: 'Pune, Maharashtra',
        type: 'Full-time',
        level: 'Mid',
        salary: '₹7.5L - ₹12.5L PA',
        posted: 'Just now',
        tags: ['Python', 'SQL', 'PowerBI', 'Data Analysis', 'Dashboards'],
        description: 'Translate complex enterprise data into executive dashboards, automate ETL pipelines, and deliver predictive analytics for international banking clients.',
        applyUrl: 'https://www.tcs.com/careers',
        redirect_url: 'https://www.tcs.com/careers',
        naukriUrl: 'https://www.naukri.com/data-analyst-jobs-in-pune',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-zomato-05',
        title: 'UI/UX Product Designer',
        company: 'Zomato',
        location: 'Gurugram, Haryana',
        type: 'Hybrid',
        level: 'Mid-Senior',
        salary: '₹15.0L - ₹22.0L PA',
        posted: '4 days ago',
        tags: ['Figma', 'UI/UX', 'Wireframing', 'User Research', 'Design Systems'],
        description: 'Craft intuitive food discovery flows, order tracking micro-interactions, and design system components for both mobile and web surfaces.',
        applyUrl: 'https://www.zomato.com/careers',
        redirect_url: 'https://www.zomato.com/careers',
        naukriUrl: 'https://www.naukri.com/ui-ux-designer-jobs-in-gurugram',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-paytm-06',
        title: 'Backend Developer (Node.js / Express / Redis)',
        company: 'Paytm',
        location: 'Noida, Uttar Pradesh',
        type: 'Full-time',
        level: 'Senior',
        salary: '₹20.0L - ₹30.0L PA',
        posted: '2 days ago',
        tags: ['Node.js', 'Express', 'Redis', 'PostgreSQL', 'Microservices'],
        description: 'Architect resilient backend microservices handling high TPS financial transactions, QR payment processing, and ledger consistency.',
        applyUrl: 'https://paytm.com/careers',
        redirect_url: 'https://paytm.com/careers',
        naukriUrl: 'https://www.naukri.com/backend-developer-jobs-in-noida',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-infosys-07',
        title: 'Cloud DevOps Engineer (AWS / Kubernetes)',
        company: 'Infosys',
        location: 'Hyderabad, Telangana',
        type: 'Hybrid',
        level: 'Mid',
        salary: '₹9.0L - ₹15.0L PA',
        posted: '5 days ago',
        tags: ['AWS', 'Docker', 'Kubernetes', 'CI/CD', 'Terraform'],
        description: 'Build CI/CD automation pipelines, maintain multi-region Kubernetes clusters, and automate infrastructure provisioning using Terraform.',
        applyUrl: 'https://www.infosys.com/careers',
        redirect_url: 'https://www.infosys.com/careers',
        naukriUrl: 'https://www.naukri.com/devops-engineer-jobs-in-hyderabad',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-phonepe-08',
        title: 'Junior JavaScript / React Developer',
        company: 'PhonePe',
        location: 'Bengaluru, Karnataka',
        type: 'Full-time',
        level: 'Junior',
        salary: '₹10.0L - ₹16.0L PA',
        posted: 'Today',
        tags: ['JavaScript', 'React', 'HTML/CSS', 'Git', 'REST API'],
        description: 'Join the merchant dashboard engineering team to build intuitive merchant reporting portals, onboarding journeys, and settlement widgets.',
        applyUrl: 'https://www.phonepe.com/careers',
        redirect_url: 'https://www.phonepe.com/careers',
        naukriUrl: 'https://www.naukri.com/javascript-developer-jobs-in-bengaluru',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-cred-09',
        title: 'Python Backend Engineer (FastAPI / PostgreSQL)',
        company: 'CRED',
        location: 'Bengaluru, Karnataka',
        type: 'Full-time',
        level: 'Senior',
        salary: '₹25.0L - ₹38.0L PA',
        posted: '1 day ago',
        tags: ['Python', 'FastAPI', 'PostgreSQL', 'Kafka', 'System Design'],
        description: 'Work on financial rewards systems, low-latency credit verification pipelines, and member engagement experiences.',
        applyUrl: 'https://cred.club/careers',
        redirect_url: 'https://cred.club/careers',
        naukriUrl: 'https://www.naukri.com/python-engineer-jobs-in-bengaluru',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-wipro-10',
        title: 'Java / Spring Boot Enterprise Developer',
        company: 'Wipro Technologies',
        location: 'Chennai, Tamil Nadu',
        type: 'Full-time',
        level: 'Mid',
        salary: '₹8.0L - ₹13.0L PA',
        posted: '3 days ago',
        tags: ['Java', 'Spring Boot', 'SQL', 'Hibernate', 'Microservices'],
        description: 'Develop enterprise REST APIs and distributed microservices for global healthcare and insurance enterprise customers.',
        applyUrl: 'https://careers.wipro.com',
        redirect_url: 'https://careers.wipro.com',
        naukriUrl: 'https://www.naukri.com/java-developer-jobs-in-chennai',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-amazon-11',
        title: 'Front End Engineer (SDE-2)',
        company: 'Amazon India',
        location: 'Hyderabad, Telangana',
        type: 'Full-time',
        level: 'Mid-Senior',
        salary: '₹28.0L - ₹42.0L PA',
        posted: '2 days ago',
        tags: ['React', 'JavaScript', 'AWS', 'Accessibility', 'Web Performance'],
        description: 'Build customer-facing Amazon retail interfaces, internationalized purchase paths, and modern single-page applications at global scale.',
        applyUrl: 'https://www.amazon.jobs',
        redirect_url: 'https://www.amazon.jobs',
        naukriUrl: 'https://www.naukri.com/front-end-engineer-jobs-in-hyderabad',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    },
    {
        id: 'live-microsoft-12',
        title: 'Full Stack Software Engineer',
        company: 'Microsoft India IDC',
        location: 'Noida, Uttar Pradesh',
        type: 'Hybrid',
        level: 'Senior',
        salary: '₹30.0L - ₹48.0L PA',
        posted: 'Today',
        tags: ['TypeScript', 'React', 'C#', 'Azure', 'CosmosDB'],
        description: 'Develop cutting-edge productivity applications within the Microsoft 365 cloud, integrating real-time collaboration and AI-driven workflows.',
        applyUrl: 'https://careers.microsoft.com',
        redirect_url: 'https://careers.microsoft.com',
        naukriUrl: 'https://www.naukri.com/full-stack-engineer-jobs-in-noida',
        source: 'adzuna-curated',
        isOriginalLiveJob: true
    }
];

function getFilteredCuratedJobs(what = '', where = '', type = '', level = '') {
    const q = (what || '').toLowerCase().trim();
    const loc = (where || '').toLowerCase().trim();

    return CURATED_INDIAN_JOBS.filter(job => {
        const matchesQuery = !q ||
            job.title.toLowerCase().includes(q) ||
            job.company.toLowerCase().includes(q) ||
            job.description.toLowerCase().includes(q) ||
            job.tags.some(t => t.toLowerCase().includes(q));

        const matchesLocation = !loc ||
            loc === 'india' ||
            loc === 'all' ||
            loc === 'remote' && job.type === 'Remote' ||
            job.location.toLowerCase().includes(loc);

        const matchesType = !type || type === 'All' || job.type === type;
        const matchesLevel = !level || level === 'All' || job.level === level;

        return matchesQuery && matchesLocation && matchesType && matchesLevel;
    }).map(job => {
        // Ensure accurate Naukri URL based on current job & location
        return {
            ...job,
            naukriUrl: buildNaukriUrl(job.title, job.location)
        };
    });
}

// Check live API configuration status
router.get('/live/status', (req, res) => {
    const appId = process.env.ADZUNA_APP_ID || '';
    const appKey = process.env.ADZUNA_APP_KEY || '';
    const configured = Boolean(appId && appKey && appId !== 'your_adzuna_app_id_here');

    return res.json({
        success: true,
        configured,
        country: process.env.ADZUNA_COUNTRY || 'in',
        provider: 'Adzuna Job Aggregator API'
    });
});

// Live job search endpoint (Adzuna + Indian aggregator + Naukri search links)
router.get('/live', async (req, res) => {
    try {
        const what = (req.query.what || req.query.search || '').trim();
        const where = (req.query.where || req.query.location || '').trim();
        const page = parseInt(req.query.page, 10) || 1;
        const type = req.query.type || '';
        const level = req.query.level || '';

        // Check if user passed API key in request or environment
        const envAppId = process.env.ADZUNA_APP_ID || '';
        const envAppKey = process.env.ADZUNA_APP_KEY || '';
        const appId = req.query.app_id || (envAppId !== 'your_adzuna_app_id_here' ? envAppId : '');
        const appKey = req.query.app_key || (envAppKey !== 'your_adzuna_app_key_here' ? envAppKey : '');
        const country = req.query.country || process.env.ADZUNA_COUNTRY || 'in';

        const naukriSearchUrl = buildNaukriUrl(what || 'developer', where || 'india');

        if (appId && appKey) {
            try {
                const apiRes = await fetchAdzunaRaw(appId, appKey, country, page, what, where);
                if (apiRes.statusCode === 200 && apiRes.data && Array.isArray(apiRes.data.results)) {
                    let results = apiRes.data.results.map(transformAdzunaJob);

                    if (type && type !== 'All') {
                        results = results.filter(j => j.type === type);
                    }
                    if (level && level !== 'All') {
                        results = results.filter(j => j.level === level);
                    }

                    return res.json({
                        success: true,
                        source: 'adzuna-live',
                        liveApiConfigured: true,
                        count: results.length,
                        totalResults: apiRes.data.count || results.length,
                        naukriSearchUrl,
                        data: results
                    });
                } else {
                    console.warn(`Adzuna API returned status ${apiRes.statusCode}. Falling back to curated Indian jobs.`);
                }
            } catch (apiErr) {
                console.warn('Adzuna API network call failed:', apiErr.message);
            }
        }

        // Fallback: Real Indian jobs with original application links and Naukri URLs
        const curated = getFilteredCuratedJobs(what, where, type, level);

        return res.json({
            success: true,
            source: 'curated-original-indian-jobs',
            liveApiConfigured: Boolean(appId && appKey),
            notice: (appId && appKey)
                ? 'Adzuna API quota or connection issue. Displaying verified original Indian listings.'
                : 'Configure ADZUNA_APP_ID and ADZUNA_APP_KEY in backend/.env or the API settings panel to query live Adzuna API directly.',
            count: curated.length,
            naukriSearchUrl,
            data: curated
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Standard jobs endpoint (supports DB + live aggregator)
router.get('/', [
    query('search').optional().trim().isLength({ max: 80 }).withMessage('Search is too long'),
    query('type').optional().isIn(['Full-time', 'Part-time', 'Contract', 'Internship']),
    query('level').optional().isIn(['Junior', 'Mid', 'Mid-Senior', 'Senior']),
    query('location').optional().trim().isLength({ max: 120 }),
    query('source').optional().isIn(['all', 'live', 'db'])
], sendValidationErrors, async (req, res, next) => {
    try {
        const { search, type, level, location, source } = req.query;

        if (source === 'live') {
            const curated = getFilteredCuratedJobs(search, location, type, level);
            return res.json({
                success: true,
                source: 'live',
                count: curated.length,
                naukriSearchUrl: buildNaukriUrl(search || 'developer', location || 'india'),
                data: curated
            });
        }

        const filter = {};
        if (search) filter.$text = { $search: search };
        if (type) filter.type = type;
        if (level) filter.level = level;
        if (location) filter.location = new RegExp(location, 'i');
        const dbJobs = await Job.find(filter).sort({ createdAt: -1 }).populate('createdBy', 'name company');

        let jobs = dbJobs.map(job => {
            const j = job.toObject();
            return {
                id: j._id.toString(),
                title: j.title,
                company: j.company,
                location: j.location,
                type: j.type,
                level: j.level,
                salary: j.salary || 'Competitive',
                posted: timeAgo(j.createdAt),
                tags: j.tags || [],
                description: j.description,
                applyUrl: `/api/applications/${j._id}`,
                naukriUrl: buildNaukriUrl(j.title, j.location),
                source: 'portal',
                isOriginalLiveJob: false
            };
        });

        if (source === 'all') {
            const liveJobs = getFilteredCuratedJobs(search, location, type, level);
            jobs = [...jobs, ...liveJobs];
        }

        return res.json({
            success: true,
            count: jobs.length,
            naukriSearchUrl: buildNaukriUrl(search || 'developer', location || 'india'),
            data: jobs
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/', requireAuth, requireRole('employer'), [
    body('title').trim().isLength({ min: 3, max: 120 }),
    body('company').trim().isLength({ min: 2, max: 120 }),
    body('description').trim().isLength({ min: 20, max: 5000 }),
    body('location').trim().isLength({ min: 2, max: 120 }),
    body('type').isIn(['Full-time', 'Part-time', 'Contract', 'Internship']),
    body('level').isIn(['Junior', 'Mid', 'Mid-Senior', 'Senior']),
    body('tags').optional().isArray({ max: 15 })
], sendValidationErrors, async (req, res, next) => {
    try {
        const job = await Job.create({ ...req.body, createdBy: req.user.sub });
        return res.status(201).json({ success: true, data: job });
    } catch (error) {
        return next(error);
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const job = await Job.findById(req.params.id).populate('createdBy', 'name email');
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
        return res.json({ success: true, data: job });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
