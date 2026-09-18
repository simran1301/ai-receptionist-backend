# AI Receptionist — onboarding & runtime backend

This is the backend for the "24/7 AI Voice Receptionist" offering on amstech.ai.
It implements the two things you don't get from a voice platform out of the box:

1. **Onboarding**: `POST /onboard` — takes a company name + URL, scrapes the site,
   turns it into a receptionist profile (services, hours, tone, FAQs), and provisions
   a live Vapi assistant with its own phone number.
2. **Runtime**: `POST /webhook/vapi` — handles the agent's tool calls during a live
   call (check calendar availability, book an appointment, capture a lead) and logs
   every finished call to Supabase.

It does **not** include: the actual "Scan Website" button/frontend (wire that to
`POST /onboard`), or the Sales/Support/Web-Designer/SEO agents from the roadmap —
this is scoped to the receptionist only, as requested.

## Setup

1. `cp .env.example .env` and fill in:
   - `ANTHROPIC_API_KEY` — used to turn scraped site text into a structured profile
   - `VAPI_API_KEY` — sign up at vapi.ai, this is what actually runs the phone calls
   - `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — from your Supabase project settings
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — a service account with access to the calendar
     you want bookings to land on (share the calendar with the service account's email)
   - `PUBLIC_SERVER_URL` — Vapi needs to reach this server over the internet. While
     testing locally, run `ngrok http 3000` and use that URL here.
   - `FIRECRAWL_API_KEY` — optional. Without it, scraping falls back to a basic
     fetch+strip that only sees server-rendered HTML (won't work on JS-heavy sites
     like a React/Next SPA). With it, uses the same engine as your website-audit agent.

2. Run the schema in `sql/schema.sql` against your Supabase project (SQL editor,
   paste and run).

3. Install and run:
   ```
   npm install
   npm run dev
   ```

4. Onboard a test customer:
   ```
   curl -X POST http://localhost:3000/onboard \
     -H "Content-Type: application/json" \
     -d '{
       "companyName": "Example Co",
       "websiteUrl": "https://example.com",
       "escalationContact": "+15551234567"
     }'
   ```
   Response includes a live phone number — call it and talk to the agent.

## Where each roadmap piece from our discussion lives

- **Scan/onboarding engine** → `src/scan.ts` + `src/extractProfile.ts`. Swap in your
  existing Firecrawl-based Agent 1 scraper here directly if you'd rather reuse that
  code than the fallback fetch included here.
- **Agent provisioning layer** → `src/promptBuilder.ts` (config compiler) +
  `src/vapiClient.ts` (calls the voice platform).
- **Execution layer** → Vapi handles the actual call; `src/functions/handlers.ts`
  is where the agent's tools (calendar, lead capture) are implemented.
- **Multi-tenant data layer** → `src/db.ts` + `sql/schema.sql`. Every row is keyed
  by `customer_id`, so this same schema is ready for the Sales/Support agents later
  without changes.

## Known gaps to close before this is production-ready

- No auth on `/onboard` — anyone who finds the URL can provision an assistant on
  your Vapi account. Add an API key or session check before this goes live on the
  public site.
- `calendar.ts` uses a naive 9am-5pm slot generator — replace with the business's
  actual hours from the scanned profile once you're ready.
- No retry/idempotency if `/onboard` fails halfway through (e.g. assistant created
  but phone number provisioning fails) — wrap in a transaction/cleanup step.
- Vapi's exact request/response field names may drift; check
  https://docs.vapi.ai before going live and adjust `vapiClient.ts` /
  `functions/handlers.ts` to match the current API version.
