'use client';

import { useRef, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { ConciergeMessage } from '@vault/types';
import { useAuth } from './providers/auth-provider';

const SUGGESTIONS = [
  'How do I verify my listing?',
  'What is RERA?',
  'How does KYC work?',
  'What is a deal room?',
];

export function AIConcierge() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ConciergeMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ticketCreated, setTicketCreated] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const client = new VaultApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    getToken: () => token,
  });

  const sendMessage = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message) return;

    const userMsg: ConciergeMessage = { role: 'user', content: message, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await client.queryConcierg({ message });
      if (res.success && res.data) {
        const assistantMsg: ConciergeMessage = {
          role: 'assistant',
          content: res.data.answer,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (res.data.isHumanHandoff && res.data.ticketId) {
          setTicketCreated(res.data.ticketId);
        }
      }
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-stone-900 shadow-lg shadow-amber-500/20 hover:bg-amber-400 transition-all"
        aria-label="Open VAULT Concierge"
      >
        {open ? (
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-80 flex-col rounded-[1.5rem] border border-stone-700 bg-stone-950 shadow-2xl shadow-black/60 overflow-hidden"
          style={{ maxHeight: '70vh' }}>
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xs">✦</span>
            <div>
              <p className="text-sm font-semibold text-stone-100">VAULT Concierge</p>
              <p className="text-xs text-stone-500">AI · Platform assistant</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 200, maxHeight: 380 }}>
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-stone-400">
                  Hi! I can help you with listing verification, KYC, RERA, deal rooms, and more.
                </p>
                <div className="flex flex-col gap-1.5 mt-3">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="rounded-lg border border-stone-700 px-3 py-1.5 text-left text-xs text-stone-300 hover:border-amber-500/50 hover:text-stone-100 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-5 ${
                    msg.role === 'user'
                      ? 'bg-amber-500/15 text-amber-100'
                      : 'bg-stone-800 text-stone-200'
                  }`}
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-stone-800 px-3 py-2 text-xs text-stone-400 animate-pulse">
                  Thinking...
                </div>
              </div>
            )}
            {ticketCreated && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
                Support ticket created · ID: {ticketCreated.slice(0, 8)}…
                <br />A VAULT advisor will reach out within 4 business hours.
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-stone-800 px-3 py-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything..."
              className="flex-1 rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-stone-100 placeholder-stone-600 focus:outline-none"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs text-stone-900 font-semibold disabled:opacity-40 hover:bg-amber-400"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
