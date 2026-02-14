import { z } from 'zod';
import { insertSubmissionSchema, insertProblemSchema, problems, submissions, users } from './schema';

export const api = {
  problems: {
    list: {
      method: 'GET' as const,
      path: '/api/problems' as const,
      responses: {
        200: z.array(z.custom<typeof problems.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/problems/:id' as const,
      responses: {
        200: z.custom<typeof problems.$inferSelect>(),
        404: z.object({ message: z.string() }),
      },
    },
  },
  submissions: {
    create: {
      method: 'POST' as const,
      path: '/api/submissions' as const,
      input: z.object({
        code: z.string(),
        problemId: z.number(),
      }),
      responses: {
        201: z.custom<typeof submissions.$inferSelect>(),
        401: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/submissions' as const, // user-specific
      responses: {
        200: z.array(z.custom<typeof submissions.$inferSelect & { problemTitle: string }>()),
        401: z.object({ message: z.string() }),
      },
    },
  },
  users: {
    me: {
      method: 'GET' as const,
      path: '/api/user' as const,
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: z.null(),
      },
    },
  }
};

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
