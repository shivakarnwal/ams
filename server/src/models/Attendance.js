import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Calendar day, YYYY-MM-DD (in APP_TIMEZONE) */
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    inTime: Date,
    outTime: Date,
    workMinutes: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['present', 'absent', 'half_day', 'leave', 'holiday', 'weekly_off', 'wfh', 'on_duty'], default: 'present' },
    note: { type: String, trim: true, default: '' },
    source: { type: String, enum: ['punch', 'manual', 'regularization'], default: 'punch' },
  },
  { timestamps: true },
);
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
jsonPlugin(attendanceSchema);

export const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
