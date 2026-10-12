# HireHello

HireHello helps a job seeker send individual, personalized outreach emails from their own Gmail account. A campaign selects a saved template, a PDF résumé, and contacts. The web app stores the approved messages; Vercel Queues runs a bounded sender one message at a time (a local worker is also available) and records Gmail's response.

## Requirements

- Node.js 22.x and npm
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

Open [http://localhost:3000](http://localhost:3000). Sign in with Google, connect the same Gmail account for sending, save a template and PDF, add contacts, review a campaign, then confirm. Locally, the worker must stay running to process queued messages after the browser closes. Production uses Vercel Queues, so no separate worker host is needed.

## Deploy with Vercel

Vercel runs the web app, API, and a private queue consumer. `vercel.json` registers the `hirehello-send` topic and pins functions to `iad1`. The producer and consumer share the **same hosted MongoDB database**, Google OAuth client, and Gmail token encryption key. Use Node.js 22.x (pinned in `package.json`). The local `mongodb://127.0.0.1:27017` URI will not work from Vercel.

1. Create a hosted MongoDB database (for example, Atlas), a database user, and network access for Vercel. Set `MONGODB_URI` to its connection string. Set `MONGODB_DB=hirehello`. If moving existing accounts, migrate the collections **and** the `resumeFiles` GridFS collections.
2. In the existing Vercel project, set the following **Production** environment variables. Redeploy after changing them. Use the permanent production domain rather than a preview deployment URL.

   | Variable | Value |
   | --- | --- |
   | `NEXTAUTH_URL` | `https://hire-hello.vercel.app` |
   | `NEXTAUTH_SECRET` | A stable random secret; generate once with `openssl rand -base64 32` |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Your Google Cloud web OAuth client |
   | `GMAIL_TOKEN_ENCRYPTION_KEY` | A stable base64-encoded 32-byte key; generate separately with `openssl rand -base64 32` |
   | `MONGODB_URI`, `MONGODB_DB` | The hosted MongoDB connection settings |

   Preserve the session secret and Gmail encryption key across redeployments. Changing the encryption key without migrating saved tokens requires users to reconnect Gmail. Never use `NEXT_PUBLIC_` for these values or commit `.env.local`.
3. In Google Cloud, add your permanent domain to **Authorized JavaScript origins** and register **both** exact redirect URIs on the web client:

   ```text
   https://hire-hello.vercel.app/api/auth/callback/google
   https://hire-hello.vercel.app/api/gmail/callback
   ```

   Keep localhost entries for development. If OAuth remains in Testing, add every intended test account under Audience. Public use of Gmail send access may require Google verification.
4. Deploy the latest `main` commit to the existing Vercel project. The queue consumer at `app/api/queues/send/route.ts` is registered by `vercel.json`; Vercel authenticates queue calls with its OIDC environment automatically. No queue credential, Render service, cron, or paid worker is required. Keep producers and the consumer in the same `iad1` region. Queue work continues after the browser closes. `npm run worker` remains for local development; do not also run it against the production database during deployment tests.

5. On the production domain, sign in, connect Gmail, upload a PDF no larger than 4 MiB, and send a **test message to your own mailbox**. Create a small live campaign only when you intend to contact its recipients. Check the delivery results after the worker runs.

Vercel Functions cap request bodies at 4.5 MB. New résumé uploads are limited to 4 MiB to leave room for multipart form overhead. Already stored PDFs up to the old 10 MB limit can still be used in campaigns. Vercel Queues is in beta and currently includes the first 1,000,000 operations per month on Hobby; function and database quotas still apply. Review usage in Vercel and Atlas. Staying within the free quotas avoids a paid worker; this is not a guarantee of unlimited service. See [Queues pricing](https://vercel.com/docs/queues/pricing).

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

The campaign API validates ownership and suppression rules, renders one subject/body per contact, copies the chosen PDF into a private campaign snapshot, and inserts queued delivery records. An idempotency key protects against repeated confirmation. The worker claims a delivery with a lease, checks the campaign and suppression list again, refreshes Gmail access, builds a MIME email with one recipient, and calls Gmail's send API. It sends sequentially with a default 15-second interval and a default cap of 20 accepted or uncertain messages per account over 24 hours. Uncertain attempts count conservatively because Gmail may already have accepted them. Gmail acceptance does not prove inbox delivery.

For a complete data-flow explanation, storage model, route map, failure handling, and operational limits, see [the implementation and architecture guide](docs/hirehello-implementation-plan.html).

## Operating notes

- Keep `.env.local`, MongoDB, and GridFS files private. Back up MongoDB, including `resumeFiles.files` and `resumeFiles.chunks`.
- Production uses a private Vercel queue callback; local development uses `npm run worker`. Both share `worker/processor.ts`. Watch campaign and delivery statuses; an uncertain send is never automatically resent.
- A paused campaign requires an explicit resume after the underlying issue is resolved.
- The app does not read replies or track opens; those would require more Gmail permissions and separate design work.

## Queue reliability and recovery

- MongoDB is the delivery source of truth; queue messages contain only a campaign ID. A unique `sender_locks.userId` record serializes sends for an account across concurrent function invocations and stores its next-send time.
- Each callback processes at most one delivery within a 120-second function. A 180-second Mongo lease exceeds that limit. The SDK retries with a delay while work remains instead of keeping a process asleep. Gmail send requests time out after 30 seconds; refresh requests after 20 seconds.
- The processor verifies the lock and delivery owner again immediately before sending. An expired delivery becomes `uncertain`, never queued. Terminal delivery updates require the matching lease owner, and counters are reconciled from delivery history after interrupted writes.
- Creating, resuming, or retrying a campaign publishes a wake message. If publication fails, the saved campaign, PDF snapshot, and recipient reservations remain intact. **Restart sending** in Campaigns calls the authenticated, same-origin, owner-checked `POST /api/campaigns/:id/dispatch` endpoint. It is limited to once per 30 seconds per campaign.
- Queue messages retain work for seven days. A prolonged provider outage or exhausted retention can require **Restart sending**; Mongo records do not expire with the queue message. Paused campaigns require explicit resume. The daily cap pauses campaigns rather than silently increasing limits.
- The queue callback has no public production URL because `vercel.json` declares a private queue trigger. Preview and production environments have separate Vercel queues; use separate database credentials for previews if enabled.

Run the database integration tests with an explicitly supplied **local test URI**:

```bash
MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test
```

Tests create and drop randomly named `hirehello_test_*` databases and stub Gmail. They cover concurrent callbacks, durable pacing, redelivery, daily limits, lost locks, crash recovery, retry backoff, unknown send outcomes, failed publication and interrupted dispatch-status writes. Never point this opt-in test URI at a production account.
