// Builds the MV3 manifest for a given target ('store' | 'github').

export const YOUTUBE_MATCHES = [
  '*://youtube.com/*',
  '*://*.youtube.com/*',
  '*://youtu.be/*',
  '*://youtube-nocookie.com/*',
  '*://*.youtube-nocookie.com/*',
];

const ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };

/** @param {'store'|'github'} target @param {string} version */
export function buildManifest(target, version) {
  const store = target === 'store';
  const exclude = store ? { exclude_matches: YOUTUBE_MATCHES } : {};
  return {
    manifest_version: 3,
    name: store ? '__MSG_extName__' : '__MSG_extNameGithub__',
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
      'webRequest',
      'offscreen',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['hook.js'],
        run_at: 'document_start',
        all_frames: true,
        world: 'MAIN',
        ...exclude,
      },
      {
        matches: ['<all_urls>'],
        js: ['scanner.js'],
        run_at: 'document_start',
        all_frames: true,
        ...exclude,
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
