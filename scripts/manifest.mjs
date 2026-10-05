// Builds the MV3 manifest.

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
      'notifications',
      'webRequest',
      'offscreen',
      'declarativeNetRequestWithHostAccess',
      'alarms',
      'contextMenus',
    ],
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
