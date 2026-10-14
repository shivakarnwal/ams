import 'dotenv/config';
import crypto from 'node:crypto';

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');

const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')} (see .env.example)`);
}

function resolveSalaryKey() {
  const raw = process.env.SALARY_ENCRYPTION_KEY;
  if (raw) {
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('SALARY_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    return Buffer.from(raw, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SALARY_ENCRYPTION_KEY is required in production (generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  }
  // dev/test only: derive a key so the feature works out of the box
  return crypto.createHash('sha256').update(`salary-slips:${process.env.JWT_SECRET}`).digest();
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  allowPublicSignup: bool(process.env.ALLOW_PUBLIC_SIGNUP, false),
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  weeklyTargetHours: Number(process.env.WEEKLY_TARGET_HOURS) || 48,
  salarySlipMaxMb: Number(process.env.SALARY_SLIP_MAX_MB) || 5,
  salaryEncryptionKey: resolveSalaryKey(),
  galleryMaxMb: Number(process.env.GALLERY_MAX_MB) || 15,
  /** Lifetime of signed photo URLs. URLs are bucketed so they stay stable (and cacheable) for at least this long. */
  galleryUrlTtlHours: Math.min(Math.max(Number(process.env.GALLERY_URL_TTL_HOURS) || 6, 1), 72),
  policyMaxMb: Number(process.env.POLICY_MAX_MB) || 20,
  ticketAttachmentMaxMb: Number(process.env.TICKET_ATTACHMENT_MAX_MB) || 10,
  ticketMaxFiles: Math.min(Math.max(Number(process.env.TICKET_MAX_FILES) || 5, 1), 10),
  enableDocs: bool(process.env.ENABLE_DOCS, false),
  seedPassword: process.env.SEED_PASSWORD || 'ChangeMe@123',
};

if (env.isProd && env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
