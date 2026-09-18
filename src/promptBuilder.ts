import { ReceptionistProfile } from "./types";

export function buildSystemPrompt(profile: ReceptionistProfile): string {
  const faqBlock = profile.faqs
    .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
    .join("\n\n");

  return `You are the AI receptionist for ${profile.companyName}.

ABOUT THE BUSINESS
${profile.summary}

SERVICES
${profile.services.map((s) => `- ${s}`).join("\n")}

OPERATING HOURS
${profile.operatingHours}

TONE
Speak in a way that is ${profile.tone}. Keep responses short and conversational — this is
a phone call, not a chat window. One or two sentences per turn unless the caller asks for detail.

FREQUENTLY ASKED QUESTIONS
${faqBlock}

WHAT YOU CAN DO
- Answer questions about the business using only the information above.
- Check calendar availability and book a meeting when the caller wants one, using your tools.
- Capture the caller's name, phone number, and reason for calling if you can't fully resolve
  their request, using the capture_lead tool.

WHAT YOU MUST NOT DO
- Never invent prices, staff names, addresses, or policies that were not given to you above.
  If you don't know, say so and offer to take a message or transfer.
- Never claim to have booked or confirmed anything unless a tool call actually succeeded.

ESCALATION
If the caller is upset, has an urgent issue, or asks for a human, tell them you'll pass them to
${profile.escalationContact} and use the capture_lead tool to log the reason before ending the call.`;
}

export function buildVapiFunctions() {
  return [
    {
      name: "check_availability",
      description: "Check open meeting slots on the business calendar for a given date range.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date to check, YYYY-MM-DD" },
        },
        required: ["date"],
      },
    },
    {
      name: "book_appointment",
      description: "Book a meeting at a specific confirmed time slot.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM, 24-hour" },
          callerName: { type: "string" },
          callerPhone: { type: "string" },
          reason: { type: "string" },
        },
        required: ["date", "time", "callerName"],
      },
    },
    {
      name: "capture_lead",
      description:
        "Log a caller's details and reason for calling when a request needs human follow-up.",
      parameters: {
        type: "object",
        properties: {
          callerName: { type: "string" },
          callerPhone: { type: "string" },
          notes: { type: "string" },
        },
        required: ["callerName", "notes"],
      },
    },
  ];
}

/**
 * Vapi assistant creation payload. See https://docs.vapi.ai/api-reference/assistants/create
 * `metadata.customerId` is how the webhook handler later knows which
 * customer/tenant a given call or function-call belongs to.
 */
export function buildVapiAssistantConfig(
  profile: ReceptionistProfile,
  customerId: string,
  serverUrl: string
) {
  return {
    name: `${profile.companyName} Receptionist`,
    firstMessage: `Thanks for calling ${profile.companyName}, how can I help you today?`,
    metadata: { customerId },
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      systemPrompt: buildSystemPrompt(profile),
      functions: buildVapiFunctions(),
    },
    voice: {
      provider: "11labs",
      voiceId: "rachel",
    },
    serverUrl: `${serverUrl}/webhook/vapi`,
  };
}
