'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { VaultApiClient } from '@vault/api-client';
import type { InvestmentCalculatorInput, InvestmentCalculatorResult } from '@vault/types';
import { Button } from '@vault/ui';

const DEFAULT_INPUT: InvestmentCalculatorInput = {
  purchasePrice: 10_000_000,
  currency: 'AED',
  downPaymentPct: 25,
  loanTermYears: 15,
  interestRatePct: 4.5,
  annualRentalIncome: 800_000,
  annualExpensesPct: 20,
  annualAppreciationPct: 5,
  transactionCostsPct: 4,
};

function fmt(n: number, currency = 'AED') {
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${currency} ${(n / 1_000).toFixed(0)}K`;
  return `${currency} ${n.toFixed(0)}`;
}

function Field({
  label,
  name,
  value,
  onChange,
  step = 1,
  suffix,
}: {
  label: string;
  name: keyof InvestmentCalculatorInput;
  value: number;
  onChange: (name: keyof InvestmentCalculatorInput, val: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-stone-400">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(name, Number(e.target.value))}
          className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
        />
        {suffix && <span className="text-xs text-stone-500">{suffix}</span>}
      </div>
    </div>
  );
}

interface InvestmentCalculatorProps {
  token?: string;
  listingId?: string;
  initialPrice?: number;
}

export function InvestmentCalculator({ token, listingId, initialPrice }: InvestmentCalculatorProps) {
  const [input, setInput] = useState<InvestmentCalculatorInput>({
    ...DEFAULT_INPUT,
    ...(initialPrice ? { purchasePrice: initialPrice } : {}),
    ...(listingId ? { listingId } : {}),
  });
  const [result, setResult] = useState<InvestmentCalculatorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const client = new VaultApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    getToken: () => token ?? null,
  });

  const setField = (name: keyof InvestmentCalculatorInput, val: number) => {
    setInput((prev) => ({ ...prev, [name]: val }));
    setResult(null);
  };

  const calculate = async () => {
    setLoading(true);
    const res = await client.calculateInvestment(input);
    if (res.success && res.data) setResult(res.data);
    setLoading(false);
  };

  const saveCalc = async () => {
    if (!result || !token) return;
    await client.saveCalculation({ inputs: input, results: result, listingId });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="cinematic-panel rounded-[2rem] p-6 space-y-6">
      <div>
        <h2 className="text-2xl text-stone-100">Investment Calculator</h2>
        <p className="mt-1 text-xs text-stone-500">Full 5-year ROI projection with mortgage modelling</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Purchase Price (AED)" name="purchasePrice" value={input.purchasePrice} onChange={setField} step={500000} />
        <Field label="Down Payment" name="downPaymentPct" value={input.downPaymentPct} onChange={setField} step={1} suffix="%" />
        <Field label="Loan Term" name="loanTermYears" value={input.loanTermYears} onChange={setField} step={1} suffix="yrs" />
        <Field label="Interest Rate" name="interestRatePct" value={input.interestRatePct} onChange={setField} step={0.1} suffix="%" />
        <Field label="Annual Rental Income" name="annualRentalIncome" value={input.annualRentalIncome} onChange={setField} step={10000} />
        <Field label="Annual Expenses" name="annualExpensesPct" value={input.annualExpensesPct} onChange={setField} step={1} suffix="%" />
        <Field label="Annual Appreciation" name="annualAppreciationPct" value={input.annualAppreciationPct} onChange={setField} step={0.5} suffix="%" />
        <Field label="Transaction Costs" name="transactionCostsPct" value={input.transactionCostsPct} onChange={setField} step={0.5} suffix="%" />
      </div>

      <Button variant="gold" onClick={calculate} disabled={loading} className="w-full">
        {loading ? 'Calculating...' : 'Calculate Returns'}
      </Button>

      {result && (
        <div className="space-y-6 animate-fade-in">
          {/* Key Metrics Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Down Payment', value: fmt(result.downPaymentAmount, result.currency) },
              { label: 'Monthly Mortgage', value: fmt(result.monthlyMortgagePayment, result.currency) },
              { label: 'Gross Rental Yield', value: `${result.grossRentalYield}%` },
              { label: 'Net Rental Yield', value: `${result.netRentalYield}%` },
              { label: 'Annual Cash Flow', value: fmt(result.annualCashFlow, result.currency) },
              { label: 'Cap Rate', value: `${result.capRate}%` },
              { label: 'Cash-on-Cash Return', value: `${result.cashOnCashReturn}%` },
              { label: 'Break-Even', value: result.breakEvenYears > 0 ? `${result.breakEvenYears} yrs` : 'N/A' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-stone-700 bg-stone-900/40 p-3">
                <p className="text-xs text-stone-500">{label}</p>
                <p className="mt-1 text-base font-semibold text-stone-100">{value}</p>
              </div>
            ))}
          </div>

          {/* 5-Year Projection Chart */}
          <div>
            <h3 className="mb-3 text-sm text-stone-300">5-Year Projection</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={result.fiveYearProjection} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                <XAxis
                  dataKey="year"
                  tickFormatter={(v) => `Y${v}`}
                  stroke="#78716c"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`}
                  stroke="#78716c"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [fmt(value, result.currency), name]}
                  contentStyle={{ background: '#1c1917', border: '1px solid #44403c', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(l) => `Year ${l}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="propertyValue"
                  name="Property Value"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  animationDuration={800}
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  name="Equity"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                  animationDuration={900}
                />
                <Line
                  type="monotone"
                  dataKey="cumulativeRentalIncome"
                  name="Cumulative Rental"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                  animationDuration={1000}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {token && (
            <Button variant="outline" onClick={saveCalc} disabled={saved} className="w-full text-sm">
              {saved ? 'Saved to your calculations ✓' : 'Save calculation'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
