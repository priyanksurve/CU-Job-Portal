const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    coverLetter: { type: String, trim: true, maxlength: 3000 },
    status: { type: String, enum: ['submitted', 'reviewing', 'shortlisted', 'rejected', 'hired'], default: 'submitted' }
}, { timestamps: true });

applicationSchema.index({ applicant: 1, job: 1 }, { unique: true });

module.exports = mongoose.model('Application', applicationSchema);
