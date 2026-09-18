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
  try {
    const { error } = await client().from("customers").insert({
      id: customerId,
      company_name: profile.companyName,
      website_url: profile.websiteUrl,
      vapi_assistant_id: vapiAssistantId,
      phone_number: phoneNumber,
      profile: profile,
    });
    if (error) {
      console.warn("Supabase saveCustomer warning (run sql/schema.sql in Supabase):", error.message);
    }
  } catch (err: any) {
    console.warn("Supabase saveCustomer exception:", err?.message);
  }
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

export async function findCustomer(filter: { id?: string; phone?: string; companyName?: string }) {
  try {
    let query = client().from("customers").select("*");
    if (filter.id) {
      query = query.eq("id", filter.id);
    } else if (filter.phone) {
      const clean = filter.phone.replace(/\D/g, "");
      query = query.ilike("phone_number", `%${clean.slice(-10)}%`);
    } else if (filter.companyName) {
      query = query.ilike("company_name", `%${filter.companyName}%`);
    }
    const { data, error } = await query.limit(1);
    if (error) {
      console.warn("Supabase findCustomer error:", error.message);
      return null;
    }
    return data && data.length > 0 ? data[0] : null;
  } catch (err: any) {
    console.warn("Supabase findCustomer exception:", err?.message);
    return null;
  }
}

export async function cancelCustomerSubscription(customerIdOrPhone: string) {
  try {
    const clean = customerIdOrPhone.replace(/\D/g, "");
    let query = client().from("customers").update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    });

    if (clean.length >= 7) {
      query = query.ilike("phone_number", `%${clean.slice(-10)}%`);
    } else {
      query = query.eq("id", customerIdOrPhone);
    }

    const { error } = await query;
    if (error) {
      console.warn("Supabase cancelCustomerSubscription warning:", error.message);
    }
    return true;
  } catch (err: any) {
    console.warn("Supabase cancelCustomerSubscription exception:", err?.message);
    return false;
  }
}

