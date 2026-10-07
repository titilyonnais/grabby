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

## [2.3.2] — 2026-10-07

Un correctif, sur tes retours de la 2.3.1 : le téléchargement YouTube qui restait bloqué à
0 %, les options remises directement sous **Télécharger**, l'écart en trop à droite des
boutons YouTube, et la croix du message en bas de page. Cette fois, la panne a été
reproduite telle que tu la vivais (Grabby mis à jour pendant qu'un onglet YouTube est
ouvert), puis vérifiée corrigée sur un vrai téléchargement YouTube, dans Chromium et dans
Brave.

### Corrigé
- **Téléchargement YouTube bloqué à 0 %, sur la pilule comme dans le popup.** Après une
  installation ou une mise à jour, Grabby remettait son script dans les onglets déjà
  ouverts, mais pas le petit script qui écoute le lecteur de la page : l'ancien restait,
  relié à l'ancienne version de Grabby qui n'existait plus. Grabby ne savait donc plus que
  la vidéo était une vidéo YouTube, l'enregistrait par le lecteur de la page… que plus
  personne n'écoutait : 0 octet, pour toujours, sans message. Désormais :
  - les deux scripts sont remis ensemble dans les onglets ouverts, et le nouveau prend la
    place de l'ancien : plus besoin de recharger la page après une mise à jour ;
  - une vidéo YouTube est reconnue à son adresse (`/watch?v=…`, `/shorts/…`) même si le
    lecteur n'a rien dit, et passe par le lecteur caché de Grabby comme prévu ;
  - si un enregistrement par le lecteur de la page ne reçoit toujours rien au bout de 20 s,
    il s'arrête avec un message clair (« Ce lecteur ne peut pas être enregistré. Recharge
    la page et réessaie. ») au lieu de rester à 0 % sans fin.
  - le bouton **Télécharger | ⌄** est remplacé dès que la nouvelle version arrive (avant, l'ancien restait jusqu'à 1,5 s et un clic dessus ne faisait rien).
- **Le pourcentage disparaissait de la pilule** quand elle était en icône seule (fenêtre
  étroite) : pendant un téléchargement, le pourcentage reste maintenant affiché, et la
  pilule revient à l'icône seule une fois fini s'il n'y a pas la place.
- **Double écart à droite de Télécharger | ⌄.** L'espace était calculé d'après les styles
  de YouTube, qui ne correspondent pas toujours à ce qui est dessiné (bouton suivant avec
  sa propre marge intérieure, compte connecté). Il est maintenant mesuré sur les boutons
  réellement dessinés de chaque côté : 8 px visibles à gauche comme à droite, comme entre
  les boutons de YouTube. Vérifié à 1400, 1100, 900, 700 et 500 px de large, après un
  changement de vidéo, avec le bouton suivant caché ou passé à la ligne : l'écart ne bouge
  plus et la page ne déborde jamais.
- **Croix pas centrée dans le message en bas de page** (« Téléchargement lancé »). Le
  message avait 12 px de marge à gauche mais 8 px à droite : la croix était collée au
  bord. Les deux côtés font maintenant 12 px, la croix est à la même distance du bord que
  la coche de l'autre côté.

### Modifié
- **Les options sont de nouveau directement sous Télécharger** : **Extrait**, **Lire
  l'extrait**, **Retouches** et **Plus tard** sont visibles tout de suite, sans passer par
  « Plus d'options » (le pli de la 2.3.0 est retiré). Elles gardent les colonnes égales et
  la pastille du nombre de retouches de la 2.3.1.
- **Directs** : le bouton **Retouches** revient sous la carte d'un direct.
- Pendant un téléchargement, la ligne d'infos (taille reçue / taille totale, vitesse,
  temps restant) s'affiche dès les premiers octets reçus, y compris pour YouTube.

## [2.3.1] — 2026-10-06

Un correctif : la page YouTube ne défile plus sans fin vers la droite, les deux messages
signalés disparaissent de la liste d'erreurs de l'extension, et la carte « Plus d'options »
est rangée. Cette fois, la vérification lit la vraie liste d'erreurs de Chrome
(chrome://extensions), avertissements compris.

### Corrigé
- **Défilement horizontal sans fin sous les vidéos YouTube.** En 2.3.0, l'espace autour de
  **Télécharger | ⌄** était mesuré d'après sa propre position : quand le bouton suivant de
  YouTube était caché ou passait à la ligne (fenêtre étroite, compte connecté avec plus de
  boutons), chaque mesure trouvait l'écart trop petit, élargissait la marge, ce qui
  relançait la mesure… La marge grandissait sans fin (reproduit : 156 px et 208 px au lieu
  de 8) et poussait la page vers la droite. L'espace est maintenant lu uniquement dans les
  styles de YouTube (l'écart de sa rangée, la marge du bouton suivant) et borné entre 0 et
  8 px : ce que Grabby écrit ne change plus ce qu'il lit.
- **Débordement sur une fenêtre étroite.** À 500 px, la pilule poussait le bouton « ⋯ » de
  YouTube hors de la page (528 px de large pour 500). Grabby regarde maintenant si son menu
  ou la fenêtre débordent, pas seulement sa rangée, et passe à l'icône seule ; il revient au
  mot dès qu'il y a la place (la 2.3.0 restait en icône seule).
- **« The feature flag gating model execution was disabled »** (popup.html). Ce n'est pas
  une erreur de Grabby que l'on peut attraper : c'est Chrome qui écrit cet avertissement dans
  la liste de l'extension chaque fois qu'on lui demande si son IA intégrée (traducteur,
  résumeur Gemini Nano) est disponible alors qu'il l'a coupée. La rubrique IA locale le
  demandait à chaque ouverture. Grabby ne demande plus rien à Chrome sauf si le nouveau
  réglage **IA de Chrome** est activé ; s'il l'est et que Chrome répond qu'il a coupé son
  IA, le réglage se désactive seul et le dit, pour que l'avertissement ne revienne pas. La
  demande précise aussi la langue du résumé (Chrome avertissait qu'elle manquait).
- **« No language specified - defaulting to English (en) »** (transformers.js). Avec
  **Détecter**, aucune langue n'était donnée à Whisper, et transformers.js prend alors
  l'anglais sans rien détecter : une vidéo en français était transcrite comme de l'anglais.
  Grabby détecte maintenant la langue lui-même (Whisper écoute jusqu'à trois passages de
  30 s, au début, au milieu et vers la fin d'un long son) puis transcrit dans cette langue.
  Vérifié sur de vraies voix : le français et l'anglais sont reconnus et bien transcrits.
  transformers.js n'écrit plus rien dans la console.
- **Plus d'options, « Retouches (2) » renvoyait « Plus tard » à la ligne.** Le nombre de
  retouches s'affiche maintenant dans une pastille à la place de l'icône : le bouton garde
  sa largeur.

### Modifié
- **Plus d'options** : **Extrait**, **Lire l'extrait**, **Retouches** et **Plus tard** se
  partagent toute la largeur de la carte en colonnes égales (deux par deux quand ils sont
  quatre), le texte centré.
- **Réglages** : en bas, la phrase sur la confidentialité est centrée et la version
  (« Grabby 2.3.1 ») est juste en dessous, au lieu d'être collée à droite.

### Ajouté
- Réglage **IA de Chrome** (rubrique IA locale), désactivé par défaut : Grabby essaie
  d'abord le traducteur et le résumeur intégrés à Chrome, quand ils sont prêts. Il vaut
  pour les téléchargements comme pour l'Atelier de la page complète.

### Supprimé
- Dans la carte d'une vidéo enregistrée en arrière-plan, le texte « Grabby télécharge
  cette vidéo en arrière-plan : tu peux continuer à la regarder normalement. Un message te
  prévient quand c'est fini. »

### Vérifié
- Sur le vrai youtube.com, en clair et en sombre, à 1400, 1100, 900, 700 et 500 px de large,
  après une navigation vers une autre vidéo, avec le bouton suivant caché puis passé à la
  ligne : marges de 8 px au plus, stables pendant 8 s, page jamais plus large que sans
  Grabby.
- La vraie liste d'erreurs de Chrome (chrome://extensions, mode développeur), lue après la
  popup, ses options, les 7 rubriques de réglages, les 9 rubriques de la page complète, le
  panneau latéral et youtube.com à quatre largeurs : vide. Le même relevé montre bien
  l'avertissement de Chrome quand **IA de Chrome** est activé (le relevé fonctionne).
- Le test « aucune erreur » compte maintenant aussi les avertissements, simule un Chrome
  qui a coupé son IA, fait des retouches et vérifie que les boutons restent sur une ligne
  en colonnes égales ; il échoue bien sur l'ancien comportement. Le test YouTube vérifie
  les marges avec le bouton suivant caché ou passé à la ligne.

## [2.3.0] — 2026-10-06

Les boutons sous YouTube sont maintenant identiques à ceux de YouTube au pixel près, la bulle
ronde sur les vidéos disparaît, les cartes reviennent à l'essentiel avec « Plus d'options »,
et deux erreurs signalées sont corrigées — vérifié dans un vrai navigateur, écran par écran.

### Modifié
- **Boutons YouTube : dégradé et survol exacts.** Mesures pixel par pixel sur youtube.com,
  à côté du bouton « Partager », bouton au repos et sous la souris, en clair et en sombre :
  - YouTube ne pose pas de voile sur le fond de ses boutons, seulement un reflet en haut :
    un dégradé de blanc (5 % en sombre, 20 % en clair) qui s'efface aux trois quarts. Grabby
    ajoutait un voile en plus et un reflet trop fort (ou noir en clair) : son bouton était
    plus clair, surtout au survol ;
  - au repos comme au survol, les trois points mesurés (haut, milieu, bas) donnent
    maintenant les mêmes couleurs que « Partager » (à 1/255 près sur une seule valeur).
- **Boutons YouTube : espace à droite.** Le bouton « Partager » a déjà sa propre marge de
  8 px ; Grabby en ajoutait 8 de plus. L'espace est maintenant mesuré des deux côtés : 8 px
  à gauche comme à droite, comme entre les boutons de YouTube.
- **Cartes allégées.** Une carte ouverte montre l'essentiel : qualité, format,
  **Télécharger**. Une seule ligne **Plus d'options** range les sous-titres (et « Créer les
  sous-titres » avec l'IA locale), les langues audio, les chapitres, **Extrait**, **Lire
  l'extrait**, **Retouches** et **Plus tard**. Repliée, la ligne dit ce qui est activé
  (« sous-titres, extrait, 2 retouches »). Pour un direct, ses retouches y sont aussi.
- **« Suivre la chaîne » quitte les cartes de vidéo** : il reste sur les cartes de chaîne et
  de playlist, et dans la page complète (rubrique Chaînes).
- **Pause, Arrêter et Annuler** pendant un téléchargement ont tous la couleur du bouton
  **Télécharger** (blanc et icône noire en sombre, l'inverse en clair). Carte repliée,
  **Arrêter et enregistrer** apparaît aussi, à côté d'Annuler, pour un enregistrement ou un
  direct.
- **Réglages, IA locale redessinée** : chaque fonction (transcription, traduction, résumé)
  sur une ligne, son état dans une étiquette à droite (verte quand c'est prêt) et ce qui la
  fait en dessous ; les marges sont celles des autres réglages, aucun texte ne sort de la
  carte. Le test et « Oublier les modèles » n'apparaissent qu'une fois l'IA autorisée.
- **Réglages, Noms et dossiers** : la note « Une fenêtre « Enregistrer sous » s'ouvre quand
  même ? » respecte les marges des lignes au-dessus.
- Le réglage « Boutons sous les vidéos YouTube » décrit simplement ce qu'il fait.

### Supprimé
- **La bulle ronde sur les vidéos et les miniatures** (le rond Grabby au survol, son menu
  déroulé et sa couleur) : supprimée partout, elle n'existe plus du tout. Les boutons sous
  le lecteur YouTube, le clic droit, Alt+Maj+D, Alt+Maj+S et `gb` restent.

### Corrigé
- **« Uncaught Error: Extension context invalidated » (scanner.js:74) sur YouTube** : après
  une mise à jour, un appel venu de la bulle partait encore vers l'ancienne extension. La
  bulle n'existe plus, et tous les appels du script de page à Chrome (messages, réglages,
  textes traduits, écouteurs) passent maintenant par une seule porte qui vérifie d'abord que
  Grabby répond ; sinon le script s'arrête sans rien lever.
- **« The feature flag gating model execution was disabled » dans la popup** : Chrome lève
  cette erreur quand ses modèles intégrés (traducteur, résumeur) sont coupés par un réglage
  du navigateur. Grabby l'attrape et considère simplement le modèle comme absent (le
  traducteur Opus-MT et le résumé simple prennent le relais).
- **Boutons YouTube recalculés sans fin** : le calcul de l'espacement réécrivait le style du
  bouton à chaque image (près de 300 fois par seconde sur youtube.com). Il n'écrit plus que
  ce qui change : zéro modification au repos.

### Vérifié
- Un nouveau test parcourt toute l'extension dans Chromium caché (popup, carte et ses
  options, téléchargement, historique, les 7 rubriques de réglages, les 10 rubriques de la
  page complète, panneau latéral) et échoue à la moindre erreur.
- Sur le vrai youtube.com, en clair et en sombre : aucune erreur de Grabby (page d'une
  vidéo, menu, page d'accueil avec les miniatures survolées), rien dessiné sur les
  miniatures, 8 px de chaque côté de la pilule.

## [2.2.0] — 2026-10-06

Les boutons sous le lecteur YouTube sont refaits d'après les vrais (mesurés sur youtube.com)
et gagnent un menu d'options ; une panne après mise à jour est réparée, et toute l'interface
a été relue bouton par bouton : alignements, textes faux, fonctions qui ne marchaient pas.

### Corrigé
- **Boutons YouTube disparus, erreurs « scanner.js:31 »** : quand Grabby se mettait à jour
  (ou était rechargé) pendant qu'un onglet YouTube restait ouvert, le script déjà dans la
  page perdait son extension. Chaque appel à Chrome levait alors « Extension context
  invalidated », toutes les 1,5 seconde, et les boutons sous le lecteur ne revenaient plus
  sans recharger la page. Maintenant :
  - le script de la page vérifie que Grabby répond avant de lui parler ; sinon il retire
    ses boutons et s'arrête, sans erreur ;
  - après une installation ou une mise à jour, Grabby se remet tout seul dans les pages
    déjà ouvertes (nouvelle autorisation interne « scripting », sans nouvel
    avertissement) ; une seule copie reste active, jamais deux rangées de boutons.
- **Boutons YouTube pas à la bonne taille ni aux bonnes couleurs** : YouTube a changé ses
  boutons (40 px au lieu de 36) et ne publie plus ses couleurs dans des variables lisibles ;
  Grabby retombait sur ses propres couleurs. Les boutons reprennent maintenant les mesures
  relevées sur youtube.com : 40 px de haut, coins de 20 px, 16 px de marge, Roboto 500
  14 px, icônes de 24 px à 6 px du texte, le filet de 1 × 24 px entre les deux parties, et
  les couleurs **lues sur le bouton « J'aime » de YouTube lui-même** (clair ou sombre,
  changées dès que YouTube change de thème). L'icône de téléchargement est celle de YouTube,
  les autres sont dessinées au même trait de 2 px.
- **Croix pas centrée** dans la bulle en bas à droite (« Téléchargement lancé », « Photo
  enregistrée »…) : c'était le caractère « × » posé sur une ligne de texte ; c'est
  maintenant une icône centrée dans un rond de 32 px. La bulle prend aussi ta couleur.
- **« Masquer » à cliquer deux fois** après une annulation (et « Télécharger à nouveau »
  après un téléchargement) : la carte montre le dernier téléchargement de la vidéo ; le
  masquer faisait réapparaître le précédent (annulé ou enregistré). Un clic les efface
  maintenant tous, et la carte revient à ses choix.
- **« Suivre la chaîne » pas aligné** : il était seul sous les explications, avec une autre
  forme que les autres boutons. Il rejoint la rangée **Extrait, Retouches, Plus tard**, avec
  la même forme, et il suit maintenant la **qualité choisie** dans la carte (il prenait
  toujours 1080p).
- **Minuterie qui ne s'arrêtait pas** à la fin d'un direct enregistré dans la fenêtre.
- **Textes faux ou trompeurs** :
  - « Enregistrement » et « Enregistrement… » pour deux états différents : le second devient
    « Écriture du fichier… » ;
  - l'IA locale renvoyait vers « Réglages, IA et pages », qui s'appelle « IA locale » ; le
    résumé se fait aussi sans le résumeur de Chrome (résumé simple de Grabby), c'est dit ;
  - « Les diffusions en direct ne sont pas prises en charge » alors que les directs HLS et
    YouTube s'enregistrent : l'erreur dit maintenant que **ce** direct (DASH) ne peut pas
    l'être ;
  - « deux à la fois » dans la liste d'adresses et la playlist, alors que le nombre se règle
    de 1 à 4 ;
  - « Chaînes et podcasts » ne parlait que de YouTube : les podcasts sont mentionnés
    partout (adresse, explication, écran vide, erreurs) ;
  - un seul nom par chose : « Son seul » (au lieu de « Audio seul » et « Le son »),
    « Réduction », « Place occupée », « autoriser » l'IA (au lieu d'« activer »), « Ajouter à
    Plus tard » / « Ajouté à Plus tard » (au lieu de « Mettre de côté », « Mis de côté »,
    « Mise de côté ») ;
  - « 1 images enregistrées », « 1 téléchargements lancés » : le singulier est géré ;
  - « Glisser pour changer l'ordre » devient « Glisse… », comme le reste de l'interface.

### Ajouté
- **Menu ⌄ sous le lecteur YouTube**, juste à droite de **Télécharger**, dessiné comme les
  menus de YouTube (coins de 12 px, lignes de 36 px, icônes de 24 px) :
  - **Vidéo en MP4** (ton format) : chaque **qualité** de la vidéo avec la **taille** du
    fichier ; un clic la télécharge dans cette qualité ;
  - **Son seul** (avec ton format audio), **Photo de l'image affichée**, **Ajouter à Plus
    tard** ;
  - **Ouvrir Grabby** : la fenêtre de Grabby sur cette page, pour tous les autres choix
    (extrait, retouches, sous-titres…) ; le panneau latéral si Chrome refuse la fenêtre.
  - Il se ferme avec Échap, un clic ailleurs ou un défilement ; il s'ouvre au-dessus du
    bouton quand la place manque en dessous ; il se pilote au clavier.

### Modifié
- **Sous le lecteur YouTube** : une seule pilule **Télécharger | ⌄** au lieu de « Télécharger
  | Son seul » et des deux ronds Photo et Plus tard (ils sont dans le menu). Quand la rangée
  de YouTube manque de place, la pilule ne garde que ses icônes, comme les boutons de
  YouTube. La progression d'un téléchargement (vidéo ou son) s'affiche dans **Télécharger**.
- **Carte ouverte** : le titre, ses détails, les menus, les actions et les explications
  partent tous du bord gauche de la miniature. Les actions (Extrait, Lire l'extrait,
  Retouches, Plus tard, Suivre la chaîne) sont des pilules de la taille de leur texte,
  dessinées comme les menus au-dessus, espacées de 8 px.
- **Page complète** : à côté d'un menu de 48 px (Qualité, Format), les boutons et le choix
  « La vidéo / Son seul » font 48 px aussi (Chaînes et podcasts, Bibliothèque…).
- La ligne de détails d'un téléchargement n'utilise plus le point médian comme séparateur.
- **En-tête de la fenêtre** : le bouton soleil / lune est retiré ; il remplaçait le thème
  « Auto » par Clair ou Sombre sans le dire. Le thème se règle dans Réglages, Général.

### Supprimé
- Deux textes qui ne servaient plus nulle part.

### Limites connues
- Après une mise à jour, une page restée ouverte retrouve ses boutons, mais **Enregistrer le
  direct** et la capture depuis le lecteur n'y remarchent qu'une fois la page rechargée.
- Le menu ⌄ ne liste des qualités que pour les vidéos que Grabby lit directement ; pour une
  vidéo enregistrée depuis le lecteur, il commence à **Son seul**.

## [2.1.0] — 2026-10-06

Les boutons sous le lecteur YouTube deviennent de vrais boutons YouTube, « Aperçu » sert
enfin à quelque chose, l'IA locale montre ce qu'elle a et ce qu'elle sait faire, et toute
l'interface passe à une seule couleur, plus sobre et plus cohérente.

### Corrigé
- **Boutons sous le lecteur YouTube illisibles** : ils étaient écrits en noir sur le fond
  sombre de YouTube (la couleur du texte de la page n'arrivait pas jusqu'à eux), et ni
  leur taille, ni leur police, ni leurs icônes n'étaient celles de YouTube. Ils reprennent
  maintenant exactement les boutons de YouTube : 36 px de haut, Roboto, icônes de 24 px,
  les couleurs de YouTube (thème clair ou sombre suivi tout seul), l'infobulle de YouTube
  au survol.
- **« Aperçu » qui ne faisait que lancer la vidéo** : sur YouTube et les autres flux, il
  remettait le lecteur de la page au début et lançait la lecture, comme le bouton Lecture.
  Il devient **Lire l'extrait** et n'apparaît qu'une fois un extrait coupé.

### Ajouté
- **Boutons Grabby sous le lecteur YouTube**, placés juste après le pouce levé / pouce
  baissé :
  - une pilule en deux parties **Télécharger | Son seul**, comme celle des pouces ;
  - pendant le téléchargement, la partie concernée affiche **En attente**, puis le
    **pourcentage** avec la barre qui avance dedans, puis **Enregistré** (ou **Échec**)
    pendant 3 secondes ;
  - deux boutons ronds, comme « ··· » : **Photo** (l'image affichée, en PNG) et **Plus
    tard** (la vidéo mise de côté) ;
  - quand la fenêtre est étroite, la pilule ne garde que ses icônes, comme YouTube.
- **Lire l'extrait** en boucle : arrivé à la fin de l'extrait, il reprend à son début. Dans
  la popup pour un fichier ; dans le lecteur de la page pour un flux, jusqu'à ce que tu
  ailles ailleurs dans la vidéo.
- **Réglages, IA locale** : une rubrique à part qui montre ce que l'IA a sur ton ordinateur.
  - **Transcription** : Whisper base (OpenAI), prêt ou pas, et la place qu'il prend ;
  - **Traduction** : chaque paire de langues déjà téléchargée pour Opus-MT (par exemple
    « Anglais vers Français, 107 Mo »), et si le traducteur intégré à Chrome est prêt ;
  - **Résumé** : si le résumeur intégré à Chrome est disponible dans ce navigateur ;
  - **Tester la transcription** : charge vraiment le modèle et lui fait écouter un son de
    test, puis dit combien de temps ça a pris (ou pourquoi ça a échoué). Si le modèle
    n'est pas encore là, le bouton dit **Télécharger et tester (77 Mo)** ;
  - **Supprimer les modèles** : libère la place ; ils seront retéléchargés si besoin.
- **L'IA locale là où elle sert** : le menu **Sous-titres** d'une carte a un groupe « IA
  locale, sur ton ordinateur » avec **Créer à partir du son** et **Traduire en** (ta
  langue), avec la taille à télécharger la première fois. Une vidéo **sans sous-titres**
  propose **Créer les sous-titres**. Si l'IA n'est pas encore autorisée, l'accord est
  demandé juste dessous. Le panneau Retouches explique quel modèle fait quoi.
- **Raccourcis de la bibliothèque** affichés en touches (/, ← →, Entrée, F, X, Suppr).

### Modifié
- **Une seule couleur** : les rubriques de la page complète et des réglages n'ont plus
  chacune leur couleur ; les icônes sont neutres, et ta couleur (Réglages, Général)
  marque ce qui lance une action et l'endroit où tu es. Les types de fichiers (vidéos,
  sons, images) sont des nuances de cette couleur.
- **Page complète** : en-têtes compacts (sans grande tuile lumineuse ni halo coloré), les
  chiffres sur une seule ligne séparés par des filets au lieu de cartes, les « Par type »
  des statistiques à plat.
- **Réglages** : le menu est une liste (icône, nom, ce qui est réglé, chevron) au lieu de
  tuiles colorées ; **Page complète**, **Panneau latéral** et **Revoir la visite** sont
  sous la liste ; la rubrique « IA et pages » devient **IA locale**.
- **Fenêtre** : **Images de la page** et **Plus tard** (avec le nombre en attente) passent
  dans l'en-tête au lieu d'un bouton seul en bas ; les actions d'une carte tiennent sur
  une ligne (**Extrait**, **Retouches**, **Plus tard**) ; la miniature d'une carte ouverte
  est un peu moins haute pour laisser la place aux choix.
- **Bulle sur les vidéos** : ouverte, son rond montre une croix pour la refermer (la flèche
  tournée ressemblait à « aller à la fin »).
- **Écrans vides** : une phrase claire, sans grosse icône qui flotte.
- Les textes n'utilisent plus le point médian « · » comme séparateur.

### Limites connues
- Les boutons sous le lecteur YouTube suivent la mise en page actuelle de YouTube ; si
  YouTube la change, Grabby les remet à la fin de la rangée de boutons.
- Le test de l'IA locale tourne dans la fenêtre de Grabby : la fermer pendant le premier
  téléchargement du modèle l'interrompt (il reprendra au prochain essai).

## [2.0.0] — 2026-10-06

La grosse mise à jour : une bibliothèque qui retrouve **ce qui est dit** dans tes vidéos,
un vrai lecteur, des favoris et des collections, le **panneau latéral**, la couleur de ton
choix, les **podcasts**, les vidéos **à télécharger plus tard**, **toutes les images**
d'une page en un .zip, la **photo** d'une vidéo, des fichiers **vérifiés** et des erreurs
qui disent **quoi faire**. Majeure, parce que la bulle sur les vidéos, les réglages et le
menu du clic droit changent de forme.

### Ajouté
- **Chercher ce qui est dit** : la recherche de la bibliothèque trouve aussi les mots
  prononcés dans tes fichiers (leurs sous-titres ou leur transcription par l'IA locale),
  sans tenir compte des accents ni des majuscules, même à cheval sur deux phrases. Chaque
  résultat montre les moments où c'est dit ; un clic lance la lecture à cet instant.
- **Lecteur amélioré** dans la bibliothèque : **vitesse** de 0,5× à 2×, **boucle A-B**,
  **image par image** (avant et arrière), **photo** de l'image (en PNG, dans le dossier
  de tes téléchargements), et le **texte synchronisé** à côté : la phrase en cours est
  surlignée, un clic sur une phrase y saute. Au clavier : Espace, ←/→ (5 s), `,` et `.`
  (une image), `[` et `]` (vitesse), A et B (boucle), S (photo), Échap.
- **Reprendre la lecture** : le lecteur se souvient où tu t'es arrêté dans chaque fichier
  et y reprend (« Reprise à 12:40 », avec « Depuis le début » si tu préfères).
- **Exporter le texte** d'un fichier en **.txt** (avec les horaires), **.srt** (sous-titres)
  ou **.md** (Markdown).
- **Éditeur de sous-titres** : dans le lecteur, **Modifier** permet de corriger chaque
  phrase, d'en supprimer, et de **décaler** tout le minutage (±0,1 s ou ±1 s) ; le texte
  corrigé est gardé, cherché et exporté tel quel.
- **Favoris et collections** : une étoile sur chaque fichier, des collections nommées
  comme tu veux (un fichier peut être dans plusieurs), et des filtres en haut de la
  bibliothèque pour n'afficher que les favoris ou une collection.
- **Sélection multiple** : **Sélectionner**, puis coche des fichiers (ou **Tout
  sélectionner**) pour les mettre en favoris, dans une collection, les retélécharger ou les
  retirer d'un coup.
- **Annuler une suppression** : un fichier retiré de la bibliothèque (ou plusieurs) peut
  être remis pendant 8 secondes avec **Annuler**.
- **Raccourcis clavier** de la bibliothèque : `/` pour chercher, flèches pour se déplacer
  entre les fichiers, Entrée pour lire, F pour le favori, X pour sélectionner, Suppr pour
  retirer.
- **Miniatures hors ligne** : la bibliothèque garde une petite copie de l'image de chaque
  fichier, pour l'afficher même sans réseau ou quand le site l'a retirée.
- **Statistiques** (nouvelle rubrique de la page complète) : fichiers et place prise,
  enregistrements des 7 derniers jours, **un graphique par semaine** sur 12 semaines, les
  **sites** d'où viennent tes fichiers, la répartition **vidéo / son / image**, les
  formats, ton heure favorite et ton record de jours d'affilée. Tout est compté sur ton
  ordinateur.
- **Déjà téléchargé** : la carte d'une vidéo que tu as déjà enregistrée le dit
  (« Déjà téléchargé il y a 2 jours · MP4 · 1080p · 85 Mo »), avec **Ouvrir** et
  **Afficher dans le dossier**. Une vidéo YouTube est reconnue par son identifiant, les
  autres par leur page, leur titre et leur place dans la page (deux vidéos d'une même
  page ne se confondent pas).
- **À télécharger plus tard** : mets une vidéo de côté depuis la bulle sur les vidéos
  (**Plus tard**), le clic droit, ou le bouton **Plus tard** de sa carte. La nouvelle
  rubrique **Plus tard** de la page complète les liste ; **Tout télécharger** maintenant,
  une par une, ou **Programmer** une heure (la nuit, par exemple).
- **Podcasts et flux RSS** : la rubrique **Chaînes suivies**, renommée **Chaînes et
  podcasts**, suit maintenant aussi un **podcast** ou n'importe quel flux RSS ou Atom qui contient des fichiers audio ou vidéo. Colle
  l'adresse du flux, ou simplement celle du site du podcast (Grabby trouve le flux qu'il
  annonce). Chaque nouvel épisode est téléchargé tout seul, **tel quel** (un MP3 reste un
  MP3, sans réencodage), avec sa pochette.
- **Toutes les images** d'une page (nouvelle rubrique **Images de la page**) : les
  images, leurs grandes versions (`srcset`), les liens vers des images, les fonds et
  l'image de partage ; un filtre de taille (toutes, ≥ 200, 600 ou 1200 px), la sélection,
  puis **Enregistrer en .zip** (fabriqué sur ton ordinateur) ou **Une par une**. Depuis le
  clic droit → Grabby → « Toutes les images de la page… », ou le bouton **Images de la
  page** de la fenêtre.
- **Photo de la vidéo** (capture instantanée) : depuis la bulle sur les vidéos (**Photo**),
  ou avec **Alt+Maj+S**. L'image est enregistrée en PNG, nommée d'après la vidéo et le
  moment (« Titre (photo 4m05s).png »), et apparaît dans la bibliothèque.
- **Clic droit Grabby** : un menu « Grabby » avec télécharger cette vidéo ou son son,
  télécharger un lien (ou son son), mettre un lien ou la vidéo de la page **de côté pour
  plus tard**, et **toutes les images de la page**.
- **Barre d'adresse « gb »** : tape `gb`, un espace, puis un ou plusieurs liens, et
  Entrée : Grabby les télécharge (`gb son …` pour le son seul). Les liens sans `https://`
  sont acceptés.
- **Plusieurs à la fois** : le nombre de téléchargements simultanés se règle de 1 à 4
  (Réglages → Téléchargements).
- **Fichiers vérifiés** (Réglages → Téléchargements → « Vérifier les fichiers », activé par défaut) : chaque fichier fabriqué est relu avant
  d'être enregistré (sa structure : MP4, MKV/WebM, MP3, Ogg/Opus, FLAC, WAV, JPEG, PNG,
  GIF, WebP), et un fichier téléchargé directement doit avoir la taille annoncée. Un
  fichier abîmé ou coupé est **refait une fois** tout seul, puis signalé.
- **Diagnostic clair** : sous une erreur, **Pourquoi et que faire ?** explique la cause en
  une phrase et ce qu'il faut faire, et **Copier le rapport** met dans le presse-papiers
  quelques lignes à joindre à un signalement (version, navigateur, site, erreur,
  tentatives) — **jamais** l'adresse de la page ni le titre.
- **Panneau latéral** : Grabby peut s'ouvrir dans le panneau latéral du navigateur
  (Réglages → IA et pages → **Panneau latéral**). Il reste ouvert à côté de
  la page et suit l'onglet que tu regardes.
- **Couleur au choix** : corail, bleu, violet, vert, ambre ou rose, pour la fenêtre, la
  page complète et la bulle sur les vidéos ; et un mode **contraste élevé** (textes et
  bordures plus marqués).
- **Notifications riches** : la notification de fin montre l'**image de la vidéo**, et
  une ligne « Vidéo · 1080p · 85 Mo ».
- **Réglages synchronisés** (désactivé par défaut) : tes réglages et tes règles suivent
  ton compte de navigateur sur tes autres ordinateurs, par la synchronisation du
  navigateur lui-même (aucun serveur de Grabby). L'historique et les fichiers restent sur
  chaque ordinateur.
- **Visite guidée** : quatre bulles au premier lancement présentent la fenêtre, la page
  complète, les réglages et le reste (bulle, clic droit, `gb`, Alt+Maj+S). Elle se passe
  d'un clic et se revoit depuis Réglages → IA et pages.
- **Format vertical 9:16** dans les retouches : un bouton ouvre le recadrage sur un cadre
  vertical à placer sur l'action, pour les Shorts, Reels et TikTok.
- **Son plus propre** dans les retouches : moins de souffle et de bruit de fond (débruitage
  spectral), les grondements et l'extrême aigu coupés, une voix plus régulière. Pour les
  vidéos comme pour les fichiers son.

### Modifié
- **Bulle sur les vidéos** : elle n'affiche plus qu'un **rond Grabby** ; un clic la
  déroule (Télécharger, Son seul, Photo, Plus tard) avec une animation, et elle se replie
  après l'action. Elle prend la couleur choisie dans les réglages.
- **Réglages réorganisés, sans défilement** : 7 rubriques en tuiles (Général, Formats,
  Noms et dossiers, Téléchargements, Raccourcis, IA et pages, Synchro et mises à jour),
  chacune tenant dans la fenêtre. L'ancienne rubrique « Apparence », qui ne contenait que
  le thème, est devenue **Général** (thème, couleur, contraste, bulle sur les vidéos,
  notifications) ; la rubrique « YouTube » a été répartie (bulle dans Général, passages
  sponsorisés et volume égalisé dans Formats).
- **Bouton Stop** : le carré du bouton d'arrêt est plus grand et plus lisible.
- **Encodage plus rapide** : les retouches sans taille cible utilisent un réglage plus
  rapide de l'encodeur (le fichier est un peu plus gros, fabriqué nettement plus vite).
- **Menu du clic droit** : ses entrées sont regroupées sous « Grabby » (voir plus haut).
- La page complète s'ouvre directement sur une rubrique (et sur l'onglet concerné) depuis
  la fenêtre, le clic droit ou la barre d'adresse.

### Limites connues
- L'encodage reste fait par ffmpeg dans le navigateur, sur un seul cœur : le
  multi-cœur demanderait d'isoler la page invisible de l'extension, ce qui empêcherait le
  lecteur YouTube caché de fonctionner.
- La photo d'une vidéo dont le site interdit la lecture de l'image passe par une capture
  de l'onglet : la vidéo doit être visible à l'écran à ce moment-là.
- Le .zip des images est limité à 1,5 Go ; au-delà, utilise **Une par une**.

## [1.11.0] — 2026-10-06

Une version de finition : les bugs signalés sont corrigés (YouTube qui passait en 144p,
doublons dans la fenêtre), le bouton sur les vidéos est plus clair, les réglages sont rangés
en rubriques, et la page complète est entièrement redessinée, avec des animations partout.

### Corrigé
- **YouTube restait en 144p après un téléchargement** (sur le site, pas dans le fichier).
  Le lecteur caché de Grabby partage la mémoire de youtube.com avec tes onglets ; quand il
  enregistrait un son, il choisissait la plus petite image (inutile pour un son), et YouTube
  retenait ce choix comme le tien. Désormais, tout ce que le lecteur caché retient
  (qualité, débit, limites) reste dans sa propre mémoire et n'est **jamais** écrit dans
  celle de youtube.com. Pour ceux que la 1.10.0 avait touchés, Grabby efface une seule fois,
  à la prochaine visite de YouTube, une qualité forcée à 144p (et seulement celle-là : un
  choix de 720p ou 1080p n'est jamais touché).
- **Doublons dans la fenêtre** : un téléchargement lancé depuis le bouton sur la vidéo
  apparaissait deux fois (sur la carte de la vidéo et dans la liste du dessous, intitulé
  « YouTube », sans animation). Chaque téléchargement apparaît maintenant **une seule fois** :
  sur la carte de sa vidéo s'il en a une, sinon dans la liste. Une carte qui a plusieurs
  téléchargements (la vidéo et le son, par exemple) les empile, chacun avec son étiquette
  (« Vidéo · MP4 · 1080p », « Son · M4A ») et sa propre barre.
- **Titre « YouTube »** : un téléchargement lancé pendant qu'une vidéo YouTube se chargeait
  pouvait s'appeler seulement « YouTube ». Grabby prend maintenant le titre du lecteur quand
  il décrit bien cette vidéo, et ne nomme jamais un fichier juste « YouTube ».
- **Bibliothèque sans informations** : le téléchargement en cours n'y affichait que
  « YouTube · En pause · 9 % ». Il y a maintenant sa miniature, son titre, ce qu'il produit,
  le site, la progression et les boutons (pause, reprise, annuler).
- **Chaînes suivies limitées à 1080p** : on peut maintenant choisir **1440p** et
  **2160p (4K)** (en VP9, le seul format que YouTube propose au-dessus de 1080p, gardé tel
  quel dans le MP4). Une vidéo qui n'a pas cette qualité est prise dans sa meilleure.
- Les boutons désactivés de la page complète (« Aucune adresse trouvée ») ne ressemblaient
  pas assez à des boutons désactivés.

### Modifié
- **Bouton sur les vidéos** redessiné : une barre sombre et nette avec le logo, un gros
  bouton blanc **Télécharger** (la vidéo) et un bouton **Son seul** écrit en toutes lettres
  (l'ancienne note de musique prêtait à confusion). Après le clic, le bouton devient vert,
  avec une coche animée et « Lancé ». Sous le lecteur YouTube, la même chose en deux
  boutons : **Télécharger** et **Son seul**.
- **Réglages rangés en rubriques** : au lieu d'une longue liste, un menu de 8 rubriques
  (Apparence, Formats par défaut, Noms et dossiers, Téléchargements, Raccourci clavier,
  YouTube, Pages et IA, Mises à jour), chacune avec son icône, sa couleur et un résumé de ce
  qui est réglé dedans (« MP4 · M4A », « Tout de suite · notification »…). On entre dans une rubrique d'un
  clic, on revient au menu avec la flèche ou Échap ; le passage glisse dans un sens puis
  dans l'autre.
- **Page complète entièrement redessinée** :
  - un menu latéral rangé en groupes (Mes fichiers, Télécharger, Retoucher, Organiser),
    chaque rubrique avec sa couleur, et un surlignage qui **glisse** vers la rubrique
    choisie ;
  - des compteurs sur le menu (téléchargements en cours, adresses en attente, chaînes
    suivies) et, en bas, un anneau de progression de tout ce qui se télécharge ;
  - chaque rubrique arrive avec son en-tête coloré, ses cartes qui apparaissent l'une après
    l'autre, et des états vides qui disent quoi faire ;
  - **Bibliothèque** : les téléchargements en cours en grand (miniature, pourcentage,
    barre, boutons), trois chiffres (fichiers, place occupée, répartition par type, avec une
    barre qui se dévoile), des filtres, et une grille de vignettes avec dates relatives
    (« hier », « il y a 3 jours ») ;
  - **Chaînes suivies** : la **photo de profil** de chaque chaîne, son **@nom**, son
    **nombre d'abonnés**, et ses **6 dernières vidéos** en vignettes, chacune marquée
    « Enregistrée », « En cours » (avec sa progression), « Nouvelle » ou « Avant le suivi ».
    Le formulaire se valide avec Entrée, affiche son résultat, et « Ne plus suivre »
    demande une confirmation ;
  - **Liste d'adresses** : une barre de progression (« 3 sur 8 traitées ») ;
  - thème clair et sombre soignés, mise en page adaptée aux petites fenêtres, et les
    animations s'arrêtent si le système demande moins de mouvement.
- **Fenêtre** : les téléchargements de la liste ont leur miniature et un badge (vidéo ou
  son) ; chaque ligne arrive avec une animation.

### Ajouté
- Le profil d'une chaîne suivie (photo, @nom, abonnés) est lu sur sa page publique
  YouTube quand tu la suis, puis une fois par jour au plus. Rien d'autre n'est lu et rien
  n'est envoyé.

## [1.10.0] — 2026-10-06

La plus grosse version de Grabby : enregistrer les directs, un petit éditeur, une IA qui
travaille sur ton ordinateur (transcription, traduction, résumé), des chaînes YouTube
suivies, une liste d'adresses à télécharger d'un coup, et une page complète avec
bibliothèque, atelier et assemblage de vidéos.

### Ajouté

#### Téléchargement
- **Enregistrer les directs** : une vidéo en direct n'est plus refusée. Sa carte propose
  **Enregistrer le direct**, une durée maximale (30 min, 1 h, 2 h, 4 h, 8 h ou 12 h) et le
  format. La barre affiche « Direct · 12:34 » ; **Arrêter et enregistrer** termine le
  fichier à tout moment (sinon il se termine seul à la durée choisie, ou quand le direct
  s'arrête).
  - **Flux HLS** (la plupart des sites) : Grabby relit la liste du direct toutes les
    quelques secondes et récupère chaque nouveau morceau, sans réencoder. La pause et la
    reprise après une coupure fonctionnent comme pour le reste.
  - **YouTube** : le direct est enregistré depuis le lecteur de la page, à vitesse normale
    (l'onglet doit rester ouvert). Aucune adresse de flux de YouTube n'est utilisée. Le
    lecteur envoie le direct en petits fichiers de quelques secondes, chacun réglé sur
    l'horloge du direct : Grabby les remet bout à bout, fait commencer le son et l'image
    ensemble et garde la bonne durée.
  - La vignette d'un direct affiche **En direct** au lieu d'une durée (celle d'un direct
    n'est que ce que la page a chargé pour l'instant).
  - Un direct au format DASH ne peut pas être enregistré : la carte le dit.
- **Compresser à une taille** : dans « Retouches et IA », **Taille du fichier** choisit
  10 Mo (Discord, WhatsApp), 25 Mo (e-mail), 50 Mo ou 100 Mo. Grabby calcule le débit qui
  tient dans cette taille selon la durée, garde un son clair et réduit la hauteur de l'image
  quand le débit ne suffit plus (1080p, 720p, 480p, 360p, 240p) : une image plus petite
  reste plus nette qu'une grande image affamée. Marche aussi pour les fichiers son (MP3,
  M4A, Opus, OGG ; FLAC et WAV deviennent du M4A).
- **Suivre des chaînes YouTube** : sous une vidéo YouTube (et une playlist), **Suivre la
  chaîne**. Toutes les heures, Grabby lit le flux public de la chaîne (le flux RSS que
  YouTube offre à tous : sans compte, sans clé, sans cookie) et enregistre chaque **nouvelle**
  vidéo avec le lecteur caché, dans la qualité et le format choisis. Les vidéos déjà
  publiées ne sont jamais prises. La page complète liste les chaînes suivies (dernière
  vérification, nombre de vidéos enregistrées), permet de changer la qualité ou le format,
  de **vérifier maintenant** ou de **ne plus suivre**. On peut aussi y coller l'adresse d'une
  chaîne (`@nom`, `/channel/…`), d'une playlist ou d'une de leurs vidéos. 50 chaînes au plus.
- **Coller une liste d'adresses** : dans la page complète, un texte où se trouvent des
  adresses (une par ligne, ou mêlées à du texte : Grabby les trouve, chacune une fois). Les
  pages s'ouvrent **deux à la fois, en arrière-plan** ; dès que leur vidéo apparaît, elle
  est téléchargée (selon la règle du site, sinon tes réglages, ou forcée en vidéo ou en son),
  puis l'onglet se ferme. Chaque adresse a son état (en attente, ouverture, lancée, échec
  avec la raison : pas de vidéo, protégée, direct…), **Réessayer** et **Retirer**. 500
  adresses au plus.

#### Édition
- **Petit éditeur**, dans le nouveau panneau **Retouches et IA** de chaque carte :
  - **Recadrer** : un cadre à déplacer et à redimensionner sur l'image de la vidéo (ou à
    tracer), aux formes libres, 16:9, 1:1, 9:16 ou 4:3, réglable aussi au clavier (flèches,
    Maj pour aller plus vite) ;
  - **Tourner** de 90°, 180° ou 270°, et **Miroir** gauche-droite ;
  - **Vitesse** de 0,5× à 2× (le son suit sans changer de hauteur ; les chapitres et les
    sous-titres sont recalés) ;
  - **Sans le son**.
  Le panneau replié garde ses choix : son bouton dit combien (« Retouches et IA (3) »).
  L'image est alors refaite en H.264 dans ton navigateur : compte à peu près la durée de la
  vidéo.
- **Un fichier par chapitre** : chaque chapitre devient son propre fichier, copié sans
  réencodage, numéroté (« 01 - Intro.mp4 ») et rangé dans un dossier au nom de la vidéo.
  Les fichiers son reçoivent leur numéro de piste (« 3/12 »), l'album et l'artiste : un
  album ou un podcast se découpe tout seul. Quand la vidéo n'a pas de chapitres, ceux que
  propose le résumé (voir plus bas) peuvent servir.
- **Sous-titres incrustés** : les sous-titres choisis (ou ceux de l'IA) sont écrits dans
  l'image, lisibles partout, même sur un lecteur qui ne sait pas afficher de sous-titres.
  Police Noto Sans incluse dans Grabby (accents, cyrillique, grec), contour noir, en bas de
  l'image, toujours à l'endroit même si la vidéo est tournée.
- **Aperçu avant de télécharger** : **Aperçu** lit dans la popup l'extrait choisi (ou toute
  la vidéo) pour vérifier que c'est le bon ; pour un flux ou une vidéo que le site ne laisse
  pas lire ailleurs, c'est le lecteur de la page qui se place au début de l'extrait.

#### IA locale
- **Transcription hors ligne** : **Transcrire** écrit les sous-titres de ce qui est dit,
  dans la langue choisie ou détectée, avec Whisper (modèle « base » d'OpenAI) qui tourne
  **dans ton navigateur**. Le son est découpé aux silences pour ne couper aucun mot, les
  lignes trop longues sont partagées, les « [Musique] » et répétitions écartés. Les
  sous-titres sont enregistrés en `.srt` à côté de la vidéo, et peuvent être incrustés.
- **Traduire les sous-titres** dans 20 langues : avec le traducteur intégré au navigateur
  quand il en a un (Chrome récent), sinon avec de petits modèles Opus-MT, en passant par
  l'anglais quand une paire n'a pas de modèle direct. Le texte traduit est une nouvelle
  piste, enregistrée en `.srt` à côté de la vidéo (et incrustable).
- **Résumé et mots-clés** : un fichier texte à côté de la vidéo avec les phrases qui
  comptent le plus (horodatées), les mots-clés et les chapitres. Le résumé est fait sur ton
  ordinateur à partir des sous-titres (ou de la transcription) ; quand la vidéo n'a pas de
  chapitres et dure plus de 6 minutes, Grabby en **propose** là où le sujet change, nommés
  par leurs mots-clés, et les écrit aussi dans le fichier vidéo.
- **Rien n'est envoyé** : les modèles sont téléchargés **une seule fois**, seulement si tu
  l'acceptes (bouton dans le panneau, ou réglage **IA locale**), depuis Hugging Face :
  environ 77 Mo pour la transcription, 107 Mo par paire de langues. Ce sont des données
  (des poids), pas du code : le moteur (ONNX Runtime) est inclus dans Grabby.
- **Règles automatiques** : pour un site (ou tous), ce que Grabby choisit tout seul : vidéo
  ou son, format, qualité (la meilleure, la plus petite ou au plus 1080p, 720p…), langues de
  sous-titres et dossier. La carte arrive déjà réglée (« Choisi par ta règle pour
  youtube.com : tu peux les changer ») ; le clic droit, le raccourci, le bouton sur les
  vidéos et la liste d'adresses les suivent aussi. La règle la plus précise gagne
  (`m.youtube.com` avant `youtube.com`).

#### Interface
- **Page complète** (bouton en haut de la popup, ou depuis les réglages) avec ses sections :
  - **Bibliothèque** : tout ce que Grabby a enregistré en grande grille, la place prise par
    type, filtres par type et par site, recherche, et un **lecteur** pour regarder ou
    écouter sans quitter la page (il faut autoriser l'accès aux fichiers dans la page de
    l'extension : la bibliothèque l'explique) ;
  - **Liste d'adresses**, **Chaînes suivies**, **Règles automatiques** et **Sauvegarde** (voir
    plus haut et plus bas) ;
  - **Atelier** : une vidéo ou un son **de ton ordinateur**, avec les mêmes retouches et la
    même IA, et un aperçu en direct (l'image tourne, se recadre, accélère pendant qu'on
    règle) ; on peut y joindre un fichier de sous-titres (`.srt`, `.vtt`) à incruster ou à
    traduire ;
  - **Assembler** : plusieurs vidéos ou sons mis bout à bout dans l'ordre choisi (flèches
    pour réordonner). S'ils se ressemblent (mêmes codecs, même taille d'image), ils sont
    copiés tels quels, instantanément et sans perte ; sinon chacun est ajusté à l'image du
    premier (bandes noires, jamais déformé) et refait en H.264. Un son au milieu de vidéos
    passe sur une image noire.
- **Bouton sur les vidéos** : au survol d'une vidéo de n'importe quel site, une petite barre
  **Télécharger** (et une note de musique pour le son seul) la télécharge d'un clic, sans
  ouvrir la popup, avec tes règles et tes réglages. Sur YouTube, un bouton **Télécharger**
  se place aussi sous le lecteur, à côté de « Partager ». Le clic ne met pas la vidéo en
  pause. Désactivable (réglage **Bouton sur les vidéos**).
- **Sauvegarder ses réglages** : un fichier JSON lisible avec tes réglages, tes règles, ton
  historique et tes chaînes suivies, pour un autre ordinateur ou un autre navigateur. La
  restauration **fusionne** (rien de ce qui est déjà là n'est perdu) et ne lit que ce qui a
  du sens : un fichier qui n'est pas de Grabby est refusé.
- La barre de progression dit **l'étape** en cours : téléchargement des modèles,
  transcription, traduction, résumé, encodage, découpage.
- Nouveau groupe de réglages **Pages et IA** (bouton sur les vidéos, IA locale, ouvrir la
  page complète).

### Modifié
- Les **directs** comptent dans le nombre affiché sur l'icône, puisqu'ils s'enregistrent.
- Un fichier qui doit être retouché passe toujours par ffmpeg, même quand il aurait été
  enregistré tel quel.
- Les menus de taille et de vitesse suivent la langue du navigateur (« 25 Mo », « 1,5× » ;
  « 25 MB », « 1.5× » en anglais).

### Corrigé
- **Brave** : le mode capture (YouTube, lecteurs Media Source) pouvait échouer avec
  « capture impossible », parce que Brave isole la mémoire du cadre invisible qui reçoit
  les données. Grabby vérifie maintenant que ce cadre écrit bien au bon endroit ; sinon il
  envoie les données par un autre chemin, et l'enregistrement aboutit.

### Limites connues
- **Le réencodage se fait dans le navigateur**, sur un seul cœur : recadrer, tourner,
  changer la vitesse, compresser ou incruster des sous-titres prend à peu près la durée de
  la vidéo en 720p (davantage en 1080p et au-delà).
- **Incrustation** : la police incluse dessine les alphabets latin, grec et cyrillique. Des
  sous-titres en chinois, japonais, coréen, arabe, hindi… ne sont pas incrustés (ils
  s'afficheraient en carrés) : ils restent en `.srt`, et le panneau le dit.
- **Atelier et Assembler** acceptent des fichiers de 1,5 Go au plus (la mémoire du
  navigateur).
- **Transcription** : Whisper « base » est un petit modèle ; il comprend bien une voix
  claire, moins un brouhaha ou de la musique forte. Compte à peu près la durée de la vidéo.
- **Résumé** : sans le résumeur intégré au navigateur, c'est un résumé par **extraits** (les
  phrases les plus représentatives de la vidéo), pas un texte réécrit.
- **Directs YouTube** : enregistrés à vitesse réelle depuis la page, qui doit rester
  ouverte ; un direct HLS commence là où il en est (pas de retour en arrière).
- **Chaînes suivies** : vérifiées une fois par heure **quand le navigateur est ouvert** ; le
  flux de YouTube ne montre que les 15 dernières vidéos.
- Le **lecteur de la bibliothèque** a besoin de l'autorisation « Accès aux URL de fichier »,
  que seul toi peux donner dans la page des extensions.

## [1.9.0] — 2026-10-06

Mise à jour en un clic, file d'attente réordonnable, sous-titres enfin lisibles, sponsors
retirés, volume égalisé, planche de captures et miniature HD. Et la vidéo YouTube de
nouveau visible quand on regarde une playlist.

### Ajouté
- **Mettre à jour en un clic** (Windows) : le bandeau « Grabby 1.9.1 est sorti » et les
  réglages ont un bouton **Mettre à jour**. Grabby demande à un petit assistant installé à
  côté de lui de télécharger la dernière version publiée sur GitHub, d'en vérifier
  l'empreinte SHA-256 (celle que GitHub publie), de remplacer ses fichiers, puis il
  redémarre tout seul. Tes réglages et ton historique sont gardés.
  - L'assistant s'installe une fois : double-clic sur `installer-mises-a-jour.cmd` dans le
    dossier de Grabby (aucun droit administrateur). `desinstaller-mises-a-jour.cmd` le
    retire.
  - Il refuse tout ce qui n'est pas une version de Grabby publiée sur son dépôt : autre
    adresse, empreinte absente ou fausse, archive qui ne contient pas Grabby, version qui ne
    correspond pas, version plus ancienne. Les fichiers que tu as ajoutés au dossier ne sont
    pas touchés.
  - Le bouton n'agit que si tu cliques : le navigateur te demande une fois l'autorisation de
    parler à l'assistant (`nativeMessaging`, facultative).
- **File d'attente** : dès que deux téléchargements sont en cours, la popup les liste tous,
  dans leur ordre.
  - Ceux qui attendent leur tour se **déplacent** : glisser-déposer par leur poignée, ou
    flèches haut et bas au clavier.
  - **Tout mettre en pause** et **Tout reprendre** d'un clic.
- **Retirer les passages sponsorisés** (YouTube, désactivé par défaut, réglage
  « YouTube ») : les passages que la communauté **SponsorBlock** a marqués comme
  sponsorisés ou comme autopromotion sont coupés du fichier. Les chapitres de la vidéo sont
  recalés, la barre indique « 2 passages sponsorisés retirés ». Grabby demande à
  SponsorBlock sans dire quelle vidéo : seulement les 4 premiers caractères d'une empreinte
  de son identifiant, que partagent des milliers d'autres vidéos ; la réponse est triée sur
  ton appareil. Sans réponse (hors ligne, serveur lent), la vidéo est enregistrée entière.
- **Égaliser le volume des fichiers son** (réglage « À la fin d'un téléchargement ») :
  MP3, M4A, Opus, OGG, FLAC et WAV au même niveau sonore (−14 LUFS, crêtes sous −1,5 dB,
  norme EBU R128). Le son est alors réencodé.
- **JPEG : une image, une planche ou la miniature.** Quand le format JPEG est choisi :
  - **Une image** : comme avant, au moment choisi ;
  - **Planche** : des captures de toute la vidéo côte à côte dans un seul JPEG, une toutes
    les 10 s, 30 s, 1 min, 5 min ou automatiquement (environ 24), 100 au plus. Grabby prend
    la plus petite qualité de la vidéo, qui suffit pour des vignettes ;
  - **Miniature** : l'image de la vidéo dans sa plus grande taille (jusqu'à 1280 × 720 sur
    YouTube), sans rien télécharger d'autre.
- **Noms et dossiers** :
  - deux nouvelles cases dans le nom du fichier : **Chaîne** (l'auteur de la vidéo) et
    **Format** (MP4, MP3…) ;
  - **Ranger les fichiers** : tels quels, dans un dossier Grabby, **par site**
    (`Grabby/youtube.com`) ou **par type** (`Grabby/Vidéos`, `Grabby/Musique`,
    `Grabby/Images`).
- **Historique** :
  - **500** téléchargements gardés au lieu de 50 ;
  - une **recherche** (titre, nom du fichier ou site, sans tenir compte des accents ni des
    majuscules) ;
  - **Ouvrir le fichier** directement ;
  - **Retélécharger** : la page se rouvre derrière et le téléchargement repart tout seul,
    dans la même qualité et le même format.
- **Raccourci clavier** dans les réglages : la touche actuelle (Alt+Maj+D par défaut), un
  bouton **Changer** qui ouvre la page des raccourcis du navigateur, et le choix de ce
  qu'elle télécharge (avec le clic droit) : **la vidéo** ou **le son seul**.
- **Notification de fin cliquable** : un clic ouvre le fichier ; ses boutons **Ouvrir** et
  **Afficher dans le dossier**.

### Modifié
- **Sous-titres en français et bien rangés** : chaque piste est nommée dans la langue du
  navigateur (« Anglais », « Anglais (automatique) », « Allemand (traduit) ») au lieu de
  l'étiquette anglaise de YouTube (« English (auto-generated) »). La liste est groupée :
  sous-titres de la vidéo, sous-titres automatiques, puis traductions, ta langue d'abord
  puis dans l'ordre alphabétique ; chaque traduction dit de quelle langue elle part.
- **Toutes les traductions YouTube** sont proposées (plus seulement vers la langue du
  navigateur), comme dans le lecteur de YouTube. Les pistes enregistrées portent ces mêmes
  noms.
- Le **nom du fichier** se compose sur deux lignes de trois cases, l'aperçu montre le
  dossier choisi.
- L'extension a maintenant un **identifiant fixe** (le même sur tous les ordinateurs), dont
  l'assistant de mise à jour a besoin.

### Corrigé
- **YouTube ne montrait plus la vidéo** quand on la regardait dans une playlist
  (`watch?v=…&list=…`) : la carte de la playlist prenait toute la place et la vidéo
  passait dessous, comme si rien n'était trouvé. La vidéo regardée est de nouveau en tête ;
  la playlist vient après, repliée (« Voir » la déplie). Une page de playlist mal lue
  n'empêche plus non plus de trouver les vidéos.
- **Défilement horizontal** à l'ouverture de la liste des formats : les noms longs
  débordaient du menu. Le menu tient dans sa largeur (nom coupé, complet au survol) et la
  popup ne défile plus jamais de côté.

### Limites connues
- **Passage à la 1.9.0 : une seule fois, à la main.** L'identifiant fixe fait de la 1.9.0
  une nouvelle extension pour le navigateur : installe-la comme la première fois (retire
  l'ancienne, charge le nouveau dossier). Tes réglages et ton historique repartent de zéro
  cette fois-ci. Ensuite, le bouton **Mettre à jour** s'occupe de tout.
- L'assistant de mise à jour n'existe que pour **Windows** (Chrome, Brave, Edge, Chromium,
  Vivaldi). Ailleurs, la mise à jour reste manuelle.
- Le navigateur ne relance une extension chargée « non empaquetée » que si le **mode
  développeur** est activé, ce qui est le cas quand on installe Grabby.
- **Sponsors** : seules les vidéos que la communauté SponsorBlock a déjà annotées sont
  concernées ; les passages coupés le sont sur l'image clé la plus proche.
- Une **planche** d'une vidéo YouTube demande de l'enregistrer en entier (en petite
  qualité) : compte le temps d'un enregistrement.

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

[Non publié]: https://github.com/titilyonnais/grabby/compare/v2.3.2...HEAD
[2.3.2]: https://github.com/titilyonnais/grabby/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/titilyonnais/grabby/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/titilyonnais/grabby/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/titilyonnais/grabby/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/titilyonnais/grabby/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/titilyonnais/grabby/compare/v1.11.0...v2.0.0
[1.11.0]: https://github.com/titilyonnais/grabby/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/titilyonnais/grabby/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/titilyonnais/grabby/compare/v1.8.0...v1.9.0
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
