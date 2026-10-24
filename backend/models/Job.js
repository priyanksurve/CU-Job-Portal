const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 120, index: true },
    company: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    location: { type: String, required: true, trim: true, maxlength: 120, index: true },
    type: { type: String, enum: ['Full-time', 'Part-time', 'Contract', 'Internship'], required: true },
    level: { type: String, enum: ['Junior', 'Mid', 'Mid-Senior', 'Senior'], required: true },
    salary: { type: String, trim: true, maxlength: 80 },
    tags: [{ type: String, trim: true, lowercase: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

jobSchema.index({ title: 'text', company: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Job', jobSchema);
