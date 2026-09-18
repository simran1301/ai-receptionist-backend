import { getFreeSlots, bookSlot } from "../calendar";
import { saveLead, saveCallReport } from "../db";
import { VapiWebhookMessage } from "../types";

/** Vapi expects a { result: string } body in response to a function-call message. */
export async function handleFunctionCall(
  payload: VapiWebhookMessage
): Promise<{ result: string }> {
  const fn = payload.message.functionCall;
  const customerId = payload.message.assistant?.metadata?.customerId ?? "unknown";
  if (!fn) return { result: "No function call payload received." };

  switch (fn.name) {
    case "check_availability": {
      const date = fn.parameters.date as string;
      const slots = await getFreeSlots(date);
      return {
        result: slots.length
          ? `Open slots on ${date}: ${slots.join(", ")}`
          : `No open slots on ${date}.`,
      };
    }

    case "book_appointment": {
      const { date, time, callerName, reason } = fn.parameters as {
        date: string;
        time: string;
        callerName: string;
        reason?: string;
      };
      await bookSlot(date, time, `Call with ${callerName}`, reason ?? "");
      return { result: `Booked ${callerName} for ${date} at ${time}.` };
    }

    case "capture_lead": {
      const { callerName, callerPhone, notes } = fn.parameters as {
        callerName: string;
        callerPhone?: string;
        notes: string;
      };
      await saveLead(customerId, callerName, callerPhone, notes);
      return { result: "Logged for follow-up." };
    }

    default:
      return { result: `Unknown function: ${fn.name}` };
  }
}

export async function handleEndOfCall(payload: VapiWebhookMessage): Promise<void> {
  const customerId = payload.message.assistant?.metadata?.customerId ?? "unknown";
  await saveCallReport(
    customerId,
    payload.message.transcript,
    payload.message.summary,
    payload.message.endedReason
  );
}
