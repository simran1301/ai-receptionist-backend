import { google } from "googleapis";

function calendarClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

export async function getFreeSlots(date: string): Promise<string[]> {
  const calendar = calendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? "primary";
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      items: [{ id: calendarId }],
    },
  });

  const busy = res.data.calendars?.[calendarId]?.busy ?? [];

  // Naive 9-5 business-hours slot generator, 30-min increments, minus busy blocks.
  const slots: string[] = [];
  for (let hour = 9; hour < 17; hour++) {
    for (const minute of [0, 30]) {
      const slotStart = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
      const overlaps = busy.some((b) => {
        const bStart = new Date(b.start!);
        const bEnd = new Date(b.end!);
        return slotStart < bEnd && slotEnd > bStart;
      });
      if (!overlaps) {
        slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
      }
    }
  }
  return slots;
}

export async function bookSlot(
  date: string,
  time: string,
  summary: string,
  description: string
): Promise<string> {
  const calendar = calendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? "primary";
  const start = new Date(`${date}T${time}:00`);
  const end = new Date(start.getTime() + 30 * 60000);

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });
  return res.data.id ?? "";
}
