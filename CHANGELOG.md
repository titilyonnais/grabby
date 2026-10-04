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

[Non publié]: https://github.com/titilyonnais/grabby/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/titilyonnais/grabby/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/titilyonnais/grabby/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/titilyonnais/grabby/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/titilyonnais/grabby/releases/tag/v1.0.0
