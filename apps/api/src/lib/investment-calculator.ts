import type { InvestmentCalculatorInput, InvestmentCalculatorResult, YearlyProjection } from '@vault/types';

export function runInvestmentCalculator(input: InvestmentCalculatorInput): InvestmentCalculatorResult {
  const {
    purchasePrice,
    currency,
    downPaymentPct,
    loanTermYears,
    interestRatePct,
    annualRentalIncome,
    annualExpensesPct,
    annualAppreciationPct,
    transactionCostsPct,
  } = input;

  const downPaymentAmount = purchasePrice * (downPaymentPct / 100);
  const loanAmount = purchasePrice - downPaymentAmount;
  const transactionCosts = purchasePrice * (transactionCostsPct / 100);
  const totalInitialCost = downPaymentAmount + transactionCosts;

  // Monthly mortgage payment (standard amortization)
  const monthlyRate = interestRatePct / 100 / 12;
  const nPayments = loanTermYears * 12;
  let monthlyMortgagePayment = 0;
  if (loanAmount > 0 && monthlyRate > 0) {
    monthlyMortgagePayment =
      (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, nPayments)) /
      (Math.pow(1 + monthlyRate, nPayments) - 1);
  }

  const annualMortgage = monthlyMortgagePayment * 12;
  const annualExpenses = annualRentalIncome * (annualExpensesPct / 100);
  const netRentalIncome = annualRentalIncome - annualExpenses;
  const annualCashFlow = netRentalIncome - annualMortgage;

  const grossRentalYield = purchasePrice > 0 ? (annualRentalIncome / purchasePrice) * 100 : 0;
  const netRentalYield = purchasePrice > 0 ? (netRentalIncome / purchasePrice) * 100 : 0;
  const capRate = purchasePrice > 0 ? (netRentalIncome / purchasePrice) * 100 : 0;
  const cashOnCashReturn = totalInitialCost > 0 ? (annualCashFlow / totalInitialCost) * 100 : 0;

  // Break-even (when cumulative cash flow covers initial costs)
  let breakEvenYears = 0;
  let cumCashFlow = 0;
  for (let y = 1; y <= 30; y++) {
    cumCashFlow += annualCashFlow;
    if (cumCashFlow >= totalInitialCost) {
      breakEvenYears = y;
      break;
    }
  }

  // 5-year projection
  const fiveYearProjection: YearlyProjection[] = [];
  let propertyValue = purchasePrice;
  let remainingBalance = loanAmount;
  let cumRental = 0;

  for (let year = 1; year <= 5; year++) {
    propertyValue *= 1 + annualAppreciationPct / 100;

    // Reduce loan balance by principal payments
    for (let m = 0; m < 12; m++) {
      const interestPayment = remainingBalance * monthlyRate;
      const principalPayment = Math.max(0, monthlyMortgagePayment - interestPayment);
      remainingBalance = Math.max(0, remainingBalance - principalPayment);
    }

    const equity = propertyValue - remainingBalance;
    cumRental += netRentalIncome;
    const yearCashFlow = annualCashFlow;
    const roi =
      totalInitialCost > 0
        ? ((equity - downPaymentAmount + cumRental) / totalInitialCost) * 100
        : 0;

    fiveYearProjection.push({
      year,
      propertyValue: Math.round(propertyValue),
      equity: Math.round(equity),
      cumulativeRentalIncome: Math.round(cumRental),
      annualCashFlow: Math.round(yearCashFlow),
      roi: Math.round(roi * 10) / 10,
    });
  }

  return {
    downPaymentAmount: Math.round(downPaymentAmount),
    loanAmount: Math.round(loanAmount),
    monthlyMortgagePayment: Math.round(monthlyMortgagePayment),
    grossRentalYield: Math.round(grossRentalYield * 10) / 10,
    netRentalYield: Math.round(netRentalYield * 10) / 10,
    annualCashFlow: Math.round(annualCashFlow),
    capRate: Math.round(capRate * 10) / 10,
    cashOnCashReturn: Math.round(cashOnCashReturn * 10) / 10,
    breakEvenYears,
    fiveYearProjection,
    currency,
  };
}
