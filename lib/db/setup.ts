import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import readline from 'node:readline';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const execAsync = promisify(exec);

type AccountInfo = {
  id: string;
  name?: string;
};

type D1SetupResult = {
  databaseId: string;
  databaseName: string;
  bindingName: string;
  apiToken: string;
};

function question(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '');
}

function parseJsonFromOutput<T>(raw: string): T | null {
  if (!raw) {
    return null;
  }

  const clean = stripAnsi(raw);

  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const slice = clean.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(slice) as T;
  } catch {
    return null;
  }
}

function getStdout(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'stdout' in error &&
    typeof (error as { stdout?: unknown }).stdout === 'string'
  ) {
    return (error as { stdout: string }).stdout;
  }

  return '';
}

function getStderr(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof (error as { stderr?: unknown }).stderr === 'string'
  ) {
    return (error as { stderr: string }).stderr;
  }

  return '';
}

function formatAccount(account: AccountInfo): string {
  return account.name ? `${account.name} (${account.id})` : account.id;
}

function extractAccounts(raw: string): AccountInfo[] {
  const cleanOutput = stripAnsi(raw);
  const accounts = new Map<string, AccountInfo>();

  const addAccount = (id?: string | null, name?: string | null) => {
    if (!id) {
      return;
    }

    const trimmedId = id.trim();
    if (!/^[a-f0-9]{32}$/i.test(trimmedId)) {
      return;
    }

    const trimmedName = name?.trim();
    const cleanName = trimmedName ? trimmedName.replace(/["']/g, '').trim() : undefined;

    if (!accounts.has(trimmedId)) {
      accounts.set(trimmedId, {
        id: trimmedId,
        name: cleanName && cleanName.length > 0 ? cleanName : undefined,
      });
    }
  };

  const data = parseJsonFromOutput<{
    account?: { id?: string; name?: string };
    accounts?: { id?: string; name?: string }[];
    result?: { accounts?: { id?: string; name?: string }[] };
  }>(cleanOutput);

  if (data) {
    addAccount(data.account?.id ?? null, data.account?.name ?? null);

    const candidates: { id?: string; name?: string }[] = [];
    if (Array.isArray(data.accounts)) {
      candidates.push(...data.accounts);
    }
    if (data.result && Array.isArray(data.result.accounts)) {
      candidates.push(...data.result.accounts);
    }

    for (const entry of candidates) {
      addAccount(entry.id ?? null, entry.name ?? null);
    }
  }

  for (const line of cleanOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^[\u2502\|].*[\u2502\|]$/.test(trimmed)) {
      const parts = trimmed
        .split(/[\u2502\|]/)
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        const [maybeName, maybeId] = parts;
        if (!/account name/i.test(maybeName) && !/account id/i.test(maybeId)) {
          addAccount(maybeId, maybeName);
        }
      }
      continue;
    }

    const inlineMatch = trimmed.match(/(.+?)\s*\(id:\s*([0-9a-f]{32})\)/i);
    if (inlineMatch) {
      addAccount(inlineMatch[2], inlineMatch[1]);
      continue;
    }

    const colonMatch = trimmed.match(/account\s+id\s*:\s*([0-9a-f]{32})/i);
    if (colonMatch) {
      addAccount(colonMatch[1]);
      continue;
    }
  }

  return Array.from(accounts.values());
}

async function promptForAccountId(): Promise<AccountInfo> {
  console.log('Provide the Cloudflare account you want to use.');
  while (true) {
    const accountId = (
      await question('Enter the Cloudflare account ID (32 hex characters): ')
    )
      .trim();

    if (/^[a-f0-9]{32}$/i.test(accountId)) {
      const name = (await question('Optional: enter a label for this account: ')).trim();
      return { id: accountId, name: name || undefined };
    }

    console.log(
      'Account ID must be exactly 32 hexadecimal characters. Please try again.'
    );
  }
}

async function promptForExistingDatabaseDetails(options: {
  defaultName?: string;
} = {}): Promise<{ databaseName: string; databaseId: string }> {
  let databaseName = '';
  const fallbackName = options.defaultName?.trim();

  while (!databaseName) {
    const answer = await question(
      `Enter your existing D1 database name${
        fallbackName ? ` (press enter to use "${fallbackName}")` : ''
      }: `
    );

    databaseName = answer || fallbackName || '';

    if (!databaseName) {
      console.log('Database name is required.');
    }
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let databaseId = '';

  while (!uuidPattern.test(databaseId)) {
    databaseId = await question(
      'Enter your existing D1 database ID (UUID): '
    );

    if (!uuidPattern.test(databaseId)) {
      console.log('Please provide a valid UUID (e.g. 123e4567-e89b-12d3-a456-426614174000).');
    }
  }

  return { databaseName, databaseId };
}

async function chooseCloudflareAccount(
  detected: AccountInfo[]
): Promise<AccountInfo> {
  if (detected.length > 0) {
    console.log('Available Cloudflare accounts:');
    detected.forEach((account, index) => {
      console.log(`  ${index + 1}) ${formatAccount(account)}`);
    });
    console.log(
      'Press Enter to use the first account, or select an account by number / provide an account ID.'
    );

    while (true) {
      const answer = (
        await question(
          `Select an account (1-${detected.length}) or enter a Cloudflare account ID: `
        )
      ).trim();

      if (answer === '') {
        return detected[0];
      }

      const index = Number.parseInt(answer, 10);
      if (!Number.isNaN(index) && index >= 1 && index <= detected.length) {
        return detected[index - 1];
      }

      if (/^[a-f0-9]{32}$/i.test(answer)) {
        const label = (
          await question('Optional: enter a label for this account: ')
        ).trim();
        return {
          id: answer,
          name: label || undefined,
        };
      }

      console.log(
        `Please enter a number between 1 and ${detected.length} or a 32-character account ID.`
      );
    }
  }

  console.log(
    'Unable to determine your Cloudflare accounts automatically.'
  );
  console.log(
    'Tip: run `pnpm wrangler whoami` in another terminal if you need to look up the account ID.'
  );
  return promptForAccountId();
}

function parseD1CreateResult(raw: string, fallbackName: string): {
  id: string;
  name: string;
} | null {
  const clean = stripAnsi(raw);

  type ResultPayload = {
    uuid?: string;
    id?: string;
    database_id?: string;
    databaseId?: string;
    name?: string;
    database_name?: string;
    databaseName?: string;
  };

  const data = parseJsonFromOutput<{ result?: ResultPayload } & ResultPayload>(clean);
  if (data) {
    const payload = (data.result ?? data) as ResultPayload;
    const id =
      payload.uuid ??
      payload.id ??
      payload.database_id ??
      payload.databaseId;
    const name =
      payload.name ??
      payload.database_name ??
      payload.databaseName ??
      fallbackName;

    if (id && name) {
      return { id, name };
    }
  }

  const snippetIdMatch = clean.match(
    /"database_id"\s*:\s*"([0-9a-f-]{36})"/i
  );
  if (snippetIdMatch) {
    const snippetNameMatch = clean.match(
      /"database_name"\s*:\s*"([^"]+)"/i
    );
    return {
      id: snippetIdMatch[1],
      name: snippetNameMatch?.[1] ?? fallbackName,
    };
  }

  const uuidMatch = clean.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  if (uuidMatch) {
    const nameMatch =
      clean.match(/DB ["']?([\w-]+)["']?/i) ??
      clean.match(/database ["']?([\w-]+)["']?/i);
    return {
      id: uuidMatch[1],
      name: nameMatch?.[1] ?? fallbackName,
    };
  }

  return null;
}

async function checkStripeCLI() {
  console.log(
    'Step 1: Checking if Stripe CLI is installed and authenticated...'
  );
  try {
    await execAsync('stripe --version');
    console.log('Stripe CLI is installed.');

    try {
      await execAsync('stripe config --list');
      console.log('Stripe CLI is authenticated.');
    } catch (error) {
      console.log(
        'Stripe CLI is not authenticated or the authentication has expired.'
      );
      console.log('Please run: stripe login');
      const answer = await question(
        'Have you completed the authentication? (y/n): '
      );
      if (answer.toLowerCase() !== 'y') {
        console.log(
          'Please authenticate with Stripe CLI and run this script again.'
        );
        process.exit(1);
      }

      try {
        await execAsync('stripe config --list');
        console.log('Stripe CLI authentication confirmed.');
      } catch (secondError) {
        console.error(
          'Failed to verify Stripe CLI authentication. Please try again.'
        );
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(
      'Stripe CLI is not installed. Please install it and try again.'
    );
    console.log('To install Stripe CLI, follow these steps:');
    console.log('1. Visit: https://docs.stripe.com/stripe-cli');
    console.log(
      '2. Download and install the Stripe CLI for your operating system'
    );
    console.log('3. After installation, run: stripe login');
    console.log(
      'After installation and authentication, please run this setup script again.'
    );
    process.exit(1);
  }
}

async function checkWranglerCLI(): Promise<AccountInfo> {
  console.log(
    'Step 2: Checking if Wrangler CLI is installed and authenticated...'
  );

  try {
    await execAsync('pnpm wrangler --version');
    console.log('Wrangler CLI is installed.');
  } catch (error) {
    console.error(
      'Wrangler CLI is not installed. Please install it and try again.'
    );
    console.log(
      'Installation guide: https://developers.cloudflare.com/workers/wrangler/install-and-update/'
    );
    process.exit(1);
  }

  let detectedAccounts: AccountInfo[] | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { stdout } = await execAsync('pnpm wrangler whoami');
      detectedAccounts = extractAccounts(stdout);
      if (detectedAccounts.length > 0) {
        console.log(
          `Wrangler CLI is authenticated. Found ${detectedAccounts.length} Cloudflare account(s).`
        );
      } else {
        console.log(
          'Wrangler CLI is authenticated, but no accounts were detected in the output.'
        );
      }
      break;
    } catch (error) {
      const stdout = getStdout(error);
      const accountsFromError = extractAccounts(stdout);
      if (accountsFromError.length > 0) {
        detectedAccounts = accountsFromError;
        console.log(
          `Wrangler CLI is authenticated. Found ${accountsFromError.length} Cloudflare account(s).`
        );
        break;
      }

      if (attempt === 0) {
        console.log(
          'Wrangler CLI is not authenticated or the authentication has expired.'
        );
        console.log('Please run: pnpm wrangler login');
        const answer = await question(
          'Have you completed the authentication? (y/n): '
        );
        if (answer.toLowerCase() !== 'y') {
          console.log(
            'Please authenticate with Wrangler CLI and run this script again.'
          );
          process.exit(1);
        }
        continue;
      }

      console.error(
        'Failed to verify Wrangler CLI authentication. Please try again.'
      );
      process.exit(1);
    }
  }

  if (detectedAccounts === null) {
    throw new Error('Unable to determine Wrangler CLI authentication status.');
  }

  return chooseCloudflareAccount(detectedAccounts);
}

async function updateWranglerConfig({
  bindingName,
  databaseId,
  databaseName,
}: {
  bindingName: string;
  databaseId: string;
  databaseName: string;
}) {
  const configPath = path.join(process.cwd(), 'wrangler.jsonc');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    let updated = content;
    let changed = false;

    if (updated.includes('"binding": "BINDING_NAME"')) {
      updated = updated.replace(
        '"binding": "BINDING_NAME"',
        `"binding": "${bindingName}"`
      );
      changed = true;
    }

    if (updated.includes('"database_name": "YOUR_DB_NAME"')) {
      updated = updated.replace(
        '"database_name": "YOUR_DB_NAME"',
        `"database_name": "${databaseName}"`
      );
      changed = true;
    }

    if (updated.includes('"database_id": "YOUR_DB_ID"')) {
      updated = updated.replace(
        '"database_id": "YOUR_DB_ID"',
        `"database_id": "${databaseId}"`
      );
      changed = true;
    }

    if (changed) {
      await fs.writeFile(configPath, updated);
      console.log('Updated wrangler.jsonc with your D1 configuration.');
    } else {
      console.log(
        'wrangler.jsonc already contains D1 configuration. Please verify it is correct.'
      );
    }
  } catch (error) {
    console.warn(
      'Could not update wrangler.jsonc automatically. Please ensure it contains the correct D1 binding information.'
    );
  }
}

async function setupCloudflareD1(account: AccountInfo): Promise<D1SetupResult> {
  console.log('Step 3: Setting up Cloudflare D1...');
  console.log(
    `Using Cloudflare account ${formatAccount(account)}.`
  );

  const hasExistingDb = (
    await question(
      'Do you already have a Cloudflare D1 database? (y/n): '
    )
  )
    .trim()
    .toLowerCase();

  let databaseId: string;
  let databaseName: string;

  if (hasExistingDb !== 'y') {
    let desiredName = '';
    while (!desiredName) {
      desiredName = await question('Enter a name for the new D1 database: ');
      if (!desiredName) {
        console.log('A database name is required.');
      }
    }

    console.log(`Creating Cloudflare D1 database "${desiredName}"...`);

    const wranglerEnv = {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: account.id,
      CF_ACCOUNT_ID: account.id,
    };

    try {
      const { stdout, stderr } = await execAsync(
        `pnpm wrangler d1 create ${desiredName}`,
        { env: wranglerEnv }
      );
      const combinedOutput = [stdout, stderr].filter(Boolean).join('\n');
      const result = parseD1CreateResult(combinedOutput, desiredName);
      if (!result) {
        throw new Error('Could not parse Wrangler output.');
      }
      databaseId = result.id;
      databaseName = result.name;
      console.log(
        `Created D1 database "${databaseName}" (${databaseId}).`
      );
    } catch (error) {
      const stdout = getStdout(error);
      const stderr = getStderr(error);
      const errorMessage = error instanceof Error ? error.message : '';
      const combinedOutput = [stdout, stderr, errorMessage]
        .map((value) => stripAnsi(value).trim())
        .filter(Boolean)
        .join('\n');

      console.error('Failed to create Cloudflare D1 database automatically.');
      if (combinedOutput) {
        console.error(combinedOutput);
      }
      console.log(
        `You can create one manually with: pnpm wrangler d1 create ${desiredName}`
      );
      console.log(
        'We will continue by using an existing D1 database. Enter the details below.'
      );

      const manualDetails = await promptForExistingDatabaseDetails({
        defaultName: desiredName,
      });
      databaseId = manualDetails.databaseId;
      databaseName = manualDetails.databaseName;
    }
  } else {
    const manualDetails = await promptForExistingDatabaseDetails();
    databaseName = manualDetails.databaseName;
    databaseId = manualDetails.databaseId;
  }

  let bindingName = (
    await question(
      'Enter the Worker binding name you want to use for D1 (default: DB): '
    )
  ).trim();

  if (!bindingName) {
    bindingName = 'DB';
  }

  console.log(
    'To run Drizzle migrations via the D1 HTTP driver you will need a Cloudflare API token with the "Account.D1:Edit" permission.'
  );
  console.log(
    'Create one at: https://dash.cloudflare.com/profile/api-tokens'
  );

  let apiToken = (
    await question(
      'Enter your Cloudflare API token (press enter to skip for now): '
    )
  ).trim();

  if (!apiToken) {
    console.log(
      'Skipping API token. Remember to set CLOUDFLARE_D1_API_TOKEN before running migrations.'
    );
  }

  await updateWranglerConfig({ bindingName, databaseId, databaseName });

  return {
    databaseId,
    databaseName,
    bindingName,
    apiToken,
  };
}

async function getStripeSecretKey(): Promise<string> {
  console.log('Step 4: Getting Stripe Secret Key');
  console.log(
    'You can find your Stripe Secret Key at: https://dashboard.stripe.com/test/apikeys'
  );
  return question('Enter your Stripe Secret Key: ');
}

async function createStripeWebhook(): Promise<string> {
  console.log('Step 5: Creating Stripe webhook...');
  try {
    const { stdout } = await execAsync('stripe listen --print-secret');
    const match = stdout.match(/whsec_[a-zA-Z0-9]+/);
    if (!match) {
      throw new Error('Failed to extract Stripe webhook secret');
    }
    console.log('Stripe webhook created.');
    return match[0];
  } catch (error) {
    console.error(
      'Failed to create Stripe webhook. Check your Stripe CLI installation and permissions.'
    );
    if (os.platform() === 'win32') {
      console.log(
        'Note: On Windows, you may need to run this script as an administrator.'
      );
    }
    throw error;
  }
}

function generateAuthSecret(): string {
  console.log('Step 6: Generating AUTH_SECRET...');
  return crypto.randomBytes(32).toString('hex');
}

async function writeEnvFile(envVars: Record<string, string>) {
  console.log('Step 7: Writing environment variables to .env');
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('\n');

  await fs.writeFile(path.join(process.cwd(), '.env'), `${envContent}\n`);
  console.log('.env file created with the necessary variables.');
}

async function main() {
  await checkStripeCLI();

  const account = await checkWranglerCLI();
  const {
    databaseId,
    databaseName,
    bindingName,
    apiToken,
  } = await setupCloudflareD1(account);
  const STRIPE_SECRET_KEY = await getStripeSecretKey();
  const STRIPE_WEBHOOK_SECRET = await createStripeWebhook();
  const BASE_URL = 'http://localhost:3000';
  const AUTH_SECRET = generateAuthSecret();

  await writeEnvFile({
    CLOUDFLARE_ACCOUNT_ID: account.id,
    CLOUDFLARE_D1_DATABASE_ID: databaseId,
    CLOUDFLARE_D1_DATABASE_NAME: databaseName,
    CLOUDFLARE_D1_BINDING: bindingName,
    CLOUDFLARE_D1_API_TOKEN: apiToken,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    BASE_URL,
    AUTH_SECRET,
  });

  console.log('🎉 Setup completed successfully!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
