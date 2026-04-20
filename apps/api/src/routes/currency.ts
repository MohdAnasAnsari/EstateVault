import type { FastifyInstance } from 'fastify';
import { getDb } from '@vault/db';
import { exchangeRatesCache } from '@vault/db/schema';
import { mockGetExchangeRate } from '@vault/mocks';
import { cacheGetOrSet, CacheKeys } from '@vault/cache';
import { sendError } from '../lib/errors.js';

const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'SAR'];
const MOCK = process.env['MOCK_SERVICES'] !== 'false';

export async function currencyRoutes(app: FastifyInstance) {
  // GET /currency/rates
  app.get('/rates', async (_request, reply) => {
    const pairs: Array<{ from: string; to: string; rate: number; fetchedAt: string }> = [];

    for (const from of CURRENCIES) {
      for (const to of CURRENCIES) {
        const result = await cacheGetOrSet(
          CacheKeys.exchangeRate(from, to),
          () => mockGetExchangeRate(from, to),
          3600, // 1 hour TTL
        ).catch(() => mockGetExchangeRate(from, to));
        pairs.push(result);
      }
    }

    return reply.send({ success: true, data: pairs });
  });

  // GET /currency/convert
  app.get('/convert', async (request, reply) => {
    const { from, to, amount } = request.query as {
      from?: string;
      to?: string;
      amount?: string;
    };

    if (!from || !to || !amount) {
      return sendError(reply, 400, 'MISSING_PARAMS', 'from, to, and amount are required');
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) {
      return sendError(reply, 400, 'INVALID_AMOUNT', 'amount must be a valid number');
    }

    const rateResult = await cacheGetOrSet(
      CacheKeys.exchangeRate(from.toUpperCase(), to.toUpperCase()),
      () => mockGetExchangeRate(from.toUpperCase(), to.toUpperCase()),
      3600,
    ).catch(() => mockGetExchangeRate(from.toUpperCase(), to.toUpperCase()));

    return reply.send({
      success: true,
      data: {
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        amount: numAmount,
        converted: numAmount * rateResult.rate,
        rate: rateResult.rate,
      },
    });
  });
}
