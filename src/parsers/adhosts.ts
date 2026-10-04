import { hostOf } from './url';

/**
 * Video ad servers and ad-tech CDNs. Media served from these is an ad creative, never
 * the video the user is watching, so it is not listed.
 */
const AD_HOSTS = [
  'doubleclick.net',
  '2mdn.net',
  'googlesyndication.com',
  'googleadservices.com',
  'imasdk.googleapis.com',
  'adservice.google.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'adnxs-simple.com',
  'adnxs.net',
  'adsafeprotected.com',
  'doubleverify.com',
  'celtra.com',
  'smartclip.net',
  'improvedigital.com',
  'viously.com',
  'adsrvr.org',
  'advertising.com',
  'adform.net',
  'adition.com',
  'criteo.com',
  'criteo.net',
  'fwmrm.net',
  'freewheel.tv',
  'innovid.com',
  'moatads.com',
  'pubmatic.com',
  'rubiconproject.com',
  'smartadserver.com',
  'spotxchange.com',
  'spotx.tv',
  'springserve.com',
  'springserve.net',
  'teads.tv',
  'tremorhub.com',
  'yieldmo.com',
  'serving-sys.com',
  'flashtalking.com',
  'adcolony.com',
  'unrulymedia.com',
  'outbrain.com',
  'taboola.com',
  'jwpltx.com',
  'vidoomy.com',
  'sascdn.com',
  'stickyadstv.com',
  'ads.dailymotion.com',
];

export function isAdUrl(url: string): boolean {
  const host = hostOf(url).toLowerCase();
  if (!host) return false;
  if (AD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  // Generic ad subdomains: ads.example.com, ad.example.com, adserver…, vast…
  return /^(ads?|adserver|adserving|vast|vpaid|preroll)\d*\./.test(host);
}
