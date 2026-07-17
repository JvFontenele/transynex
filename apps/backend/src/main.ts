import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { Server as SocketServer } from 'socket.io';
import { registerAuth } from './auth.js';
import { createContext } from './context.js';
import { createQueue, createWorker } from './queue.js';
import { registerRoutes } from './routes.js';

const PORT = Number(process.env.PORT ?? 3000);

const ctx = await createContext();
// maxParamLength: o token JWT de /files/:token excede os 100 chars default.
const app = Fastify({ logger: true, maxParamLength: 1000 });
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

const auth = await registerAuth(app, ctx);
const queue = createQueue(ctx);
registerRoutes(app, ctx, queue, auth);

await app.listen({ port: PORT, host: '0.0.0.0' });

// Socket.IO compartilha o servidor HTTP do Fastify.
const io = new SocketServer(app.server, { cors: { origin: '*' } });
io.use((socket, next) => {
  try {
    app.jwt.verify(socket.handshake.auth?.token ?? '');
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
const worker = createWorker(ctx, io);

const shutdown = async () => {
  await worker.close();
  await queue.close();
  io.close();
  await app.close();
  await ctx.prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
