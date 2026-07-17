import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { Server as SocketServer } from 'socket.io';
import { createContext } from './context.js';
import { createQueue, createWorker } from './queue.js';
import { registerRoutes } from './routes.js';

const PORT = Number(process.env.PORT ?? 3000);

const ctx = await createContext();
const app = Fastify({ logger: true });
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

const queue = createQueue(ctx);
registerRoutes(app, ctx, queue);

await app.listen({ port: PORT, host: '0.0.0.0' });

// Socket.IO compartilha o servidor HTTP do Fastify.
const io = new SocketServer(app.server, { cors: { origin: '*' } });
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
