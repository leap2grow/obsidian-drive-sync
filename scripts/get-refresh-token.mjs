// Creates a Google refresh token for this plugin without any third-party website.
//
// Usage:
//   node scripts/get-refresh-token.mjs [client_secret.json] [--no-browser]
//
// Pass the JSON file downloaded when creating the Desktop app OAuth client, or
// leave it out to type the client ID and secret. The script listens on
// 127.0.0.1 for Google's redirect and only talks to Google's own endpoints.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 5 * 60_000;

const readClient = async (jsonPath) => {
	if (jsonPath) {
		const json = JSON.parse(await readFile(jsonPath, 'utf8'));
		const client = json.installed ?? json.web ?? json;
		if (!client.client_id || !client.client_secret) {
			throw new Error(`${jsonPath} has no client_id and client_secret.`);
		}
		return { clientId: client.client_id, clientSecret: client.client_secret };
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const clientId = (await rl.question('Client ID: ')).trim();
		const clientSecret = (await rl.question('Client secret: ')).trim();
		if (!clientId || !clientSecret) {
			throw new Error('Both the client ID and client secret are required.');
		}
		return { clientId, clientSecret };
	} finally {
		rl.close();
	}
};

const openBrowser = (url) => {
	const [command, args] =
		process.platform === 'win32'
			? ['rundll32', ['url.dll,FileProtocolHandler', url]]
			: process.platform === 'darwin'
				? ['open', [url]]
				: ['xdg-open', [url]];
	spawn(command, args, { stdio: 'ignore', detached: true })
		.on('error', () => undefined)
		.unref();
};

const waitForCode = (server, redirectUri, state) =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error('Timed out after 5 minutes waiting for Google sign-in.')),
			TIMEOUT_MS,
		);

		server.on('request', (req, res) => {
			const params = new URL(req.url ?? '/', redirectUri).searchParams;
			if (!params.has('code') && !params.has('error')) {
				res.writeHead(404).end();
				return;
			}

			const error =
				params.get('state') !== state
					? 'The response did not match this sign-in attempt.'
					: params.get('error')
						? `Google returned an error: ${params.get('error')}`
						: !params.get('scope')?.split(' ').includes(SCOPE)
							? 'Google Drive access was not granted. Allow the Drive permission on the consent screen.'
							: undefined;

			res.writeHead(error ? 400 : 200, {
				'Content-Type': 'text/plain; charset=utf-8',
			}).end(
				error
					? `${error}\n\nYou can close this tab.`
					: 'Signed in. Go back to the terminal; you can close this tab.',
			);
			clearTimeout(timer);
			if (error) reject(new Error(error));
			else resolve(params.get('code'));
		});
	});

const exchangeCode = async ({ clientId, clientSecret }, code, redirectUri, verifier) => {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			code_verifier: verifier,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		}),
	});
	const tokens = await response.json();
	if (!response.ok) {
		throw new Error(
			`Token exchange failed: ${tokens.error} ${tokens.error_description ?? ''}`.trim(),
		);
	}
	if (!tokens.refresh_token) {
		throw new Error(
			'Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and run this script again.',
		);
	}
	return tokens.refresh_token;
};

const main = async () => {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		console.log(
			'Usage: node scripts/get-refresh-token.mjs [client_secret.json] [--no-browser]',
		);
		return;
	}
	const client = await readClient(args.find((arg) => !arg.startsWith('--')));

	const verifier = randomBytes(32).toString('base64url');
	const state = randomBytes(16).toString('base64url');
	const server = createServer();
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

	try {
		const redirectUri = `http://127.0.0.1:${server.address().port}`;
		const authUrl = `${AUTH_URL}?${new URLSearchParams({
			client_id: client.clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: SCOPE,
			access_type: 'offline',
			prompt: 'consent',
			state,
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256',
		})}`;

		console.log('\nSign in with the Google account whose Drive should hold the vault:\n');
		console.log(authUrl);
		console.log('\nWaiting for Google sign-in (5 minutes)...');
		if (!args.includes('--no-browser')) openBrowser(authUrl);

		const code = await waitForCode(server, redirectUri, state);
		const refreshToken = await exchangeCode(client, code, redirectUri, verifier);

		console.log('\nRefresh token:\n');
		console.log(refreshToken);
		console.log(
			'\nSave it in your password manager. In the plugin settings, enter the client ID and client secret first, then this refresh token.',
		);
	} finally {
		server.close();
		server.closeAllConnections();
	}
};

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
});
