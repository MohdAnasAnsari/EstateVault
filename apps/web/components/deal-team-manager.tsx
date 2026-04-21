'use client';

import { useEffect, useMemo, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { DealTeamMember } from '@vault/types';
import { Badge, Button, Input, Label } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

const ROLES = ['lead', 'co_investor', 'legal', 'financial', 'observer'] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  lead: 'Lead',
  co_investor: 'Co-investor',
  legal: 'Legal',
  financial: 'Financial',
  observer: 'Observer',
};

const ROLE_COLOURS: Record<Role, string> = {
  lead: 'bg-amber-400/15 text-amber-100',
  co_investor: 'bg-blue-400/15 text-blue-100',
  legal: 'bg-purple-400/15 text-purple-100',
  financial: 'bg-emerald-400/15 text-emerald-100',
  observer: 'bg-stone-400/10 text-stone-300',
};

interface Props {
  dealRoomId: string;
}

export function DealTeamManager({ dealRoomId }: Props) {
  const { token, user } = useAuth();
  const [members, setMembers] = useState<DealTeamMember[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const client = useMemo(
    () => new VaultApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1', getToken: () => token }),
    [token],
  );

  useEffect(() => {
    if (!token) return;
    void client.getDealTeam(dealRoomId).then((r) => {
      if (r.success && r.data) setMembers(r.data as DealTeamMember[]);
    });
  }, [client, token, dealRoomId]);

  const myMember = members.find((m) => m.userId === user?.id);
  const isLead = myMember?.role === 'lead';

  async function handleInvite(formData: FormData) {
    const response = await client.inviteDealTeamMember(dealRoomId, {
      email: String(formData.get('email') ?? ''),
      role: String(formData.get('role') ?? 'observer') as Role,
      pseudonym: String(formData.get('pseudonym') ?? '') || null,
    });
    if (response.success) {
      setStatus('Invitation sent.');
      setShowInvite(false);
      const r = await client.getDealTeam(dealRoomId);
      if (r.success && r.data) setMembers(r.data as DealTeamMember[]);
    } else {
      setStatus(response.error?.message ?? 'Invite failed');
    }
  }

  async function handleRemove(memberId: string) {
    const r = await client.removeDealTeamMember(dealRoomId, memberId);
    if (r.success) setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  async function handleRoleChange(memberId: string, role: Role) {
    const r = await client.updateDealTeamMember(dealRoomId, memberId, { role });
    if (r.success) setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role } : m)));
  }

  async function handleAccept(memberId: string) {
    const r = await client.acceptDealTeamInvite(dealRoomId, memberId);
    if (r.success) {
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, acceptedAt: new Date().toISOString() } : m)));
      setStatus('You have joined the deal team.');
    }
  }

  const pendingInvite = members.find((m) => m.userId === user?.id && !m.acceptedAt);

  return (
    <div className="cinematic-panel rounded-[2rem] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl text-stone-50">Deal Team</h3>
        {isLead && (
          <Button size="sm" variant="outline" onClick={() => setShowInvite(!showInvite)}>
            {showInvite ? 'Cancel' : '+ Invite'}
          </Button>
        )}
      </div>

      {pendingInvite && !pendingInvite.acceptedAt && (
        <div className="rounded-[1.2rem] border border-amber-300/20 bg-amber-400/8 p-4">
          <p className="text-sm text-amber-200">You have been invited as <strong>{ROLE_LABELS[pendingInvite.role as Role]}</strong></p>
          <div className="mt-2">
            <Button size="sm" variant="gold" onClick={() => void handleAccept(pendingInvite.id)}>
              Accept invite
            </Button>
          </div>
        </div>
      )}

      {showInvite && (
        <form action={(fd) => void handleInvite(fd)} className="rounded-[1.2rem] border border-white/10 bg-white/3 p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" name="email" type="email" placeholder="colleague@example.com" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select id="invite-role" name="role" className="rounded-[0.8rem] border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-100">
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-pseudonym">Pseudonym (optional)</Label>
              <Input id="invite-pseudonym" name="pseudonym" placeholder="e.g. Investor A" />
            </div>
          </div>
          <Button type="submit" size="sm" variant="gold">Send invitation</Button>
        </form>
      )}

      <div className="space-y-2">
        {members.map((member) => (
          <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-white/8 bg-white/3 px-4 py-3">
            <div>
              <p className="text-sm text-stone-100">
                {member.pseudonym ?? member.userDisplayName ?? member.userEmail ?? 'Unknown'}
              </p>
              {!member.pseudonym && member.userDisplayName && member.userEmail && (
                <p className="text-xs text-stone-500">{member.userEmail}</p>
              )}
              {!member.acceptedAt && (
                <p className="mt-0.5 text-xs text-amber-400">Pending acceptance</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isLead && member.userId !== user?.id ? (
                <select
                  value={member.role}
                  onChange={(e) => void handleRoleChange(member.id, e.target.value as Role)}
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-stone-200"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              ) : (
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${ROLE_COLOURS[member.role as Role] ?? ''}`}>
                  {ROLE_LABELS[member.role as Role] ?? member.role}
                </span>
              )}
              {(isLead || member.userId === user?.id) && member.userId !== user?.id && (
                <button
                  type="button"
                  onClick={() => void handleRemove(member.id)}
                  className="text-xs text-stone-500 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        {members.length === 0 && (
          <p className="text-sm text-stone-500">No team members yet. Invite collaborators to this deal.</p>
        )}
      </div>

      {status && <p className="text-xs text-amber-200">{status}</p>}
    </div>
  );
}
