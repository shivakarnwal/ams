// Boots the API against a real MongoDB-compatible server for integration tests.
// Set TEST_MONGODB_URI to use your own MongoDB; otherwise mongodb-memory-server is used.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-test';
process.env.SEED_PASSWORD = 'Passw0rd!test';
process.env.SALARY_SLIP_MAX_MB = '1';

let mem;
let uri = process.env.TEST_MONGODB_URI;
if (!uri) {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mem = await MongoMemoryServer.create();
  uri = mem.getUri();
}
process.env.MONGODB_URI = uri;

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { seedDatabase } = await import('../src/seed/seed.js');
const { default: request } = await import('supertest');

export const app = createApp();
export const api = request(app);
export const PASSWORD = process.env.SEED_PASSWORD;

export async function start() {
  await connectDB(uri);
  return seedDatabase({ reset: true, log: () => {} });
}
export async function stop() {
  await disconnectDB();
  if (mem) await mem.stop();
}
export async function login(email) {
  const res = await api.post('/api/v1/auth/login').send({ email, password: PASSWORD, device_id: 'TEST' });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, user: res.body.user };
}
export const auth = (token) => ({ Authorization: `Bearer ${token}` });
