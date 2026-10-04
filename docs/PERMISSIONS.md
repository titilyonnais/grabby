# What each permission is for

**Purpose:** detect the non-encrypted videos playing on the current page and let the
user save them as a file. Grabby never bypasses DRM or encryption:
encrypted HLS (`EXT-X-KEY` with a method other than `NONE`), DASH `ContentProtection` and any
use of Encrypted Media Extensions mark the media as protected and no download is offered.

| Permission | Why it is needed |
|---|---|
| `host_permissions: <all_urls>` | Videos can be served from any site and any CDN. Needed to observe media responses in every tab, to read HLS/DASH manifests and to fetch the segments the user asked to download. |
| `webRequest` | Read-only observation of response headers (`Content-Type`, `Content-Length`) to recognize video files and streaming manifests. No request is blocked or modified through this API. For a detected file, the extension reads its first 256 KB to check that it really is a video, how long it lasts and whether it is encrypted (encrypted files are shown as protected). |
| `declarativeNetRequestWithHostAccess` | Many CDNs reject requests without the page's `Referer`/`Origin`. Temporary **session** rules restore these two headers **only for requests made by the extension itself** (`tabIds: [-1]`) while a user-initiated download runs; they are removed right after. Browsing traffic is never modified. |
| `notifications` | One system notification when a download the user started finishes or fails (can be turned off in the settings). Clicking it shows the file in its folder. |
| `downloads` | Save the resulting file through the browser's download manager, show it in its folder, report progress. |
| `offscreen` | A hidden extension page downloads stream segments and runs ffmpeg.wasm (bundled in the package) to assemble them into an MP4/M4A/MP3 file, then hands a Blob URL to the download manager. Service workers cannot hold Blob URLs or run this workload. |
| `storage` | Settings, download history (max 50 entries, user-clearable) and per-tab detection state (session storage). |
| `unlimitedStorage` | Capture mode records a player's buffered data in the extension's IndexedDB before assembly; recordings of long videos can exceed the default quota. Data is deleted as soon as the file is saved or the capture is canceled. |
| Content scripts on `<all_urls>` | `scanner.js` lists `<video>` elements and the page title/thumbnail (page metadata, poster, or a small still of the playing video kept on the device); `hook.js` (MAIN world) detects DRM usage and tracks Media Source buffers so a capture can be performed when — and only when — the user clicks "Record playback". |
| `web_accessible_resources: capture-sink.html` | Hidden extension frame used during a capture to move recorded buffers into extension storage without copying them through messaging (`use_dynamic_url: true`). |
| CSP `'wasm-unsafe-eval'` | Required to instantiate the bundled ffmpeg WebAssembly module. No remote code is loaded; there is no `eval` of strings. |

**Remote code:** none. All JavaScript and WebAssembly ship inside the package; the code is not
minified so it can be reviewed.

**Data use:** no data is collected or transmitted (see `PRIVACY.md`).
