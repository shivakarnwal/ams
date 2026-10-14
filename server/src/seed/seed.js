import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { Announcement } from '../models/Announcement.js';
import { Attendance } from '../models/Attendance.js';
import { Holiday } from '../models/Holiday.js';
import { Leave } from '../models/Leave.js';
import { TravelExpense } from '../models/TravelExpense.js';
import { User } from '../models/User.js';
import { Visitor } from '../models/Visitor.js';
import { ManpowerRequisition } from '../models/ManpowerRequisition.js';
import { Candidate } from '../models/Candidate.js';
import { Confirmation } from '../models/Confirmation.js';
import { CompOff } from '../models/CompOff.js';
import { Regularization } from '../models/Regularization.js';
import { SalarySlip } from '../models/SalarySlip.js';
import { AppraisalLetter } from '../models/AppraisalLetter.js';
import { Form16 } from '../models/Form16.js';
import { seedEmployeeDocs } from './employeeDocsSeed.js';
import { Album } from '../models/Album.js';
import { Photo } from '../models/Photo.js';
import { dropAllFiles, policyFiles, ticketFiles } from '../utils/gridfs.js';
import { Policy, PolicyCategory, PolicyVersion } from '../models/Policy.js';
import { Counter, Ticket, TicketCategory, TicketComment, TicketEvent, TicketPriority } from '../models/Ticket.js';
import { ensureTicketDefaults } from './ticketDefaults.js';
import { EmployeeProfile, ProfileAudit } from '../models/EmployeeProfile.js';
import { createFileStore } from '../utils/gridfs.js';
import { encryptField, profileAad } from '../utils/fieldCrypto.js';
import { todayString } from '../utils/helpers.js';

const d = (s) => new Date(s);

export async function seedDatabase({ reset = false, log = console.log } = {}) {
  if (reset) {
    await Promise.all(
      [User, Attendance, Leave, CompOff, Regularization, Visitor, TravelExpense, ManpowerRequisition, Candidate, Confirmation, Holiday, Announcement, SalarySlip, Album, Photo,
      PolicyCategory, Policy, PolicyVersion, TicketCategory, TicketPriority, Ticket, TicketComment, TicketEvent, Counter, EmployeeProfile, ProfileAudit, AppraisalLetter, Form16]
        .map((M) => M.deleteMany({})),
    );
    await Promise.all([dropAllFiles(), policyFiles.drop(), ticketFiles.drop(), createFileStore('profileFiles').drop()]);
  }
  const pw = env.seedPassword;
  const upsertUser = async (data) => {
    const existing = await User.findOne({ email: data.email });
    return existing || User.create({ password: pw, ...data });
  };

  const head = await upsertUser({ employeeCode: '1361', name: 'Head Office', email: 'headoffice@bharuwasolutions.com', role: 'admin', designation: '-', department: 'Management', location: 'Haridwar', branch: 'Head Office' });
  const admin = await upsertUser({ employeeCode: '1000001', name: 'System Admin', email: 'admin@example.com', role: 'admin', designation: 'Administrator', department: 'IT', location: 'Haridwar' });
  const hr = await upsertUser({ employeeCode: '1000002', name: 'HR Manager', email: 'hr@example.com', role: 'hr', designation: 'HR Manager', department: 'Human Resources', location: 'Haridwar' });
  const varun = await upsertUser({ employeeCode: 'PREPL1361', name: 'Varun Singh', email: 'varun.singh@bharuwasolutions.com', role: 'manager', designation: 'General Manager', department: 'Engineering', location: 'Haridwar', manager: head._id, dateOfJoining: d('2018-04-02') });
  const ashu = await upsertUser({ employeeCode: '1100100', name: 'Ashu Taneja', email: 'ashu.taneja@bharuwasolutions.com', role: 'manager', designation: 'Manager', department: 'Engineering', location: 'Haridwar', manager: varun._id, dateOfJoining: d('2019-06-10') });
  const shiva = await upsertUser({
    employeeCode: '1100175', name: 'Shiva Karnwal', email: 'shiva.karnwal@bharuwasolutions.com', role: 'employee', designation: 'Engineer',
    department: 'Engineering', location: 'Haridwar', branch: 'Haridwar', contact: '9878555641', manager: ashu._id, dateOfJoining: d('2023-01-16'),
    leaveBalance: { sick: 6.5, earned: 42.5, casual: 7, compOff: 0, maternity: 0 },
  });
  await upsertUser({ employeeCode: '1100620', name: 'Ishika Sahu', email: 'ishika.sahu@bharuwasolutions.com', role: 'employee', designation: 'Software Engineer Automation', department: 'Engineering', location: 'Noida', manager: ashu._id, dateOfJoining: d('2024-02-05') });
  await upsertUser({ employeeCode: '1100301', name: 'Rishabh Singh', email: 'rishabh.singh@bharuwasolutions.com', role: 'employee', designation: 'Software Engineer', department: 'Engineering', location: 'Dehradun', manager: ashu._id, dateOfJoining: d('2022-09-21') });

  if (!(await Holiday.countDocuments())) {
    await Holiday.insertMany([
      { name: 'Mahatma Gandhi Jayanti', date: d('2026-10-02') },
      { name: 'Dussehra', date: d('2026-10-20') },
      { name: 'Diwali', date: d('2026-11-08') },
    ]);
  }
  if (!(await Announcement.countDocuments())) {
    await Announcement.create({ title: 'Welcome to the new HR portal', body: 'Apply for leave, comp-off and attendance regularization from one place.', createdBy: hr._id });
  }

  if (!(await Attendance.countDocuments({ employee: shiva._id }))) {
    const today = todayString();
    const base = new Date(`${today}T00:00:00Z`);
    for (let i = 1; i <= 5; i += 1) {
      const day = new Date(base.getTime() - i * 86_400_000);
      const dow = day.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const date = day.toISOString().slice(0, 10);
      await Attendance.create({
        employee: shiva._id, date, status: 'present', source: 'manual', workMinutes: 540,
        inTime: new Date(`${date}T04:00:00Z`), outTime: new Date(`${date}T13:00:00Z`),
      });
    }
  }
  if (!(await Visitor.countDocuments())) {
    await Visitor.create({ employee: shiva._id, visitorName: 'Amit Verma', company: 'Acme Corp', contactNumber: '9876543210', purpose: 'Project discussion', visitDate: d(todayString()), expectedTime: '11:00' });
  }
  if (!(await TravelExpense.countDocuments())) {
    await TravelExpense.create({ employee: shiva._id, expenseNo: 'TE-SEED-0001', purpose: 'Client site visit', fromLocation: 'Haridwar', toLocation: 'Delhi', travelDate: d('2026-09-15'), mode: 'train', amount: 1850 });
  }
  await ensureTicketDefaults();
  if (!(await EmployeeProfile.exists({ user: shiva._id }))) {
    // demo data only — every identity number below is fake
    const enc = (field, value) => encryptField(value, profileAad(shiva._id, field));
    await EmployeeProfile.create({
      user: shiva._id,
      general: { title: 'Mr.', firstName: 'Shiva', lastName: 'Karnwal', gender: 'Male', maritalStatus: 'Single', bloodGroup: 'B+', nationality: 'Indian', religion: 'Hindu', countryOfBirth: 'India' },
      employment: {
        businessUnit: 'BHARUWA-SOLUTIONS-Haridwar', company: 'BHARUWA SOLUTIONS PVT LIMITED', plant: 'Haridwar', headquarters: 'Haridwar', grade: 'E120',
        personType: 'Onroll', employmentCategory: 'Permanent', shiftStart: '09:30', shiftEnd: '18:30', hod: ashu._id,
      },
      contact: { personalMobile: '9000000001', permanentAddress: { city: 'Haridwar', state: 'Uttarakhand', country: 'India', district: 'Haridwar', pincode: '249401' } },
      bank: { bankName: 'State Bank of India', accountHolderName: 'Shiva Karnwal', accountNumber: enc('accountNumber', '000011112222'), ifsc: 'SBIN0000001', branchName: 'Haridwar', accountType: 'Salary' },
      statutory: { aadhaarNo: enc('aadhaarNo', '999900001111'), panNo: enc('panNo', 'ABCDE1234F'), uanNo: '100000000001', confirmationDate: d('2023-07-16') },
      languages: [{ language: 'Hindi', read: true, write: true, speak: true }, { language: 'English', read: true, write: true, speak: true }],
    });
  }
  if (!(await PolicyCategory.countDocuments())) {
    const folders = [
      ['Leave & Attendance', 'purple'], ['Working Hours', 'blue'], ['Medical & Insurance', 'orange'],
      ['IT & BYOD', 'sky'], ['Code of Conduct', 'green'], ['Travel & Expenses', 'amber'],
    ];
    await PolicyCategory.insertMany(folders.map(([name, color]) => ({ name, color, createdBy: hr._id })));
  }
  await seedEmployeeDocs({ employee: shiva, by: hr });
  log(`Seeded users: ${await User.countDocuments()} (admin@example.com / hr@example.com / ashu.taneja@... / shiva.karnwal@...)`);
  return { admin, hr, ashu, shiva, varun, head };
}

// CLI: node src/seed/seed.js [--reset] [--force]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (env.isProd && !args.includes('--force')) {
    console.error('Refusing to seed in production without --force');
    process.exit(1);
  }
  connectDB()
    .then(() => seedDatabase({ reset: args.includes('--reset') }))
    .then(() => console.log(`Done. All seeded accounts use the password from SEED_PASSWORD.`))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => disconnectDB());
}
export default mongoose;
