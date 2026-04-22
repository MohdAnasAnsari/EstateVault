import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { exchangeRatesCache } from '@vault/db';
import { cacheGet, cacheSet, CacheKeys } from '@vault/cache';
import { apiSuccess, apiError } from '@vault/types';
import { createLogger } from '@vault/logger';
import { eq, and } from 'drizzle-orm';

const logger = createLogger('analytics-service:currency');

// Supported currencies (AED base)
const SUPPORTED_CURRENCIES = [
  'AED', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'INR', 'SAR', 'QAR',
  'KWD', 'BHD', 'OMR', 'EGP', 'JOD', 'RUB', 'CAD', 'AUD', 'SGD', 'HKD',
];

// Mock/fallback rates relative to AED
const FALLBACK_RATES: Record<string, number> = {
  AED: 1,
  USD: 0.2723,
  EUR: 0.2517,
  GBP: 0.2154,
  CHF: 0.2441,
  JPY: 41.14,
  CNY: 1.9764,
  INR: 22.638,
  SAR: 1.0206,
  QAR: 0.9905,
  KWD: 0.08367,
  BHD: 0.10262,
  OMR: 0.10479,
  EGP: 13.208,
  JOD: 0.19309,
  RUB: 24.99,
  CAD: 0.37468,
  AUD: 0.42368,
  SGD: 0.36571,
  HKD: 2.1239,
};

async function fetchLiveRates(): Promise<Record<string, number>> {
  const apiKey = process.env['CURRENCY_API_KEY'];
  if (!apiKey) {
    logger.debug('No CURRENCY_API_KEY set — using fallback rates');
    return FALLBACK_RATES;
  }

  try {
    const url = `https://api.currencyapi.com/v3/latest?apikey=${apiKey}&base_currency=AED&currencies=${SUPPORTED_CURRENCIES.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Currency API responded ${res.status}`);
    const json = await res.json() as { data: Record<string, { value: number }> };
    const rates: Record<string, number> = {};
    for (const [code, entry] of Object.entries(json.data)) {
      rates[code] = entry.value;
    }
    return rates;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch live currency rates — using fallback');
    return FALLBACK_RATES;
  }
}

export async function currencyRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── GET /rates — Get exchange rates (AED base) ─────────────────────────────
  fastify.get('/rates', async (request, reply) => {
    const cacheKey = 'currency:rates:AED';
    const cached = await cacheGet<{ rates: Record<string, number>; fetchedAt: string }>(cacheKey);

    if (cached) {
      return reply.send(apiSuccess(cached));
    }

    const rates = await fetchLiveRates();
    const fetchedAt = new Date().toISOString();

    const result = { base: 'AED', rates, fetchedAt, supported: SUPPORTED_CURRENCIES };

    // Cache in Redis for 1 hour
    await cacheSet(cacheKey, result, 3600);

    // Persist to DB for audit trail
    await Promise.all(
      Object.entries(rates).map(([to, rate]) =>
        db
          .insert(exchangeRatesCache)
          .values({ fromCurrency: 'AED', toCurrency: to, rate: rate.toString() })
          .onConflictDoUpdate({
            target: [exchangeRatesCache.fromCurrency, exchangeRatesCache.toCurrency],
            set: { rate: rate.toString(), fetchedAt: new Date() },
          })
          .catch((err: unknown) => logger.error({ err, to }, 'Failed to persist rate')),
      ),
    );

    return reply.send(apiSuccess(result));
  });

  // ── GET /convert — Convert between currencies ──────────────────────────────
  fastify.get('/convert', async (request, reply) => {
    const QuerySchema = z.object({
      from: z.string().length(3).toUpperCase(),
      to: z.string().length(3).toUpperCase(),
      amount: z.coerce.number().positive(),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(
        apiError('VALIDATION_ERROR', 'Provide from, to (3-letter currency codes), and amount', parsed.error.flatten()),
      );
    }

    const { from, to, amount } = parsed.data;

    if (from === to) {
      return reply.send(apiSuccess({ from, to, amount, converted: amount, rate: 1 }));
    }

    // Get rates
    const cacheKey = 'currency:rates:AED';
    let rates: Record<string, number> = {};

    const cached = await cacheGet<{ rates: Record<string, number> }>(cacheKey);
    if (cached) {
      rates = cached.rates;
    } else {
      rates = await fetchLiveRates();
      await cacheSet(cacheKey, { base: 'AED', rates, fetchedAt: new Date().toISOString() }, 3600);
    }

    // Convert via AED as base
    // If from = AED, rate is rates[to]
    // If to = AED, rate is 1 / rates[from]
    // Otherwise: amount_AED = amount / rates[from], converted = amount_AED * rates[to]
    let converted: number;
    let rate: number;

    if (from === 'AED') {
      const toRate = rates[to];
      if (!toRate) {
        return reply.code(400).send(apiError('UNSUPPORTED_CURRENCY', `Currency ${to} is not supported`));
      }
      rate = toRate;
      converted = amount * toRate;
    } else if (to === 'AED') {
      const fromRate = rates[from];
      if (!fromRate) {
        return reply.code(400).send(apiError('UNSUPPORTED_CURRENCY', `Currency ${from} is not supported`));
      }
      rate = 1 / fromRate;
      converted = amount * rate;
    } else {
      const fromRate = rates[from];
      const toRate = rates[to];
      if (!fromRate) {
        return reply.code(400).send(apiError('UNSUPPORTED_CURRENCY', `Currency ${from} is not supported`));
      }
      if (!toRate) {
        return reply.code(400).send(apiError('UNSUPPORTED_CURRENCY', `Currency ${to} is not supported`));
      }
      const amountInAed = amount / fromRate;
      converted = amountInAed * toRate;
      rate = converted / amount;
    }

    return reply.send(
      apiSuccess({
        from,
        to,
        amount,
        converted: parseFloat(converted.toFixed(4)),
        rate: parseFloat(rate.toFixed(6)),
      }),
    );
  });
}
