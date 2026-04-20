import type { FastifyInstance } from 'fastify';
import { CurrencyConvertQuerySchema } from '@vault/types';
import { cacheGetOrSet, CacheKeys } from '@vault/cache';
import { mockGetExchangeRate } from '@vault/mocks';
import { handleZodError } from '../lib/errors.js';
import { ZodError } from 'zod';

const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'SAR'] as const;

export async function currencyRoutes(app: FastifyInstance) {
  app.get('/rates', async (_request, reply) => {
    const data = await Promise.all(
      CURRENCIES.flatMap((from) =>
        CURRENCIES.map(async (to) =>
          cacheGetOrSet(
            CacheKeys.exchangeRate(from, to),
            () => mockGetExchangeRate(from, to),
            3600,
          ).catch(() => mockGetExchangeRate(from, to)),
        ),
      ),
    );

    return reply.send({ success: true, data });
  });

  app.get('/convert', async (request, reply) => {
    try {
      const query = CurrencyConvertQuerySchema.parse(request.query);
      const rate = await cacheGetOrSet(
        CacheKeys.exchangeRate(query.from, query.to),
        () => mockGetExchangeRate(query.from, query.to),
        3600,
      ).catch(() => mockGetExchangeRate(query.from, query.to));

      return reply.send({
        success: true,
        data: {
          from: query.from,
          to: query.to,
          amount: query.amount,
          converted: Number((query.amount * rate.rate).toFixed(2)),
          rate: rate.rate,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });
}
