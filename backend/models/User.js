const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['candidate', 'employer'], default: 'candidate' },
    resetOtpHash: { type: String, select: false },
    resetOtpExpiresAt: { type: Date, select: false },
    profile: {
        headline: { type: String, trim: true, maxlength: 120 },
        location: { type: String, trim: true, maxlength: 120 },
        bio: { type: String, trim: true, maxlength: 1000 },
        skills: [{ type: String, trim: true }]
    }
}, { timestamps: true });

userSchema.methods.comparePassword = function comparePassword(password) {
    return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
    return { id: this._id, name: this.name, email: this.email, role: this.role, profile: this.profile };
};

module.exports = mongoose.model('User', userSchema);
