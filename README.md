# HireHello

HireHello helps a job seeker send individual, personalized outreach emails from their own Gmail account. A campaign selects a saved template, a PDF résumé, and contacts. The web app stores the approved messages; a separate worker sends them one by one and records Gmail's response.

## Requirements

- Node.js 20.9 or newer and npm
- MongoDB, locally or hosted
- A Google Cloud OAuth web application with the Gmail API enabled
- Google OAuth consent configured with `openid email profile` for sign-in and `gmail.send` for the separate Gmail connection

For local development, add both authorized redirect URIs to the OAuth client:

- `http://localhost:3000/api/auth/callback/google`
- `http://localhost:3000/api/gmail/callback`

Google's OAuth test mode permits only listed test users. Public use of `gmail.send` may require Google verification.

## Start locally

```bash
npm ci
cp .env.example .env.local
```

Fill in `.env.local` with your MongoDB URI, OAuth client credentials, and two independent random secrets. Generate `NEXTAUTH_SECRET` and the 32-byte base64 `GMAIL_TOKEN_ENCRYPTION_KEY` separately:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Start the web app and worker in separate terminals:

```bash
npm run dev
npm run worker
```

Open [http://localhost:3000](http://localhost:3000). Sign in with Google, connect the same Gmail account for sending, save a template and PDF, add contacts, review a campaign, then confirm. The worker must stay running to process queued messages after the browser closes. Deploy it as a persistent process with automatic restart; a serverless web deployment alone does not run this queue.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js locally |
| `npm run worker` | Start the MongoDB queue worker; reads `.env.local` |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Core and worker tests |

## How sending works

Google sign-in establishes identity with `openid email profile`. Connecting Gmail is a separate OAuth flow that requests `gmail.send`, verifies the same Google account, and stores an encrypted refresh token on the server. Neither access nor refresh tokens are sent in the app session.

The campaign API validates ownership and suppression rules, renders one subject/body per contact, copies the chosen PDF into a private campaign snapshot, and inserts queued delivery records. An idempotency key protects against repeated confirmation. The worker claims a delivery with a lease, checks the campaign and suppression list again, refreshes Gmail access, builds a MIME email with one recipient, and calls Gmail's send API. It sends sequentially with a default 15-second interval and a default cap of 20 accepted messages per account over 24 hours. Gmail acceptance does not prove inbox delivery.

For a complete data-flow explanation, storage model, route map, failure handling, and operational limits, see [the implementation and architecture guide](docs/hirehello-implementation-plan.html).

## Operating notes

- Keep `.env.local`, MongoDB, and GridFS files private. Back up MongoDB, including `resumeFiles.files` and `resumeFiles.chunks`.
- Run one worker process for this MVP. Watch campaign and delivery statuses; an uncertain send must be reviewed before any manual retry.
- A paused campaign requires an explicit resume after the underlying issue is resolved.
- The app does not read replies or track opens; those would require more Gmail permissions and separate design work.
