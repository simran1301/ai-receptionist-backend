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

  try {
    const res = await axios.post(
      `${VAPI_BASE}/phone-number`,
      payload,
      { headers: authHeaders() }
    );
    return res.data.number as string;
  } catch (err: any) {
    // If buying an additional number requires a payment method, fallback to reassigning existing number
    try {
      const existing = await axios.get(`${VAPI_BASE}/phone-number`, {
        headers: authHeaders(),
      });
      if (existing.data && existing.data.length > 0) {
        const targetNumber = existing.data[0];
        await axios.patch(
          `${VAPI_BASE}/phone-number/${targetNumber.id}`,
          { assistantId },
          { headers: authHeaders() }
        );
        return targetNumber.number as string;
      }
    } catch (fallbackErr) {
      console.error("Failed to reassign existing phone number:", fallbackErr);
    }
    throw err;
  }
}

/**
 * Lists all phone numbers provisioned in the Vapi account.
 */
export async function listPhoneNumbers(): Promise<Array<{ id: string; number: string; assistantId?: string }>> {
  const res = await axios.get(`${VAPI_BASE}/phone-number`, {
    headers: authHeaders(),
  });
  return res.data || [];
}

/**
 * Releases a phone number from Vapi. Accepts either a Vapi Phone Number ID or a phone number string (e.g. "+15514441061").
 */
export async function releasePhoneNumber(phoneNumberOrId: string): Promise<{ released: boolean; id: string; number?: string }> {
  const cleanedTarget = phoneNumberOrId.replace(/\D/g, "");
  const allNumbers = await listPhoneNumbers();

  // Match by exact ID or by trailing digits of phone number
  const matched = allNumbers.find(
    (n) =>
      n.id === phoneNumberOrId ||
      (cleanedTarget.length >= 7 && (n.number || "").replace(/\D/g, "").endsWith(cleanedTarget.slice(-10)))
  );

  const targetId = matched ? matched.id : phoneNumberOrId;
  const targetNum = matched ? matched.number : phoneNumberOrId;

  try {
    // Unlink assistant first to ensure clean detachment
    try {
      await axios.patch(
        `${VAPI_BASE}/phone-number/${targetId}`,
        { assistantId: null },
        { headers: authHeaders() }
      );
    } catch {
      // Non-fatal if already detached
    }

    // Delete/release number from Vapi
    await axios.delete(`${VAPI_BASE}/phone-number/${targetId}`, {
      headers: authHeaders(),
    });

    return { released: true, id: targetId, number: targetNum };
  } catch (err: any) {
    console.error(`Failed to delete Vapi phone number ${targetId}:`, err.response?.data || err.message);
    throw new Error(`Failed to release phone number ${targetNum}: ${err.response?.data?.message || err.message}`);
  }
}

/**
 * Deletes an assistant from Vapi by assistant ID.
 */
export async function deleteAssistant(assistantId: string): Promise<boolean> {
  try {
    await axios.delete(`${VAPI_BASE}/assistant/${assistantId}`, {
      headers: authHeaders(),
    });
    return true;
  } catch (err: any) {
    console.warn(`Failed to delete Vapi assistant ${assistantId}:`, err.response?.data || err.message);
    return false;
  }
}

