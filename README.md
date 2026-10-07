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

<!-- release:2.3.2 — mettre à jour ce bloc à chaque version (vérifié par npm run release:check) -->
## Nouveautés de la version 2.3.2

- **Corrigé, le téléchargement YouTube bloqué à 0 %** : après une mise à jour de Grabby,
  les onglets YouTube déjà ouverts gardaient un ancien script qui n'écoutait plus personne,
  et l'enregistrement restait à 0 % sans fin. Grabby remet maintenant tous ses scripts dans
  les onglets ouverts (plus besoin de recharger la page), reconnaît une vidéo YouTube à son
  adresse, et s'arrête avec un message clair au lieu de rester bloqué si rien n'arrive.
- **Les options sont de nouveau directement sous Télécharger** : **Extrait**, **Lire
  l'extrait**, **Retouches** et **Plus tard**, sans passer par « Plus d'options ».
- **Corrigé, le double écart à droite de Télécharger | ⌄** : l'espace est mesuré sur les
  boutons réellement dessinés, 8 px de chaque côté comme entre les boutons de YouTube.
- **Corrigé, la croix du message en bas de page** : elle est à la même distance du bord
  que la coche de l'autre côté.
- La pilule garde son **pourcentage** pendant un téléchargement, même en icône seule.

**Rappel de la 2.3.1** : plus de défilement sans fin sur YouTube, plus aucun message dans
les erreurs de l'extension, détection de la langue parlée avant la transcription.

**Rappel de la 2.3.0** : boutons YouTube identiques au pixel près, plus aucune bulle sur
les vidéos ni les miniatures, cartes allégées avec **Plus d'options**.

**Rappel de la 2.2.0** : pilule **Télécharger | ⌄** sous le lecteur YouTube avec son menu
(qualité, son seul, photo, Plus tard, Grabby), plus de panne après une mise à jour.

**Rappel de la 2.1.0** : la rubrique **Réglages, IA locale** (état des modèles, test,
suppression), **Lire l'extrait** en boucle et une interface à une seule couleur.

**Rappel de la 2.0.0** :

- **Chercher ce qui est dit** : la bibliothèque retrouve les mots prononcés dans tes
  vidéos (sous-titres ou transcription locale) et lance la lecture au bon moment.
- **Lecteur amélioré** : vitesse, boucle A-B, image par image, photo de l'image, **reprise
  là où tu t'étais arrêté**, texte synchronisé à côté, **éditeur de sous-titres** (corriger,
  décaler) et **export** en .txt, .srt ou .md.
- **Favoris, collections, sélection multiple** et **Annuler** après une suppression ;
  raccourcis clavier ; miniatures gardées hors ligne ; nouvelle rubrique **Statistiques**.
- **Déjà téléchargé** affiché sur la carte d'une vidéo déjà enregistrée, avec Ouvrir et
  Afficher dans le dossier.
- **À télécharger plus tard** (bulle, clic droit, carte), maintenant ou à l'heure choisie ;
  **podcasts et flux RSS** suivis ; **toutes les images** d'une page en un .zip ; **photo**
  d'une vidéo (bulle ou Alt+Maj+S) ; menu **clic droit Grabby** ; **`gb` + lien** dans la
  barre d'adresse ; **1 à 4 téléchargements** à la fois.
- **Fichiers vérifiés** (refaits une fois s'ils sont abîmés) et **diagnostic clair** :
  pourquoi ça a échoué, quoi faire, et un rapport à copier (sans adresse ni titre).
- **Panneau latéral**, **couleur au choix** et **contraste élevé**, **notifications avec
  l'image** de la vidéo, **réglages synchronisés** (si tu l'actives), **visite guidée**.
- Retouches : **format vertical 9:16**, **son plus propre**, encodage plus rapide.
- **Modifié** : la bulle sur les vidéos n'est plus qu'un rond qui se déroule au clic ; les
  réglages tiennent sans défilement en 7 rubriques ; le carré du bouton Stop est plus grand.

**Rappel de la 1.11.0** :

- **Corrigé** : YouTube ne repasse plus en **144p** après un téléchargement. Le lecteur
  caché de Grabby garde ses choix pour lui ; une qualité forcée par la 1.10.0 est réparée
  toute seule à la prochaine visite de YouTube.
- **Corrigé** : un téléchargement lancé depuis le bouton sur la vidéo n'apparaît plus en
  double dans la fenêtre ; la vidéo et le son d'une même carte s'empilent, chacun avec
  son étiquette.
- **Page complète redessinée** : menu en groupes, animations partout, **téléchargements
  en cours** détaillés dans la bibliothèque, **photo, @nom, abonnés et dernières vidéos**
  des chaînes suivies, qualité jusqu'à **4K** pour les chaînes et playlists.

**Rappel de la 1.10.0** :

- **Enregistrer les directs** : flux HLS de n'importe quel site, et directs YouTube depuis
  la page ; **Arrêter et enregistrer** quand tu veux, ou une durée maximale.
- **Retouches et IA** sur chaque vidéo : **recadrer**, **tourner**, **miroir**, **vitesse**,
  **sans le son**, **compresser à 10, 25, 50 ou 100 Mo**, **sous-titres incrustés**,
  **un fichier par chapitre**, et un **aperçu** avant de télécharger.
- **IA locale, rien n'est envoyé** : **transcription** de ce qui est dit (Whisper),
  **traduction** des sous-titres dans 20 langues, **résumé et mots-clés** avec chapitres
  proposés. Les modèles se téléchargent une fois, seulement si tu l'acceptes.
- **Règles automatiques** par site : vidéo ou son, format, qualité, sous-titres, dossier.
- **Boutons sous le lecteur YouTube** : **Télécharger | ⌄** pour télécharger sans ouvrir
  Grabby.
- **Page complète** : **bibliothèque** avec lecteur, **liste d'adresses** à télécharger
  d'un coup, **chaînes YouTube suivies** (leurs nouvelles vidéos s'enregistrent seules),
  **atelier** pour les fichiers de ton ordinateur, **assembler** des vidéos bout à bout,
  **sauvegarde** et restauration des réglages.
- **Corrigé** : dans Brave, le mode capture (YouTube) pouvait échouer avec « capture
  impossible ».

**Rappel de la 1.9.0** :

- **Mettre à jour en un clic** (Windows) : un bouton dans Grabby télécharge la nouvelle
  version, vérifie son empreinte et l'installe. Une fois l'assistant installé
  ([voir plus bas](#mettre-à-jour-en-un-clic-windows)).
- **File d'attente** : les téléchargements qui attendent se déplacent (glisser ou flèches),
  **Tout mettre en pause** / **Tout reprendre**.
- **Sous-titres en français**, groupés (de la vidéo, automatiques, traduits), et toutes
  les traductions de YouTube.
- **Retirer les passages sponsorisés** de YouTube (SponsorBlock, anonyme, à activer).
- **Égaliser le volume** des fichiers son.
- **JPEG** : une image, une **planche** de captures de toute la vidéo, ou la **miniature
  HD**.
- **Noms et dossiers** : cases Chaîne et Format, rangement par site ou par type.
- **Historique** de 500 téléchargements, avec recherche, Ouvrir le fichier et
  Retélécharger.
- **Raccourci clavier** réglable depuis Grabby (vidéo ou son seul), **notification** qui
  ouvre le fichier.
- **Corrigé** : vidéo YouTube introuvable dans une playlist, défilement de côté dans la
  liste des formats.

**Rappel de la 1.8.0** :

- **Plusieurs langues** : sous-titres et pistes audio se cochent à plusieurs ; sous-titres
  **traduits par YouTube** dans la langue du navigateur.
- **Chapitres** de YouTube et des lecteurs de page, écrits dans le fichier.
- **Plusieurs extraits** d'une vidéo, réunis dans un fichier (un chapitre chacun) ou un
  fichier par extrait.
- **Image fixe JPEG**, **GIF** et **WebP animés** tirés de la vidéo.
- **Fichiers audio étiquetés** : titre, chaîne et pochette.
- **Playlists et chaînes YouTube** : tout télécharger, numéroté dans l'ordre.
- **Quand télécharger** : plage horaire (avec « Lancer maintenant »), Wi-Fi seulement,
  vitesse maximale.
- **Prévenir des nouvelles versions** (à activer dans les réglages).
- **Corrigé** : extraits YouTube qui revenaient au début, début d'extrait muet, fichier
  vide après une reprise.

**Rappel de la 1.7.0** :

- **Pause, reprise et extraits pour tout** : YouTube et tous les lecteurs enregistrés se
  mettent en pause, reprennent seuls après une coupure ou un redémarrage (la page est
  rouverte en arrière-plan si besoin) et peuvent être coupés en extrait.
- **Sous-titres de YouTube**, générés automatiquement compris.
- **Sous-titres partout** : fichiers `<track>` des pages, sous-titres chargés par les
  lecteurs, WebVTT et TTML dans des segments MP4 (`wvtt`, `stpp`), fichiers TTML/DFXP.
- **Tout télécharger** prend aussi YouTube et les lecteurs à enregistrer.

**Rappel de la 1.6.0** :

- **Pause et reprise** : les morceaux reçus sont gardés sur le disque, Reprendre repart de
  là. Connexion perdue, veille ou navigateur fermé : le téléchargement **reprend tout seul**.
- **Téléchargements plus rapides** : connexions ajustées au débit (2 à 16), gros fichiers
  récupérés en plusieurs plages à la fois.
- **Couper un extrait** : deux poignées ou des temps à taper ; pour un flux, seuls les
  segments de l'extrait sont téléchargés.
- **Sous-titres** des flux HLS et DASH, intégrés à la vidéo ou dans un `.srt` à côté.
- **Tout télécharger** : toutes les vidéos de la page cochées, un format pour toutes.
- **Clic droit** sur une vidéo et **raccourcis** : Alt+Maj+G ouvre Grabby, Alt+Maj+D
  télécharge la vidéo de la page.
- **Nouvel historique** par jour, avec miniature, qualité et fichiers introuvables signalés.
- Interface plus nette à tout zoom, listes et réglages qui se referment en douceur.

**Rappel de la 1.5.3** :

- **Finitions** : interrupteurs sans à-coup au clic, ligne d'une vidéo en cours plus
  propre (barre sous le texte, miniature sur toute la hauteur), icône du format décollée du
  bord, page Réglages plus animée, plus d'étiquette « Expérimental ».

**Rappel de la 1.5.0** :

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
  instantané pour les vidéos déjà chargées, sinon enregistrement accéléré de la lecture,
  qu'on peut mettre en pause, reprendre et couper en extrait comme un téléchargement.
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
- **Couper des extraits** : début et fin au choix, pour toutes les vidéos, et jusqu'à 8
  extraits réunis dans un fichier (un chapitre chacun) ou un fichier par extrait ; pour un
  flux, seuls les segments des extraits sont téléchargés, pour un enregistrement seules ces
  parties sont lues.
- **Sous-titres**, une ou plusieurs langues, intégrés à la vidéo ou en `.srt` à côté : flux
  HLS et DASH (WebVTT, TTML, et les deux dans des segments MP4), fichiers `<track>` des
  pages, sous-titres chargés par les lecteurs, et ceux de YouTube (générés automatiquement
  ou traduits dans la langue du navigateur).
- **Plusieurs langues audio** d'un flux HLS ou DASH, chacune une piste de la vidéo.
- **Chapitres** (description YouTube, `<track kind="chapters">`) écrits dans le fichier.
- **Images** tirées de la vidéo : JPEG au moment choisi, GIF ou WebP animés d'un passage.
- **Fichiers audio étiquetés** : titre, chaîne et pochette ; **volume égalisé** si tu le
  souhaites.
- **Planche de captures** de toute la vidéo et **miniature HD**, en JPEG.
- **Passages sponsorisés retirés** des vidéos YouTube (SponsorBlock), si tu l'actives.
- **Tout télécharger** : toutes les vidéos de la page en une fois, un format pour toutes ;
  sur YouTube, toute une **playlist** ou les vidéos d'une **chaîne**, numérotées.
- **Directs** : flux HLS de n'importe quel site (morceau par morceau, sans réencodage) et
  directs YouTube (depuis le lecteur de la page), jusqu'à ce que tu arrêtes ou à une durée
  maximale.
- **Retouches** : recadrer, tourner, miroir, vitesse de 0,5× à 2×, sans le son,
  **compresser à une taille** (10, 25, 50 ou 100 Mo), **sous-titres incrustés** dans
  l'image, **un fichier par chapitre** ; **aperçu** de l'extrait avant de télécharger.
- **IA locale** (modèles téléchargés une fois, avec ton accord ; rien n'est envoyé) :
  **transcription** de ce qui est dit (Whisper, langue détectée ou choisie), **traduction**
  des sous-titres (Opus-MT, ou le traducteur de Chrome si tu actives **IA de Chrome**),
  **résumé, mots-clés et chapitres proposés**.
- **Règles automatiques** par site (vidéo ou son, format, qualité, sous-titres, dossier),
  suivies aussi par le clic droit, le raccourci, le bouton sur les vidéos et la liste
  d'adresses.
- **Sous le lecteur YouTube**, une pilule **Télécharger | ⌄** identique aux boutons de
  YouTube, juste après le pouce levé / pouce baissé ; ⌄ ouvre le choix de la qualité, du son
  seul, de la photo, de Plus tard et de Grabby. Rien n'est jamais dessiné sur les vidéos ni
  sur les miniatures.
- **Page complète** : **bibliothèque** (recherche dans ce qui est dit, lecteur avec vitesse,
  boucle A-B, image par image, reprise, texte synchronisé, éditeur de sous-titres et
  export ; favoris, collections, sélection multiple, Annuler), **statistiques**, **liste
  d'adresses** ouvertes deux par deux en arrière-plan, **plus tard** (vidéos mises de côté,
  à l'heure choisie), **chaînes et podcasts suivis** (nouvelles vidéos et épisodes
  enregistrés seuls), **images de la page** en .zip, **atelier** pour les fichiers de
  l'ordinateur, **assembler** des vidéos ou des sons bout à bout, **sauvegarde** des
  réglages dans un fichier.
- **Panneau latéral** : la même fenêtre, ouverte à côté de la page.
- **Fichiers vérifiés** : chaque fichier est relu avant d'être enregistré, refait une fois
  s'il est abîmé ; une erreur explique quoi faire et donne un rapport à copier.
- **Quand télécharger** : plage horaire, Wi-Fi seulement (là où le navigateur le sait),
  vitesse maximale ; « Lancer maintenant » pour ne pas attendre.
- **Prévenir des nouvelles versions**, si tu l'actives : une question par jour à GitHub ;
  **Mettre à jour** les installe en un clic (Windows, avec l'assistant).
- **Clic droit, barre d'adresse et raccourcis** : un menu « Grabby » au clic droit
  (vidéo, son, lien, plus tard, toutes les images), `gb` + un lien dans la barre
  d'adresse, Alt+Maj+G pour ouvrir Grabby, Alt+Maj+D pour télécharger la vidéo de la page
  (ou son son seul, au choix), Alt+Maj+S pour une photo de la vidéo.
- **Vrais titres et miniatures** : métadonnées de la page, sinon une image de la vidéo.
- **Rapide et reprenable** : morceaux téléchargés en parallèle (connexions ajustées au
  débit), gros fichiers en plusieurs plages ; **pause et reprise**, reprise automatique après
  une coupure de connexion, la veille ou un redémarrage du navigateur.
- **Suivi** : progression dans la popup et sur l'icône, **file d'attente** réordonnable
  (Tout mettre en pause / Tout reprendre), bulle et notification à la fin (un clic ouvre le
  fichier), annulation, nouvel essai, historique des 500 derniers téléchargements (par jour,
  avec miniature, recherche, Ouvrir le fichier et Retélécharger).
- **Noms de fichiers** à composer (titre, chaîne, qualité, format, site, date) et
  rangement dans Téléchargements, un dossier Grabby, par site ou par type.
- Assemblage par **ffmpeg.wasm embarqué** : aucun code distant, rien n'est envoyé ailleurs.
- Interface **français / anglais**, thème **clair / sombre / auto**, **six couleurs** au
  choix et un mode **contraste élevé** ; **visite guidée** au premier lancement.

## Ce que Grabby ne fait pas (et pourquoi)

| | |
|---|---|
| **DRM et chiffrement** | Netflix, Prime Video, Disney+, Paramount+, myCanal, contenus payants… Contourner une mesure technique de protection est illégal (art. L.335-3-1 CPI, directive 2001/29/CE, DMCA §1201). Grabby détecte ces contenus (EME, `EXT-X-KEY`, `ContentProtection`, fichiers chiffrés) et les affiche « Protégé ». Pour regarder hors connexion, utilise le téléchargement intégré aux applications officielles. |
| **Directs DASH** | Les directs HLS et YouTube s'enregistrent ; un direct au format DASH est signalé mais pas enregistré. |
| **Réencodage pour changer de format** | Trop lent dans un navigateur : seuls les formats compatibles avec la source sont proposés. L'image n'est réencodée que si tu le demandes : qualité plus petite (groupe « Réduire »), retouches, taille à tenir ou sous-titres incrustés. |
| **IA dans le nuage** | Aucune : la transcription, la traduction et le résumé tournent dans ton navigateur. Rien n'est envoyé à un service d'IA. |

> Télécharge uniquement des vidéos que tu as le droit de conserver (les tiennes, sous licence
> libre ou avec l'accord de l'auteur) et respecte les conditions d'utilisation des sites.

## YouTube (expérimental)

Grabby propose les qualités réellement disponibles sur YouTube (jusqu'en 4K/8K) avec leur
taille, en MP4, WebM ou MKV, ou l'audio seul (avec titre, chaîne et pochette), avec ses
sous-titres (traduits compris) et ses chapitres si tu en choisis, ou une image JPEG, GIF ou
WebP. Une playlist ou les vidéos d'une chaîne se téléchargent en une fois.
L'enregistrement se fait dans un lecteur caché : la vidéo que tu regardes n'est pas touchée
et tu peux quitter la page. Il se met en pause, reprend après une coupure ou un redémarrage,
et peut se limiter à un ou plusieurs extraits. Si tu l'actives, les passages
sponsorisés repérés par SponsorBlock sont retirés du fichier. La vitesse dépend de ce
lecteur. Fonction fragile, et contraire aux conditions de YouTube : à tes
risques.

## Installation et mise à jour

**Installer depuis une release**

1. Télécharge `grabby-vX.Y.Z.zip` dans les
   [Releases](https://github.com/titilyonnais/grabby/releases/latest) et décompresse-le.
2. Ouvre `brave://extensions` (ou `chrome://extensions`, `edge://extensions`,
   `opera://extensions`).
3. Active le **mode développeur**.
4. Clique **Charger l'extension non empaquetée** et choisis le dossier décompressé.

### Mettre à jour en un clic (Windows)

Une seule fois, après avoir installé Grabby : ouvre son dossier et double-clique sur
**`installer-mises-a-jour.cmd`**. Il installe un petit assistant pour ton compte (aucun
droit administrateur) et l'annonce à Chrome, Brave, Edge, Chromium et Vivaldi.

Ensuite, quand une version sort, clique sur **Mettre à jour** dans le bandeau de Grabby
(ou dans Réglages → Mises à jour). Le navigateur demande la première fois l'autorisation de
parler à l'assistant ; celui-ci télécharge la version publiée sur GitHub, vérifie son
empreinte SHA-256, remplace les fichiers du dossier et Grabby redémarre. Tes réglages et
ton historique sont gardés, les fichiers que tu as ajoutés au dossier aussi.

Si tu déplaces le dossier de Grabby, relance `installer-mises-a-jour.cmd` depuis le nouveau
dossier. `desinstaller-mises-a-jour.cmd` retire l'assistant.

> **Venant d'une version avant la 1.9.0** : installe la 1.9.0 une fois à la main (retire
> l'ancienne Grabby de `brave://extensions`, puis charge le nouveau dossier). Elle a un
> identifiant fixe, nécessaire à l'assistant : pour le navigateur c'est une nouvelle
> extension, donc réglages et historique repartent de zéro cette fois-ci.

### Mettre à jour à la main (tous les systèmes)

1. Télécharge le zip de la nouvelle version.
2. Remplace le contenu de ton dossier Grabby par celui du zip, au même emplacement.
3. Dans `brave://extensions`, clique sur ↻ sous Grabby. Tes réglages et ton historique
   sont conservés.

**Depuis les sources**

```bash
npm ci
npm run build      # → dist/
npm run zip        # → release/grabby-vX.Y.Z.zip
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
5. **Pause** arrête le téléchargement en gardant ce qui est reçu ; **Reprendre** repart de
   là. Une coupure de connexion, la veille ou la fermeture du navigateur n'obligent pas à
   recommencer : Grabby reprend tout seul. C'est pareil pour un enregistrement (YouTube,
   lecteur sans fichier) : il repart un peu avant l'endroit où il s'était arrêté, et si la
   page a été fermée, Grabby la rouvre dans un onglet en arrière-plan le temps de finir.

**Avant de télécharger**, la carte ouverte montre l'essentiel : qualité, format et
**Télécharger**. Le reste est rangé dans **Plus d'options** ; sa ligne dit ce qui est activé
(« sous-titres, extrait, 2 retouches »), pour que rien de choisi ne passe inaperçu :

- **Sous-titres** (quand la vidéo en a) : coche une ou plusieurs langues ; elles sont mises
  dans la vidéo, ou dans des fichiers `.srt` à part si tu coches l'option (toujours à part
  en TS et AVI, qui ne savent pas les garder, et pour un fichier enregistré tel quel).
- **Langue audio** (quand le flux en propose plusieurs) : coche celles à garder, chacune
  devient une piste de la vidéo.
- **Garder les chapitres** (quand la vidéo en a) : ils sont écrits dans le fichier.
- **Couper un extrait** : fais glisser les deux poignées ou tape le début et la fin
  (`1:05`). La coupe tombe sur l'image clé la plus proche : l'extrait peut commencer
  quelques secondes plus tôt. Le fichier s'appelle « Titre (1m05-2m40).mp4 ».
  **Ajouter un extrait** en crée un autre (8 au plus) ; chaque pastille sous le curseur
  sélectionne ou retire le sien. Les extraits sont **réunis dans un seul fichier** (un
  chapitre chacun) ou, si tu décoches l'option, enregistrés **un fichier chacun**.
- **Image** (dans la liste des formats) : **JPEG** enregistre, au choix, **une image** au
  moment choisi, une **planche** (des captures de toute la vidéo côte à côte, une toutes les
  10 s, 30 s, 1 min, 5 min ou automatiquement) ou la **miniature** de la vidéo dans sa plus
  grande taille ; **GIF** et **WebP** une animation d'un passage de 30 secondes au plus.
- **Lire l'extrait** (une fois un extrait coupé) : le lit en boucle dans la popup ; pour un
  flux (YouTube…), c'est le lecteur de la page qui le lit en boucle, jusqu'à ce que tu
  ailles ailleurs dans la vidéo.
- **Retouches et IA** : un panneau pour ce qui est fait au fichier une fois téléchargé. Ses
  choix restent quand il est replié (son bouton dit combien) :
  - **Image** : **Recadrer** (un cadre à déplacer sur l'image, formes libre, 16:9, 1:1,
    9:16, 4:3), **Rotation** (90°, 180°, 270°), **Miroir** ;
  - **Vitesse et taille** : **Vitesse** de 0,5× à 2×, **Taille du fichier** (10, 25, 50 ou
    100 Mo), **Sans le son** ;
  - **IA locale** : **Transcrire** (la langue parlée, ou détectée), **Traduire en**,
    **Résumé et mots-clés** (un fichier texte à côté). La première fois, Grabby demande
    l'accord pour télécharger les modèles (environ 77 Mo, puis 107 Mo par paire de
    langues). La transcription et la traduction sont aussi dans le menu **Sous-titres** de
    la carte, et une vidéo sans sous-titres propose **Créer les sous-titres** ;
  - **Sous-titres et chapitres** : **Incruster les sous-titres dans l'image**, **Un fichier
    par chapitre** (dans un dossier au nom de la vidéo, numérotés).

  Les retouches de l'image refont la vidéo en H.264 : compte à peu près sa durée.

Pour un **direct**, la carte propose **Enregistrer le direct**, une durée maximale et les
mêmes retouches. La barre compte le temps enregistré ; **Arrêter et enregistrer** termine le
fichier.

Quand la page a plusieurs vidéos, **Tout télécharger** (au-dessus de la liste) les coche
toutes : décoche celles que tu ne veux pas, choisis un format, puis **Télécharger (N)**. Elles
partent deux par deux, en meilleure qualité.

Sur une **playlist YouTube** (ou une vidéo lue dans une playlist) et sur l'onglet **Vidéos**
d'une chaîne, une carte propose de tout télécharger dans une qualité et un format. Les
fichiers sont numérotés dans l'ordre de la liste. Seules les vidéos déjà affichées sont
prises : fais défiler la page pour en charger d'autres.

Dès que **deux téléchargements** sont en cours, une liste les montre tous en haut de la
popup, dans l'ordre où ils seront faits. Ceux qui attendent se **déplacent** par leur
poignée (glisser-déposer, ou flèches haut et bas au clavier) ; **Tout mettre en pause** et
**Tout reprendre** agissent sur tous à la fois.

L'onglet **Historique** garde les 500 derniers téléchargements. Au-delà de trois, une
**recherche** apparaît (titre, nom du fichier ou site). Chaque ligne permet d'**ouvrir le
fichier**, de le **montrer dans son dossier**, de **retélécharger** (la page se rouvre
derrière et le téléchargement repart tout seul, dans la même qualité et le même format) ou
d'ouvrir la page.

Sans ouvrir Grabby : **clic droit** → **Grabby** (cette vidéo, son son, un lien, plus tard,
toutes les images), **Alt+Maj+D** pour la vidéo principale de la page, **Alt+Maj+S** pour
une photo de la vidéo (raccourcis modifiables dans `chrome://extensions/shortcuts`),
`gb` puis un ou plusieurs liens dans la barre d'adresse (`gb son …` pour le son seul),
ou, sur YouTube, la pilule **Télécharger | ⌄** sous le lecteur (⌄ : qualité, son seul, photo,
Plus tard, Ouvrir Grabby).

**Page complète** (bouton en grille en haut de la popup) :

| Section | Ce qu'elle fait |
|---|---|
| Bibliothèque | Tout ce que Grabby a enregistré, en grille : place prise par type, filtres par type, site, favoris et collections, recherche dans les titres **et dans ce qui est dit**, sélection multiple, Annuler après une suppression, raccourcis clavier ; lecteur intégré avec vitesse, boucle A-B, image par image, photo, reprise, texte synchronisé, éditeur de sous-titres et export .txt/.srt/.md (après avoir autorisé « Accès aux URL de fichier » pour Grabby) |
| Statistiques | Fichiers et place prise, les 7 derniers jours, un graphique sur 12 semaines, les sites, les types et les formats ; compté sur ton ordinateur |
| Liste d'adresses | Colle des adresses (ou un texte qui en contient) : chaque page s'ouvre en arrière-plan, deux à la fois, sa vidéo est téléchargée selon tes règles (ou en vidéo, ou en son), puis l'onglet se ferme |
| Plus tard | Les vidéos mises de côté (bulle, clic droit, carte) : Tout télécharger, une par une, ou Programmer une heure |
| Chaînes et podcasts | Les chaînes et playlists YouTube, les podcasts et flux RSS/Atom suivis : leurs nouvelles vidéos et épisodes sont enregistrés tout seuls (vérification toutes les heures) ; Vérifier maintenant, Ne plus suivre |
| Images de la page | Les images d'une page (grandes versions comprises), un filtre de taille, la sélection, puis un .zip ou une par une |
| Atelier | Une vidéo ou un son de ton ordinateur, avec les mêmes retouches et la même IA, et un aperçu en direct ; un fichier `.srt`/`.vtt` à incruster ou traduire |
| Assembler | Plusieurs fichiers mis bout à bout dans l'ordre choisi : copiés tels quels s'ils se ressemblent, sinon refaits en H.264 à la taille du premier |
| Règles automatiques | Pour un site ou tous : vidéo ou son, format, qualité, langues de sous-titres, dossier |
| Sauvegarde | Réglages, règles, historique et chaînes suivies dans un fichier JSON ; la restauration ajoute sans rien perdre |

**Réglages** (icône à droite de la lune/du soleil), en 7 rubriques sans défilement :
Général, Formats, Noms et dossiers, Téléchargements, Raccourcis, IA locale, Synchro et
mises à jour.

| Réglage | Effet |
|---|---|
| Thème | Auto, clair ou sombre |
| Couleur, contraste élevé | Six couleurs pour Grabby (fenêtre, page complète, bulle de fin de téléchargement) ; textes et bordures plus marqués |
| Format vidéo / Format audio | Format proposé par défaut dans les listes |
| Me prévenir à la fin | Bulle dans la page et notification système (un clic ouvre le fichier) |
| Égaliser le volume des fichiers son | Chaque fichier son au même niveau (−14 LUFS) ; le son est réencodé |
| Demander où enregistrer | Ouvre la fenêtre d'enregistrement à chaque fichier |
| Ranger les fichiers | Tels quels dans Téléchargements, dans un dossier `Grabby`, par site (`Grabby/youtube.com`) ou par type (`Grabby/Vidéos`) |
| Nom du fichier | Cases à cocher : Titre (toujours), Chaîne, Qualité, Format, Site, Date, avec aperçu |
| Seulement à certaines heures | Les nouveaux téléchargements attendent la plage choisie (« Lancer maintenant » pour ne pas attendre) |
| Seulement en Wi-Fi | Attend le Wi-Fi ; proposé seulement là où le navigateur connaît la connexion (ChromeOS, Android) |
| Téléchargements à la fois | De 1 à 4 en même temps (2 par défaut) |
| Vitesse maximale | Limite le débit de tous les téléchargements (YouTube : le lecteur caché lit moins vite) |
| Vérifier les fichiers | Relit chaque fichier avant de l'enregistrer et le refait une fois s'il est abîmé (activé par défaut) |
| Raccourci clavier | La touche qui télécharge sans ouvrir Grabby (Changer ouvre la page des raccourcis) et ce qu'elle prend : la vidéo ou le son seul |
| Retirer les passages sponsorisés | YouTube : coupe les sponsors et l'autopromotion repérés par SponsorBlock (désactivé par défaut) |
| Boutons sous les vidéos YouTube | « Télécharger » et son menu d'options sous le lecteur YouTube (activé par défaut) |
| Page complète, Panneau latéral, Revoir la visite | Trois boutons sous la liste des rubriques |
| Réglages synchronisés | Réglages et règles suivent ton compte de navigateur sur tes autres ordinateurs (désactivé par défaut) |
| IA locale | Autorise le téléchargement unique des modèles (désactivé par défaut) ; montre chaque modèle, s'il est prêt et sa taille, avec Tester la transcription et Supprimer les modèles |
| IA de Chrome | Laisse Grabby essayer d'abord le traducteur et le résumeur intégrés à Chrome (désactivé par défaut : demander à Chrome suffit à lui faire écrire un avertissement quand il a coupé son IA ; si c'est le cas, le réglage se désactive tout seul) |
| Prévenir des nouvelles versions | Une fois par jour, demande à GitHub la dernière version (désactivé par défaut) |
| Installer la dernière version | Bouton Mettre à jour : télécharge, vérifie et installe la dernière version (Windows, avec l'assistant) |

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
| **JPEG** | Image | Une image fixe | la vidéo a une image |
| **GIF** | Animation | Se lit partout (480 px, 12 images/s) | la vidéo a une image |
| **WebP** | Animation | Bien plus léger (480 px, 15 images/s) | la vidéo a une image |

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

Aucun compte, aucune statistique, aucun serveur : rien ne quitte ton appareil. Grabby ne
fait de requête de lui-même que si tu l'actives ou le demandes : la vérification
quotidienne des nouvelles versions auprès de GitHub, la mise à jour quand tu cliques sur
Mettre à jour, la question à SponsorBlock (sans dire quelle vidéo) si tu retires les
passages sponsorisés, le flux public des chaînes YouTube que tu suis, et le
téléchargement unique des modèles d'IA depuis Hugging Face si tu l'acceptes. L'IA travaille
ensuite sur ton ordinateur : ni le son, ni les sous-titres, ni le résumé ne sont envoyés.
Détails dans
la [politique de confidentialité](docs/PRIVACY.md) et
[à quoi sert chaque autorisation](docs/PERMISSIONS.md).

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
- capture d'un lecteur MSE (MP4, et WebM → MP4), pages restreintes ;
- pause et reprise, coupure réseau et redémarrage du navigateur (téléchargements et
  enregistrements), extraits de flux, de fichiers et d'enregistrements ;
- sous-titres HLS et DASH (WebVTT, TTML, `wvtt` et `stpp` en MP4), `<track>` d'un fichier
  et d'un lecteur enregistré, intégrés ou en `.srt`.

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
     ├ scanner.ts          <video> (Shadow DOM compris) et leurs <track>, titre, miniature,
     │                     manifestes, vidéos annoncées et liens directs ; sessions
     │                     d'enregistrement (pause, reprise, directs) ; playlists et chaînes YouTube
     ├ overlay.ts          boutons sous le lecteur YouTube et leur menu, photo (Alt+Maj+S)
     └ toast.ts            bulle « Téléchargement terminé »
              │
service worker ─ detector  webRequest (lecture seule) → classify → probe (premiers octets)
               ├ registry  médias par onglet (storage.session) ; visible : doublons, flux
               ├ plan      variante, pistes audio, sous-titres, chapitres, extraits, image,
               │           format, étiquettes
               ├ jobs      file d'attente, plage horaire et Wi-Fi, pause/reprise (alarms),
               │           en-têtes Referer (DNR), downloads ; quick : clic droit, raccourcis,
               │           bouton sur les vidéos, règles automatiques
               ├ batch     liste d'adresses (deux onglets à la fois) ; watch : chaînes suivies
               │           (flux RSS public, toutes les heures) ; backup : sauvegarde
               ├ updates   nouvelles versions (GitHub, seulement si activé)
               └ badge     nombre de vidéos, progression, ✓ / !
              │
offscreen ─ fetcher        morceaux en parallèle (pacer : 2 à 16 connexions), plages HTTP,
          │                limite de vitesse, rangés dans IndexedDB au fur et à mesure
          ├ ffmpeg         ffmpeg.wasm : remux sans réencodage de l'image, 12 formats et
          │                JPEG/GIF/WebP, extraits (réunis ou non), chapitres, pochettes,
          │                raccord des sessions d'un enregistrement (pistes remises en
          │                ordre), sous-titres (WebVTT, SRT, TTML, wvtt/stpp, YouTube) → SRT
          ├ live           directs HLS : liste relue, nouveaux morceaux rangés au fil de l'eau
          ├ finish         après l'assemblage : IA, résumé, retouches (H.264), découpage
          ├ ai/worker      transformers.js + ONNX Runtime (inclus) : Whisper, Opus-MT
          └ youtube-player lecteur YouTube caché (sous-titres choisis activés)
popup (Preact) ─ liste, listes qualité/format, retouches et IA, progression, historique, réglages
app (Preact)   ─ page complète : bibliothèque, adresses, chaînes, atelier, assembler,
                 règles, sauvegarde (ffmpeg.wasm et IA dans la page)
```

## Licences

Code source sous licence **MIT** ([LICENSE](LICENSE)). Les paquets distribués embarquent
`ffmpeg-core` (**GPL-2.0-or-later**) : ils sont donc distribués dans leur ensemble sous GPL.
Ils incluent aussi transformers.js (Apache-2.0), ONNX Runtime Web (MIT) et la police
Noto Sans (SIL Open Font License 1.1) ; les modèles d'IA téléchargés à la demande gardent
leur licence (Whisper et Opus-MT : Apache-2.0).
Détails : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
