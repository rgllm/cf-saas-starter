import 'dotenv/config'

import { and, eq } from 'drizzle-orm'
import { drizzle as drizzleRemote } from 'drizzle-orm/sqlite-proxy'

import { stripe } from '../payments/stripe'
import * as schema from './schema'
import { hashPassword } from '@/lib/auth/session'
import { BOOTSTRAP_STATEMENTS } from './bootstrap'

const { users, teams, teamMembers } = schema

type RemoteMethod = 'run' | 'all' | 'values' | 'get'

type D1ApiResponse = {
	success?: boolean
	errors?: { code?: unknown; message?: unknown }[]
	result?: { results?: unknown }[]
}

function getRequiredEnv(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`Missing required environment variable ${name}`)
	}
	return value
}

const accountId = getRequiredEnv('CLOUDFLARE_ACCOUNT_ID')
const databaseId = getRequiredEnv('CLOUDFLARE_D1_DATABASE_ID')
const token = getRequiredEnv('CLOUDFLARE_D1_API_TOKEN')
const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`

async function remoteCallback(
	sql: string,
	params: any[],
	method: RemoteMethod
): Promise<{ rows: unknown[] }> {
	const response = await fetch(
		`${baseUrl}/${method === 'values' ? 'raw' : 'query'}`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ sql, params }),
		}
	)

	const data = (await response.json()) as D1ApiResponse
	if (!response.ok || !data.success) {
		const errors: string =
			Array.isArray(data.errors) && data.errors.length > 0
				? data.errors
						.map((error) => {
							const code =
								typeof error?.code === 'number' ? error.code : 'unknown'
							const message =
								typeof error?.message === 'string'
									? error.message
									: 'Unknown error'
							return `${code}: ${message}`
						})
						.join('\n')
				: `Unexpected response from Cloudflare D1 API (${response.status})`
		throw new Error(errors)
	}

	const results = data.result?.[0]?.results
	const rows = Array.isArray(results)
		? results
		: (typeof results === 'object' &&
				results !== null &&
				Array.isArray((results as { rows?: unknown[] }).rows)
				? (results as { rows: unknown[] }).rows
				: [])

	return { rows }
}

const db = drizzleRemote(remoteCallback, { schema })

async function createStripeProducts() {
	console.log('Creating Stripe products and prices...')

	const baseProduct = await stripe.products.create({
		name: 'Base',
		description: 'Base subscription plan',
	})

	await stripe.prices.create({
		product: baseProduct.id,
		unit_amount: 800,
		currency: 'usd',
		recurring: {
			interval: 'month',
			trial_period_days: 7,
		},
	})

	const plusProduct = await stripe.products.create({
		name: 'Plus',
		description: 'Plus subscription plan',
	})

	await stripe.prices.create({
		product: plusProduct.id,
		unit_amount: 1200,
		currency: 'usd',
		recurring: {
			interval: 'month',
			trial_period_days: 7,
		},
	})

	console.log('Stripe products and prices created successfully.')
}

async function seed() {
	const email = 'test@test.com'
	const password = 'admin123'
	const passwordHash = await hashPassword(password)

	for (const statement of BOOTSTRAP_STATEMENTS) {
		await remoteCallback(statement, [], 'run')
	}

	let [user] = await db
		.select()
		.from(users)
		.where(eq(users.email, email))
		.limit(1)

	if (!user) {
		await db.insert(users).values({
			email,
			passwordHash,
			role: 'owner',
		})

		;[user] = await db
			.select()
			.from(users)
			.where(eq(users.email, email))
			.limit(1)
	}

	if (!user) {
		throw new Error('Failed to retrieve the seeded user.')
	}

	console.log('Initial user created.')

	const teamName = 'Test Team'
	let [team] = await db
		.select()
		.from(teams)
		.where(eq(teams.name, teamName))
		.limit(1)

	if (!team) {
		await db.insert(teams).values({
			name: teamName,
		})

		;[team] = await db
			.select()
			.from(teams)
			.where(eq(teams.name, teamName))
			.limit(1)
	}

	if (!team) {
		throw new Error('Failed to retrieve the seeded team.')
	}

	const [existingMembership] = await db
		.select()
		.from(teamMembers)
		.where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)))
		.limit(1)

	if (!existingMembership) {
		await db.insert(teamMembers).values({
			teamId: team.id,
			userId: user.id,
			role: 'owner',
		})
	}

	await createStripeProducts()
}

seed()
	.catch((error) => {
		console.error('Seed process failed:', error)
		process.exit(1)
	})
	.finally(() => {
		console.log('Seed process finished. Exiting...')
		process.exit(0)
	})
