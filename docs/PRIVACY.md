# Grabby — Privacy policy / Politique de confidentialité

_Last updated: 2026-10-05 (1.6.0)_

## English

Grabby does **not** collect, store on a server, sell or share any personal data.

- **No account, no analytics, no tracking, no remote server.** The extension contains no
  telemetry and makes no network request of its own except to the media files, playlists
  and manifests of the page you are viewing, and only to detect or download them at your
  request.
- **What stays on your device:**
  - your settings (theme, video and audio formats, file name parts, save options) in the
    browser's extension storage, and the theme again in the popup's own storage so it opens
    without a flash;
  - the list of your last 50 downloads (file name, page address, size, date, quality and a
    small thumbnail), which you can clear at any time from the History tab;
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
  ou les télécharger à ta demande.
- **Ce qui reste sur ton appareil :**
  - tes réglages (thème, formats vidéo et audio, composition du nom de fichier, options
    d'enregistrement), et le thème une seconde fois dans la mémoire de la popup pour qu'elle
    s'ouvre sans clignoter ;
  - la liste de tes 50 derniers téléchargements (nom du fichier, adresse de la page, taille,
    date, qualité et une petite miniature), effaçable à tout moment depuis l'onglet
    Historique ;
  - les téléchargements en cours ou en pause, et les morceaux déjà reçus, pour reprendre
    après une coupure de connexion ou un redémarrage du navigateur ; supprimés dès que le
    fichier est enregistré ou le téléchargement annulé ;
  - les médias détectés dans tes onglets ouverts, gardés en mémoire de session et effacés à
    la fermeture de l'onglet ou du navigateur ;
  - les données temporaires du mode capture, supprimées dès que le fichier est enregistré
    ou la capture annulée.
- **Accès aux pages.** Grabby lit les réponses réseau et les éléments `<video>` des pages
  visitées uniquement pour reconnaître les ressources vidéo, ainsi que le titre de la page et
  les métadonnées de la vidéo (balises Open Graph, `VideoObject` schema.org) pour nommer le
  fichier. Pour vérifier un fichier détecté, il en lit les 256 premiers Ko (format, durée,
  chiffrement). Quand une page n'a pas d'image d'aperçu, il prend une petite image de la
  vidéo en cours pour illustrer la liste. Tout cela reste en mémoire de session sur ton
  appareil. Il ne lit ni les formulaires, ni les mots de passe, ni le contenu des cookies.
- **Liens.** Quand une page cite des fichiers vidéo sans les lire (métadonnées de partage,
  liens directs), Grabby lit les 256 premiers Ko d'au plus 12 d'entre eux pour vérifier que
  ce sont de vraies vidéos.
- **Notifications.** À la fin d'un téléchargement, une petite bulle apparaît dans la page
  que tu regardes et une notification système s'affiche ; tu peux les désactiver dans les
  réglages.
- **Les téléchargements** passent par le gestionnaire de téléchargements du navigateur,
  vers l'emplacement de ton choix.

Contact : ouvre une issue sur le dépôt GitHub du projet.
