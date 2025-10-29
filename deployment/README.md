# Zoho Catalyst deployment

This project supports two Catalyst deployment modes:

1. Serverless Functions (Advanced I/O) for order suggestion API
2. AppSail (PaaS container) for hosting the Next.js UI

You can use either or both: host the UI on AppSail and call the serverless function for calculations.

## Prerequisites

- Catalyst CLI installed and logged in

```powershell
catalyst.cmd --version
catalyst.cmd login
```

## 1) Initialize Catalyst project

From the repository root:

```powershell
# interactive; choose or create a Catalyst project
catalyst.cmd init
```

## 2) Deploy the serverless function

We created an Advanced I/O function in `functions/suggestions`.

- Endpoint base: the function root
- POST /suggestions: calculates order suggestions

```powershell
# install function deps
cd functions/suggestions
npm install

# optional local test (if you run via node for quick check)
npm run dev

# go back to the repo root before deploying
cd ../../..

# deploy functions (choose Advanced I/O when prompted if asked)
catalyst.cmd functions:deploy
```

After deploy, note the public URL for the function and set it in `.env.local`:

```bash
NEXT_PUBLIC_CATALYST_FUNCTION_URL=https://<your-function-url>
```

You can point it either to the function base or directly to `/suggestions`.

## 3) Deploy the UI on AppSail (PaaS)

We included a Dockerfile at `deployment/appsail/Dockerfile`.

```powershell
# from the repo root
catalyst.cmd appsail:init
# follow prompts and select the Dockerfile path: deployment\appsail\Dockerfile

# build & deploy
catalyst.cmd appsail:deploy
```

Once deployed, set your app’s public URL as allowed origin for the function (env var `ALLOWED_ORIGIN`) in the function’s environment, or update the function to allow your domain.

## 4) Local development

- Run UI locally:

```powershell
npm install
npm run dev
```

- Use local Next.js API fallback (no Catalyst): the UI computes suggestions client-side and via `/api/suggestions` locally.

- Switch to Catalyst backend: set `NEXT_PUBLIC_CATALYST_FUNCTION_URL` in `.env.local` and restart `npm run dev`.

## Endpoints

- Serverless: `POST /suggestions` with body `{ skuData: [...] }`
- UI: `/` main dashboard, `/demo` demo page

## Notes

- SKUs starting with `0-`, `800-`, `2000-` are filtered out in both UI and serverless function.
- For CORS, set environment variable `ALLOWED_ORIGIN` (or `NEXT_PUBLIC_APP_URL`) for the function.
