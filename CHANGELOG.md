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

## [1.8.0] — 2026-10-06

Plusieurs langues audio et de sous-titres, chapitres, plusieurs extraits, images et
animations tirées de la vidéo, playlists et chaînes YouTube, téléchargements programmés et
limite de vitesse. Et des extraits YouTube enfin propres.

### Ajouté
- **Plusieurs langues de sous-titres à la fois** : la liste « Sous-titres » se coche
  maintenant comme une liste de cases. Chaque langue choisie devient une piste de la vidéo
  (avec sa langue et son nom), ou un `.srt` à côté ; deux fichiers de même langue sont
  numérotés.
- **Sous-titres traduits par YouTube** : quand aucune piste écrite n'existe dans la langue
  du navigateur et que YouTube sait traduire vers elle, la liste propose aussi « Français
  (traduit de : Anglais) », et la piste porte le nom et la langue de la traduction. Comme
  pour les autres sous-titres YouTube, Grabby garde ce que le lecteur caché charge
  lui-même : aucune requête en plus.
- **Plusieurs langues audio** : pour un flux HLS ou DASH qui propose plusieurs langues, une
  liste « Langue audio » permet d'en garder une autre que celle par défaut, ou plusieurs :
  chacune devient une piste de la vidéo, avec sa langue. En audio seul, c'est la première
  cochée qui est gardée.
- **Chapitres** :
  - ceux de YouTube, lus dans la description de la vidéo, où que soit l'horodatage sur la
    ligne (« 0:00 Intro », « Intro - 0:00 », « ⌨️ (1:45) Installer ») et selon la règle de
    YouTube : au moins trois, le premier à 0:00, dix secondes d'écart au moins ;
  - ceux d'un lecteur de page (`<track kind="chapters">`) ;
  - écrits dans le fichier (MP4, MKV, WebM, MOV, M4A, MP3, FLAC, OGG, Opus), recalés sur
    l'extrait quand on en coupe un. Un interrupteur « Garder les chapitres » permet de s'en
    passer.
- **Plusieurs extraits d'une même vidéo** (jusqu'à 8) : « Ajouter un extrait » sous le
  curseur, une pastille par extrait pour passer de l'un à l'autre ou le retirer, les autres
  restant visibles en pâle sur le curseur. Au choix :
  - **réunis dans un seul fichier**, dans l'ordre, avec un chapitre par extrait ;
  - ou **un fichier par extrait**, chacun nommé d'après ses temps.
  Pour un flux, seuls les segments des extraits sont téléchargés.
- **Images tirées de la vidéo**, nouveau groupe « Image » dans la liste des formats :
  - **JPEG** : une image fixe, au moment choisi sur un curseur ou tapé (« 1:05 ») ;
  - **GIF** et **WebP** animés : une partie de la vidéo (30 secondes au plus), 480 pixels de
    large, GIF avec sa propre palette, WebP bien plus léger.
  Seule la partie utile de la vidéo est téléchargée, YouTube compris.
- **Fichiers audio étiquetés** : le titre de la vidéo et sa chaîne (YouTube) sont écrits
  dans le fichier, et l'image d'aperçu de la vidéo devient la **pochette** (M4A, MP3,
  FLAC). Si l'image ne peut pas être lue, le fichier est fait sans elle.
- **Playlists et chaînes YouTube** : sur une playlist, une vidéo lue dans une playlist ou
  l'onglet Vidéos (ou En direct) d'une chaîne, une carte « Playlist : 42 vidéos » propose
  **Tout télécharger** dans une qualité (1080p à 360p) et un format (vidéo ou audio seul).
  Les vidéos sont enregistrées deux à la fois, numérotées dans l'ordre de la liste
  (« 01 - Titre ») ; dans le fichier, le titre reste celui de la vidéo et la chaîne en est
  l'artiste. Seules les vidéos déjà affichées par la page sont prises : faire défiler la
  page en charge d'autres.
- **Quand télécharger**, nouveau groupe de réglages :
  - **seulement à certaines heures** (par exemple de 22:00 à 07:00, la nuit comprise) : les
    nouveaux téléchargements attendent la plage choisie, affichent « Commence à 22:00 » et
    démarrent seuls à l'heure, même si le navigateur s'était endormi. Un bouton « Lancer
    maintenant » les fait partir tout de suite ; ceux déjà commencés vont jusqu'au bout ;
  - **seulement en Wi-Fi** : proposé là où le navigateur connaît le type de connexion
    (ChromeOS, Android) ; sur les données mobiles, les téléchargements attendent le Wi-Fi ;
  - **vitesse maximale** (256 Ko/s à 10 Mo/s) : partagée par tous les téléchargements,
    appliquée tout de suite à ceux en cours. Un fichier simple passe alors par Grabby (le
    téléchargement du navigateur ne se ralentit pas) et reste enregistré tel quel ; pour
    YouTube, le lecteur caché lit moins vite d'autant (jamais sous la vitesse normale).
- **Prévenir des nouvelles versions** (désactivé par défaut, réglage « Mises à jour ») : une
  fois par jour, Grabby demande à GitHub quelle est la dernière version publiée. Si elle est
  plus récente, un bandeau « Grabby 1.9.0 est sorti » s'affiche avec un lien vers sa page ;
  Masquer le cache jusqu'à la suivante. Rien d'autre n'est envoyé et rien ne s'installe
  tout seul.

### Modifié
- Les **listes à choix multiples** (sous-titres, langues audio) gardent le menu ouvert
  pendant qu'on coche, avec de vraies cases.
- Un **fichier simple avec chapitres** est récupéré par Grabby puis réassemblé (sans
  réencodage), pour que ses chapitres soient écrits dans le fichier.
- La **piste audio principale** porte sa langue quand le flux la donne.

### Corrigé
- **Extraits YouTube qui revenaient au début** : la vidéo d'un extrait se lançait une
  seconde puis repartait du début, plusieurs fois, et le fichier se lisait mal. Le lecteur
  remplit parfois les trous de sa mémoire tampon en retéléchargeant un passage déjà reçu :
  les morceaux arrivaient en double et dans le désordre. Grabby remet maintenant chaque
  piste enregistrée en ordre (WebM comme MP4) avant de l'assembler : chaque passage une
  seule fois, dans l'ordre du temps.
- **Début d'extrait silencieux** : une image recopiée sans réencodage commence sur l'image
  clé qui précède l'extrait ; le son, les sous-titres et les chapitres partent maintenant
  de ce même instant, au lieu de laisser une ou deux secondes muettes au début. Les
  enregistrements d'extrait démarrent dix secondes avant le début demandé pour avoir cette
  image clé.
- **Fichier vide (262 octets)** après un enregistrement repris en plusieurs fois : un
  réglage de l'assemblage restait actif d'une étape à l'autre dans ffmpeg.wasm. Chaque étape
  repart maintenant de ses propres réglages.
- **JPEG et pochettes** : l'encodeur JPEG de ffmpeg.wasm plantait en calculant ses tables
  de compression optimales ; les tables standard sont utilisées.
- **Extraits réunis allant du tout début à la toute fin** de la vidéo : ils étaient pris
  pour « toute la vidéo » et enregistrés sans être coupés.
- **Extraits réunis d'une vidéo à plusieurs langues** : seule la première langue restait
  après l'assemblage final ; toutes sont gardées.
- **Listes déroulantes ouvertes vers le haut** : quand la popup était affichée dans une
  fenêtre plus haute qu'elle (ouverte dans un onglet, par exemple), la liste pouvait
  dépasser du haut et ses premiers choix devenaient inaccessibles.
- **Image en double** dans un enregistrement YouTube : quand le lecteur caché repartait (après
  une pause, ou relancé par YouTube), le morceau qu'il renvoyait pouvait commencer une image
  avant la fin du précédent, et les deux étaient gardés. Le morceau d'avant perd maintenant
  ce que le suivant a de nouveau, comme dans le tampon du lecteur (MP4 comme WebM). Au
  raccord de deux parties d'un enregistrement repris, la partie d'avant s'arrête aussi juste
  avant l'image où reprend la suite (ffmpeg coupe sur l'heure de décodage, et cette image
  est décodée un peu avant d'être montrée).

### Limites connues
- **Wi-Fi seulement** n'est proposé que si le navigateur indique le type de connexion :
  sur Windows, macOS et Linux, Chrome ne le donne pas.
- Les **playlists** ne prennent que les vidéos que la page a déjà affichées, et une vidéo
  dont l'intégration est désactivée par son auteur ne peut pas être enregistrée.
- La **vitesse maximale** ne ralentit pas un enregistrement de lecteur dans la page (il se
  fait à la vitesse de lecture).

## [1.7.0] — 2026-10-05

Pause, reprise, extraits et sous-titres pour **toutes** les vidéos : YouTube et tous les
lecteurs enregistrés compris. Sous-titres dans tous les formats courants.

### Ajouté
- **Pause et reprise des enregistrements** (YouTube et mode capture, sur tous les sites) :
  Pause arrête l'enregistrement en gardant ce qui est déjà enregistré ; Reprendre repart un
  peu avant l'endroit où il s'était arrêté, et les morceaux sont raccordés sans trou ni
  passage en double, en un seul fichier.
- **Reprise automatique des enregistrements** :
  - **connexion perdue** ou lecteur bloqué en route : l'enregistrement s'arrête et repart
    seul dès que possible, comme un téléchargement ;
  - **navigateur fermé** ou redémarré : l'enregistrement reprend à la réouverture. Si la
    page n'est plus ouverte, Grabby la rouvre dans un onglet en arrière-plan, finit
    l'enregistrement, puis referme cet onglet ;
  - **page fermée** pendant la pause : la barre affiche « En pause · page fermée » ;
    Reprendre rouvre la page, ou « Arrêter et enregistrer » garde ce qui est déjà là.
- **Extraits des enregistrements** : « Couper un extrait » est maintenant proposé pour
  YouTube et pour tout lecteur enregistré. Le lecteur part du début de l'extrait et
  s'arrête à sa fin : seule la partie demandée est lue (en accéléré) et enregistrée, et le
  bouton devient « Enregistrer l'extrait ».
- **Sous-titres de YouTube** : la liste « Sous-titres » propose les pistes de la vidéo, y
  compris celles générées automatiquement. Le lecteur caché de
  Grabby les affiche pendant qu'il enregistre, et Grabby garde ce que le lecteur charge :
  aucune requête supplémentaire vers YouTube.
- **Sous-titres de tous les lecteurs enregistrés** et **des fichiers simples** :
  - les fichiers de sous-titres d'une vidéo (`<track>` dans la page) sont proposés ;
  - les fichiers de sous-titres qu'un lecteur charge lui-même (WebVTT, SubRip, TTML) sont
    repérés et proposés avec son lecteur, quand il est le seul de son cadre ;
  - avec un fichier enregistré tel quel, ils sont mis dans un `.srt` à côté ; avec une
    conversion, ils sont intégrés à la vidéo.
- **Nouveaux formats de sous-titres** :
  - **WebVTT et TTML dans des segments MP4** (`wvtt` et `stpp`), utilisés par beaucoup de
    flux DASH et par les flux HLS en fMP4 ;
  - **fichiers TTML / DFXP** (DASH ou fichiers à part), avec leurs temps en heures, en
    images, en ticks ou en secondes, l'italique et le gras ;
  - **formats propres à YouTube** (`json3`, `srv3`, `srv1`) ;
  - le décalage de présentation des flux DASH (`presentationTimeOffset`) est appliqué.
- **Extrait et sous-titres ensemble** pour les enregistrements : seules les répliques de la
  partie enregistrée sont gardées, recalées à partir de zéro.

### Modifié
- **Tout télécharger** prend aussi les vidéos YouTube et les lecteurs à enregistrer : toutes
  les vidéos de la page peuvent être cochées.
- Les **enregistrements** affichent leur bouton Pause comme les téléchargements, et les
  données d'un enregistrement en pause sont gardées jusqu'à sa reprise (elles étaient
  effacées au redémarrage du navigateur).

### Corrigé
- Les **sous-titres MP4 d'un flux DASH** (`wvtt`, `stpp`) étaient ignorés, et un flux qui
  n'avait que ceux-là ne proposait aucun sous-titre.
- Un enregistrement **bloqué à mi-chemin** (lecteur figé, réseau coupé) s'arrêtait avec
  seulement ce qui était déjà enregistré, au lieu de reprendre.

## [1.6.0] — 2026-10-05

Téléchargements plus rapides qu'on peut mettre en pause et qui reprennent seuls, extraits,
sous-titres, « Tout télécharger », clic droit et raccourcis clavier, nouvel historique.

### Ajouté
- **Pause et reprise** : bouton Pause sur la carte, sur la ligne repliée et dans « Autres
  téléchargements ». Les morceaux déjà reçus sont rangés sur le disque au fur et à mesure :
  Reprendre repart de là, sans retélécharger ce qui est déjà arrivé.
- **Reprise automatique** :
  - **connexion perdue** : la barre affiche « Connexion perdue » avec un compte à rebours, et
    Grabby réessaie seul (après 3 s, 6 s, 12 s… jusqu'à 2 min entre deux essais), tout de
    suite dès que le réseau revient ;
  - **ordinateur en veille** ou **navigateur fermé** : le téléchargement reprend au réveil
    ou au redémarrage, là où il s'était arrêté ;
  - **liens expirés** pendant la pause (beaucoup de sites signent leurs liens pour quelques
    heures) : Grabby redemande des liens neufs à la page si elle est encore ouverte ; sinon il
    explique qu'il faut rouvrir la page et relancer le téléchargement.
- **Couper un extrait** : sous les choix de qualité et de format, « Couper un extrait »
  ouvre un rail à deux poignées (début et fin) et deux champs où taper les temps exacts
  (`1:05`, `65`, `1:02:03`). La durée de l'extrait et sa taille estimée s'affichent, le
  bouton devient « Télécharger l'extrait » et le fichier est nommé d'après lui
  (« Titre (1m05-2m40).mp4 »).
  - Pour un flux HLS ou DASH, **seuls les segments de l'extrait sont téléchargés** : une
    minute d'un film de deux heures se télécharge en quelques secondes.
  - Un fichier simple est téléchargé en entier puis coupé.
  - La coupe se fait sans réencoder l'image, sur l'image clé la plus proche : l'extrait peut
    commencer quelques secondes plus tôt que demandé (c'est indiqué sous le bouton).
  - Un extrait d'une très longue vidéo, trop lourde pour être assemblée en entier, tient
    souvent en mémoire : il est alors assemblé et converti normalement.
- **Sous-titres** : quand un flux en propose (HLS `EXT-X-MEDIA TYPE=SUBTITLES`, DASH en
  WebVTT), une liste « Sous-titres » permet d'en choisir un.
  - Ils sont **intégrés à la vidéo** (MP4 et MOV en `mov_text`, MKV en SubRip, WebM en
    WebVTT), avec leur langue, ou enregistrés **dans un fichier .srt à part** nommé comme la
    vidéo (« Titre.fr.srt »), que les lecteurs chargent tout seuls.
  - Les formats qui ne savent pas les garder (TS, AVI) les enregistrent toujours à côté.
  - Les segments WebVTT sont recalés sur l'horloge de la vidéo, les répliques répétées à
    la jonction de deux segments ne sont gardées qu'une fois, l'italique et le gras sont
    conservés.
  - Avec un extrait, seules ses répliques sont gardées, recalées à partir de zéro.
  - Un sous-titre illisible ne fait pas échouer la vidéo : elle est enregistrée sans.
- **Tout télécharger** : au-dessus de la liste, quand la page a plusieurs vidéos. Chaque
  ligne reçoit une case ronde (toutes cochées au départ), un seul format s'applique à
  toutes, et « Télécharger (N) » les met en file d'attente, deux à la fois, en meilleure
  qualité. Un fichier audio reste un fichier audio.
- **Clic droit** : « Télécharger cette vidéo avec Grabby » sur une vidéo, « Télécharger la
  vidéo de la page avec Grabby » ailleurs. Une bulle dans la page confirme le départ, ou
  explique pourquoi rien n'est parti (vidéo protégée, rien trouvé).
- **Raccourcis clavier** : Alt+Maj+G ouvre Grabby, Alt+Maj+D télécharge la vidéo principale
  de la page dans les formats des réglages. Modifiables dans `chrome://extensions/shortcuts`.
- **Nouvel historique** : téléchargements regroupés par jour (« Aujourd'hui », « Hier »,
  puis la date), avec miniature, format, qualité, taille et heure. Un fichier supprimé ou
  déplacé est signalé « introuvable ». Chaque entrée peut rouvrir sa page ou être retirée,
  et l'en-tête compte les entrées avec un bouton pour tout effacer.
- **Autres téléchargements** : les téléchargements lancés depuis un autre onglet (ou avant
  un redémarrage) apparaissent sous la liste, avec leur progression, Pause et Annuler.
- **Bouton Annuler** sur la ligne repliée d'une vidéo en cours de téléchargement.

### Modifié
- **Téléchargements nettement plus rapides** :
  - les morceaux arrivent dans n'importe quel ordre : un morceau lent ne retient plus les
    autres ;
  - le nombre de connexions s'adapte au débit (de 2 à 16, 6 au départ) et baisse de moitié
    quand le serveur dit qu'il sature (réponses 429 ou 503) ;
  - un fichier de 8 Mo ou plus, enregistré tel quel, est téléchargé par Grabby en plusieurs
    plages à la fois au lieu d'une seule connexion (si le serveur ne sait pas envoyer de
    plages, le navigateur s'en charge comme avant).
- **Barre de progression** qui suit les octets reçus (elle restait à 0 % puis sautait), sans
  liseré sombre autour de la partie corail.
- **Netteté à tout zoom et sur tout écran** : la barre de progression est faite de vrais
  arrondis, le texte est lissé en niveaux de gris (plus de franges jaunes et bleues sous
  Windows), icônes et lettres sont dessinées en précision géométrique. Vérifié à 100 %,
  125 %, 150 % et 300 %.
- **Listes qui se referment en douceur** : qualité, format et listes des réglages se
  replient dans leur bouton au lieu de disparaître d'un coup.
- **Pilule des onglets** : elle s'étire puis s'écrase contre son bord au lieu de dépasser
  de son rail.
- **Réglages** : la page se ferme comme elle s'ouvre, à l'envers (les groupes descendent
  l'un après l'autre, puis le titre, puis la page).
- **Boutons d'une carte tous à 48 px**, quel que soit l'état (prêt, en cours, terminé).
- **Valeurs qui changent** : la qualité, le format et la taille montent à leur place au lieu
  de changer d'un coup.
- **Un seul paquet** : chaque version est publiée dans un unique `grabby-vX.Y.Z.zip`, qui
  comprend la prise en charge expérimentale de YouTube. `npm run build` produit `dist/`.
- **Pages des autorisations et de confidentialité** réécrites pour les utilisateurs : à
  quoi sert chaque autorisation, en clair, et ce qui reste sur l'appareil.

### Corrigé
- **Liste des téléchargements jamais enregistrée pendant un téléchargement actif** : les
  mises à jour de progression repoussaient sans cesse la sauvegarde. Elle est maintenant
  enregistrée régulièrement, ce qui permet la reprise après un redémarrage.

### Sécurité
- Deux nouvelles autorisations, détaillées dans `docs/PERMISSIONS.md` : `alarms` (réveiller
  Grabby pour retenter un téléchargement coupé) et `contextMenus` (les entrées du clic
  droit). Les raccourcis clavier n'en demandent aucune.

### Limites connues
- Les sous-titres embarqués dans des segments MP4 (`wvtt`, `stpp`/TTML) et les sous-titres
  des fichiers simples (`<track>`) ne sont pas encore proposés.
- Pas d'extrait ni de sous-titres pour un enregistrement de lecture (mode capture), qui se
  fait en temps réel.

## [1.5.3] — 2026-10-04

### Corrigé
- **Interrupteurs** : un simple clic déclenchait l'étirement du bouton (prévu pour un appui
  long) en même temps que sa glissade, ce qui faisait un petit à-coup. L'étirement n'arrive
  plus qu'après un vrai appui maintenu.
- **Ligne d'une vidéo en cours de téléchargement** : le pourcentage passait sous les
  étiquettes dès qu'il avait deux chiffres. La barre de progression est maintenant sous le
  texte de la ligne, et le pourcentage reste à côté du type de vidéo.
- **Aperçu du nom de fichier** : l'icône du format était collée au bord arrondi ; elle a
  maintenant sa marge.

### Modifié
- **Miniature des lignes** : elle occupe toute la hauteur de la ligne, de haut en bas, au
  lieu de laisser du vide au-dessus et en dessous.
- **Plus d'étiquette « Expérimental »** sur les cartes des vidéos YouTube :
  l'explication sous le bouton Télécharger suffit.
- **Page Réglages plus animée** : elle glisse plus posément, le titre et la flèche de retour
  arrivent ensuite, puis les groupes de réglages montent l'un après l'autre.

## [1.5.2] — 2026-10-04

Finitions de l'interface.

### Corrigé
- **Interrupteurs des réglages** : en passant sur « activé », le bouton rond dépassait de
  son rail (le ressort l'envoyait trop loin). Il glisse maintenant sans dépasser, et
  s'étire toujours un peu quand on le maintient.
- **Liste des formats qui défilait toute seule** : descendre la souris dans la liste la
  faisait défiler jusqu'en bas sans rien faire. Elle ne défile plus qu'au clavier (flèches,
  Début, Fin) ou à la molette.
- **Texte trop près du bord** : les explications sous le bouton Télécharger et les chiffres
  sous la barre de progression ont plus de marge sur les côtés et en bas de la carte.

### Modifié
- **Lignes compactes moins arrondies** : la petite miniature ressemblait à une gélule.
  Miniature arrondie à 14 px dans une ligne à 22 px (toujours concentriques) ; la grande
  carte garde ses 32 px.

## [1.5.1] — 2026-10-04

### Corrigé
- **Liste déroulante refermée toute seule** juste après avoir déplié une carte : la carte
  défilait pour se mettre en vue à la fin de son animation, ce qui fermait une liste
  (qualité, format) ouverte entre-temps. Elle ne défile plus quand une liste est ouverte.
  Repéré par les tests de bout en bout sur la machine d'intégration continue, plus lente.

## [1.5.0] — 2026-10-04

Nouvelle interface (grande miniature, tout en pilules, animations à ressort), audit complet
du code et une série de correctifs trouvés par de nouveaux tests de bout en bout.

### Ajouté
- **Grande carte avec miniature** : la vidéo ouverte s'affiche en grand (miniature pleine
  largeur, titre, choix de qualité et de format, bouton Télécharger) ; les autres vidéos
  sont des lignes compactes. Cliquer sur une ligne la **déplie en grande carte** : la
  miniature grandit depuis sa place et la carte s'agrandit en douceur, l'autre se replie.
- **Animations « à ressort »**, un peu cartoon, partout où l'on agit : les boutons
  s'écrasent quand on appuie et rebondissent quand on relâche, la pastille des onglets et
  des choix (Auto / Clair / Sombre) glisse d'un choix à l'autre, les interrupteurs
  s'étirent quand on les tient, les menus jaillissent depuis leur bouton, l'icône du thème
  tourne, le logo sautille à l'ouverture, une petite gerbe de confettis entoure la coche
  « Enregistré ». Le réglage système « réduire les animations » est respecté.
- **Nom du fichier en touches** : les quatre parties (Titre, Qualité, Site, Date) tiennent
  sur une seule ligne, centrées, avec une pastille de coche qui saute dessus. La dernière
  partie cochée refuse de partir en **secouant la tête**.
- **Aperçu du nom en petite fiche de fichier** (extension, nom, dossier de destination) et
  **encart d'aide redessiné** pour « Enregistrer sous ».
- **Navigation au clavier** : flèches gauche / droite entre les onglets et dans les choix du
  thème ; à la fermeture des réglages, le focus revient sur le bouton Réglages.

### Modifié
- **Tout est rond et harmonisé** : chaque bouton, liste déroulante, barre de progression et
  touche est une pilule. Les cartes ont un rayon de 32 px : une pilule de 48 px placée à
  8 px du bord suit exactement l'arrondi de sa carte (24 + 8 = 32). Même règle dans les
  réglages et les menus.
- **Carte ouverte sobre** : plus de contour coloré, c'est sa taille qui la distingue.
- **Mode clair plus lisible** : textes secondaires, traits, contours des listes et piste
  des interrupteurs plus contrastés ; anneau de focus plus foncé.
- **Ouverture de la popup** sans flash : le thème est appliqué avant le premier affichage, et
  l'emplacement de chargement a la forme de la liste (une grande carte, puis des lignes),
  donc rien ne saute à l'arrivée des vidéos.
- **Réglages instantanés** : un réglage changé s'affiche tout de suite, sans attendre l'aller-
  retour avec le reste de l'extension.
- **Noms de fichiers lisibles** : les caractères interdits par Windows sont remplacés comme
  on l'écrirait à la main (« Film : la suite » → « Film - la suite », « AC/DC » → « AC-DC »)
  au lieu d'un tiret bas.
- **Taille des flux HLS** estimée sur le débit moyen annoncé par le site (et non le débit de
  pointe) : un épisode de 1,1 Go n'est plus annoncé à 1,8 Go ni refusé à tort.
- **Format OGG** : toujours en Vorbis (l'Opus a son propre choix).
- **Flux DASH en plusieurs parties** (publicité avant l'émission) : Grabby prend la partie
  principale, avec sa vraie durée.

### Corrigé
- **Opus** : l'enregistrement en Opus (et l'audio des WebM) échouait pour toute source qui
  n'était pas déjà en 48 kHz (la plupart des MP4) — l'encodeur libopus de ffmpeg.wasm
  plante. Grabby utilise maintenant l'encodeur Opus intégré à ffmpeg.
- **Gros fichiers convertis** : un fichier d'un seul morceau (conversion, extraction du son,
  réduction de qualité) échouait s'il mettait plus de 60 secondes à arriver. Le délai ne
  compte plus que les silences du serveur, et la taille reçue s'affiche pendant le
  transfert.
- **Pause pendant un enregistrement** : plus de minute de pause coupait l'enregistrement et
  laissait la vidéo de la page muette en accéléré. La page est maintenant prévenue, rend sa
  vitesse et son son à la vidéo, et l'enregistrement en pause n'est plus pris pour un
  plantage.
- **Annuler** arrête vraiment ffmpeg (le processeur est libéré tout de suite), et un
  téléchargement annulé pendant son attente ne lance plus sa conversion.
- **Format choisi ignoré** lors d'une réduction de qualité (MOV, AVI, TS sur une source
  WebM), et format affiché différent de celui envoyé après un changement de qualité.
- **« Réessayer »** sans effet quand la vidéo n'était plus sur la page ; un téléchargement
  en file d'attente échouait si la page changeait entre-temps.
- **Deux clics rapides dans les réglages** pouvaient s'annuler (par exemple décocher
  « Titre » juste après avoir coché « Qualité »), et un ancien état pouvait écraser le
  nouveau.
- **Les réglages volaient le focus** à chaque mise à jour (une liste ouverte se refermait
  pendant un téléchargement) ; les rouvrir juste après les avoir fermés les refermait.
- **Date du nom de fichier** en heure locale (entre minuit et 2 h, c'était la veille).
- **M4A depuis une source WebM** : le son est converti en AAC au lieu d'un Opus glissé dans
  un .m4a illisible par les lecteurs Apple.
- **Son d'une vidéo de plus de 1,5 Go** : refus clair au lieu d'un échec après le
  téléchargement complet.
- État « Enregistré » : le bouton « Afficher dans le dossier » ne recouvre plus le texte.

### Tests
- Nouveaux tests de bout en bout : **chaque format proposé** (11 pour une source MP4, 9 pour
  une source WebM) est téléchargé puis vérifié (signature du fichier, conteneur et codecs
  avec ffprobe) ; options de fichier (dossier Grabby, parties du nom, « Enregistrer sous »,
  notification désactivée) ; dépliage et repli des cartes ; case « Titre » décochable et
  dernière case gardée. 25 tests de bout en bout et 238 tests unitaires.

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
- *Rectificatif : cette version annonçait à tort des tests de bout en bout couvrant tous les
  formats et les options. Ils n'existaient pas encore ; ils sont arrivés avec la 1.5.0, et
  ont révélé un échec de l'Opus corrigé à ce moment-là.*

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

[Non publié]: https://github.com/titilyonnais/grabby/compare/v1.8.0...HEAD
[1.8.0]: https://github.com/titilyonnais/grabby/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/titilyonnais/grabby/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/titilyonnais/grabby/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/titilyonnais/grabby/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/titilyonnais/grabby/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/titilyonnais/grabby/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/titilyonnais/grabby/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/titilyonnais/grabby/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/titilyonnais/grabby/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/titilyonnais/grabby/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/titilyonnais/grabby/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/titilyonnais/grabby/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/titilyonnais/grabby/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/titilyonnais/grabby/releases/tag/v1.0.0
