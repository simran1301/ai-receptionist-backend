export interface ReceptionistProfile {
  companyName: string;
  websiteUrl: string;
  /** Short description of what the company does, in plain language */
  summary: string;
  services: string[];
  /** Human-readable, e.g. "Mon-Fri 9am-6pm ET, closed weekends" */
  operatingHours: string;
  /** e.g. "warm, professional, concise" */
  tone: string;
  faqs: { question: string; answer: string }[];
  /** What to say/do when the caller wants to book time */
  bookingInstructions: string;
  /** Phone or email to hand off to when the agent can't help */
  escalationContact: string;
}

export interface OnboardRequestBody {
  companyName: string;
  websiteUrl: string;
  /** Phone/email a human should be escalated to */
  escalationContact: string;
}

export interface OnboardResult {
  customerId: string;
  profile: ReceptionistProfile;
  vapiAssistantId: string;
  phoneNumber: string;
}

/** Minimal shape of the pieces of a Vapi webhook payload this server reads */
export interface VapiWebhookMessage {
  message: {
    type: "function-call" | "end-of-call-report" | string;
    functionCall?: {
      name: string;
      parameters: Record<string, unknown>;
    };
    call?: { id: string; customer?: { number?: string } };
    transcript?: string;
    summary?: string;
    endedReason?: string;
    // Custom metadata we attach when creating the assistant, so we know
    // which customer a given call belongs to.
    assistant?: { metadata?: { customerId?: string } };
  };
}
