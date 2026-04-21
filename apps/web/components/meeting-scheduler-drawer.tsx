'use client';

import { useState } from 'react';
import { Calendar, Check, ChevronLeft, ChevronRight, Clock, Globe, X } from 'lucide-react';
import { Button, Input, Label } from '@vault/ui';
import type { MeetingRequestDetail, MeetingType } from '@vault/types';

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  property_discussion: 'Property discussion',
  due_diligence: 'Due diligence',
  offer: 'Offer review',
  virtual_viewing: 'Virtual viewing',
};

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function formatSlot(iso: string, tz: string) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface InitiatorDrawerProps {
  dealRoomId: string;
  onSubmit: (
    meetingType: MeetingType,
    durationMinutes: number,
    timezone: string,
    slots: string[],
  ) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}

export function MeetingSchedulerDrawer({
  onSubmit,
  onClose,
  loading,
}: InitiatorDrawerProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [meetingType, setMeetingType] = useState<MeetingType>('property_discussion');
  const [duration, setDuration] = useState(30);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [calendarOffset, setCalendarOffset] = useState(0);

  const today = new Date();
  const visibleDays = Array.from({ length: 14 }, (_, i) => addDays(today, i + calendarOffset));
  const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

  function toggleSlot(day: Date, hour: number) {
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    const iso = d.toISOString();
    setSelectedSlots((prev) =>
      prev.includes(iso)
        ? prev.filter((s) => s !== iso)
        : prev.length >= 10
          ? prev
          : [...prev, iso],
    );
  }

  async function handleSubmit() {
    await onSubmit(meetingType, duration, timezone, selectedSlots);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-stone-950 border-l border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-amber-200" />
            <h2 className="text-lg text-stone-50">Schedule meeting</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-stone-400 hover:text-stone-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-white/8 px-6 py-3">
          {([1, 2, 3] as const).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  step === s
                    ? 'bg-amber-400 text-stone-950'
                    : step > s
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-white/8 text-stone-500'
                }`}
              >
                {step > s ? <Check className="h-3.5 w-3.5" /> : s}
              </span>
              <span
                className={`text-xs uppercase tracking-[0.18em] ${
                  step >= s ? 'text-stone-300' : 'text-stone-600'
                }`}
              >
                {s === 1 ? 'Details' : s === 2 ? 'Availability' : 'Confirm'}
              </span>
              {s < 3 && <div className="mx-3 h-px w-8 bg-white/10" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === 1 && (
            <div className="grid gap-6">
              <div className="grid gap-3">
                <Label>Meeting type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(MEETING_TYPE_LABELS) as MeetingType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMeetingType(type)}
                      className={`rounded-[1.4rem] border px-4 py-3 text-sm text-left transition-colors ${
                        meetingType === type
                          ? 'border-amber-300/40 bg-amber-400/10 text-amber-100'
                          : 'border-white/10 bg-white/3 text-stone-300 hover:border-white/20'
                      }`}
                    >
                      {MEETING_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <Label>Duration</Label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors ${
                        duration === d
                          ? 'border-amber-300/40 bg-amber-400/10 text-amber-100'
                          : 'border-white/10 bg-white/3 text-stone-300 hover:border-white/20'
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" />
                      {d < 60 ? `${d} min` : `${d / 60}h`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <Label>Timezone</Label>
                <div className="relative">
                  <Globe className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full appearance-none rounded-[1.4rem] border border-white/10 bg-white/5 pl-10 pr-4 py-3 text-sm text-stone-100 outline-none"
                  >
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz} className="bg-stone-900">
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-stone-300">
                  Select up to <span className="text-amber-200">10 slots</span> across the next 14
                  days ({selectedSlots.length}/10 selected)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCalendarOffset(Math.max(0, calendarOffset - 7))}
                    className="rounded-full border border-white/10 p-1.5 text-stone-400 hover:text-stone-200"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarOffset(Math.min(7, calendarOffset + 7))}
                    className="rounded-full border border-white/10 p-1.5 text-stone-400 hover:text-stone-200"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      <th className="w-12 pr-3 text-right text-stone-500"></th>
                      {visibleDays.slice(0, 7).map((day) => (
                        <th
                          key={day.toISOString()}
                          className="px-1 pb-2 text-center text-stone-400 font-normal"
                        >
                          <span className="block">
                            {day.toLocaleDateString('en-US', { weekday: 'short' })}
                          </span>
                          <span
                            className={`block text-sm font-medium ${
                              isSameDay(day, today) ? 'text-amber-300' : 'text-stone-200'
                            }`}
                          >
                            {day.getDate()}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {HOURS.map((hour) => (
                      <tr key={hour}>
                        <td className="pr-3 py-1 text-right text-stone-500 whitespace-nowrap">
                          {hour}:00
                        </td>
                        {visibleDays.slice(0, 7).map((day) => {
                          const d = new Date(day);
                          d.setHours(hour, 0, 0, 0);
                          const iso = d.toISOString();
                          const selected = selectedSlots.includes(iso);
                          const isPast = d < new Date();
                          return (
                            <td key={iso} className="px-1 py-1">
                              <button
                                type="button"
                                disabled={isPast || (!selected && selectedSlots.length >= 10)}
                                onClick={() => toggleSlot(day, hour)}
                                className={`h-8 w-full rounded-lg border text-[10px] transition-colors ${
                                  selected
                                    ? 'border-amber-300/40 bg-amber-400/20 text-amber-200'
                                    : isPast
                                      ? 'border-white/4 bg-white/2 text-stone-700 cursor-not-allowed'
                                      : 'border-white/8 bg-white/3 text-stone-500 hover:border-white/20 hover:bg-white/8'
                                }`}
                              >
                                {selected ? '✓' : ''}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedSlots.length > 0 && (
                <div className="rounded-[1.4rem] border border-white/8 bg-white/3 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">
                    Selected slots
                  </p>
                  <div className="grid gap-2">
                    {selectedSlots.sort().map((slot) => (
                      <div key={slot} className="flex items-center justify-between text-sm">
                        <span className="text-stone-300">{formatSlot(slot, timezone)}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedSlots((prev) => prev.filter((s) => s !== slot))
                          }
                          className="text-stone-600 hover:text-stone-300"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-5">
              <div className="rounded-[1.4rem] border border-white/8 bg-white/3 p-5 grid gap-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-400">Meeting type</span>
                  <span className="text-stone-100">{MEETING_TYPE_LABELS[meetingType]}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-400">Duration</span>
                  <span className="text-stone-100">{duration < 60 ? `${duration} min` : `${duration / 60}h`}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-400">Timezone</span>
                  <span className="text-stone-100">{timezone}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-400">Slots offered</span>
                  <span className="text-stone-100">{selectedSlots.length}</span>
                </div>
              </div>
              <div className="rounded-[1.4rem] border border-amber-300/10 bg-amber-400/5 p-4 text-sm text-stone-300">
                The other party will be notified and asked to submit their own availability.
                Their slots are not shown to you. When overlap is found, the meeting is automatically confirmed and both parties receive an ICS file.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-5">
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
              Back
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
          {step < 3 ? (
            <Button
              variant="gold"
              disabled={step === 2 && selectedSlots.length === 0}
              onClick={() => setStep((s) => (s + 1) as 2 | 3)}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="gold"
              disabled={loading}
              onClick={() => void handleSubmit()}
            >
              {loading ? 'Sending...' : 'Send request'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface RespondDrawerProps {
  request: { id: string; meetingType: MeetingType; durationMinutes: number; timezone: string };
  myAvailability: string[] | null;
  onSubmit: (slots: string[]) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}

export function MeetingAvailabilityDrawer({
  request,
  myAvailability,
  onSubmit,
  onClose,
  loading,
}: RespondDrawerProps) {
  const [selectedSlots, setSelectedSlots] = useState<string[]>(myAvailability ?? []);
  const [calendarOffset, setCalendarOffset] = useState(0);

  const today = new Date();
  const visibleDays = Array.from({ length: 7 }, (_, i) => addDays(today, i + calendarOffset));
  const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

  function toggleSlot(day: Date, hour: number) {
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    const iso = d.toISOString();
    setSelectedSlots((prev) =>
      prev.includes(iso)
        ? prev.filter((s) => s !== iso)
        : prev.length >= 10
          ? prev
          : [...prev, iso],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-stone-950 border-l border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <h2 className="text-lg text-stone-50">Submit your availability</h2>
            <p className="mt-1 text-sm text-stone-400">
              {MEETING_TYPE_LABELS[request.meetingType]} · {request.durationMinutes < 60 ? `${request.durationMinutes} min` : `${request.durationMinutes / 60}h`} · {request.timezone}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-stone-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 grid gap-5">
          <div className="rounded-[1.4rem] border border-white/8 bg-white/3 p-4 text-sm text-stone-300">
            Select your available time slots. Your selections are not shared with the other party until overlap is found.
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-400">{selectedSlots.length}/10 slots selected</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCalendarOffset(Math.max(0, calendarOffset - 7))}
                className="rounded-full border border-white/10 p-1.5 text-stone-400"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCalendarOffset(calendarOffset + 7)}
                className="rounded-full border border-white/10 p-1.5 text-stone-400"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th className="w-12 pr-3 text-right text-stone-500"></th>
                  {visibleDays.map((day) => (
                    <th key={day.toISOString()} className="px-1 pb-2 text-center text-stone-400 font-normal">
                      <span className="block">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span className={`block text-sm font-medium ${isSameDay(day, today) ? 'text-amber-300' : 'text-stone-200'}`}>
                        {day.getDate()}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HOURS.map((hour) => (
                  <tr key={hour}>
                    <td className="pr-3 py-1 text-right text-stone-500">{hour}:00</td>
                    {visibleDays.map((day) => {
                      const d = new Date(day);
                      d.setHours(hour, 0, 0, 0);
                      const iso = d.toISOString();
                      const selected = selectedSlots.includes(iso);
                      const isPast = d < new Date();
                      return (
                        <td key={iso} className="px-1 py-1">
                          <button
                            type="button"
                            disabled={isPast || (!selected && selectedSlots.length >= 10)}
                            onClick={() => toggleSlot(day, hour)}
                            className={`h-8 w-full rounded-lg border text-[10px] transition-colors ${
                              selected
                                ? 'border-amber-300/40 bg-amber-400/20 text-amber-200'
                                : isPast
                                  ? 'border-white/4 bg-white/2 text-stone-700 cursor-not-allowed'
                                  : 'border-white/8 bg-white/3 text-stone-500 hover:border-white/20'
                            }`}
                          >
                            {selected ? '✓' : ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-6 py-5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="gold"
            disabled={loading || selectedSlots.length === 0}
            onClick={() => void onSubmit(selectedSlots)}
          >
            {loading ? 'Submitting...' : 'Submit availability'}
          </Button>
        </div>
      </div>
    </div>
  );
}
