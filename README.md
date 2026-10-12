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
Save the OAuth client after adding the Gmail callback. Google Cloud may take several minutes or longer to apply the change; an exact URL match is required. Start a fresh **Connect Gmail** flow after it takes effect rather than reloading an old Google error or callback URL.

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

## Deploy with Vercel

Vercel runs the web app and API. The email sender in `worker/index.ts` needs a separate, continuously running Node.js service. Both processes must use the **same hosted MongoDB database**, Google OAuth client, and Gmail token encryption key. The local `mongodb://127.0.0.1:27017` URI will not work from Vercel.

1. Create a hosted MongoDB database (for example, Atlas), a database user, and network access for Vercel and the worker. Set `MONGODB_URI` to its connection string. Use the same `MONGODB_DB` on both processes. If moving existing accounts, migrate the collections **and** the `resumeFiles` GridFS collections.
2. In the existing Vercel project, set the following **Production** environment variables. Redeploy after changing them. Use the permanent production domain rather than a preview deployment URL.

   | Variable | Value |
   | --- | --- |
   | `NEXTAUTH_URL` | `https://your-production-domain` |
   | `NEXTAUTH_SECRET` | A stable random secret; generate once with `openssl rand -base64 32` |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Your Google Cloud web OAuth client |
   | `GMAIL_TOKEN_ENCRYPTION_KEY` | A stable base64-encoded 32-byte key; generate separately with `openssl rand -base64 32` |
   | `MONGODB_URI`, `MONGODB_DB` | The hosted MongoDB connection settings |

   Preserve the session secret and Gmail encryption key across redeployments. Changing the encryption key without migrating saved tokens requires users to reconnect Gmail. Never use `NEXT_PUBLIC_` for these values or commit `.env.local`.
3. In Google Cloud, add your permanent domain to **Authorized JavaScript origins** and register **both** exact redirect URIs on the web client:

   ```text
   https://your-production-domain/api/auth/callback/google
   https://your-production-domain/api/gmail/callback
   ```

   Keep localhost entries for development. If OAuth remains in Testing, add every intended test account under Audience. Public use of Gmail send access may require Google verification.
4. Deploy **one** persistent Node.js worker from this repository, for example a Render Background Worker. Install with `npm ci --omit=dev` and start with `npm run worker`. Give it `MONGODB_URI`, `MONGODB_DB`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_TOKEN_ENCRYPTION_KEY` with the **same values** as Vercel. `WORKER_POLL_MS`, `WORKER_SEND_INTERVAL_MS`, and `WORKER_DAILY_CAP` are optional. Arrange automatic restart and inspect its logs if a campaign stays queued.
5. On the production domain, sign in, connect Gmail, upload a PDF no larger than 4 MiB, and send a **test message to your own mailbox**. Create a small live campaign only when you intend to contact its recipients. Check the delivery results after the worker runs.

Vercel Functions cap request bodies at 4.5 MB. New résumé uploads are limited to 4 MiB to leave room for multipart form overhead. Already stored PDFs up to the old 10 MB limit can still be used in campaigns. Vercel Hobby cron runs only once per day, which does not support the app's prompt sending and 15-second pacing.

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
