<p align="center">
  <img src="public/icons/icon-128.png" width="96" height="96" alt="" />
</p>

<h1 align="center">Grabby</h1>

<p align="center">
  Repère les vidéos d'une page et les enregistre en un clic.<br />
  Chrome · Brave · Edge · Opera · Vivaldi · Arc — tout navigateur Chromium 111+.
</p>

---

## Ce que fait Grabby

- **Détection automatique** sur n'importe quel site : fichiers directs (MP4, WebM, MP3…),
  flux **HLS** (`.m3u8`) et **DASH** (`.mpd`), y compris dans les lecteurs intégrés (iframes).
- **Mode capture** pour les lecteurs qui ne publient aucun fichier (lecteurs `blob:` / MSE) :
  instantané pour les vidéos déjà chargées, sinon enregistrement accéléré de la lecture.
- **Choix de la qualité** et du **format** dans deux listes : vidéo MP4 (par défaut), MKV,
  WebM, MOV, AVI, TS ; audio seul M4A, MP3, Opus, OGG, FLAC, WAV. L'image n'est jamais
  réencodée : seuls les formats compatibles avec la source sont proposés.
- Progression en direct dans la popup **et sur l'icône** (42 %, puis ✓), **bulle** dans la
  page et notification à la fin, annulation, nouvel essai, bouton **retélécharger**,
  **historique** des 50 derniers téléchargements.
- **Tri des vraies vidéos** : chaque fichier est vérifié à partir de ses premiers octets
  (vraie vidéo, durée, chiffrement) ; pages d'erreur, publicités, aperçus au survol,
  morceaux de flux, doublons et extraits de moins de 2 s sont écartés. Les vidéos que la
  page annonce sans les lire (métadonnées, liens directs) sont aussi trouvées. Vrais titres et miniatures (métadonnées de la page,
  sinon une image de la vidéo).
- Assemblage par **ffmpeg.wasm embarqué** (aucun code distant), sans réencodage quand c'est possible.
- Interface minimaliste **FR / EN**, thème **clair / sombre / auto**.

## Ce que Grabby ne fait pas (et pourquoi)

| | |
|---|---|
| **DRM et chiffrement** | Netflix, Prime Video, Disney+, myCanal, contenus payants… Contourner une mesure technique de protection est illégal (art. L.335-3-1 CPI, directive 2001/29/CE, DMCA §1201). Grabby détecte ces flux (EME, `EXT-X-KEY`, `ContentProtection`) et les affiche « Protégé ». |
| **Directs (live)** | Hors périmètre de la v1. |

> Télécharge uniquement des vidéos que tu as le droit de conserver (les tiennes, sous licence
> libre ou avec l'accord de l'auteur) et respecte les conditions d'utilisation des sites.

## YouTube (expérimental)

Grabby peut enregistrer les vidéos YouTube dans un lecteur caché : la vidéo que tu
regardes n'est pas touchée. Fonction fragile, et contraire aux conditions de YouTube :
à tes risques.

## Installation

**Depuis une release :** télécharge le zip `grabby-…` dans les
[Releases](../../releases), décompresse-le, puis :

1. ouvre `chrome://extensions` (ou `brave://extensions`, `edge://extensions`, `opera://extensions`) ;
2. active le **mode développeur** ;
3. clique **Charger l'extension non empaquetée** et choisis le dossier décompressé.

**Depuis les sources :**

```bash
npm ci
npm run build      # → dist/
npm run zip        # → release/*.zip
```

## Développement

```bash
npm test            # tests unitaires (Vitest) : analyseurs HLS/DASH, registre, plans, ffmpeg…
npm run typecheck
npm run build && npm run test:e2e   # E2E Playwright : vraie extension dans Chromium
npm run fixtures    # régénère les médias de test (ffmpeg système requis)
npm run icons       # régénère les icônes
```

Les tests E2E chargent l'extension dans Chromium et vérifient, sur un serveur local :
fichier direct, fichier protégé par Referer, HLS (choix de qualité), HLS audio seul, DASH
(audio + vidéo séparés), HLS chiffré refusé, MP4 chiffré (DRM) affiché « Protégé »,
aperçus au survol écartés, capture d'un lecteur MSE (MP4 et WebM → MP4), HLS → MOV avec
bulle de fin et ✓ sur l'icône, son en FLAC, liens directs, fichier sans extension ni type,
segments de flux ignorés, pages restreintes.

Vérifications sur de vrais sites (Brave, sans fenêtre visible) : `node test/live/live.mjs <url>`,
`node test/live/yt-download.mjs <url> 1080p mp4`, `node test/live/popup-shot.mjs <url> nom`.
`HEADED=1` affiche le navigateur.

## Architecture

```
page ─ hook.ts (MAIN)      DRM (EME), suivi MediaSource, capture
     └ scanner.ts          <video>, titre, miniature, manifestes (Performance API)
              │
service worker ─ detector  webRequest (lecture seule) → classify
               ├ registry  médias par onglet (storage.session)
               ├ plan      choix variante / piste audio / format
               └ jobs      file d'attente, en-têtes Referer (DNR), downloads
              │
offscreen ─ fetcher        segments en parallèle, reprises, ordre garanti
          └ ffmpeg-worker  ffmpeg.wasm : remux MP4, fusion audio/vidéo, M4A/MP3
popup (Preact) ─ liste, qualité, progression, historique, réglages
```


## Licences

Code source sous licence **MIT** ([LICENSE](LICENSE)). Les paquets distribués embarquent
`ffmpeg-core` (**GPL-2.0-or-later**) : ils sont donc distribués dans leur ensemble sous GPL.
Détails : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
