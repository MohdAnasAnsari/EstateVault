'use client';

import { useMemo, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { AssetType, EncryptedBlob, Listing } from '@vault/types';
import { AssetTypeEnum } from '@vault/types';
import { Badge, Button, Input, Label } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

async function fileToEncryptedBlob(file: File): Promise<EncryptedBlob> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = btoa(String.fromCharCode(...keyBytes));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(base64),
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
    algorithm: 'AES-GCM',
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    keyHint: key.slice(0, 12),
  };
}

export function SellerListingEditor() {
  const { token, user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [created, setCreated] = useState<Listing | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifiedDocs, setVerifiedDocs] = useState<{
    titleDeedDocument: EncryptedBlob | null;
    nocDocument: EncryptedBlob | null;
    encumbranceDocument: EncryptedBlob | null;
    titleDeedNumber: string;
    offPlan: boolean;
  } | null>(null);

  const client = useMemo(
    () =>
      new VaultApiClient({
        baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
        getToken: () => token,
      }),
    [token],
  );

  if (!user || !token) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Sign in to create listings</h1>
        </div>
      </main>
    );
  }

  if (user.accessTier !== 'level_3' && user.role !== 'admin') {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Level 3 required</h1>
          <p className="mt-4 text-sm text-stone-300">Complete KYC and AML clearance to unlock seller listing creation.</p>
          <div className="mt-5">
            <Button asChild variant="gold">
              <a href="/kyc">Complete KYC</a>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  async function verifyDocuments(formData: FormData) {
    setVerifying(true);
    setStatus('Encrypting and verifying seller documents...');
    const offPlan = formData.get('offPlan') === 'on';
    const titleDeedFile = formData.get('titleDeedFile') as File | null;
    const nocFile = formData.get('nocFile') as File | null;
    const encumbranceFile = formData.get('encumbranceFile') as File | null;

    if (!titleDeedFile || !encumbranceFile) {
      setStatus('Title deed and encumbrance certificate are required.');
      setVerifying(false);
      return;
    }

    const payload = {
      deedNumber: String(formData.get('titleDeedNumber') ?? ''),
      titleDeedDocument: await fileToEncryptedBlob(titleDeedFile),
      offPlan,
      nocDocument: offPlan && nocFile ? await fileToEncryptedBlob(nocFile) : undefined,
      encumbranceDocument: await fileToEncryptedBlob(encumbranceFile),
    };

    const response = await client.verifySellerDocs(payload);
    if (!response.success || !response.data?.verified) {
      setStatus(response.error?.message ?? 'Title deed verification failed');
      setVerifying(false);
      return;
    }

    setVerifiedDocs({
      titleDeedDocument: payload.titleDeedDocument,
      nocDocument: payload.nocDocument ?? null,
      encumbranceDocument: payload.encumbranceDocument,
      titleDeedNumber: payload.deedNumber,
      offPlan,
    });
    setStatus('Seller verification complete. You can now save the listing.');
    setVerifying(false);
  }

  async function saveListing(formData: FormData) {
    if (!verifiedDocs) {
      setStatus('Verify seller documents first.');
      return;
    }

    const response = await client.createListing({
      title: String(formData.get('title') ?? ''),
      assetType: String(formData.get('assetType') ?? 'villa') as AssetType,
      country: String(formData.get('country') ?? ''),
      city: String(formData.get('city') ?? ''),
      district: String(formData.get('district') ?? ''),
      description: String(formData.get('description') ?? ''),
      descriptionAr: String(formData.get('descriptionAr') ?? ''),
      priceAmount: Number(formData.get('priceAmount') ?? 0),
      sizeSqm: Number(formData.get('sizeSqm') ?? 0),
      bedrooms: Number(formData.get('bedrooms') ?? 0),
      bathrooms: Number(formData.get('bathrooms') ?? 0),
      offPlan: verifiedDocs.offPlan,
      titleDeedNumber: verifiedDocs.titleDeedNumber,
      titleDeedDocument: verifiedDocs.titleDeedDocument ?? undefined,
      nocDocument: verifiedDocs.nocDocument ?? undefined,
      encumbranceDocument: verifiedDocs.encumbranceDocument ?? undefined,
    });

    if (!response.success || !response.data) {
      setStatus(response.error?.message ?? 'Listing save failed');
      return;
    }

    setCreated(response.data as Listing);
    setStatus('Listing saved. Quality score updated and fraud checks queued.');
  }

  return (
    <main className="page-wrap section-space space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Seller editor</p>
        <h1 className="mt-3 text-5xl text-stone-50">Verified listing creation</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_360px]">
        <div className="space-y-6">
          <form action={(formData) => void verifyDocuments(formData)} className="cinematic-panel rounded-[2rem] p-7">
            <h2 className="text-2xl text-stone-50">Seller verification pipeline</h2>
            <p className="mt-2 text-sm text-stone-400">All documents are AES-256 encrypted client-side before submission.</p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="Title deed number" name="titleDeedNumber" />
              <label className="flex items-center gap-3 rounded-[1rem] border border-white/10 bg-white/4 px-4 py-3 text-stone-200">
                <input type="checkbox" name="offPlan" />
                Off-plan asset
              </label>
              <Upload label="Title deed upload" name="titleDeedFile" />
              <Upload label="NOC from developer" name="nocFile" optional />
              <Upload label="Encumbrance certificate" name="encumbranceFile" />
            </div>
            <div className="mt-6">
              <Button type="submit" variant="gold" disabled={verifying}>Verify seller documents</Button>
            </div>
          </form>

          <form action={(formData) => void saveListing(formData)} className="cinematic-panel rounded-[2rem] p-7">
            <h2 className="text-2xl text-stone-50">Listing details</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="Title" name="title" />
              <SelectField label="Asset type" name="assetType" />
              <Field label="Country" name="country" defaultValue="United Arab Emirates" />
              <Field label="City" name="city" defaultValue="Dubai" />
              <Field label="District" name="district" />
              <Field label="Price amount" name="priceAmount" type="number" />
              <Field label="Size sqm" name="sizeSqm" type="number" />
              <Field label="Bedrooms" name="bedrooms" type="number" />
              <Field label="Bathrooms" name="bathrooms" type="number" />
            </div>
            <div className="mt-4 grid gap-4">
              <Field label="Description" name="description" as="textarea" />
              <Field label="Arabic description" name="descriptionAr" as="textarea" />
            </div>
            <div className="mt-6">
              <Button type="submit" variant="gold" disabled={!verifiedDocs}>Save draft</Button>
            </div>
          </form>
        </div>

        <aside className="space-y-6">
          <div className="cinematic-panel rounded-[2rem] p-7">
            <h2 className="text-2xl text-stone-50">Verification status</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>{verifiedDocs ? 'Title deed verified' : 'Pending verification'}</Badge>
              <Badge>{user.accessTier}</Badge>
            </div>
            <p className="mt-4 text-sm text-stone-300">{status ?? 'Verify your seller documents to begin.'}</p>
          </div>

          <div className="cinematic-panel rounded-[2rem] p-7">
            <h2 className="text-2xl text-stone-50">Quality score</h2>
            {created ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <p className="text-5xl text-amber-100">{created.listingQualityScore}</p>
                  <Badge>{created.qualityTier}</Badge>
                </div>
                <div className="grid gap-2 text-sm text-stone-300">
                  <p>Add a floor plan (+10 points)</p>
                  <p>Upload a video tour (+15 points)</p>
                  <p>Add Arabic description (+10 points)</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-stone-400">Score appears as soon as the listing is saved.</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  as,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  as?: 'textarea';
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      {as === 'textarea' ? (
        <textarea id={name} name={name} defaultValue={defaultValue} className="min-h-32 rounded-[1rem] border border-white/10 bg-white/5 px-4 py-3 text-stone-100" />
      ) : (
        <Input id={name} name={name} type={type} defaultValue={defaultValue} />
      )}
    </div>
  );
}

function SelectField({ label, name }: { label: string; name: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <select id={name} name={name} className="rounded-[1rem] border border-white/10 bg-white/5 px-4 py-3 text-stone-100">
        {AssetTypeEnum.options.map((item) => (
          <option key={item} value={item}>
            {item.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </div>
  );
}

function Upload({ label, name, optional }: { label: string; name: string; optional?: boolean }) {
  return (
    <label className="grid gap-2 rounded-[1rem] border border-dashed border-white/12 bg-white/3 p-4">
      <span className="text-sm text-stone-100">{label}</span>
      <input type="file" name={name} className="text-sm text-stone-400" />
      {optional ? <span className="text-xs text-stone-500">Optional when not off-plan.</span> : null}
    </label>
  );
}
