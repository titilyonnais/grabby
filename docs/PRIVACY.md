# Grabby — Privacy policy / Politique de confidentialité

_Last updated: 2026-10-06 (1.9.0)_

## English

Grabby does **not** collect, store on a server, sell or share any personal data.

- **No account, no analytics, no tracking, no remote server.** The extension contains no
  telemetry and makes no network request of its own except to the media files, playlists
  and manifests of the page you are viewing, and only to detect or download them at your
  request (and, only if you turn them on or ask for them, the new version check, the
  update and the SponsorBlock question described below).
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
- **Notifications.** When a download finishes, a small bubble appears in the page you are
  looking at, and a system notification is shown; both can be turned off in the settings.
- **Downloads** are saved through the browser's own download manager to the location you
  choose.

Contact: open an issue on the project's GitHub repository.

## Français

Grabby ne collecte **aucune** donnée personnelle, ne l'envoie à aucun serveur, ne la vend
et ne la partage pas.

- **Pas de compte, pas de statistiques, pas de pistage, pas de serveur.** L'extension ne
  contient aucune télémétrie. Elle n'effectue aucune requête réseau à son initiative, hormis
  vers les fichiers vidéo, playlists et manifestes de la page consultée, pour les détecter
  ou les télécharger à ta demande (et, seulement si tu l'actives, la vérification
  quotidienne des nouvelles versions, la mise à jour et la question à SponsorBlock
  décrites plus bas, seulement si tu les actives ou les demandes).
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
- **Notifications.** À la fin d'un téléchargement, une petite bulle apparaît dans la page
  que tu regardes et une notification système s'affiche ; tu peux les désactiver dans les
  réglages.
- **Les téléchargements** passent par le gestionnaire de téléchargements du navigateur,
  vers l'emplacement de ton choix.

Contact : ouvre une issue sur le dépôt GitHub du projet.
