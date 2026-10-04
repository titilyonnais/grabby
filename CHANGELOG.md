# Journal des modifications

Toutes les évolutions notables de Grabby sont consignées ici, version par version.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la numérotation
suit le [versionnage sémantique](https://semver.org/lang/fr/) :
- un **correctif** (1.2.**1**) ne fait que réparer ;
- une version **mineure** (1.**3**.0) ajoute des fonctions sans rien casser ;
- une version **majeure** (**2**.0.0) change un comportement existant.

Chaque version a les rubriques utiles parmi : **Ajouté**, **Modifié**, **Corrigé**,
**Supprimé**, **Sécurité** et **Limites connues**.

## [Non publié]

Rien pour l'instant.

## [1.4.1] — 2026-10-04

Finitions de l'interface de la 1.4.0 : arrondis harmonisés, animations soignées, réglages
plus clairs.

### Corrigé
- **Contour de la carte ouverte coupé en haut** : la liste laisse maintenant la place au
  liseré autour de la carte dépliée.
- **Animation des réglages** : plus de tremblement à l'ouverture. Les réglages **glissent**
  par-dessus la liste (qui ne bouge plus), à l'ouverture **et** à la fermeture.

### Modifié
- **Arrondis harmonisés** partout : un même rayon pour les grandes cartes et les encadrés
  de réglages, un rayon intérieur unique (vignette, listes, aperçu, encarts) qui s'emboîte
  proprement dans le grand.
- **Animations** ajoutées et adoucies : fondu léger en changeant d'onglet (Cette page ↔
  Historique) et à l'ouverture des choix d'une carte, glissement des réglages dans les deux
  sens.
- **Section « Fichiers » des réglages** plus claire : petite aide sous « Nom du fichier »,
  cases à cocher avec une coche animée, et aperçu du nom précédé d'une icône de fichier (il
  ne ressemble plus à un champ de saisie).

## [1.4.0] — 2026-10-04

Suivi détaillé du téléchargement, liste plus claire, page de réglages à part entière,
réglages vérifiés un à un.

### Ajouté
- **Détail du téléchargement** sous la barre de progression : taille reçue et taille totale
  (« 253 Mo / ≈ 601 Mo »), **vitesse** en direct (« 6,1 Mo/s ») et **temps restant**. Le
  « ≈ » signale une taille estimée (flux), sinon elle vient du serveur.
- **Liste repliable** : une ligne compacte par vidéo, une seule carte ouverte à la fois avec
  ses choix. Un téléchargement en cours sur une carte fermée s'affiche en pourcentage et par
  une fine barre sous la ligne.
- **Nom du fichier par cases à cocher** (Titre, Qualité, Site, Date) avec un aperçu en
  direct, à la place du modèle à accolades `{title}`.
- **Alerte « Enregistrer sous »** : si le navigateur ouvre quand même sa fenêtre
  d'enregistrement alors que le réglage de Grabby est désactivé, les réglages l'expliquent et
  proposent un bouton qui ouvre directement les réglages de téléchargement du navigateur.

### Modifié
- **Les réglages sont une vraie page** (elle glisse sur le côté), au lieu d'un panneau qui
  remontait du bas. Retour par la flèche en haut à gauche ou avec Échap.
- **Barres de défilement** redessinées : une pastille arrondie bien visible sur le fond,
  **sans les flèches** du haut et du bas.
- **Téléchargement des flux plus rapide** : 8 segments en parallèle au lieu de 6, pour mieux
  remplir la connexion sans se faire limiter par les serveurs.

### Corrigé
- **Saccade de l'icône** en fin de téléchargement (99 % → 0 % → 99 %) : la progression ne
  revient plus jamais en arrière quand une étape succède à une autre (téléchargement puis
  assemblage).
- Le réglage **« Ranger dans un dossier Grabby »** était ignoré quand le navigateur imposait
  sa fenêtre « Enregistrer sous » ; c'est maintenant détecté et expliqué (voir ci-dessus).
- Vérification de **tous les formats** (6 vidéo, 6 audio) et des options dans les tests de
  bout en bout.

## [1.3.0] — 2026-10-04

Toutes les qualités qu'un lecteur propose, réduction de la qualité par Grabby, fausses
alertes DRM supprimées.

### Ajouté
- **Toutes les qualités d'un lecteur dans une seule carte** : quand un site propose la même
  vidéo en plusieurs fichiers (une balise `<source>` par qualité, un flux HLS par qualité…),
  Grabby les regroupe et les liste dans le choix de qualité, de la meilleure à la plus
  petite. La meilleure est choisie par défaut, même si le lecteur jouait une qualité
  inférieure.
- **Résolution réelle des fichiers** : Grabby la lit dans leurs premiers octets (MP4 et
  WebM) et l'affiche sur la carte (« 1080p »), au lieu de ne rien indiquer.
- **Réduire la qualité** : le choix de qualité propose aussi, dans un groupe « Réduire »,
  les qualités usuelles plus petites que la source (1440p, 1080p, 720p, 480p, 360p, 240p,
  144p) que le site n'offre pas. Grabby réduit alors l'image lui-même (H.264), avec la
  taille attendue. Exemple : une vidéo proposée uniquement en 4K peut être enregistrée en
  360p.
  - Fonctionne pour les fichiers directs et les flux HLS/DASH, pas pour les enregistrements
    de lecture ni YouTube (qui propose déjà ses petites qualités).
  - Grabby part de la plus petite qualité suffisante (moins à télécharger et à décoder).
  - Formats MP4, MKV, MOV, AVI ou TS (le WebM ne peut pas contenir de H.264), ou audio seul.

### Modifié
- **Noms des qualités des films** : un film au format cinéma (1920 × 800, 1280 × 534…) est
  appelé 1080p ou 720p, comme sur les lecteurs, et non plus « 800p » ou « 534p ».
- La barre de progression d'une réduction de qualité tient compte de la conversion, qui est
  la partie la plus longue.

### Corrigé
- **Fausse alerte « Protégé »** sur des lecteurs qui vérifient seulement si le navigateur
  sait lire les vidéos protégées, sans en lire. Seule une vidéo qui reçoit vraiment des clés
  de déchiffrement est maintenant considérée comme protégée.
- **Avertissement PlayReady dans les erreurs de l'extension**
  (`com.microsoft.playready.recommendation… setServerCertificate()`, attribué à `hook.js`) :
  il venait de la même vérification et n'apparaît plus. Les anciennes lignes s'effacent avec
  « Tout effacer » sur la page des erreurs de l'extension.
- Le message « Rien à voir ici » et l'historique vide sont centrés verticalement dans la
  popup.

### Limites connues
- Réduire la qualité réencode l'image dans le navigateur, sur un seul cœur : compte
  plusieurs minutes, et parfois plus que la durée de la vidéo pour un film en haute
  définition. Au-delà de 1,5 Go de source, la réduction est refusée.
- Un fichier dont l'index est à la fin (MP4 non optimisé pour le web) ne révèle ni sa durée
  ni sa résolution dans ses premiers octets : ses autres qualités restent alors sur des
  cartes séparées.

## [1.2.1] — 2026-10-04

Correctif de l'icône et vrai suivi des versions.

### Corrigé
- Après un téléchargement, l'infobulle de l'icône affichait le texte technique
  `__MSG_extName__` au lieu de « Grabby — Téléchargeur de vidéos ».

### Modifié
- **Journal des modifications** réécrit en français, détaillé version par version (Ajouté,
  Modifié, Corrigé…), depuis la 1.0.0.
- **README** réécrit : nouveautés de la version, utilisation, tableau des formats, questions
  fréquentes (fenêtre « Enregistrer sous », notifications, contenus protégés), procédure de
  mise à jour et de publication.
- Les **notes des releases GitHub** sont tirées du journal des modifications (au lieu de la
  liste automatique des commits).
- Une version ne peut plus être publiée si le journal et le README ne la décrivent pas :
  `npm run release:check`, lancé par la CI à chaque envoi et avant chaque publication.

## [1.2.0] — 2026-10-04

Popup stable et plus claire, 12 formats d'enregistrement, suivi du téléchargement sur
l'icône et dans la page, détection fiable sur beaucoup plus de sites.

### Ajouté
- **12 formats d'enregistrement**, choisis dans une liste :
  - vidéo : MP4, MKV, WebM, MOV, AVI, TS ;
  - audio seul : M4A, MP3, Opus, OGG, FLAC, WAV.

  L'image n'est jamais réencodée (ce serait beaucoup trop long dans le navigateur) : seuls
  les formats compatibles avec la source sont proposés. Par exemple, pas de WebM pour une
  vidéo H.264, mais MP4, MKV, MOV, AVI et TS. Le son est copié quand c'est possible,
  sinon converti.
- **Conversion des fichiers directs** : un lien `.webm` peut être enregistré en MP4, un
  MP4 en MOV, etc. Au-delà de 1,5 Go, le fichier est enregistré tel quel.
- **Progression sur l'icône** de l'extension : pourcentage pendant le téléchargement
  (« 42% »), puis **✓** en vert (ou **!** en rouge en cas d'échec) pendant 6 secondes. Le
  survol de l'icône indique le pourcentage et le titre.
- **Bulle « Téléchargement terminé »** en bas à droite de la page que tu regardes, avec un
  bouton **Afficher**. Elle fonctionne même quand les notifications de Windows sont
  désactivées, et suit le thème clair ou sombre.
- **Vidéos annoncées par la page** sans être lues, détectées puis vérifiées : métadonnées
  de partage (`og:video`, `twitter:player:stream`), `contentUrl` schema.org, balises
  `<source>` d'un lecteur pas encore lancé, liens directs vers des fichiers vidéo ou audio.
  Au plus 12 par page ; elles passent après la vidéo en cours de lecture.
- **Fichiers sans extension ni type précis** (ex. `/video?id=3` servi en
  `application/octet-stream`) : tout ce qu'un lecteur vidéo charge est examiné à partir de
  ses premiers octets.

### Modifié
- **Popup à taille fixe** (380 × 600 px) : elle ne rétrécit plus sur l'onglet Historique et
  ne change plus de taille à l'ouverture des Réglages.
- **Qualité et format dans deux listes déroulantes** sur une même ligne, au lieu des
  pastilles qui passaient à la ligne. Chaque qualité affiche sa taille (annoncée par la
  source ou estimée d'après son débit), chaque format une courte description. Les listes
  s'utilisent aussi au clavier (flèches, Entrée, Échap).
- Le bouton **Audio seul** est remplacé par le groupe « Audio seul » de la liste des formats.
- **Réglages** : formats vidéo et audio par défaut choisis dans les mêmes listes (6 + 6).
- **Ordre des vidéos** : la vidéo en cours de lecture et les vidéos longues passent en tête,
  puis les liens, puis les extraits courts.

### Corrigé
- **Carte vidéo décentrée** (marge plus grande à droite) et **contenu décalé vers la gauche**
  quand une barre de défilement apparaissait : marges symétriques de 14 px, place de la
  barre réservée des deux côtés.
- **Barres de défilement** non stylisées dans les Réglages : barres fines aux couleurs du
  thème partout.
- **« Fichiers randoms »** listés comme des vidéos :
  - les morceaux d'un flux (segments fMP4 nommés `.mp4`) sont écartés ;
  - les fichiers qui composent un flux déjà listé (ex. `CMAF_360.mp4` sur Reddit) sont masqués ;
  - un même fichier joint par plusieurs adresses (redirection, miroir, lien de
    téléchargement, ex. archive.org) n'apparaît qu'une fois.
- Publicités : deux régies de plus écartées (Xandr/AppNexus `adnxs-simple.com`, Viously…).
- Les fichiers `.ogv` (vidéo Ogg) étaient étiquetés « Audio ».
- Titres : le nom du site en suffixe (« … : Internet Archive ») est retiré.

### Limites connues
- La fenêtre « Enregistrer sous » peut s'ouvrir malgré le réglage de Grabby : c'est le
  réglage du navigateur qui prime (voir la FAQ du README).

## [1.1.0] — 2026-10-04

Choix du format, notifications, tri des vraies vidéos, vrais titres et miniatures, et
YouTube enregistré discrètement.

### Ajouté
- **Choix du format** MP4 (par défaut), WebM ou MKV, à chaque téléchargement et dans les
  réglages. Une source WebM/VP9 est copiée en MP4 sans réencodage, et les MP4 sont
  optimisés pour démarrer avant d'être entièrement chargés (`+faststart`).
- **Notification système** à la fin d'un téléchargement (désactivable) ; un clic affiche le
  fichier dans son dossier.
- Bouton **Retélécharger** une fois le téléchargement terminé.
- **Vérification de chaque fichier** à partir de ses 256 premiers Ko : vraie vidéo, durée,
  chiffrement.
- **Miniatures** quand la page n'en fournit pas : image de la vidéo en cours, sinon la plus
  grande image visible.
- **YouTube (expérimental)** :
  - les qualités réellement proposées par YouTube (jusqu'en 4K/8K), avec leur taille ;
  - MP4 (H.264/AAC jusqu'en 1080p, VP9 au-delà) ou WebM (VP9/Opus) ;
  - enregistrement dans un **lecteur caché** : la vidéo que tu regardes n'est pas touchée et
    tu peux quitter la page.

### Modifié
- Libellés de qualité des **vidéos verticales** : 1080p au lieu de 608p.
- Titres nettoyés : nom du site retiré (« — Vidéo Dailymotion », « Prime Video: »),
  métadonnées schema.org utilisées, noms de fichiers faits d'identifiants ignorés.

### Corrigé
- Les fichiers **chiffrés (DRM)** des plateformes de streaming étaient proposés et donnaient
  des fichiers illisibles : ils sont maintenant affichés « Protégé ».
- Pages d'erreur, publicités, **aperçus au survol** et extraits de moins de 2 secondes ne sont
  plus listés.
- Une même vidéo n'apparaît plus deux fois (flux + « Lecteur »).
- La liste des qualités débordait de la popup.
- La popup pouvait rester bloquée en chargement sur un onglet invalide.

### Sécurité
- Aucun contournement de DRM : les contenus protégés sont détectés et
  jamais téléchargés.

## [1.0.0] — 2026-10-04

Première version.

### Ajouté
- Détection automatique des vidéos non chiffrées sur n'importe quel site : fichiers directs,
  flux HLS et DASH, y compris dans les lecteurs intégrés (iframes).
- **Mode capture** pour les lecteurs qui ne publient aucun fichier (lecteurs `blob:`/MSE).
- Choix de la qualité, **audio seul** (M4A ou MP3), progression en direct, annulation,
  nouvel essai, historique des 50 derniers téléchargements.
- Assemblage par **ffmpeg.wasm** embarqué (aucun code distant).
- Contenus protégés (DRM, HLS chiffré) détectés et jamais téléchargés.
- Capture YouTube expérimentale.
- Interface en français et en anglais, thème clair et sombre.

[Non publié]: https://github.com/titilyonnais/grabby/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/titilyonnais/grabby/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/titilyonnais/grabby/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/titilyonnais/grabby/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/titilyonnais/grabby/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/titilyonnais/grabby/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/titilyonnais/grabby/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/titilyonnais/grabby/releases/tag/v1.0.0
