import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	notices: [] as string[],
	requestUrl: vi.fn(),
}));

vi.mock('obsidian', () => ({
	Notice: class {
		constructor(message: string) {
			mocks.notices.push(message);
		}
	},
	requestUrl: mocks.requestUrl,
}));

import { getDriveAgent, refreshAccessToken } from '../helpers/requests';

const response = (status: number, json: unknown = {}, text = '') => ({
	status,
	headers: {},
	arrayBuffer: new ArrayBuffer(0),
	json,
	text,
});

const createPlugin = () => ({
	accessToken: { token: '', expiresAt: 0 },
	settings: {
		refreshToken: 'saved-token',
		clientId: 'custom-client-id',
		clientSecret: 'custom-client-secret',
	},
	saveSettings: vi.fn(async () => undefined),
});

describe('refreshAccessToken', () => {
	beforeEach(() => {
		mocks.notices.length = 0;
		mocks.requestUrl.mockReset();
	});

	it.each([400, 401, 403])(
		'keeps credentials when a token is rejected with HTTP %s',
		async (status) => {
			mocks.requestUrl.mockResolvedValue(response(status));
			const plugin = createPlugin();
			plugin.accessToken = { token: 'cached-access', expiresAt: 1234 };

			await refreshAccessToken(plugin as never);

			expect(plugin.settings.refreshToken).toBe('saved-token');
			expect(plugin.accessToken).toEqual({
				token: 'cached-access',
				expiresAt: 1234,
			});
			expect(plugin.saveSettings).not.toHaveBeenCalled();
		},
	);

	it.each([429, 500, 503])(
		'keeps the token after transient HTTP %s',
		async (status) => {
			mocks.requestUrl.mockResolvedValue(response(status));
			const plugin = createPlugin();

			await refreshAccessToken(plugin as never);

			expect(plugin.settings.refreshToken).toBe('saved-token');
			expect(plugin.saveSettings).not.toHaveBeenCalled();
			expect(mocks.notices.at(-1)).toContain('please try again');
		},
	);

	it('does not clear the saved token when a replacement token is rejected', async () => {
		mocks.requestUrl.mockResolvedValue(response(401));
		const plugin = createPlugin();

		await refreshAccessToken(plugin as never, 'replacement-token');

		expect(plugin.settings.refreshToken).toBe('saved-token');
		expect(plugin.accessToken).toEqual({ token: '', expiresAt: 0 });
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it('keeps the token after a network failure', async () => {
		mocks.requestUrl.mockRejectedValue(new Error('offline'));
		const plugin = createPlugin();

		await refreshAccessToken(plugin as never);

		expect(plugin.settings.refreshToken).toBe('saved-token');
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it('stores a successful access token and expiry', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(1_000);
		mocks.requestUrl.mockResolvedValue(
			response(200, { access_token: 'access', expires_in: 3600 }),
		);
		const plugin = createPlugin();

		await expect(refreshAccessToken(plugin as never)).resolves.toEqual({
			token: 'access',
			expiresAt: 3_601_000,
		});
		expect(mocks.requestUrl).toHaveBeenCalledWith(
			{
				url: 'https://oauth2.googleapis.com/token',
				method: 'POST',
				contentType: 'application/x-www-form-urlencoded',
				body: new URLSearchParams({
					client_id: 'custom-client-id',
					client_secret: 'custom-client-secret',
					grant_type: 'refresh_token',
					refresh_token: 'saved-token',
				}).toString(),
				throw: false,
			},
		);
	});

	it.each([
		['client ID', 'clientId'],
		['client secret', 'clientSecret'],
	] as const)(
		'sends nothing when the %s is missing',
		async (_label, key) => {
			const plugin = createPlugin();
			plugin.settings[key] = '  ';

			await expect(
				refreshAccessToken(plugin as never, 'replacement-token'),
			).resolves.toBeUndefined();

			expect(mocks.requestUrl).not.toHaveBeenCalled();
			expect(mocks.notices.at(-1)).toContain('client ID and client secret');
		},
	);

	it('trims pasted credentials before sending them to Google', async () => {
		mocks.requestUrl.mockResolvedValue(
			response(200, { access_token: 'access', expires_in: 3600 }),
		);
		const plugin = createPlugin();
		plugin.settings.clientId = ' custom-client-id\n';
		plugin.settings.clientSecret = 'custom-client-secret ';

		await refreshAccessToken(plugin as never, ' pasted-token ');

		expect(mocks.requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://oauth2.googleapis.com/token',
				body: new URLSearchParams({
					client_id: 'custom-client-id',
					client_secret: 'custom-client-secret',
					grant_type: 'refresh_token',
					refresh_token: 'pasted-token',
				}).toString(),
			}),
		);
	});
});

describe('getDriveAgent', () => {
	it('adds authorization and serializes JSON requests', async () => {
		mocks.requestUrl.mockResolvedValue(response(200, { id: 'file-id' }));
		const plugin = createPlugin();
		plugin.accessToken = {
			token: 'access-token',
			expiresAt: Date.now() + 3_600_000,
		};

		const result = await getDriveAgent(plugin as never)
			.post('drive/v3/files', { json: { name: 'note.md' } })
			.json<{ id: string }>();

		expect(result).toEqual({ id: 'file-id' });
		expect(mocks.requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://www.googleapis.com/drive/v3/files',
				method: 'POST',
				headers: { Authorization: 'Bearer access-token' },
				body: '{"name":"note.md"}',
				contentType: 'application/json',
				throw: false,
			}),
		);
	});
});
