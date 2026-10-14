import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { ensureTicketDefaults } from './seed/ticketDefaults.js';

async function main() {
  await connectDB();
  console.log('MongoDB connected');
  await ensureTicketDefaults(); // starter ticket categories/priorities on a fresh database (no-op afterwards)
  const server = createApp().listen(env.port, () => console.log(`API running on http://localhost:${env.port}/api/v1 (${env.nodeEnv})`));

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => { await disconnectDB(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
