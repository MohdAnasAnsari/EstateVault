import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { cacheGet, cacheSet } from '@vault/cache';
import { aiService } from '@vault/ai';
import { apiSuccess, apiError } from '@vault/types';
import { createLogger } from '@vault/logger';

const logger = createLogger('analytics-service:market-intelligence');

export async function marketIntelligenceRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /price-trends — Price/sqm trends ───────────────────────────────────
  fastify.get('/price-trends', async (request, reply) => {
    const QuerySchema = z.object({
      city: z.string().min(1).default('Dubai'),
      assetType: z.string().optional(),
      months: z.coerce.number().int().min(1).max(24).default(12),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { city, assetType, months } = parsed.data;
    const cacheKey = `mi:price-trends:${city}:${assetType ?? 'all'}:${months}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const intelligence = await aiService.getMarketIntelligence(city);

    const result = {
      city,
      assetType: assetType ?? 'all',
      months,
      trends: intelligence.pricePerSqm.slice(-months),
      updatedAt: intelligence.updatedAt,
    };

    await cacheSet(cacheKey, result, 3600); // 1hr cache
    return reply.send(apiSuccess(result));
  });

  // ── GET /transaction-velocity — Transaction volume metrics ─────────────────
  fastify.get('/transaction-velocity', async (request, reply) => {
    const QuerySchema = z.object({
      city: z.string().min(1).default('Dubai'),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { city } = parsed.data;
    const cacheKey = `mi:transaction-velocity:${city}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const intelligence = await aiService.getMarketIntelligence(city);

    const result = {
      city,
      velocity: intelligence.transactionVelocity,
      totalDeals: intelligence.transactionVelocity.reduce((sum, v) => sum + v.deals, 0),
      avgDealsPerMonth:
        intelligence.transactionVelocity.length > 0
          ? Math.round(
              intelligence.transactionVelocity.reduce((sum, v) => sum + v.deals, 0) /
                intelligence.transactionVelocity.length,
            )
          : 0,
      updatedAt: intelligence.updatedAt,
    };

    await cacheSet(cacheKey, result, 3600);
    return reply.send(apiSuccess(result));
  });

  // ── GET /cap-rates — Cap rate analysis ────────────────────────────────────
  fastify.get('/cap-rates', async (request, reply) => {
    const QuerySchema = z.object({
      city: z.string().min(1).default('Dubai'),
      assetType: z.string().optional(),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { city, assetType } = parsed.data;
    const cacheKey = `mi:cap-rates:${city}:${assetType ?? 'all'}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const intelligence = await aiService.getMarketIntelligence(city);

    const capRates = assetType
      ? intelligence.capRates.filter((cr) => cr.assetType === assetType)
      : intelligence.capRates;

    const result = {
      city,
      assetType: assetType ?? 'all',
      capRates,
      marketAverage:
        capRates.length > 0
          ? parseFloat(
              (capRates.reduce((sum, cr) => sum + cr.current, 0) / capRates.length).toFixed(2),
            )
          : null,
      updatedAt: intelligence.updatedAt,
    };

    await cacheSet(cacheKey, result, 3600);
    return reply.send(apiSuccess(result));
  });

  // ── GET /demand-heatmap — Geographic demand intensity ─────────────────────
  fastify.get('/demand-heatmap', async (request, reply) => {
    const QuerySchema = z.object({
      city: z.string().min(1).default('Dubai'),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { city } = parsed.data;
    const cacheKey = `mi:demand-heatmap:${city}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const intelligence = await aiService.getMarketIntelligence(city);

    const result = {
      city,
      heatmap: intelligence.demandHeatmap,
      hotspots: intelligence.demandHeatmap
        .filter((p) => p.intensity >= 0.7)
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 5),
      updatedAt: intelligence.updatedAt,
    };

    await cacheSet(cacheKey, result, 3600);
    return reply.send(apiSuccess(result));
  });

  // ── GET /forecast — AI-powered 6-month price forecast ─────────────────────
  fastify.get('/forecast', async (request, reply) => {
    const QuerySchema = z.object({
      city: z.string().min(1).default('Dubai'),
      assetType: z.string().optional(),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { city, assetType } = parsed.data;
    const cacheKey = `mi:forecast:${city}:${assetType ?? 'all'}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const intelligence = await aiService.getMarketIntelligence(city);

    const result = {
      city,
      assetType: assetType ?? 'all',
      forecast: intelligence.forecast,
      label: intelligence.forecastLabel,
      activeBuyerBriefs: intelligence.activeBuyerBriefs.filter(
        (b) => !assetType || b.assetType === assetType,
      ),
      updatedAt: intelligence.updatedAt,
    };

    await cacheSet(cacheKey, result, 7200); // 2hr cache for forecasts
    return reply.send(apiSuccess(result));
  });

  // ── GET /investment-calculator — ROI, mortgage, 5-year projections ─────────
  fastify.get('/investment-calculator', async (request, reply) => {
    const InputSchema = z.object({
      price: z.coerce.number().positive(),
      downPayment: z.coerce.number().min(0).max(100).default(20),
      interestRate: z.coerce.number().min(0).max(30).default(4.5),
      holdingPeriod: z.coerce.number().int().min(1).max(30).default(5),
      annualRentalIncome: z.coerce.number().min(0).default(0),
      annualExpenses: z.coerce.number().min(0).max(100).default(5),
      appreciation: z.coerce.number().min(-20).max(50).default(3),
      currency: z.string().length(3).default('AED'),
      transactionCosts: z.coerce.number().min(0).max(20).default(4),
    });

    const parsed = InputSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid inputs', parsed.error.flatten()));
    }

    const {
      price,
      downPayment,
      interestRate,
      holdingPeriod,
      annualRentalIncome,
      annualExpenses,
      appreciation,
      currency,
      transactionCosts,
    } = parsed.data;

    // Core calculations
    const downPaymentAmt = (price * downPayment) / 100;
    const loanAmount = price - downPaymentAmt;
    const monthlyRate = interestRate / 100 / 12;
    const totalPayments = holdingPeriod * 12;

    const monthlyMortgagePayment =
      monthlyRate > 0
        ? (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments))) /
          (Math.pow(1 + monthlyRate, totalPayments) - 1)
        : loanAmount / totalPayments;

    const annualExpenseAmt = (annualRentalIncome * annualExpenses) / 100;
    const netRentalIncome = annualRentalIncome - annualExpenseAmt;
    const annualMortgage = monthlyMortgagePayment * 12;
    const annualCashFlow = netRentalIncome - annualMortgage;

    const grossRentalYield = price > 0 ? (annualRentalIncome / price) * 100 : 0;
    const netRentalYield = price > 0 ? (netRentalIncome / price) * 100 : 0;
    const capRate = price > 0 ? (netRentalIncome / price) * 100 : 0;
    const cashOnCashReturn = downPaymentAmt > 0 ? (annualCashFlow / downPaymentAmt) * 100 : 0;

    // 5-year projection
    const transactionCostAmt = (price * transactionCosts) / 100;
    const totalInitialInvestment = downPaymentAmt + transactionCostAmt;

    let remainingLoan = loanAmount;
    let cumulativeRentalIncome = 0;
    const fiveYearProjection = [];

    for (let year = 1; year <= Math.min(holdingPeriod, 10); year++) {
      const propertyValue = price * Math.pow(1 + appreciation / 100, year);
      const yearlyInterest = remainingLoan * (interestRate / 100);
      const yearlyPrincipal = Math.min(annualMortgage - yearlyInterest, remainingLoan);
      remainingLoan = Math.max(0, remainingLoan - yearlyPrincipal);
      cumulativeRentalIncome += netRentalIncome;
      const equity = propertyValue - remainingLoan;
      const totalReturn = equity + cumulativeRentalIncome - totalInitialInvestment;
      const roi = totalInitialInvestment > 0 ? (totalReturn / totalInitialInvestment) * 100 : 0;

      fiveYearProjection.push({
        year,
        propertyValue: Math.round(propertyValue),
        equity: Math.round(equity),
        cumulativeRentalIncome: Math.round(cumulativeRentalIncome),
        annualCashFlow: Math.round(annualCashFlow),
        roi: parseFloat(roi.toFixed(2)),
      });
    }

    // Break-even calculation
    let breakEvenYears = 0;
    let cumulativeReturn = 0;
    for (let y = 1; y <= 30; y++) {
      const propVal = price * Math.pow(1 + appreciation / 100, y);
      cumulativeReturn = propVal - loanAmount + netRentalIncome * y - totalInitialInvestment;
      if (cumulativeReturn >= 0) {
        breakEvenYears = y;
        break;
      }
    }

    const result = {
      inputs: {
        price,
        downPayment,
        interestRate,
        holdingPeriod,
        annualRentalIncome,
        annualExpenses,
        appreciation,
        currency,
        transactionCosts,
      },
      calculations: {
        downPaymentAmount: Math.round(downPaymentAmt),
        loanAmount: Math.round(loanAmount),
        monthlyMortgagePayment: Math.round(monthlyMortgagePayment),
        grossRentalYield: parseFloat(grossRentalYield.toFixed(2)),
        netRentalYield: parseFloat(netRentalYield.toFixed(2)),
        annualCashFlow: Math.round(annualCashFlow),
        capRate: parseFloat(capRate.toFixed(2)),
        cashOnCashReturn: parseFloat(cashOnCashReturn.toFixed(2)),
        breakEvenYears,
        currency,
      },
      fiveYearProjection,
    };

    return reply.send(apiSuccess(result));
  });
}
