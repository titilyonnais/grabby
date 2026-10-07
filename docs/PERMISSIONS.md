# À quoi sert chaque autorisation

Grabby a un seul but : repérer les vidéos non chiffrées de la page que tu regardes et les
enregistrer en fichier, dans la qualité et le format choisis. Il ne contourne jamais un
DRM ni un chiffrement : un HLS chiffré (`EXT-X-KEY` autre que `NONE`), un DASH avec
`ContentProtection` ou toute utilisation des Encrypted Media Extensions marquent la vidéo
comme protégée, et aucun téléchargement n'est proposé.

| Autorisation | Pourquoi |
|---|---|
| Accès à tous les sites (`<all_urls>`) | Les vidéos viennent de n'importe quel site ou CDN. Il faut observer les réponses réseau des onglets, lire les manifestes HLS/DASH et récupérer les morceaux demandés. |
| `webRequest` | Lecture seule des en-têtes de réponse (`Content-Type`, `Content-Length`) pour reconnaître les vidéos et les manifestes. Aucune requête n'est bloquée ni modifiée. Pour un fichier repéré, Grabby lit ses 256 premiers Ko pour vérifier que c'est bien une vidéo, sa durée et s'il est chiffré. Les fichiers de sous-titres qu'un lecteur charge (WebVTT, SubRip, TTML) sont reconnus de la même façon, pour ne pas les prendre pour une vidéo. |
| `declarativeNetRequestWithHostAccess` | Beaucoup de serveurs refusent une requête sans le `Referer`/`Origin` de la page. Des règles **temporaires** remettent ces deux en-têtes **uniquement sur les requêtes de Grabby lui-même** pendant un téléchargement que tu as lancé, puis sont retirées. Ta navigation n'est jamais modifiée. |
| `notifications` | Une notification système quand un téléchargement se termine ou échoue (désactivable dans les réglages). Un clic ouvre le fichier ; ses boutons l'ouvrent ou le montrent dans son dossier. |
| `downloads` | Enregistrer le fichier par le gestionnaire de téléchargements du navigateur, le montrer dans son dossier, suivre la progression. |
| `downloads.open` | **Ouvrir le fichier** depuis l'historique ou la notification de fin. Seulement un fichier que Grabby a enregistré, et seulement quand tu cliques. |
| `offscreen` | Une page invisible de l'extension télécharge les morceaux des flux et lance ffmpeg.wasm (inclus dans l'extension) pour produire le format choisi, réduire l'image si une qualité plus petite est demandée, et héberger le lecteur YouTube caché. |
| `storage` | Réglages, historique (500 entrées au plus, effaçable), vidéos repérées par onglet (mémoire de session) et téléchargements en cours, pour les reprendre après un redémarrage. La popup garde aussi le thème choisi pour s'ouvrir sans clignoter. |
| `unlimitedStorage` | Les morceaux d'un téléchargement sont rangés dans la base locale de l'extension au fur et à mesure (c'est ce qui permet la pause et la reprise), comme les données du mode capture avant l'assemblage ; une longue vidéo dépasse le quota par défaut. Tout est effacé dès que le fichier est enregistré ou le téléchargement annulé. |
| `alarms` | Réveiller Grabby pour retenter un téléchargement coupé par une perte de connexion (après 3 s, 6 s… jusqu'à 2 min), même si le navigateur a mis l'extension en veille entre-temps ; lancer les téléchargements en attente quand s'ouvre la plage horaire choisie ; continuer d'ouvrir, deux à la fois, les pages des liens donnés avec `gb` ; et, seulement si tu as activé « Prévenir des nouvelles versions », vérifier une fois par jour la dernière version publiée. |
| `contextMenus` | Le menu « Grabby » du clic droit : télécharger cette vidéo (ou seulement son son), télécharger la vidéo d'un lien (ou son son), télécharger la vidéo de la page. Rien d'autre. |
| `scripting` | Après une mise à jour, l'ancien Grabby est coupé des pages déjà ouvertes : il remet `hook.js` et `scanner.js` dans ces onglets pour qu'ils fonctionnent sans les recharger. Aucun autre script n'est injecté. |
| Mot-clé `gb` de la barre d'adresse (`omnibox`, sans autorisation) | Taper `gb` puis un ou plusieurs liens les donne à Grabby (`gb son …` pour le son seul). Grabby ne voit que ce qui est tapé après `gb`, jamais le reste de ta navigation. |
| Photo d'une vidéo (`captureVisibleTab`, sans autorisation de plus) | Quand le site interdit de lire l'image d'une vidéo, Grabby fait une capture de l'**onglet visible** au moment où tu cliques sur **Photo** (ou Alt+Maj+S) et n'en garde que le rectangle de la vidéo. Jamais sans ton clic. |
| Raccourcis clavier (`commands`, sans autorisation) | Alt+Maj+G ouvre Grabby, Alt+Maj+D télécharge la vidéo principale de la page (ou son son seul, au choix), Alt+Maj+S prend une photo de la vidéo à l'écran. Modifiables dans `chrome://extensions/shortcuts` (le bouton Changer des réglages l'ouvre). |
| Clé `key` du manifeste | Donne à Grabby le même identifiant sur tous les ordinateurs, où que soit son dossier : en remplaçant le dossier par une nouvelle version, le navigateur garde tes réglages et ton historique. Ce n'est pas une autorisation. |
| Scripts dans les pages | `scanner.js` liste les `<video>` (et leurs fichiers de sous-titres `<track>`), le titre et la miniature de la page et les fichiers vidéo qu'elle cite (12 au plus) ; il affiche aussi la bulle « Téléchargement terminé » et le petit bouton « Télécharger » sur les vidéos (désactivable dans les réglages). `hook.js` repère l'usage d'un DRM et suit les tampons Media Source pour pouvoir enregistrer la lecture quand — et seulement quand — tu le demandes. |
| Onglets | Pour finir un enregistrement interrompu (navigateur fermé, page fermée pendant la pause), Grabby rouvre la page **en arrière-plan** si elle n'est plus ouverte, puis referme cet onglet une fois l'enregistrement terminé. Les liens donnés avec `gb` sont traités de même : leurs pages s'ouvrent deux à la fois en arrière-plan et se referment une fois leur vidéo trouvée. Aucune autorisation supplémentaire. |
| `capture-sink.html` accessible aux pages | Cadre invisible de l'extension qui reçoit les données d'un enregistrement sans les recopier par messages (`use_dynamic_url: true`). |
| CSP `'wasm-unsafe-eval'` | Nécessaire pour lancer ffmpeg.wasm, le seul module WebAssembly inclus dans l'extension. Aucun code n'est chargé depuis Internet, et aucune chaîne n'est évaluée. |

La version 2.0 ajoute une seule autorisation, `sidePanel` (le panneau latéral) ; le mot-clé `gb` et la photo d'onglet n'en demandent pas. La synchronisation des réglages utilise `storage` (déjà accordée), et seulement si tu l'actives.

La version 3.0 n'ajoute aucune autorisation ; Grabby y fait moins de choses, donc moins de requêtes : la liste ci-dessous est complète.

La version 3.1 en retire deux : `sidePanel` (le panneau latéral n'existe plus) et `nativeMessaging`, l'autorisation facultative que demandait le bouton **Mettre à jour** (retiré : une nouvelle version s'installe à la main, comme la première).

**Code distant** : aucun. Tout le JavaScript et le WebAssembly (ffmpeg.wasm) sont dans
l'extension, et rien d'autre n'est téléchargé pour être exécuté.

**Requêtes de Grabby lui-même** : aucune par défaut.

- Si tu actives « Prévenir des nouvelles versions », une requête par jour vers
  `https://api.github.com/repos/titilyonnais/grabby/releases/latest` (sans cookie ni
  identifiant), pour connaître le numéro de la dernière version.
- Si tu actives « Retirer les passages sponsorisés », une requête vers
  `https://sponsor.ajay.app/api/skipSegments/<4 caractères>` par vidéo YouTube
  téléchargée : seulement le début de l'empreinte de son identifiant, partagé par des
  milliers de vidéos.
- Si tu enregistres une **miniature** YouTube, une requête vers `https://i.ytimg.com`
  pour trouver sa plus grande taille.
- Pour la **notification** de fin et la petite image de l'**historique** : l'image de la
  vidéo, une fois, depuis l'adresse où la page l'affichait (sans cookie).
- Si tu actives **Réglages synchronisés** : ils passent par `chrome.storage.sync`, la
  synchronisation du navigateur lui-même (aucun serveur de Grabby).

**Données** : rien n'est collecté ni envoyé (voir [PRIVACY.md](PRIVACY.md)).
