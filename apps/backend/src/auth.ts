import type { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import argon2 from 'argon2';
import type { AppContext } from './context.js';

const ACCESS_TTL = '15m';
const FILE_TTL = '1h';
const REFRESH_TTL = '7d';
const REFRESH_COOKIE = 'refresh_token';
const IS_PROD = process.env.NODE_ENV === 'production';

export interface AuthHelpers {
  /** URL assinada para servir um StorageRef via GET /api/v1/files/:token. */
  fileUrlFor(ref: string): string;
  /** URL assinada de download de um ExportArtifact. */
  exportDownloadUrlFor(artifactId: string): string;
}

export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<AuthHelpers> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não definido — obrigatório para autenticação');
  }

  await app.register(cookie);
  await app.register(jwt, { secret });

  // Bootstrap: cria o primeiro admin a partir do env se o banco está vazio.
  if ((await ctx.prisma.user.count()) === 0) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      await ctx.prisma.user.create({
        data: { email, passwordHash: await argon2.hash(password) },
      });
      app.log.info({ email }, 'Usuário admin inicial criado');
    } else {
      app.log.warn('Nenhum usuário no banco e ADMIN_EMAIL/ADMIN_PASSWORD ausentes — login impossível');
    }
  }

  const issueTokens = (user: { id: string; email: string; role: string }) => ({
    accessToken: app.jwt.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: ACCESS_TTL }),
    fileToken: app.jwt.sign({ scope: 'files' }, { expiresIn: FILE_TTL }),
  });

  const setRefreshCookie = (reply: { setCookie: Function }, userId: string) => {
    const token = app.jwt.sign({ sub: userId, type: 'refresh' }, { expiresIn: REFRESH_TTL });
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    });
  };

  app.post<{ Body: { email: string; password: string } }>('/api/v1/auth/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return reply.code(400).send({ error: 'email e password são obrigatórios' });

    const user = await ctx.prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send({ error: 'Credenciais inválidas' });
    }

    setRefreshCookie(reply, user.id);
    return {
      ...issueTokens(user),
      user: { id: user.id, email: user.email, role: user.role },
    };
  });

  app.post('/api/v1/auth/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) return reply.code(401).send({ error: 'Sessão expirada' });

    let payload: { sub: string; type?: string };
    try {
      payload = app.jwt.verify(raw);
    } catch {
      return reply.code(401).send({ error: 'Sessão expirada' });
    }
    if (payload.type !== 'refresh') return reply.code(401).send({ error: 'Sessão expirada' });

    const user = await ctx.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return reply.code(401).send({ error: 'Sessão expirada' });

    setRefreshCookie(reply, user.id);
    return {
      ...issueTokens(user),
      user: { id: user.id, email: user.email, role: user.role },
    };
  });

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return reply.code(204).send();
  });

  // Proteção global: tudo em /api/v1 exige Bearer, exceto auth e rotas
  // servidas por token próprio na URL (imagens em <img src> e downloads
  // não enviam header Authorization).
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    if (!url.startsWith('/api/')) return;
    if (url.startsWith('/api/v1/auth/')) return;
    if (url.startsWith('/api/v1/files/')) return;
    if (/^\/api\/v1\/exports\/[^/]+\/download/.test(url)) return;
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
  });

  return {
    fileUrlFor: (ref) =>
      `/api/v1/files/${app.jwt.sign({ ref, scope: 'file' }, { expiresIn: FILE_TTL })}`,
    exportDownloadUrlFor: (artifactId) =>
      `/api/v1/exports/${artifactId}/download?t=${app.jwt.sign({ artifactId, scope: 'export' }, { expiresIn: FILE_TTL })}`,
  };
}
