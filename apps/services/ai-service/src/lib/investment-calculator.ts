/**
 * Investment Calculator Library
 * Provides mortgage, ROI, cap rate and 5-year projection calculations.
 */

// ─── Mortgage Calculator ───────────────────────────────────────────────────────

/**
 * Calculate monthly mortgage payment using standard amortisation formula.
 *
 * @param price - Total property price
 * @param downPayment - Down payment amount
 * @param interestRate - Annual interest rate as percentage (e.g. 5 for 5%)
 * @param years - Loan term in years
 * @returns Monthly payment amount
 */
export function calculateMortgage(
  price: number,
  downPayment: number,
  interestRate: number,
  years: number,
): number {
  const principal = price - downPayment;
  if (principal <= 0) return 0;

  const monthlyRate = interestRate / 100 / 12;
  const numPayments = years * 12;

  if (monthlyRate === 0) {
    return principal / numPayments;
  }

  // Standard amortisation formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
  const factor = Math.pow(1 + monthlyRate, numPayments);
  return (principal * (monthlyRate * factor)) / (factor - 1);
}

// ─── ROI Calculator ───────────────────────────────────────────────────────────

/**
 * Calculate gross and net rental yield.
 *
 * @param annualRent - Annual rental income
 * @param purchasePrice - Purchase price of property
 * @param expenses - Annual expenses (mortgage, maintenance, insurance, etc.)
 * @returns Gross and net yield percentages
 */
export function calculateROI(
  annualRent: number,
  purchasePrice: number,
  expenses: number,
): { grossYield: number; netYield: number } {
  if (purchasePrice <= 0) {
    return { grossYield: 0, netYield: 0 };
  }

  const grossYield = Math.round((annualRent / purchasePrice) * 100 * 100) / 100;
  const netIncome = annualRent - expenses;
  const netYield = Math.round((netIncome / purchasePrice) * 100 * 100) / 100;

  return { grossYield, netYield };
}

// ─── 5-Year Projection ────────────────────────────────────────────────────────

export interface ProjectionParams {
  price: number;
  downPayment: number;
  interestRate: number;
  annualRent: number;
  maintenancePct: number;
  holdingPeriod: number;
}

export interface YearProjection {
  year: number;
  propertyValue: number;
  equity: number;
  annualRent: number;
  annualMortgage: number;
  maintenanceCost: number;
  netCashflow: number;
  cumulativeCashflow: number;
  roi: number;
}

/**
 * Project year-by-year cashflows with capital appreciation at 5% CAGR.
 *
 * @param params - Projection parameters
 * @returns Array of yearly projection data
 */
export function project5Years(params: ProjectionParams): YearProjection[] {
  const {
    price,
    downPayment,
    interestRate,
    annualRent,
    maintenancePct,
    holdingPeriod,
  } = params;

  const APPRECIATION_RATE = 0.05; // 5% CAGR
  const RENT_GROWTH_RATE = 0.03; // 3% annual rent growth
  const LOAN_TERM_YEARS = 25;

  const monthlyMortgage = calculateMortgage(price, downPayment, interestRate, LOAN_TERM_YEARS);
  const annualMortgage = monthlyMortgage * 12;

  const projections: YearProjection[] = [];
  let cumulativeCashflow = -downPayment; // Initial investment is negative
  let remainingPrincipal = price - downPayment;
  const monthlyRate = interestRate / 100 / 12;

  for (let year = 1; year <= holdingPeriod; year++) {
    // Capital appreciation
    const propertyValue = Math.round(price * Math.pow(1 + APPRECIATION_RATE, year));

    // Reduce outstanding principal each year
    for (let m = 0; m < 12; m++) {
      const interestPayment = remainingPrincipal * monthlyRate;
      const principalPayment = monthlyMortgage - interestPayment;
      remainingPrincipal = Math.max(0, remainingPrincipal - principalPayment);
    }

    const equity = propertyValue - remainingPrincipal;
    const currentAnnualRent = Math.round(annualRent * Math.pow(1 + RENT_GROWTH_RATE, year));
    const maintenanceCost = Math.round((propertyValue * maintenancePct) / 100);
    const netCashflow = Math.round(currentAnnualRent - annualMortgage - maintenanceCost);

    cumulativeCashflow += netCashflow;

    const roi = price > 0
      ? Math.round(((equity + cumulativeCashflow - price) / price) * 100 * 100) / 100
      : 0;

    projections.push({
      year,
      propertyValue,
      equity: Math.round(equity),
      annualRent: currentAnnualRent,
      annualMortgage: Math.round(annualMortgage),
      maintenanceCost,
      netCashflow,
      cumulativeCashflow: Math.round(cumulativeCashflow),
      roi,
    });
  }

  return projections;
}

// ─── Cap Rate ─────────────────────────────────────────────────────────────────

/**
 * Calculate capitalisation rate.
 * Cap Rate = (Annual NOI / Property Value) * 100
 *
 * @param annualNOI - Annual Net Operating Income (rent minus operating expenses, excluding mortgage)
 * @param propertyValue - Current market value of the property
 * @returns Cap rate as a percentage
 */
export function calculateCapRate(annualNOI: number, propertyValue: number): number {
  if (propertyValue <= 0) return 0;
  return Math.round((annualNOI / propertyValue) * 100 * 100) / 100;
}
