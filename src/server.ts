import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { z } from "zod";
import { scrapeSiteText } from "./scan";
import { extractReceptionistProfile } from "./extractProfile";
import { buildVapiAssistantConfig } from "./promptBuilder";
import { createAssistant, provisionPhoneNumber } from "./vapiClient";
import { saveCustomer } from "./db";
import { handleFunctionCall, handleEndOfCall } from "./functions/handlers";
import { OnboardResult, VapiWebhookMessage } from "./types";

const app = express();
app.use(express.json());

// Only the site itself should be able to call /onboard. Vapi's webhook to
// /webhook/vapi comes from Vapi's servers, not a browser, so it isn't
// affected by CORS and needs no origin here.
const allowedOrigin = process.env.FRONTEND_ORIGIN ?? "https://amstech.ai";
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

const onboardSchema = z.object({
  companyName: z.string().min(1),
  websiteUrl: z.string().url(),
  escalationContact: z.string().min(1),
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
