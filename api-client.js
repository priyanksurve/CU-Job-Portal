window.JobPortalApi = (() => {
    const baseUrl = window.JOB_PORTAL_API_URL || '/api';

    async function request(path, options = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const validationError = payload.errors && payload.errors[0];
            const error = new Error((validationError && validationError.msg) || payload.message || 'Request failed');
            error.field = validationError && validationError.path;
            throw error;
        }
        return payload;
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

    return {
        health: () => request('/health'),
        register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
        login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
        requestPasswordReset: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
        resetPassword: (data) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),
        updateProfile: (data, token) => request('/auth/profile', { method: 'PUT', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
        getJobs: (filters = {}) => request(`/jobs?${new URLSearchParams(filters)}`),
        createJob: (data, token) => request('/jobs', { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
        applyToJob: (jobId, data, token) => request(`/applications/${jobId}`, { method: 'POST', body: JSON.stringify(data), headers: { Authorization: `Bearer ${token}` } }),
        getMyApplications: (token) => request('/applications/me', { headers: { Authorization: `Bearer ${token}` } }),
        getLiveJobs: (filters = {}) => request(`/jobs/live?${new URLSearchParams(filters)}`),
        getLiveApiStatus: () => request('/jobs/live/status'),
        buildNaukriUrl
    };
})();
