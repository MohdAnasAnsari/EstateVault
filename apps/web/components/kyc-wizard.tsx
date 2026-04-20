'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssetTypeEnum, type AssetType, type KycWizardSubmitInput } from '@vault/types';
import { Badge, Button, Input, Label } from '@vault/ui';
import { VaultApiClient } from '@vault/api-client';
import { ConfettiBurst } from './confetti-burst';
import { useAuth } from './providers/auth-provider';

const STEPS = ['Documents', 'Selfie', 'Address', 'Capacity', 'Review'] as const;
const ASSET_OPTIONS = AssetTypeEnum.options.filter((item) => item !== 'other');
const LIVENESS_PROMPT = ['blink twice', 'turn head left'];

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function KycWizard() {
  const router = useRouter();
  const { token, user, setAuth } = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [form, setForm] = useState<KycWizardSubmitInput>({
    documentType: 'passport',
    documents: { front: '', back: '', selfie: '', proofOfAddress: '' },
    livenessPrompt: LIVENESS_PROMPT,
    issueDate: new Date().toISOString(),
    financialCapacityRange: '$250k - $1M',
    assetTypeInterests: ['villa'],
  });

  const client = useMemo(
    () =>
      new VaultApiClient({
        baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
        getToken: () => token,
      }),
    [token],
  );

  useEffect(() => {
    if (!token || !submitting) return;

    const interval = window.setInterval(() => {
      void client.getKycStatus().then(async (response) => {
        if (!response.success || !response.data) return;

        setStatusText(`Status: ${response.data.status.replace('_', ' ')}`);
        if (response.data.status === 'approved') {
          setApproved(true);
          await setAuth(token);
          window.clearInterval(interval);
          window.setTimeout(() => {
            startTransition(() => router.push('/dashboard'));
          }, 1800);
        }
      });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [client, router, setAuth, submitting, token]);

  if (!user || !token) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Sign in to complete KYC</h1>
        </div>
      </main>
    );
  }

  const issueDate = new Date(form.issueDate);
  const isAddressFresh = Date.now() - issueDate.getTime() < 90 * 24 * 60 * 60 * 1000;

  async function updateFile(
    key: keyof KycWizardSubmitInput['documents'],
    file: File | null,
  ) {
    if (!file) return;
    const base64 = await fileToBase64(file);
    setForm((current) => ({
      ...current,
      documents: {
        ...current.documents,
        [key]: base64,
      },
    }));
  }

  async function submit() {
    setSubmitting(true);
    setStatusText('Submitting documents for review...');
    const response = await client.submitKycWizard(form);
    if (!response.success) {
      setStatusText(response.error?.message ?? 'Submission failed');
      setSubmitting(false);
      return;
    }

    setStatusText('Under Review');
    window.setTimeout(() => {
      void client.getKycStatus().then(async (statusResponse) => {
        if (statusResponse.success && statusResponse.data?.status === 'approved') {
          setApproved(true);
          await setAuth(token);
          window.setTimeout(() => {
            startTransition(() => router.push('/dashboard'));
          }, 1800);
        }
      });
    }, 2200);
  }

  return (
    <main className="page-wrap section-space">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">KYC</p>
        <h1 className="mt-3 text-5xl text-stone-50">Identity and access verification</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-300">
          Complete all five steps to unlock Phase 2 verification workflows, listing access, and compliance clearance.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="cinematic-panel rounded-[2rem] p-6">
          <div className="grid gap-3">
            {STEPS.map((label, index) => (
              <button
                key={label}
                type="button"
                className={`rounded-[1.2rem] border px-4 py-3 text-left ${
                  index === step ? 'border-amber-300/40 bg-amber-300/10 text-amber-100' : 'border-white/8 bg-white/3 text-stone-300'
                }`}
                onClick={() => setStep(index)}
              >
                <span className="block text-xs uppercase tracking-[0.25em] text-stone-500">Step {index + 1}</span>
                <span className="mt-1 block text-base">{label}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="relative cinematic-panel rounded-[2rem] p-7">
          <ConfettiBurst active={approved} />
          {step === 0 ? (
            <div className="space-y-5">
              <FieldLabel label="Document type" />
              <select
                className="w-full rounded-[1rem] border border-white/10 bg-white/5 px-4 py-3 text-stone-100"
                value={form.documentType}
                onChange={(event) => setForm((current) => ({ ...current, documentType: event.target.value as KycWizardSubmitInput['documentType'] }))}
              >
                <option value="passport">Passport</option>
                <option value="national_id">National ID</option>
                <option value="drivers_license">Driver&apos;s license</option>
              </select>
              <UploadField label="Front image" accept="image/*" capture="environment" onFile={(file) => updateFile('front', file)} />
              <UploadField label="Back image" accept="image/*" capture="environment" optional onFile={(file) => updateFile('back', file)} />
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <div className="rounded-[1.4rem] border border-emerald-300/15 bg-emerald-300/8 p-5 text-sm text-emerald-100">
                Liveness prompt: {LIVENESS_PROMPT.join(', ')}.
              </div>
              <UploadField label="Selfie capture" accept="image/*" capture="user" onFile={(file) => updateFile('selfie', file)} />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <UploadField label="Proof of address" accept="image/*,.pdf" onFile={(file) => updateFile('proofOfAddress', file)} />
              <div className="grid gap-2">
                <Label htmlFor="issueDate">Issue date</Label>
                <Input
                  id="issueDate"
                  type="date"
                  value={form.issueDate.slice(0, 10)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      issueDate: new Date(`${event.target.value}T00:00:00.000Z`).toISOString(),
                    }))
                  }
                />
                <p className={`text-sm ${isAddressFresh ? 'text-emerald-200' : 'text-rose-300'}`}>
                  {isAddressFresh ? 'Document age is valid.' : 'Proof of address must be less than 3 months old.'}
                </p>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <div className="grid gap-2">
                <Label htmlFor="capacity">Investment capacity</Label>
                <input
                  id="capacity"
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={['$50k - $250k', '$250k - $1M', '$1M - $5M', '$5M+'].indexOf(form.financialCapacityRange)}
                  onChange={(event) => {
                    const ranges = ['$50k - $250k', '$250k - $1M', '$1M - $5M', '$5M+'];
                    setForm((current) => ({ ...current, financialCapacityRange: ranges[Number(event.target.value)] ?? ranges[0] }));
                  }}
                />
                <p className="text-sm text-amber-100">{form.financialCapacityRange}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {ASSET_OPTIONS.map((item) => {
                  const selected = form.assetTypeInterests.includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`rounded-[1.2rem] border px-4 py-3 text-left ${selected ? 'border-amber-300/35 bg-amber-300/10 text-amber-100' : 'border-white/8 bg-white/3 text-stone-300'}`}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          assetTypeInterests: selected
                            ? current.assetTypeInterests.filter((entry) => entry !== item)
                            : [...current.assetTypeInterests, item as AssetType],
                        }))
                      }
                    >
                      {item.replaceAll('_', ' ')}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-6">
              <ReviewRow label="Document type" value={form.documentType.replace('_', ' ')} />
              <ReviewRow label="Front uploaded" value={form.documents.front ? 'Yes' : 'No'} />
              <ReviewRow label="Selfie uploaded" value={form.documents.selfie ? 'Yes' : 'No'} />
              <ReviewRow label="Proof of address" value={form.documents.proofOfAddress ? 'Yes' : 'No'} />
              <ReviewRow label="Capacity" value={form.financialCapacityRange} />
              <div className="flex flex-wrap gap-2">
                {form.assetTypeInterests.map((item) => (
                  <Badge key={item}>{item.replaceAll('_', ' ')}</Badge>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap justify-between gap-3">
            <Button variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="gold" onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}>
                Continue
              </Button>
            ) : (
              <Button
                variant="gold"
                onClick={submit}
                disabled={
                  submitting ||
                  !isAddressFresh ||
                  !form.documents.front ||
                  !form.documents.selfie ||
                  !form.documents.proofOfAddress ||
                  form.assetTypeInterests.length === 0
                }
              >
                Submit KYC
              </Button>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Badge>{user.kycStatus.replace('_', ' ')}</Badge>
            {approved ? <Badge className="bg-emerald-300/20 text-emerald-100">Tier upgraded to Level 3</Badge> : null}
            {statusText ? <p className="text-sm text-stone-300">{statusText}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <p className="text-xs uppercase tracking-[0.25em] text-stone-500">{label}</p>;
}

function UploadField({
  label,
  accept,
  capture,
  optional,
  onFile,
}: {
  label: string;
  accept: string;
  capture?: 'user' | 'environment';
  optional?: boolean;
  onFile: (file: File | null) => void;
}) {
  return (
    <label className="block rounded-[1.3rem] border border-dashed border-white/12 bg-white/3 p-6">
      <span className="block text-lg text-stone-100">{label}</span>
      <span className="mt-2 block text-sm text-stone-400">
        Drag-drop or tap to capture/upload {optional ? '(optional)' : ''}.
      </span>
      <input className="mt-4 block w-full text-sm text-stone-300" type="file" accept={accept} capture={capture} onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[1.1rem] border border-white/8 bg-white/3 px-4 py-3">
      <span className="text-sm text-stone-400">{label}</span>
      <span className="text-sm text-stone-100">{value}</span>
    </div>
  );
}
