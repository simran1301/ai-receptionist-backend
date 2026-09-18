import axios from "axios";
import { ReceptionistProfile } from "./types";

const EXTRACTION_SYSTEM_PROMPT = `You turn raw website text into a structured profile for an AI phone receptionist.
Read the site content and infer: what the business does, its services, likely operating hours
(if not stated, infer a sensible default like "Mon-Fri 9am-5pm" and say so is inferred),
the brand's tone of voice, and 5-8 FAQs a caller would plausibly ask, with concise answers
grounded only in what the site actually says. Do not invent specific facts (prices, addresses,
staff names) that are not present in the text — omit them instead.

Respond with ONLY valid JSON matching this shape, no prose, no markdown fences:
{
  "summary": string,
  "services": string[],
  "operatingHours": string,
  "tone": string,
  "faqs": [{ "question": string, "answer": string }]
}`;

export async function extractReceptionistProfile(
  companyName: string,
  websiteUrl: string,
  escalationContact: string,
  siteText: string
): Promise<ReceptionistProfile> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Company: ${companyName}\nURL: ${websiteUrl}\n\nSite content:\n${siteText}`,
        },
      ],
    },
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    }
  );

  const textBlock = res.data.content.find((b: { type: string }) => b.type === "text");
  const raw = textBlock?.text ?? "{}";
  const parsed = JSON.parse(stripCodeFence(raw));

  return {
    companyName,
    websiteUrl,
    summary: parsed.summary ?? "",
    services: parsed.services ?? [],
    operatingHours: parsed.operatingHours ?? "Not specified — confirm with the business",
    tone: parsed.tone ?? "professional and friendly",
    faqs: parsed.faqs ?? [],
    bookingInstructions:
      "Offer to check calendar availability and book a meeting using the check_availability and book_appointment tools.",
    escalationContact,
  };
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
}
