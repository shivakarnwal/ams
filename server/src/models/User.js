import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { jsonPlugin } from './plugins.js';

export const ROLES = ['employee', 'manager', 'hr', 'admin'];

const balance = (def) => ({ type: Number, default: def, min: 0 });

const userSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: [true, 'Employee code is required'], unique: true, trim: true },
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },
    email: { type: String, required: [true, 'Email is required'], unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ROLES, default: 'employee', index: true },
    designation: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '', index: true },
    location: { type: String, trim: true, default: '' },
    branch: { type: String, trim: true, default: '' },
    contact: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    avatar: { type: String, default: '' },
    dateOfJoining: { type: Date },
    dateOfBirth: { type: Date },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    leaveBalance: {
      sick: balance(12),
      earned: balance(30),
      casual: balance(12),
      compOff: balance(0),
      maternity: balance(0),
    },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
    lastDeviceId: String,
  },
  { timestamps: true },
);

userSchema.index({ name: 'text' });
jsonPlugin(userSchema);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
