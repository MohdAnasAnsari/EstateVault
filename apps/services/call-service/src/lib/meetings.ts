import ical, {
  ICalAttendeeRole,
  ICalAttendeeStatus,
  type ICalAttendeeData,
  type ICalEventData,
} from 'ical-generator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimeSlot {
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export interface MeetingForIcal {
  id: string;
  icsUid: string;
  meetingType: string;
  scheduledAt: Date;
  durationMinutes: number;
  timezone: string;
  dealRoomId: string;
  organizerName?: string;
  organizerEmail?: string;
  attendeeEmails?: string[];
}

// ─── Slot Overlap Finding ─────────────────────────────────────────────────────

/**
 * Find overlapping time slots between two sets of availability.
 * Slots are ISO 8601 strings; overlap is any slot present in both lists
 * (exact string match — callers should normalize to a canonical form).
 * For range-based slots: returns ranges where both parties are available.
 */
export function findOverlappingSlots(slots1: string[], slots2: string[]): string[] {
  const set2 = new Set(slots2);
  return slots1.filter((slot) => set2.has(slot));
}

/**
 * Find overlapping time ranges (start/end pairs) between two availability sets.
 * Each input entry is a "start|end" encoded string for easy comparison.
 */
export function findOverlappingRanges(
  ranges1: TimeSlot[],
  ranges2: TimeSlot[],
): TimeSlot[] {
  const overlaps: TimeSlot[] = [];

  for (const a of ranges1) {
    for (const b of ranges2) {
      const aStart = new Date(a.start).getTime();
      const aEnd = new Date(a.end).getTime();
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();

      // Overlap exists when one range starts before the other ends
      const overlapStart = Math.max(aStart, bStart);
      const overlapEnd = Math.min(aEnd, bEnd);

      if (overlapStart < overlapEnd) {
        overlaps.push({
          start: new Date(overlapStart).toISOString(),
          end: new Date(overlapEnd).toISOString(),
        });
      }
    }
  }

  return overlaps;
}

// ─── iCal Generation ─────────────────────────────────────────────────────────

/**
 * Generate an .ics (iCalendar) file buffer for a confirmed meeting.
 */
export function generateIcal(meeting: MeetingForIcal): string {
  const calendar = ical({
    name: 'EstateVault Meeting',
    prodId: '//EstateVault//EstateVault Calendar//EN',
    timezone: meeting.timezone,
  });

  const startTime = new Date(meeting.scheduledAt);
  const endTime = new Date(startTime.getTime() + meeting.durationMinutes * 60 * 1000);

  const meetingTypeLabel: Record<string, string> = {
    property_discussion: 'Property Discussion',
    due_diligence: 'Due Diligence Review',
    offer: 'Offer Negotiation',
    virtual_viewing: 'Virtual Property Viewing',
  };

  const summary = meetingTypeLabel[meeting.meetingType] ?? meeting.meetingType;
  const description = `EstateVault ${summary} — Deal Room ${meeting.dealRoomId}`;

  const eventData: ICalEventData = {
    id: meeting.icsUid,
    start: startTime,
    end: endTime,
    summary,
    description,
    location: 'EstateVault Virtual Meeting Room',
    url: `https://app.vault.example.com/deal-rooms/${meeting.dealRoomId}`,
    timezone: meeting.timezone,
  };

  if (meeting.organizerEmail) {
    eventData.organizer = {
      name: meeting.organizerName ?? meeting.organizerEmail,
      email: meeting.organizerEmail,
    };
  }

  if (meeting.attendeeEmails && meeting.attendeeEmails.length > 0) {
    eventData.attendees = meeting.attendeeEmails.map((email): ICalAttendeeData => ({
      email,
      rsvp: true,
      status: ICalAttendeeStatus.ACCEPTED,
      role: ICalAttendeeRole.REQ,
    }));
  }

  calendar.createEvent(eventData);

  return calendar.toString();
}

// ─── Time Formatting ──────────────────────────────────────────────────────────

/**
 * Format a meeting date/time for display in a given timezone.
 */
export function formatMeetingTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    // Fallback if timezone is invalid
    return date.toUTCString();
  }
}
