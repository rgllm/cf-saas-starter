# Next.js SaaS Starter — Cloudflare Workers (OpenNext)

Run the Next.js SaaS starter on **Cloudflare Workers** using **OpenNext** with **Cloudflare D1** as the database. 
The template keeps the Stripe-powered subscription flow, auth, RBAC, and dashboard from the original Vercel project, but is tuned for the Cloudflare platform.

## Features

- Marketing landing page (`/`) with animated Terminal element
- Pricing page (`/pricing`) which connects to Stripe Checkout
- Dashboard pages with CRUD operations on users/teams
- Basic RBAC with Owner and Member roles
- Subscription management with Stripe Customer Portal
- Email/password authentication with JWTs stored to cookies
- Global middleware to protect logged-in routes
- Local middleware to protect Server Actions or validate Zod schemas
- Activity logging system for any user events

## Tech Stack

- **Runtime**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) via [OpenNext](https://github.com/opennextjs/opennext)
- **Framework**: [Next.js 15](https://nextjs.org/)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **Payments**: [Stripe](https://stripe.com/)
- **UI Library**: [shadcn/ui](https://ui.shadcn.com/)

## Getting Started

```bash
git clone https://github.com/<your-org>/cf-saas-starter
cd cf-saas-starter
pnpm install
```

## Requirements

- `pnpm`
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) authenticated (`wrangler login`)
- Cloudflare account with D1 enabled
- Stripe account + [Stripe CLI](https://docs.stripe.com/stripe-cli) for local testing (optional but recommended)

## Running Locally

[Install](https://docs.stripe.com/stripe-cli) and log in to your Stripe account (optional, only required for local webhooks/payments):

```bash
stripe login
```

Authenticate Wrangler so the script can provision D1 resources:

```bash
wrangler login
```

Use the included setup script to create your `.env` file and (optionally) create a D1 database:

```bash
pnpm db:setup
```

Run the database migrations (via the D1 HTTP driver) and seed the database with the default user/team:

```bash
pnpm db:migrate
pnpm db:seed
```

This will create the following user and team:

- User: `test@test.com`
- Password: `admin123`

You can also create new users through the `/sign-up` route.

Finally, run the Next.js development server for the modern dev workflow:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the app in action.

You can listen for Stripe webhooks locally through their CLI to handle subscription change events:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

If you prefer to exercise the full Worker runtime locally you can also use:

```bash
pnpm preview       # Builds with OpenNext, then runs wrangler dev
```

## Testing Payments

To test Stripe payments, use the following test card details:

- Card Number: `4242 4242 4242 4242`
- Expiration: Any future date
- CVC: Any 3-digit number

## Going to Production

When you're ready to deploy your SaaS application to production, follow these steps:

### Deploy to Cloudflare

1. Build the OpenNext output and deploy with the included CLI script:

   ```bash
   pnpm deploy
   ```

   This wraps `opennextjs-cloudflare` and publishes to Cloudflare Workers/Pages.

2. Alternatively, you can push the `.open-next` artifacts to your own deployment pipeline and run `wrangler deploy`.

### Configure environment variables & bindings

Set the following in the Cloudflare dashboard (Workers > your deployment > Settings > Variables) or via `wrangler secret put`:

- `BASE_URL`: e.g. `https://yourdomain.com`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `AUTH_SECRET`

And ensure your Worker has the D1 binding created during setup (defaults to `DB`). If you created the database manually, update `wrangler.jsonc` accordingly and redeploy.

### Set up a production Stripe webhook

1. Go to the Stripe Dashboard and create a new webhook for your production environment.
2. Set the endpoint URL to your production API route (e.g., `https://yourdomain.com/api/stripe/webhook`).
3. Select the events you want to listen for (e.g., `checkout.session.completed`, `customer.subscription.updated`).

## Other Templates

While this template is intentionally minimal and to be used as a learning resource, there are other paid versions in the community which are more full-featured:

- https://achromatic.dev
- https://shipfa.st
- https://makerkit.dev
- https://zerotoshipped.com
- https://turbostarter.dev
