import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import type { Role } from '@prisma/client';
import type { AppContext } from './context.js';
import { actorOf } from './auth.js';

const ROLES = new Set<string>(['ADMIN', 'EDITOR', 'VIEWER']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = { id: true, email: true, role: true, createdAt: true } as const;

/** Rotas de gestão de usuários — todas exclusivas de ADMIN. */
export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Guard local: tudo em /api/v1/users exige ADMIN (a autenticação em si
  // já foi garantida pelo hook global de auth.ts).
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/v1/users')) return;
    if (actorOf(req).role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Apenas administradores' });
    }
  });

  app.get('/api/v1/users', async () =>
    ctx.prisma.user.findMany({
      select: { ...publicUser, _count: { select: { projects: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  );

  app.post<{ Body: { email: string; password: string; role?: string } }>(
    '/api/v1/users',
    async (req, reply) => {
      const { email, password, role = 'EDITOR' } = req.body ?? {};
      if (!email || !EMAIL_RE.test(email)) {
        return reply.code(400).send({ error: 'email inválido' });
      }
      if (!password || password.length < 8) {
        return reply.code(400).send({ error: 'password deve ter ao menos 8 caracteres' });
      }
      if (!ROLES.has(role)) return reply.code(400).send({ error: `role inválido: ${role}` });
      if (await ctx.prisma.user.findUnique({ where: { email } })) {
        return reply.code(409).send({ error: 'Já existe um usuário com esse email' });
      }
      const user = await ctx.prisma.user.create({
        data: { email, passwordHash: await argon2.hash(password), role: role as Role },
        select: publicUser,
      });
      return reply.code(201).send(user);
    },
  );

  app.patch<{ Params: { id: string }; Body: { role?: string; password?: string } }>(
    '/api/v1/users/:id',
    async (req, reply) => {
      const { role, password } = req.body ?? {};
      const user = await ctx.prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });

      if (role !== undefined) {
        if (!ROLES.has(role)) return reply.code(400).send({ error: `role inválido: ${role}` });
        // Nunca deixar o sistema sem admin (inclui rebaixar a si mesmo).
        if (user.role === 'ADMIN' && role !== 'ADMIN') {
          const admins = await ctx.prisma.user.count({ where: { role: 'ADMIN' } });
          if (admins <= 1) {
            return reply.code(409).send({ error: 'Não é possível rebaixar o último administrador' });
          }
        }
      }
      if (password !== undefined && password.length < 8) {
        return reply.code(400).send({ error: 'password deve ter ao menos 8 caracteres' });
      }

      return ctx.prisma.user.update({
        where: { id: user.id },
        data: {
          role: role as Role | undefined,
          passwordHash: password ? await argon2.hash(password) : undefined,
        },
        select: publicUser,
      });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/v1/users/:id', async (req, reply) => {
    if (req.params.id === actorOf(req).sub) {
      return reply.code(409).send({ error: 'Você não pode excluir a si mesmo' });
    }
    const user = await ctx.prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });
    if (user.role === 'ADMIN') {
      const admins = await ctx.prisma.user.count({ where: { role: 'ADMIN' } });
      if (admins <= 1) {
        return reply.code(409).send({ error: 'Não é possível excluir o último administrador' });
      }
    }
    // Projetos do usuário ficam sem dono (ownerId -> null) e visíveis só a admins.
    await ctx.prisma.user.delete({ where: { id: user.id } });
    return reply.code(204).send();
  });
}
