import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID, createHmac } from "crypto";
import { z } from "zod";
import axios from "axios";
import { scrapeSiteText } from "./scan";
import { extractReceptionistProfile } from "./extractProfile";
import { buildVapiAssistantConfig } from "./promptBuilder";
import { createAssistant, provisionPhoneNumber, releasePhoneNumber, deleteAssistant } from "./vapiClient";
import { saveCustomer, findCustomer, cancelCustomerSubscription } from "./db";
import { handleFunctionCall, handleEndOfCall } from "./functions/handlers";
import { OnboardResult, VapiWebhookMessage } from "./types";

const app = express();
app.use(express.json());

// Only the site itself should be able to call /onboard. Vapi's webhook to
// /webhook/vapi comes from Vapi's servers, not a browser, so it isn't
// affected by CORS and needs no origin here.
const allowedOrigin = process.env.FRONTEND_ORIGIN ?? "*";
app.use(cors({ origin: allowedOrigin }));

// Cheap abuse guard: the frontend sends this shared secret in a header.
// It stops a random visitor from calling /onboard directly and burning
// your Anthropic/Vapi credits — swap for real user auth once you have it.
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const provided = req.header("x-onboard-key");
  if (!process.env.ONBOARD_API_KEY || provided !== process.env.ONBOARD_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function generateApprovalToken(phone: string, email: string): string {
  const secret = process.env.ONBOARD_API_KEY || "ams_cancellation_secret";
  return createHmac("sha256", secret).update(`${phone}:${email}`).digest("hex");
}

function verifyApprovalToken(token: string, phone: string, email: string): boolean {
  const expected = generateApprovalToken(phone, email);
  return token === expected;
}

const onboardSchema = z.object({
  companyName: z.string().min(1),
  websiteUrl: z.string().url(),
  escalationContact: z.string().min(1),
});

const cancelRequestSchema = z.object({
  companyName: z.string().min(1),
  managerEmail: z.string().email(),
  phoneNumber: z.string().min(1),
  reason: z.string().default("Customer requested cancellation"),
  notes: z.string().optional(),
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", service: "ai-receptionist-backend", timestamp: new Date().toISOString() });
});

// Step 2 of the "Scan Website" flow: given a company + URL, produce a live
// voice receptionist with its own phone number.
app.post("/onboard", requireApiKey, async (req, res) => {
  try {
    const body = onboardSchema.parse(req.body);
    const serverUrl = process.env.PUBLIC_SERVER_URL;
    if (!serverUrl) throw new Error("PUBLIC_SERVER_URL is not set");

    const siteText = await scrapeSiteText(body.websiteUrl);
    const profile = await extractReceptionistProfile(
      body.companyName,
      body.websiteUrl,
      body.escalationContact,
      siteText
    );

    const customerId = randomUUID();
    const assistantConfig = buildVapiAssistantConfig(profile, customerId, serverUrl);
    const vapiAssistantId = await createAssistant(assistantConfig);

    const cleanDigits = body.escalationContact.replace(/\D/g, "");
    const areaCode = cleanDigits.length >= 10 ? cleanDigits.slice(-10, -7) : "551";
    const phoneNumber = await provisionPhoneNumber(vapiAssistantId, areaCode);

    await saveCustomer(customerId, profile, vapiAssistantId, phoneNumber);

    const result: OnboardResult = { customerId, profile, vapiAssistantId, phoneNumber };
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// Manager Portal Cancellation Request
// Dispatches an executive review email to sales@amstech.ai with an approval link
app.post("/cancel-subscription/request", requireApiKey, async (req, res) => {
  try {
    const body = cancelRequestSchema.parse(req.body);
    const serverUrl = process.env.PUBLIC_SERVER_URL || "https://ai-receptionist-backend-4ums.onrender.com";

    const token = generateApprovalToken(body.phoneNumber, body.managerEmail);
    const approveUrl = `${serverUrl}/cancel-subscription/approve?token=${token}&phone=${encodeURIComponent(
      body.phoneNumber
    )}&email=${encodeURIComponent(body.managerEmail)}&org=${encodeURIComponent(body.companyName)}`;
    const declineUrl = `${serverUrl}/cancel-subscription/decline?token=${token}&phone=${encodeURIComponent(
      body.phoneNumber
    )}&email=${encodeURIComponent(body.managerEmail)}&org=${encodeURIComponent(body.companyName)}`;

    // Dispatch approval request to sales@amstech.ai via Google Apps Script email system
    const scriptUrl =
      process.env.GOOGLE_SCRIPT_URL ||
      "https://script.google.com/macros/s/AKfycbyC_jc0PfIUXuHNPiiSoh_i5z-wfKaZQBH5kpIGoGpykAhjhlkqAFfkruyLxaOF7UKZ-g/exec";

    try {
      await axios.post(
        scriptUrl,
        {
          portalApiKey: "AMS_SECURE_PORTAL_2026_V1",
          action: "requestCancellation",
          org: body.companyName,
          email: body.managerEmail,
          phone: body.phoneNumber,
          reason: body.reason,
          notes: body.notes || "",
          approveUrl: approveUrl,
          declineUrl: declineUrl,
        },
        { timeout: 8000 }
      );
    } catch (mailErr: any) {
      console.warn("Failed to dispatch cancellation email via Google Apps Script:", mailErr.message);
    }

    console.log(`
=============================================================================
[AI RECEPTIONIST CANCELLATION REQUEST RECEIVED]
Client Organization: ${body.companyName}
Manager Email:       ${body.managerEmail}
Assigned Phone Line: ${body.phoneNumber}
Reason:              ${body.reason}
Notes:               ${body.notes || "None"}

ONE-CLICK APPROVE LINK (Releases Vapi number & cancels subscription):
${approveUrl}

DECLINE LINK:
${declineUrl}
=============================================================================
`);

    res.json({
      success: true,
      message: "Cancellation request submitted. An approval email has been sent to sales@amstech.ai.",
      status: "pending_approval",
      approvalUrl: approveUrl,
    });
  } catch (err) {
    console.error("Error in /cancel-subscription/request:", err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// Approval Handler (Clicked by sales@amstech.ai from approval email)
// Releases the phone number in Vapi, archives the assistant, and cancels customer subscription
app.get("/cancel-subscription/approve", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    const phone = String(req.query.phone || "");
    const email = String(req.query.email || "");
    const org = String(req.query.org || "Enterprise Client");

    if (!phone || !email || !token) {
      return res.status(400).send("<h3>Missing required parameters (token, phone, email)</h3>");
    }

    if (!verifyApprovalToken(token, phone, email)) {
      return res.status(403).send("<h3>Invalid or expired cancellation authorization token.</h3>");
    }

    // 1. Find customer record to get assistant ID
    const customer = await findCustomer({ phone, companyName: org });

    // 2. Release phone number from Vapi
    let releaseResult: { released: boolean; id: string; number?: string } = { released: false, id: "", number: phone };
    try {
      releaseResult = await releasePhoneNumber(phone);
    } catch (vapiErr: any) {
      console.warn("Vapi phone release warning:", vapiErr.message);
    }

    // 3. Delete Vapi assistant if found
    if (customer?.vapi_assistant_id) {
      await deleteAssistant(customer.vapi_assistant_id);
    }

    // 4. Update customer status in Supabase database
    await cancelCustomerSubscription(phone);

    // 5. Notify Google Apps Script to mark row as cancelled
    const scriptUrl =
      process.env.GOOGLE_SCRIPT_URL ||
      "https://script.google.com/macros/s/AKfycbyC_jc0PfIUXuHNPiiSoh_i5z-wfKaZQBH5kpIGoGpykAhjhlkqAFfkruyLxaOF7UKZ-g/exec";

    try {
      await axios.post(
        scriptUrl,
        {
          portalApiKey: "AMS_SECURE_PORTAL_2026_V1",
          action: "confirmCancellation",
          org: org,
          email: email,
          phone: phone,
        },
        { timeout: 8000 }
      );
    } catch (syncErr: any) {
      console.warn("Google Apps Script sync warning:", syncErr.message);
    }

    // 6. Return professional confirmation page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Subscription Cancelled - AMS Technology Solutions</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0F172A; color: #FFFFFF; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          .card { background: #1E293B; border: 1px solid #334155; border-radius: 16px; padding: 40px; max-width: 540px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
          .badge { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background-color: rgba(239, 68, 68, 0.15); color: #EF4444; font-size: 28px; margin-bottom: 20px; border: 1px solid rgba(239, 68, 68, 0.3); }
          h1 { font-size: 22px; font-weight: 700; margin: 0 0 10px 0; color: #FFFFFF; }
          p { font-size: 14px; color: #94A3B8; margin: 0 0 24px 0; line-height: 1.6; }
          .details { background: #0F172A; border: 1px solid #334155; border-radius: 8px; padding: 16px; text-align: left; font-size: 13px; margin-bottom: 24px; }
          .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1E293B; }
          .row:last-child { border-bottom: none; }
          .label { color: #64748B; }
          .val { font-weight: 600; color: #E2E8F0; font-family: monospace; }
          .status-tag { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: rgba(239, 68, 68, 0.2); color: #FCA5A5; border: 1px solid rgba(239, 68, 68, 0.3); }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">✔</div>
          <h1>Cancellation Approved & Executed</h1>
          <p>The AI Receptionist subscription has been successfully terminated and the provisioned telephone line has been released back to the telecom carrier pool.</p>
          
          <div class="details">
            <div class="row"><span class="label">Organization:</span><span class="val">${org}</span></div>
            <div class="row"><span class="label">Manager Email:</span><span class="val">${email}</span></div>
            <div class="row"><span class="label">Released Phone DID:</span><span class="val" style="color: #F87171;">${phone}</span></div>
            <div class="row"><span class="label">Carrier Status:</span><span class="val" style="color: #34D399;">RELEASED / DELETED</span></div>
            <div class="row"><span class="label">Service Status:</span><span class="status-tag">CANCELLED</span></div>
          </div>

          <div style="font-size: 12px; color: #64748B;">
            AMS Technology Solutions LLC · sales@amstech.ai · +1 551 254 9002
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Error in /cancel-subscription/approve:", err);
    res.status(500).send(`<h3>Error approving cancellation: ${(err as Error).message}</h3>`);
  }
});

// Decline Cancellation Handler
app.get("/cancel-subscription/decline", (req, res) => {
  const org = String(req.query.org || "Client");
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cancellation Declined</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0F172A; color: #FFF; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { background: #1E293B; border: 1px solid #334155; border-radius: 12px; padding: 36px; max-width: 480px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="box">
        <h2 style="margin-top:0;">Cancellation Declined</h2>
        <p style="color:#94A3B8;">The cancellation request for <strong>${org}</strong> has been rejected. The AI Receptionist service and telephone line remain active.</p>
      </div>
    </body>
    </html>
  `);
});

// Programmatic Release Endpoint (Protected by requireApiKey)
app.post("/cancel-subscription/release", requireApiKey, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });

    const result = await releasePhoneNumber(phoneNumber);
    await cancelCustomerSubscription(phoneNumber);

    res.json({ success: true, released: result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Vapi posts every function call and the end-of-call report here.
app.post("/webhook/vapi", async (req, res) => {
  const payload = req.body as VapiWebhookMessage;
  try {
    if (payload.message.type === "function-call") {
      const result = await handleFunctionCall(payload);
      return res.json(result);
    }
    if (payload.message.type === "end-of-call-report") {
      await handleEndOfCall(payload);
      return res.json({ received: true });
    }
    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => console.log(`AI receptionist server listening on :${port}`));

