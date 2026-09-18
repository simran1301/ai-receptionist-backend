import axios from "axios";

const VAPI_BASE = "https://api.vapi.ai";

function authHeaders() {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error("VAPI_API_KEY is not set");
  return { Authorization: `Bearer ${key}` };
}

export async function createAssistant(config: unknown): Promise<string> {
  const res = await axios.post(`${VAPI_BASE}/assistant`, config, {
    headers: authHeaders(),
  });
  return res.data.id as string;
}

/**
 * Buys a phone number from Vapi and attaches it to the assistant.
 * If you'd rather bring an existing Twilio number, use the
 * /phone-number/import endpoint instead — same shape, different body.
 */
export async function provisionPhoneNumber(
  assistantId: string,
  areaCode?: string
): Promise<string> {
  const payload: Record<string, unknown> = { provider: "vapi", assistantId };
  if (areaCode) {
    payload.numberDesiredAreaCode = areaCode;
  } else {
    payload.numberDesiredAreaCode = "551";
  }

  const res = await axios.post(
    `${VAPI_BASE}/phone-number`,
    payload,
    { headers: authHeaders() }
  );
  return res.data.number as string;
}
