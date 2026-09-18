import { createClient } from "@supabase/supabase-js";
import { ReceptionistProfile } from "./types";

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  return createClient(url, key);
}

export async function saveCustomer(
  customerId: string,
  profile: ReceptionistProfile,
  vapiAssistantId: string,
  phoneNumber: string
) {
  const { error } = await client().from("customers").insert({
    id: customerId,
    company_name: profile.companyName,
    website_url: profile.websiteUrl,
    vapi_assistant_id: vapiAssistantId,
    phone_number: phoneNumber,
    profile: profile,
  });
  if (error) throw error;
}

export async function saveLead(
  customerId: string,
  callerName: string,
  callerPhone: string | undefined,
  notes: string
) {
  const { error } = await client().from("leads").insert({
    customer_id: customerId,
    caller_name: callerName,
    caller_phone: callerPhone ?? null,
    notes,
  });
  if (error) throw error;
}

export async function saveCallReport(
  customerId: string,
  transcript: string | undefined,
  summary: string | undefined,
  endedReason: string | undefined
) {
  const { error } = await client().from("calls").insert({
    customer_id: customerId,
    transcript: transcript ?? null,
    summary: summary ?? null,
    ended_reason: endedReason ?? null,
  });
  if (error) throw error;
}
