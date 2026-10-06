// Builds the MV3 manifest.

/**
 * The public half of Grabby's key: it fixes the extension's id wherever its folder is (the
 * update helper only answers this id). Nothing is signed with it here.
 */
export const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqfBpV4xVYq559yE0aFOTefB7cwlQ6s4QQT6rOvDnsA+YObU7EiDhRjCePZ/R3q7xvSKsj4Hobzw/v5uwanLBfTZ4cyBLI2zJ7VsVKknoLQOJMa3LsLZEqKvOIu0NF2mINJYfTScMxy2dv6EUN8qq+ybgmIUha8r5BGniTtXQkbskxVCnl5CZeCBpux9kYbEm2I8NwifGpmMiaySLKpCXuY7UyLkWFn76NN9QkL2KxHqNxPxJClNV4dkI9wg6d+WHABPdqT+gVqXqtZlxFNI93ijWHiM4kPBhzMHnD61RIXNOs4Bc5NylCRDtjbQKGsO2D6njc0NAxbst9XfV4VciPQIDAQAB';

/** The id the browser gives Grabby, from its key. */
export async function extensionId() {
  const { createHash } = await import('node:crypto');
  const hex = createHash('sha256').update(Buffer.from(EXTENSION_KEY, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

/** The update helper's name for the browser (native messaging). */
export const UPDATER_HOST = 'com.grabby.updater';

const ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };

/** @param {string} version */
export function buildManifest(version) {
  return {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: 'Grabby',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    version,
    key: EXTENSION_KEY,
    minimum_chrome_version: '111',
    icons: ICONS,
    action: {
      default_popup: 'popup.html',
      default_title: '__MSG_extName__',
      default_icon: { 16: ICONS[16], 32: ICONS[32] },
    },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: [
      'storage',
      'unlimitedStorage',
      'downloads',
      // "Open the file" from the history or a notification.
      'downloads.open',
      'notifications',
      'webRequest',
      'offscreen',
      'declarativeNetRequestWithHostAccess',
      'alarms',
      'contextMenus',
    ],
    // Asked for when "Update" is first clicked: talking to the update helper.
    optional_permissions: ['nativeMessaging'],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+G' }, description: '__MSG_cmdOpen__' },
      'download-best': { suggested_key: { default: 'Alt+Shift+D' }, description: '__MSG_cmdDownload__' },
    },
    host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['hook.js'],
        run_at: 'document_start',
        all_frames: true,
        world: 'MAIN',
      },
      {
        matches: ['<all_urls>'],
        js: ['scanner.js'],
        run_at: 'document_start',
        all_frames: true,
      },
    ],
    web_accessible_resources: [
      { resources: ['capture-sink.html'], matches: ['<all_urls>'], use_dynamic_url: true },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  };
}
