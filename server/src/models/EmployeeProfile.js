import mongoose from 'mongoose';
import { DOCUMENT_TYPES } from './profileOptions.js';

const { ObjectId } = mongoose.Schema.Types;
const str = (max = 120) => ({ type: String, trim: true, default: '', maxlength: max });
const file = new mongoose.Schema(
  {
    fileId: { type: ObjectId, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    kind: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);
const address = new mongoose.Schema(
  { line1: str(200), line2: str(200), pincode: str(10), country: str(60), state: str(60), city: str(80), district: str(80) },
  { _id: false },
);
const meta = new mongoose.Schema({ updatedBy: { type: ObjectId, ref: 'User' }, updatedAt: Date }, { _id: false });

/**
 * Extended HR profile, one per user. Identity/login fields (name, email, role, manager, department …) stay on
 * User; everything here is the employee master data shown on My Profile.
 * Values in SECRET_FIELDS are stored encrypted ("v1:…") — see utils/fieldCrypto.js.
 */
const profileSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, unique: true },
    general: {
      title: str(10), firstName: str(60), middleName: str(60), lastName: str(60),
      gender: str(20), maritalStatus: str(20), bloodGroup: str(5), nationality: str(60), religion: str(60),
      birthPlace: str(80), stateOfBirth: str(60), countryOfBirth: str(60),
    },
    employment: {
      businessUnit: str(), company: str(), plant: str(), headquarters: str(), subDepartment: str(), division: str(), function: str(),
      grade: str(20), personType: str(20), costCenter: str(60), position: str(), employmentCategory: str(40),
      groupDateOfJoining: Date, shiftStart: str(8), shiftEnd: str(8),
      hod: { type: ObjectId, ref: 'User', default: null },
      adminManager: { type: ObjectId, ref: 'User', default: null },
    },
    contact: {
      personalEmail: str(120), personalMobile: str(20), emergencyContactPerson: str(120), emergencyContactNo: str(20), emergencyMedicalProblem: str(300),
      permanentAddress: { type: address, default: () => ({}) },
      correspondenceAddress: { type: address, default: () => ({}) },
      sameAsPermanent: { type: Boolean, default: false },
    },
    bank: {
      bankName: str(), accountHolderName: str(), accountNumber: str(200) /* encrypted */, ifsc: str(11), branchName: str(), accountType: str(20),
    },
    statutory: {
      passportNo: str(200), passportValidUpto: Date, aadhaarNo: str(200), panNo: str(200) /* encrypted */,
      uanNo: str(20), drivingLicence: str(30), esiNo: str(20), pfAccountNo: str(30),
      uniformStatus: str(20), uniformType: str(40), extraUniform: str(20), attendanceInput: str(20), confirmationDate: Date,
    },
    documents: [{ type: { type: String, enum: DOCUMENT_TYPES, required: true }, file: { type: file, required: true } }],
    experience: [{
      employer: str(), designation: str(), fromDate: Date, toDate: Date, location: str(), city: str(80), attachment: { type: file, default: null },
    }],
    education: [{
      level: str(60), certificate: str(60), fromDate: Date, toDate: Date, mode: str(30), institute: str(150), passingYear: Number,
      percentage: Number, grade: str(20), university: str(150), country: str(60), attachment: { type: file, default: null },
    }],
    family: [{
      relationship: str(30), name: str(), gender: str(20), dateOfBirth: Date, university: str(150), qualification: str(), passingYear: Number,
      percentage: Number, grade: str(20), school: str(150), dependent: { type: Boolean, default: false }, working: { type: Boolean, default: false }, placeOfBirth: str(80),
    }],
    languages: [{ language: str(40), read: Boolean, write: Boolean, speak: Boolean }],
    hobbies: [{ sportType: str(40), culturalType: str(40), hobby: str(), others: str() }],
    /** who last changed each section, for "Updated by … on …" */
    sectionMeta: { type: Map, of: meta, default: () => new Map() },
  },
  { timestamps: true },
);

export const EmployeeProfile = mongoose.models.EmployeeProfile || mongoose.model('EmployeeProfile', profileSchema);

/** Append-only log of profile changes and sensitive-value reveals. Values are never stored here, only field names. */
const auditSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    actor: { type: ObjectId, ref: 'User', required: true },
    section: { type: String, required: true },
    action: { type: String, enum: ['update', 'add', 'edit', 'remove', 'reveal', 'upload', 'delete'], required: true },
    fields: [String],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ user: 1, createdAt: -1 });
export const ProfileAudit = mongoose.models.ProfileAudit || mongoose.model('ProfileAudit', auditSchema);
