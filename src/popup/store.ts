import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BgToPopup, PopupState, PopupToBg } from '../shared/messages';

async function currentTabId(fixed?: number): Promise<number> {
  if (fixed !== undefined) return fixed;
  const forced = new URLSearchParams(location.search).get('tab');
  if (forced) return Number(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? -1;
}

/** Live popup state pushed by the service worker over a long-lived port. */
export function useGrabby(fixedTab?: number) {
  const [state, setState] = useState<PopupState | null>(null);
  const port = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let disposed = false;
    let p: chrome.runtime.Port;
    const connect = async () => {
      const tabId = await currentTabId(fixedTab);
      if (disposed) return;
      p = chrome.runtime.connect({ name: 'popup' });
      port.current = p;
      p.onMessage.addListener((m: BgToPopup) => {
        if (m.type === 'state') setState(m.state);
      });
      // The service worker may restart: reconnect transparently.
      p.onDisconnect.addListener(() => {
        if (!disposed) setTimeout(connect, 150);
      });
      p.postMessage({ type: 'subscribe', tabId } satisfies PopupToBg);
    };
    void connect();
    // The side panel stays open while the user goes from tab to tab: it follows the one shown.
    const side = document.documentElement.hasAttribute('data-side') && fixedTab === undefined;
    let windowId: number | undefined;
    const follow = ({ tabId, windowId: w }: { tabId: number; windowId: number }) => {
      if (w === windowId) port.current?.postMessage({ type: 'subscribe', tabId } satisfies PopupToBg);
    };
    const moved = (tabId: number, change: { url?: string }, tab: chrome.tabs.Tab) => {
      if (change.url && tab.active && tab.windowId === windowId) port.current?.postMessage({ type: 'subscribe', tabId } satisfies PopupToBg);
    };
    if (side) {
      void chrome.windows.getCurrent().then((w) => (windowId = w.id));
      chrome.tabs.onActivated.addListener(follow);
      chrome.tabs.onUpdated.addListener(moved);
    }
    return () => {
      disposed = true;
      p?.disconnect();
      if (side) {
        chrome.tabs.onActivated.removeListener(follow);
        chrome.tabs.onUpdated.removeListener(moved);
      }
    };
  }, []);

  const send = useMemo(() => (msg: PopupToBg) => port.current?.postMessage(msg), []);
  return { state, send };
}
