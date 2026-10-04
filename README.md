<p align="center">
  <img src="public/icons/icon-128.png" width="96" height="96" alt="" />
</p>

<h1 align="center">Grabby</h1>

<p align="center">
  Repère les vidéos d'une page et les enregistre en un clic.<br />
  Chrome · Brave · Edge · Opera · Vivaldi · Arc — tout navigateur Chromium 111+.
</p>

<p align="center">
  <a href="https://github.com/titilyonnais/grabby/releases/latest"><img alt="Dernière version" src="https://img.shields.io/github/v/release/titilyonnais/grabby?label=version" /></a>
  <a href="https://github.com/titilyonnais/grabby/actions/workflows/ci.yml"><img alt="Tests" src="https://github.com/titilyonnais/grabby/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="Licence" src="https://img.shields.io/badge/licence-MIT-blue" /></a>
</p>

---

<!-- release:1.5.0 — mettre à jour ce bloc à chaque version (vérifié par npm run release:check) -->
## Nouveautés de la version 1.5.0

- **Nouvelle interface** : la vidéo ouverte s'affiche en **grande carte avec sa miniature**,
  les autres en lignes compactes ; cliquer sur une ligne la déplie en grand.
- **Tout est rond et harmonisé** : boutons, listes et barres en pilules, cartes aux
  arrondis assortis.
- **Animations à ressort** un peu cartoon partout où l'on agit (boutons, onglets,
  interrupteurs, menus, confettis à la fin d'un téléchargement), mode clair plus lisible.
- **Audit complet** et nombreux correctifs : Opus qui échouait sur la plupart des vidéos,
  gros fichiers convertis coupés au bout d'une minute, enregistrement mis en pause, Annuler
  qui laissait tourner la conversion, réglages qui s'annulaient en cliquant vite.
- **Chaque format vérifié** par de nouveaux tests de bout en bout (signature, conteneur et
  codecs de chaque fichier produit).

**Rappel de la 1.4.1** :
- Finitions de l'interface de la 1.4.0 et section « Fichiers » des réglages plus claire.

**Rappel de la 1.4.0** :
- **Suivi détaillé** : sous la barre de progression, la taille reçue et la taille totale
  (« 253 Mo / ≈ 601 Mo »), la **vitesse** (« 6,1 Mo/s ») et le **temps restant**.
- **Liste plus claire** : une ligne par vidéo, une seule carte ouverte à la fois. Un
  téléchargement en cours reste visible sur sa ligne même repliée.
- **Réglages en vraie page**, avec le **nom du fichier par cases à cocher** (Titre, Qualité,
  Site, Date) et un aperçu en direct.
- **Barres de défilement** redessinées, bien visibles et sans les flèches.
- **Corrigé** : saccade de l'icône en fin de téléchargement ; le dossier Grabby était ignoré
  quand le navigateur imposait sa fenêtre « Enregistrer sous » (maintenant détecté et
  expliqué).

**Rappel de la 1.3.0** :
- **Toutes les qualités d'un lecteur** dans une seule carte, la meilleure par défaut.
- **Réduire la qualité** : une vidéo en 4K peut être enregistrée en 720p, 480p… jusqu'à 144p
  (Grabby réduit l'image lui-même, c'est plus lent).
- **Résolution réelle** affichée, films au format cinéma nommés comme sur les lecteurs.
- **Corrigé** : fausses alertes « Protégé » et avertissement PlayReady dans les erreurs.

**Rappel de la 1.2.0** :
- **Popup stable**, qualité et format dans des listes déroulantes.
- **12 formats** : vidéo MP4, MKV, WebM, MOV, AVI, TS ; audio seul M4A, MP3, Opus, OGG,
  FLAC, WAV.
- **Suivi du téléchargement** : pourcentage sur l'icône, puis ✓, et une bulle
  « Téléchargement terminé » dans la page.
- **Détection plus fiable** : fichiers sans extension, vidéos annoncées par la page, liens
  directs ; plus de morceaux de flux ni de doublons.

Le détail de chaque version est dans le [journal des modifications](CHANGELOG.md).
<!-- /release -->

## Sommaire

- [Ce que fait Grabby](#ce-que-fait-grabby)
- [Ce que Grabby ne fait pas](#ce-que-grabby-ne-fait-pas-et-pourquoi)
- [YouTube (expérimental)](#youtube-expérimental)
- [Installation et mise à jour](#installation-et-mise-à-jour)
- [Utilisation](#utilisation)
- [Formats d'enregistrement](#formats-denregistrement)
- [Questions fréquentes](#questions-fréquentes)
- [Vie privée](#vie-privée)
- [Développement](#développement)
- [Versions et journal des modifications](#versions-et-journal-des-modifications)
- [Architecture](#architecture)
- [Licences](#licences)

## Ce que fait Grabby

- **Détection automatique** sur n'importe quel site, y compris dans les lecteurs intégrés
  (iframes) :
  - fichiers directs (MP4, WebM, MOV, MP3…), même sans extension ni type précis ;
  - flux **HLS** (`.m3u8`) et **DASH** (`.mpd`) ;
  - vidéos que la page annonce sans les avoir lues : métadonnées de partage, `contentUrl`
    schema.org, balises `<source>`, liens directs vers des fichiers.
- **Mode capture** pour les lecteurs qui ne publient aucun fichier (lecteurs `blob:`/MSE) :
  instantané pour les vidéos déjà chargées, sinon enregistrement accéléré de la lecture.
- **Tri des vraies vidéos** : chaque fichier est vérifié à partir de ses premiers octets
  (vraie vidéo, durée, chiffrement). Sont écartés :
  - les pages d'erreur et les publicités ;
  - les aperçus au survol et les extraits de moins de 2 secondes ;
  - les morceaux de flux et les doublons d'un même fichier.

  La vidéo en cours de lecture et les vidéos longues passent en tête de liste.
- **Qualité et format** au choix : 6 formats vidéo et 6 formats audio (voir
  [plus bas](#formats-denregistrement)). Toutes les qualités qu'un lecteur propose sont
  réunies dans une seule carte, avec la résolution réelle de chaque fichier.
- **Réduire la qualité** : les qualités plus petites que la source (jusqu'à 144p) peuvent
  être fabriquées par Grabby, même quand le site ne les propose pas.
- **Vrais titres et miniatures** : métadonnées de la page, sinon une image de la vidéo.
- **Suivi** : progression dans la popup et sur l'icône, bulle et notification à la fin,
  annulation, nouvel essai, bouton retélécharger, historique des 50 derniers
  téléchargements.
- Assemblage par **ffmpeg.wasm embarqué** : aucun code distant, rien n'est envoyé ailleurs.
- Interface **français / anglais**, thème **clair / sombre / auto**.

## Ce que Grabby ne fait pas (et pourquoi)

| | |
|---|---|
| **DRM et chiffrement** | Netflix, Prime Video, Disney+, Paramount+, myCanal, contenus payants… Contourner une mesure technique de protection est illégal (art. L.335-3-1 CPI, directive 2001/29/CE, DMCA §1201). Grabby détecte ces contenus (EME, `EXT-X-KEY`, `ContentProtection`, fichiers chiffrés) et les affiche « Protégé ». Pour regarder hors connexion, utilise le téléchargement intégré aux applications officielles. |
| **Directs (live)** | Les diffusions en direct sont signalées mais pas enregistrées. |
| **Réencodage pour changer de format** | Trop lent dans un navigateur : seuls les formats compatibles avec la source sont proposés. L'image n'est réencodée que si tu demandes une qualité plus petite (groupe « Réduire »). |

> Télécharge uniquement des vidéos que tu as le droit de conserver (les tiennes, sous licence
> libre ou avec l'accord de l'auteur) et respecte les conditions d'utilisation des sites.

## YouTube (expérimental)

Grabby peut enregistrer les vidéos YouTube dans un lecteur caché : la vidéo que tu
regardes n'est pas touchée. Fonction fragile, et contraire aux conditions de YouTube :
à tes risques.

## Installation et mise à jour

**Installer depuis une release**

1. Télécharge le zip `grabby-…` dans les
   [Releases](https://github.com/titilyonnais/grabby/releases/latest) et décompresse-le.
2. Ouvre `brave://extensions` (ou `chrome://extensions`, `edge://extensions`,
   `opera://extensions`).
3. Active le **mode développeur**.
4. Clique **Charger l'extension non empaquetée** et choisis le dossier décompressé.

**Mettre à jour**

1. Télécharge le zip de la nouvelle version.
2. Remplace le contenu de ton dossier Grabby par celui du zip, au même emplacement.
3. Dans `brave://extensions`, clique sur ↻ sous Grabby. Tes réglages et ton historique
   sont conservés.

**Depuis les sources**

```bash
npm ci
npm run build      # → dist/
npm run zip        # → release/*.zip
```

## Utilisation

1. Ouvre une page avec une vidéo. Le **nombre de vidéos trouvées** s'affiche sur l'icône
   Grabby.
2. Clique sur l'icône. Chaque vidéo est une ligne ; clique dessus pour voir ses choix (une
   seule carte ouverte à la fois).
3. Choisis la **qualité** et le **format** dans les deux listes, puis **Télécharger** (ou
   **Enregistrer la lecture** pour un lecteur sans fichier). La liste des qualités a deux
   groupes :
   - **Proposées par le site** : téléchargées telles quelles, rapide ;
   - **Réduire (conversion, plus lent)** : des qualités plus petites, fabriquées par
     Grabby à partir de la source (taille approximative indiquée).
4. Pendant le téléchargement, la carte affiche la **taille** (reçue / totale), la
   **vitesse** et le **temps restant**, et l'icône le **pourcentage**. À la fin, elle affiche
   **✓**, une **bulle** apparaît en bas à droite de la page et une notification système
   est envoyée. Le bouton **Afficher** ouvre le dossier du fichier.

**Réglages** (icône à droite de la lune/du soleil) :

| Réglage | Effet |
|---|---|
| Thème | Auto, clair ou sombre |
| Format vidéo / Format audio | Format proposé par défaut dans les listes |
| Me prévenir à la fin | Bulle dans la page et notification système |
| Demander où enregistrer | Ouvre la fenêtre d'enregistrement à chaque fichier |
| Ranger dans un dossier Grabby | Sous-dossier `Grabby` dans Téléchargements |
| Nom du fichier | Cases à cocher : Titre (toujours), Qualité, Site, Date, avec aperçu |

## Formats d'enregistrement

| Format | Type | Usage | Disponible quand… |
|---|---|---|---|
| **MP4** | Vidéo | Le plus compatible (par défaut) | toujours |
| **MKV** | Vidéo | Accepte toutes les pistes | toujours |
| **WebM** | Vidéo | Format du web | la source est en VP8/VP9/AV1 |
| **MOV** | Vidéo | Apple, logiciels de montage | la source est en H.264/HEVC |
| **AVI** | Vidéo | Anciens lecteurs | la source est en H.264/HEVC |
| **TS** | Vidéo | Flux brut | la source est en H.264/HEVC |
| **M4A** | Audio | AAC, léger | toujours |
| **MP3** | Audio | Universel | toujours |
| **Opus** | Audio | Très léger | toujours |
| **OGG** | Audio | Format libre | toujours |
| **FLAC** | Audio | Sans perte | toujours |
| **WAV** | Audio | Non compressé | toujours |

L'image est **copiée telle quelle**, sauf si tu choisis une qualité du groupe « Réduire » :
elle est alors réencodée en H.264 (MP4, MKV, MOV, AVI ou TS). Le son est copié quand le
format le permet, sinon converti. Au-delà de 1,5 Go, un flux à piste unique ou un fichier direct est
enregistré dans son format d'origine (la conversion se fait en mémoire).

## Questions fréquentes

**La fenêtre « Enregistrer sous » s'ouvre alors que le réglage est désactivé.**
Le réglage du navigateur passe avant celui de Grabby, et aucune extension ne peut le
contourner. Grabby le détecte et l'explique dans ses réglages, avec un bouton qui ouvre
directement les réglages de téléchargement du navigateur : désactive « Toujours demander où
enregistrer les fichiers » (`brave://settings/downloads`, `chrome://settings/downloads`…).

**Je ne vois pas de notification à la fin.**
La bulle dans la page s'affiche toujours (si « Me prévenir à la fin » est activé). Pour la
notification système, vérifie que les notifications de ton navigateur sont autorisées dans
les paramètres de Windows (Système › Notifications) et que le mode Ne pas déranger est
coupé.

**La popup a des angles carrés et un contour.**
C'est le cadre que le navigateur dessine autour de toutes les popups d'extension ; une
extension ne peut pas le modifier.

**Une vidéo est affichée « Protégé ».**
Elle est chiffrée par son éditeur (DRM). Grabby ne contourne jamais une protection.

**Le lecteur affiche 1080p mais Grabby propose moins.**
Grabby liste ce que le site envoie vraiment. Beaucoup de lecteurs choisissent la qualité
selon ta connexion et ne chargent la 1080p qu'une fois sélectionnée : choisis-la dans le
lecteur, lance la lecture quelques secondes, puis rouvre Grabby. Les qualités proposées
par le site sont réunies dans la liste de la carte.

**Réduire la qualité est long.**
L'image est réencodée dans le navigateur, sur un seul cœur : quelques secondes pour un
court extrait, plusieurs minutes (parfois plus que la durée de la vidéo) pour un film en
haute définition. Le téléchargement continue si tu fermes la popup. Si le site propose déjà
une qualité proche, elle est bien plus rapide à télécharger.

**Un avertissement PlayReady apparaît dans les erreurs de l'extension.**
Il venait d'une ancienne vérification de Grabby (jusqu'à la 1.2.1). Depuis la 1.3.0, il
n'apparaît plus : efface les anciennes lignes avec « Tout effacer » sur la page des erreurs.

**Grabby ne trouve rien sur une page.**
Lance la lecture de la vidéo : certains lecteurs ne chargent rien avant. Si rien n'apparaît
toujours, ouvre une [issue](https://github.com/titilyonnais/grabby/issues) avec l'adresse de
la page.

## Vie privée

Aucun compte, aucune statistique, aucun serveur : rien ne quitte ton appareil. Détails dans
la [politique de confidentialité](docs/PRIVACY.md) et la
[justification des permissions](docs/PERMISSIONS.md).

## Développement

```bash
npm test                 # tests unitaires (Vitest)
npm run typecheck        # vérification des types
npm run build && npm run test:e2e   # tests de bout en bout (Playwright, extension réelle)
npm run release:check    # CHANGELOG et README à jour pour la version de package.json
npm run fixtures         # régénère les médias de test (ffmpeg système requis)
npm run icons            # régénère les icônes
```

Les **tests de bout en bout** chargent l'extension dans Chromium, sans fenêtre, et vérifient
sur un serveur local :
- fichier direct, fichier protégé par Referer, fichier sans extension ni type ;
- HLS avec choix de qualité, HLS audio seul, DASH audio + vidéo ;
- HLS enregistré en MOV avec bulle de fin et ✓ sur l'icône, son DASH en FLAC ;
- liens directs (liens cassés et pages ignorés), segments de flux ignorés ;
- HLS chiffré et MP4 chiffré (DRM) affichés « Protégé », aperçus au survol écartés ;
- capture d'un lecteur MSE (MP4, et WebM → MP4), pages restreintes.

**Vérifications sur de vrais sites** (Brave, sans fenêtre visible ; `HEADED=1` pour la voir) :

```bash
node test/live/live.mjs <url> [url…]                  # ce qui est détecté et ce que montre la popup
node test/live/yt-download.mjs <url> 1080p mp4        # téléchargement YouTube
node test/live/popup-shot.mjs <url> nom               # captures de la popup, clair et sombre
```

## Versions et journal des modifications

Chaque version est décrite dans le [CHANGELOG](CHANGELOG.md), en français, rubrique par
rubrique (Ajouté, Modifié, Corrigé…). Les notes de chaque
[release GitHub](https://github.com/titilyonnais/grabby/releases) sont tirées de ce fichier.

Pour publier une version :

1. Décrire les changements sous **[Non publié]** dans `CHANGELOG.md` au fil du travail.
2. Au moment de publier : renommer cette section en `[X.Y.Z] — AAAA-MM-JJ`, mettre à jour
   le bloc « Nouveautés » de ce README et la version de `package.json`.
3. `npm run release:check` doit passer. La CI le vérifie à chaque envoi, et la publication
   d'une version est refusée s'il échoue.
4. Pousser le tag `vX.Y.Z` : la release est créée avec le zip et les notes du CHANGELOG.

## Architecture

```
page ─ hook.ts (MAIN)      DRM (EME), suivi MediaSource, capture ; YouTube
     ├ scanner.ts          <video> (Shadow DOM compris), titre, miniature, manifestes,
     │                     vidéos annoncées et liens directs
     └ toast.ts            bulle « Téléchargement terminé »
              │
service worker ─ detector  webRequest (lecture seule) → classify → probe (premiers octets)
               ├ registry  médias par onglet (storage.session) ; visible : doublons, flux
               ├ plan      variante, piste audio, format, conversion des fichiers directs
               ├ jobs      file d'attente, en-têtes Referer (DNR), downloads
               └ badge     nombre de vidéos, progression, ✓ / !
              │
offscreen ─ fetcher        segments en parallèle, reprises, ordre garanti
          ├ ffmpeg         ffmpeg.wasm : remux sans réencodage de l'image, 12 formats
          └ youtube-player lecteur YouTube caché
popup (Preact) ─ liste, listes qualité/format, progression, historique, réglages
```


## Licences

Code source sous licence **MIT** ([LICENSE](LICENSE)). Les paquets distribués embarquent
`ffmpeg-core` (**GPL-2.0-or-later**) : ils sont donc distribués dans leur ensemble sous GPL.
Détails : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
