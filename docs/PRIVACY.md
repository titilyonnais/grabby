# Grabby — Privacy policy / Politique de confidentialité

_Last updated: 2026-10-06 (2.0.0)_

## English

Grabby does **not** collect, store on a server, sell or share any personal data.

- **No account, no analytics, no tracking, no remote server.** The extension contains no
  telemetry and makes no network request of its own except to the media files, playlists
  and manifests of the page you are viewing, and only to detect or download them at your
  request (and, only if you turn them on or ask for them, the new version check, the
  update, the SponsorBlock question, the feeds of the channels you follow and the AI models
  described below).
- **What stays on your device:**
  - your settings (theme, video and audio formats, file name parts, save options) in the
    browser's extension storage, and the theme again in the popup's own storage so it opens
    without a flash;
  - the list of your last 500 downloads (file name, page address, size, date, quality,
    format and a small thumbnail), which you can clear at any time from the History tab;
  - the downloads in progress or paused, and the parts of them already received, so they can
    resume after a lost connection or a browser restart; deleted as soon as the file is saved
    or the download canceled;
  - the media detected in your open tabs, kept in session memory and deleted when the tab
    closes or the browser exits;
  - temporary data recorded in capture mode, deleted as soon as the file is saved or the
    capture is canceled.
- **Page access.** Grabby reads the network responses and `<video>` elements of the pages
  you visit only to recognize video resources, and the page's title and video metadata
  (Open Graph tags, schema.org `VideoObject`) to name the file. To check a detected file,
  it reads its first 256 KB (format, duration, encryption). When a page has no preview
  image, it takes a small still of the playing video to illustrate the list. All of this
  stays in session memory on your device. It does not read form contents, passwords or
  cookies' values.
- **Links.** When a page names video files without playing them (sharing metadata, direct
  links), Grabby reads the first 256 KB of at most 12 of them to check they are real videos.
- **YouTube playlists and channels.** On a playlist or a channel's Videos tab, Grabby reads
  the list of videos the page shows (address, title, length) to offer to download them all.
  It stays in session memory on your device.
- **Audio file covers.** When you save the sound of a video as M4A, MP3 or FLAC, Grabby
  fetches the video's preview image (the one shown in the list) to use as the cover.
- **New version check (off by default).** Only if you turn on "Tell me about new versions":
  once a day, one request to GitHub's public API
  (`api.github.com/repos/titilyonnais/grabby/releases/latest`), without cookies or any
  identifier, to learn the latest version number. GitHub sees the request like any visit
  to its site (your IP address). Nothing is downloaded or installed.
- **Update (only when you click "Update").** On Windows, once you installed the update
  helper (`installer-mises-a-jour.cmd`), clicking "Update" asks the helper, a script
  installed on your computer, to fetch the latest release from GitHub
  (`api.github.com/repos/titilyonnais/grabby/releases/latest`, then the release's zip on
  `github.com/titilyonnais/grabby/releases/download/…`), without cookies or any
  identifier. It checks the zip's SHA-256 against the one GitHub publishes and replaces
  Grabby's files. Nothing else is sent.
- **Sponsored parts (off by default).** Only if you turn on "Remove sponsored parts", when
  you download a YouTube video Grabby asks SponsorBlock (`sponsor.ajay.app`) for the
  sponsored parts, the private way: it sends only the first 4 characters of the SHA-256 of
  the video's id, shared by thousands of videos, and picks the right one on your device.
  No cookie, no identifier. SponsorBlock sees the request like any visit (your IP address).
- **Thumbnail.** When you save a video's thumbnail, Grabby fetches it at its biggest size
  (on YouTube, from `i.ytimg.com`, where the page already loads it).
- **Followed channels (only those you follow).** When you follow a YouTube channel or
  playlist, Grabby reads its page once (to find its id), then once an hour its public feed
  (`www.youtube.com/feeds/videos.xml?…`), without cookies, to see new videos. To show the
  channel's picture, @name and number of subscribers, it reads the channel's public page
  (`www.youtube.com/channel/…`, without cookies) when you follow it, then at most once a
  day. The full page shows that picture and the thumbnails of the latest videos, loaded
  from YouTube's image servers (`yt3.googleusercontent.com`, `i.ytimg.com`) like any
  YouTube page does. The list of followed channels and the videos already seen stay in the
  extension's storage; you can stop following at any time.
- **YouTube's own settings.** The hidden player Grabby uses for YouTube keeps what it
  chooses (quality, bandwidth) to itself and never writes it to youtube.com's storage, so
  your own playback is never changed. Once, on your next visit to YouTube, Grabby removes
  a quality forced to 144p by version 1.10.0 (and nothing else); nothing is read or sent.
- **Pasted addresses.** The pages of a list you paste are opened one or two at a time in
  tabs behind yours, as if you opened them yourself, and closed once their video is
  found.
- **Live streams.** While you record a live stream, Grabby keeps reading its playlist (or
  records what the page's player plays), until you stop it or the time you set is up.
- **Local AI (only if you ask for it and agree).** Transcription and translation run on
  your device. The first time, after you agree, the models' weights (data, not code) are
  downloaded once from Hugging Face (`huggingface.co` and its file servers), without
  cookies or any identifier, and kept in the browser's cache. Your videos, sounds and texts
  are never sent. When the browser has its own on-device translator or summarizer (Chrome's
  built-in AI), Grabby may use it instead; it also works on your device.
- **Button on videos.** A small "Download" button shows over the videos of the pages you
  visit (it can be turned off in the settings); it is drawn by Grabby in the page and sends
  nothing.
- **Library and backup.** The full-page library shows your download history. If you allowed
  Grabby to read local files (`chrome://extensions`, "Allow access to file URLs"), it can
  play the files you saved; nothing leaves your device. A backup is a file you save and
  open yourself; Grabby sends it nowhere.
- **Notifications.** When a download finishes, a small bubble appears in the page you are
  looking at, and a system notification is shown; both can be turned off in the settings.
  The system notification shows the video's picture: when it is an address on the web,
  Grabby fetches it (without cookies) to put it in the notification.
- **What is said in your files.** When a download has subtitles or a transcription, its
  text is kept in the extension's storage, so the library can search it, show it beside
  the player and export it; you can edit it there. It goes when the file is taken out of
  the library or the history is cleared. Nothing is sent.
- **Pictures kept offline.** The library keeps a small copy (320 px) of each file's
  picture in the extension's storage, fetched once (without cookies) from where the page
  showed it, so it shows without the network.
- **Where you stopped.** The library's player remembers where you stopped each file (a
  number of seconds per file), in the extension's storage.
- **Statistics** are counted from your history, on your device; nothing is sent.
- **Kept for later.** The videos you put aside (address, title, picture, sound or video)
  stay in the extension's storage until you download or remove them.
- **Photo of a video.** When you take a photo of a video (the button on videos, Alt+Shift+S
  or the library's player), Grabby reads the picture from the video, or, when the site
  doesn't allow it, takes a screenshot of the visible tab (`captureVisibleTab`) and keeps
  only the video's rectangle. It is saved as a file on your device; nothing is sent.
- **All the page's images.** When you ask for them, Grabby lists the pictures of that page
  (addresses and sizes) and downloads the ones you choose, from where the page loads them,
  into a .zip made on your device.
- **Podcasts.** When you follow a podcast or any feed with audio or video files, Grabby
  reads that feed once an hour (without cookies) and downloads its new episodes from the
  addresses the feed gives.
- **Synced settings (off by default).** Only if you turn on "Synced settings": your
  settings and rules are written to the browser's own synced storage (`chrome.storage.sync`),
  which your browser carries to your other computers through your browser account. Grabby
  has no server; your history, files and texts are never synced.
- **Address bar.** Typing "gb" then links in the address bar hands those links to
  Grabby, like pasting them in its list; the browser shows nothing to anyone else.
- **Report to copy.** When a download fails, "Copy the report" puts a few lines in your
  clipboard (Grabby's version, the browser, the site's name, the error); never the page's
  address nor the title. You decide where to paste it.
- **Downloads** are saved through the browser's own download manager to the location you
  choose.

Contact: open an issue on the project's GitHub repository.

## Français

Grabby ne collecte **aucune** donnée personnelle, ne l'envoie à aucun serveur, ne la vend
et ne la partage pas.

- **Pas de compte, pas de statistiques, pas de pistage, pas de serveur.** L'extension ne
  contient aucune télémétrie. Elle n'effectue aucune requête réseau à son initiative, hormis
  vers les fichiers vidéo, playlists et manifestes de la page consultée, pour les détecter
  ou les télécharger à ta demande (et la vérification quotidienne des nouvelles versions,
  la mise à jour, la question à SponsorBlock, les flux des chaînes suivies et les modèles
  d'IA décrits plus bas, seulement si tu les actives ou les demandes).
- **Ce qui reste sur ton appareil :**
  - tes réglages (thème, formats vidéo et audio, composition du nom de fichier, options
    d'enregistrement), et le thème une seconde fois dans la mémoire de la popup pour qu'elle
    s'ouvre sans clignoter ;
  - la liste de tes 500 derniers téléchargements (nom du fichier, adresse de la page,
    taille, date, qualité, format et une petite miniature), effaçable à tout moment depuis
    l'onglet Historique ;
  - les téléchargements en cours ou en pause, et les morceaux déjà reçus, pour reprendre
    après une coupure de connexion ou un redémarrage du navigateur ; supprimés dès que le
    fichier est enregistré ou le téléchargement annulé ;
  - les médias détectés dans tes onglets ouverts, gardés en mémoire de session et effacés à
    la fermeture de l'onglet ou du navigateur ;
  - les données temporaires du mode capture (et les sous-titres chargés par le lecteur
    enregistré), gardées pendant une pause et supprimées dès que le fichier est enregistré
    ou la capture annulée.
- **Accès aux pages.** Grabby lit les réponses réseau et les éléments `<video>` des pages
  visitées uniquement pour reconnaître les ressources vidéo, ainsi que le titre de la page et
  les métadonnées de la vidéo (balises Open Graph, `VideoObject` schema.org) pour nommer le
  fichier. Pour vérifier un fichier détecté, il en lit les 256 premiers Ko (format, durée,
  chiffrement). Quand une page n'a pas d'image d'aperçu, il prend une petite image de la
  vidéo en cours pour illustrer la liste. Tout cela reste en mémoire de session sur ton
  appareil. Il ne lit ni les formulaires, ni les mots de passe, ni le contenu des cookies.
- **Sous-titres.** Grabby reconnaît les fichiers de sous-titres que la page déclare
  (`<track>`) ou que son lecteur charge, pour te les proposer. Ils ne sont téléchargés que
  si tu les choisis.
- **Enregistrement interrompu.** Pour finir un enregistrement coupé par la fermeture du
  navigateur ou de la page, Grabby rouvre cette page dans un onglet en arrière-plan, puis le
  referme.
- **Liens.** Quand une page cite des fichiers vidéo sans les lire (métadonnées de partage,
  liens directs), Grabby lit les 256 premiers Ko d'au plus 12 d'entre eux pour vérifier que
  ce sont de vraies vidéos.
- **Playlists et chaînes YouTube.** Sur une playlist ou l'onglet Vidéos d'une chaîne,
  Grabby lit la liste des vidéos que la page affiche (adresse, titre, durée) pour te
  proposer de toutes les télécharger. Elle reste en mémoire de session sur ton appareil.
- **Pochettes des fichiers audio.** Quand tu enregistres le son d'une vidéo en M4A, MP3 ou
  FLAC, Grabby récupère l'image d'aperçu de la vidéo (celle de la liste) pour en faire la
  pochette.
- **Nouvelles versions (désactivé par défaut).** Seulement si tu actives « Prévenir des
  nouvelles versions » : une fois par jour, une requête vers l'API publique de GitHub
  (`api.github.com/repos/titilyonnais/grabby/releases/latest`), sans cookie ni identifiant,
  pour connaître le numéro de la dernière version. GitHub voit la requête comme toute
  visite de son site (ton adresse IP). Rien n'est téléchargé ni installé.
- **Mise à jour (seulement quand tu cliques sur « Mettre à jour »).** Sous Windows, une
  fois l'assistant installé (`installer-mises-a-jour.cmd`), le bouton demande à cet
  assistant, un script installé sur ton ordinateur, de récupérer la dernière version
  publiée sur GitHub (`api.github.com/repos/titilyonnais/grabby/releases/latest`, puis le
  zip de la version sur `github.com/titilyonnais/grabby/releases/download/…`), sans cookie
  ni identifiant. Il vérifie l'empreinte SHA-256 du zip avec celle que publie GitHub, puis
  remplace les fichiers de Grabby. Rien d'autre n'est envoyé.
- **Passages sponsorisés (désactivé par défaut).** Seulement si tu actives « Retirer les
  passages sponsorisés », quand tu télécharges une vidéo YouTube, Grabby demande ses
  passages sponsorisés à SponsorBlock (`sponsor.ajay.app`) de façon anonyme : il n'envoie
  que les 4 premiers caractères de l'empreinte SHA-256 de l'identifiant de la vidéo,
  partagés par des milliers de vidéos, et retrouve la bonne sur ton appareil. Ni cookie,
  ni identifiant. SponsorBlock voit la requête comme toute visite (ton adresse IP).
- **Miniature.** Quand tu enregistres la miniature d'une vidéo, Grabby la récupère dans sa
  plus grande taille (sur YouTube, sur `i.ytimg.com`, où la page la charge déjà).
- **Chaînes suivies (seulement celles que tu suis).** Quand tu suis une chaîne ou une
  playlist YouTube, Grabby lit sa page une fois (pour trouver son identifiant), puis une
  fois par heure son flux public (`www.youtube.com/feeds/videos.xml?…`), sans cookie, pour
  voir les nouvelles vidéos. Pour afficher la photo de la chaîne, son @nom et son nombre
  d'abonnés, il lit sa page publique (`www.youtube.com/channel/…`, sans cookie) quand tu la
  suis, puis une fois par jour au plus. La page complète affiche cette photo et les
  miniatures des dernières vidéos, chargées depuis les serveurs d'images de YouTube
  (`yt3.googleusercontent.com`, `i.ytimg.com`), comme n'importe quelle page de YouTube.
  La liste des chaînes suivies et des vidéos déjà vues reste dans la mémoire de
  l'extension ; tu peux arrêter de suivre à tout moment.
- **Réglages de YouTube.** Le lecteur caché que Grabby utilise pour YouTube garde ses choix
  (qualité, débit) pour lui et ne les écrit jamais dans la mémoire de youtube.com : ta
  propre lecture n'est jamais modifiée. Une seule fois, à ta prochaine visite de YouTube,
  Grabby efface une qualité forcée à 144p par la version 1.10.0 (et rien d'autre) ; rien
  n'est lu ni envoyé.
- **Liste d'adresses collée.** Les pages d'une liste que tu colles sont ouvertes une ou deux
  à la fois dans des onglets en arrière-plan, comme si tu les ouvrais toi-même, puis
  refermées une fois leur vidéo trouvée.
- **Directs.** Pendant que tu enregistres un direct, Grabby continue de lire sa playlist
  (ou enregistre ce que joue le lecteur de la page), jusqu'à ce que tu l'arrêtes ou que la
  durée choisie soit atteinte.
- **IA locale (seulement si tu la demandes et l'acceptes).** La transcription et la
  traduction se font sur ton appareil. La première fois, après ton accord, les poids des
  modèles (des données, pas du code) sont téléchargés une seule fois depuis Hugging Face
  (`huggingface.co` et ses serveurs de fichiers), sans cookie ni identifiant, et gardés dans
  le cache du navigateur. Tes vidéos, sons et textes ne sont jamais envoyés. Quand le
  navigateur a son propre traducteur ou résumeur sur l'appareil (l'IA intégrée de Chrome),
  Grabby peut s'en servir à la place ; lui aussi travaille sur ton appareil.
- **Bouton sur les vidéos.** Un petit bouton « Télécharger » s'affiche sur les vidéos des
  pages visitées (désactivable dans les réglages) ; Grabby le dessine dans la page et il
  n'envoie rien.
- **Bibliothèque et sauvegarde.** La bibliothèque plein écran montre ton historique de
  téléchargements. Si tu as autorisé Grabby à lire les fichiers locaux (`chrome://extensions`,
  « Autoriser l'accès aux URL de fichier »), elle peut lire les fichiers enregistrés ; rien
  ne quitte ton appareil. Une sauvegarde est un fichier que tu enregistres et rouvres
  toi-même ; Grabby ne l'envoie nulle part.
- **Notifications.** À la fin d'un téléchargement, une petite bulle apparaît dans la page
  que tu regardes et une notification système s'affiche ; tu peux les désactiver dans les
  réglages. La notification système montre l'image de la vidéo : quand c'est une adresse
  web, Grabby la récupère (sans cookie) pour l'y mettre.
- **Ce qui est dit dans tes fichiers.** Quand un téléchargement a des sous-titres ou une
  transcription, son texte est gardé dans la mémoire de l'extension, pour que la
  bibliothèque puisse le chercher, l'afficher à côté du lecteur et l'exporter ; tu peux
  l'y modifier. Il part quand le fichier est retiré de la bibliothèque ou l'historique
  effacé. Rien n'est envoyé.
- **Miniatures hors ligne.** La bibliothèque garde une petite copie (320 px) de l'image de
  chaque fichier dans la mémoire de l'extension, récupérée une fois (sans cookie) là où la
  page l'affichait, pour l'afficher sans réseau.
- **Où tu t'es arrêté.** Le lecteur de la bibliothèque retient où tu t'es arrêté dans
  chaque fichier (un nombre de secondes par fichier), dans la mémoire de l'extension.
- **Statistiques** : comptées à partir de ton historique, sur ton appareil ; rien n'est
  envoyé.
- **Plus tard.** Les vidéos mises de côté (adresse, titre, image, son ou vidéo) restent
  dans la mémoire de l'extension jusqu'à ce que tu les télécharges ou les retires.
- **Photo d'une vidéo.** Quand tu prends une photo d'une vidéo (la bulle sur les vidéos,
  Alt+Maj+S ou le lecteur de la bibliothèque), Grabby lit l'image de la vidéo, ou, quand
  le site ne le permet pas, fait une capture de l'onglet visible (`captureVisibleTab`) et
  n'en garde que le rectangle de la vidéo. Elle est enregistrée en fichier sur ton
  appareil ; rien n'est envoyé.
- **Toutes les images de la page.** Quand tu le demandes, Grabby liste les images de cette
  page (adresses et tailles) et télécharge celles que tu choisis, là où la page les
  charge, dans un .zip fabriqué sur ton appareil.
- **Podcasts.** Quand tu suis un podcast ou tout flux avec des fichiers audio ou vidéo,
  Grabby lit ce flux une fois par heure (sans cookie) et télécharge ses nouveaux épisodes
  depuis les adresses que le flux donne.
- **Réglages synchronisés (désactivé par défaut).** Seulement si tu actives « Réglages
  synchronisés » : tes réglages et tes règles sont écrits dans la mémoire synchronisée du
  navigateur lui-même (`chrome.storage.sync`), que ton navigateur transporte vers tes
  autres ordinateurs par ton compte de navigateur. Grabby n'a pas de serveur ; ton
  historique, tes fichiers et tes textes ne sont jamais synchronisés.
- **Barre d'adresse.** Taper « gb » puis des liens dans la barre d'adresse les donne à
  Grabby, comme si tu les collais dans sa liste ; le navigateur ne montre rien à personne.
- **Rapport à copier.** Quand un téléchargement échoue, « Copier le rapport » met quelques
  lignes dans ton presse-papiers (la version de Grabby, le navigateur, le nom du site,
  l'erreur) ; jamais l'adresse de la page ni le titre. C'est toi qui décides où le coller.
- **Les téléchargements** passent par le gestionnaire de téléchargements du navigateur,
  vers l'emplacement de ton choix.

Contact : ouvre une issue sur le dépôt GitHub du projet.
