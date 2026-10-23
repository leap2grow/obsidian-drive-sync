# Drive Sync (leap2grow)

A personal fork of [Google Drive Sync](https://github.com/RichardX366/Obsidian-Google-Drive) by Richard Xiong. It syncs an Obsidian vault with Google Drive through **your own Google OAuth client**. There is no third-party website or token server.

Based on upstream 3.1.1 (commit `1922dd0`).

## What's different from upstream

- **Only talks to Google.** The plugin contacts `oauth2.googleapis.com` (access tokens), `www.googleapis.com` (Drive API) and `www.google.com/generate_204` (connection check). The fallback to `ogd-server.richardxiong.com` and the "Access token endpoint" setting are removed.
- **Your own client is required.** Without a client ID and client secret, the plugin does not start and never sends the refresh token anywhere.
- **Settings order:** Client ID, Client secret, Refresh token. The refresh token is checked against Google as soon as you enter it, so the client must be set first.
- **Own plugin ID** (`leap2grow-drive-sync`), so Obsidian's built-in updater never replaces this build with the upstream plugin.
- **`scripts/get-refresh-token.mjs`** replaces the sign-in on the upstream website.

## Setup

### 1. Google Cloud (once)

1. In the [Google Cloud console](https://console.cloud.google.com), create a project and enable the **Google Drive API**.
2. Under **Google Auth Platform**, configure the consent screen:
    - **Audience:** **Internal** if your account is in a Google Workspace organization. Otherwise **External**, with publishing status **In production** (in Testing, refresh tokens expire after 7 days).
    - **Data Access:** only `https://www.googleapis.com/auth/drive.file`.
3. Under **Clients**, create a client of type **Desktop app** and download the JSON. Google only shows the secret when you create the client.

### 2. Refresh token (once, on a computer with Node.js 18+)

```bash
node scripts/get-refresh-token.mjs path/to/client_secret_xxx.json
```

Leave out the path to type the client ID and secret instead. Add `--no-browser` to copy the sign-in link yourself.

Sign in with the Google account whose Drive should hold the vault, and allow the Drive permission. The script prints the refresh token.

Store the client ID, client secret and refresh token in your password manager, then delete the JSON file. You use the same three values on every device.

### 3. Install the plugin (every device)

Use [BRAT](https://github.com/TfTHacker/obsidian42-brat), which works on Windows, macOS, iOS and Android:

1. **Settings → Community plugins → Browse**, then install and enable **BRAT**.
2. **BRAT → Add beta plugin**, then enter `leap2grow/obsidian-drive-sync`.
3. Enable **Drive Sync (leap2grow)** under **Settings → Community plugins**.

On desktop you can also copy `main.js`, `manifest.json` and `styles.css` from a [release](https://github.com/leap2grow/obsidian-drive-sync/releases) to `<vault>/.obsidian/plugins/leap2grow-drive-sync/`.

### 4. Connect (every device)

- Use an **empty vault with exactly the same name** on every device. The plugin finds the Drive folder by vault name.
- Keep the vault **out of OneDrive, iCloud and Google Drive for desktop**. Two sync tools on one folder will corrupt it. On iPhone, store the vault "On My iPhone".
- In the plugin settings, enter **Client ID**, then **Client secret**, then **Refresh token**.
- On the first device, add your existing notes **through Obsidian** after connecting, then push.

The plugin syncs its own settings file, which includes these three values, to the vault folder in your Drive. Don't share that folder.

## Releasing

```bash
npm version patch   # updates manifest.json, versions.json and creates a tag without a "v"
git push --follow-tags
```

The release workflow runs the tests, builds the plugin and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`. BRAT picks it up from there.

## Pulling in upstream fixes

```bash
git fetch upstream
git merge upstream/master
```

Review the diff before releasing, especially new network requests. When resolving conflicts, keep this fork's plugin ID, name, version and token handling.

## Caution

**Always back up your vault before using this plugin.**

## Use

- After setup, the plugin pulls changes from Google Drive once when Obsidian finishes opening the vault.
    - This sync is from Google Drive to Obsidian (pulling cloud files).
    - The plugin prioritizes unsynced local changes except for local file deletions (cloud file creation/modification will overwrite a local deletion).
    - You can pull by running the `Pull from Google Drive` command.
    - Pulling new plugins/configurations may require a restart of Obsidian.
- To sync local changes to Google Drive, select the sync button on the ribbon or run the `Push to Google Drive` command.
    - This pulls changes before pushing changes to Google Drive.
    - Push before closing Obsidian or switching devices so Google Drive stays up to date.
- Enable `Automatically push changes` in the plugin settings to push one minute after the most recent local file change. This is off by default.
- To set your local vault to the Google Drive state, run the `Reset local vault to Google Drive` command.
- On phones, wait for the sync to finish before switching apps. iOS and Android suspend apps in the background, and an interrupted sync can corrupt data.

## Notes

- Do **not** manually upload files into the vault's Google Drive folder or use another Google Drive sync tool on it.
    - The plugin can only see files it created (`drive.file` scope), so this will likely break syncing and can cause data loss.
- Do **not** change vault files outside the Obsidian app.
    - The plugin tracks changes through the Obsidian API and cannot see changes made elsewhere.
- If you delete or rename a file that has **no** file extension, sync before creating a folder with the exact same path (or the other way around).
- When activating the plugin on a new vault, make sure the vault is empty.
    - To bring in existing notes, activate the plugin first, then copy them in **through the Obsidian app**.
- Edit on one device at a time and sync before switching devices.
    - Conflicts are resolved automatically in favor of the local file. There is no manual conflict resolution.
- Sync with a stable internet connection. Closing the app or losing connection while syncing can corrupt data.
- Do **not** change the Obsidian configuration folder.
- Vault files and synced configuration files are sent directly between your device and the Google Drive API.

## Multiple vaults

- The Google Drive folder created on setup is the vault's root folder and is tagged with the vault name.
    - You can move, rename or color it within the same Google Drive account without affecting syncing.
    - Each file in the vault is also tagged with the vault name in Google Drive's file properties.
- Each vault connects to the Google Drive folder with the same vault name.
    - Devices that sync the same vault must use the same vault name.
- You can have several vaults per Google account by giving local vaults different names.
    - Do **not** rename a local vault that is syncing. Make a new vault, sync it, and move your files over.

## New devices

- To avoid a long first download, you can copy the vault folder from Google Drive to the new device and open it as a vault.
- Otherwise the plugin downloads everything from Google Drive on its first sync, which can take a long time for large vaults.

## License

0BSD, see [LICENSE](LICENSE). Original work copyright Richard Xiong.
