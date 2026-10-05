# À quoi sert chaque autorisation

Grabby a un seul but : repérer les vidéos non chiffrées de la page que tu regardes et les
enregistrer en fichier, dans la qualité et le format choisis. Il ne contourne jamais un
DRM ni un chiffrement : un HLS chiffré (`EXT-X-KEY` autre que `NONE`), un DASH avec
`ContentProtection` ou toute utilisation des Encrypted Media Extensions marquent la vidéo
comme protégée, et aucun téléchargement n'est proposé.

| Autorisation | Pourquoi |
|---|---|
| Accès à tous les sites (`<all_urls>`) | Les vidéos viennent de n'importe quel site ou CDN. Il faut observer les réponses réseau des onglets, lire les manifestes HLS/DASH et récupérer les morceaux demandés. |
| `webRequest` | Lecture seule des en-têtes de réponse (`Content-Type`, `Content-Length`) pour reconnaître les vidéos et les manifestes. Aucune requête n'est bloquée ni modifiée. Pour un fichier repéré, Grabby lit ses 256 premiers Ko pour vérifier que c'est bien une vidéo, sa durée et s'il est chiffré. |
| `declarativeNetRequestWithHostAccess` | Beaucoup de serveurs refusent une requête sans le `Referer`/`Origin` de la page. Des règles **temporaires** remettent ces deux en-têtes **uniquement sur les requêtes de Grabby lui-même** pendant un téléchargement que tu as lancé, puis sont retirées. Ta navigation n'est jamais modifiée. |
| `notifications` | Une notification système quand un téléchargement se termine ou échoue (désactivable dans les réglages). Un clic montre le fichier dans son dossier. |
| `downloads` | Enregistrer le fichier par le gestionnaire de téléchargements du navigateur, le montrer dans son dossier, suivre la progression. |
| `offscreen` | Une page invisible de l'extension télécharge les morceaux des flux et lance ffmpeg.wasm (inclus dans l'extension) pour produire le format choisi, réduire l'image si une qualité plus petite est demandée, et héberger le lecteur YouTube caché. |
| `storage` | Réglages, historique (50 entrées au plus, effaçable) et vidéos repérées par onglet (mémoire de session). La popup garde aussi le thème choisi pour s'ouvrir sans clignoter. |
| `unlimitedStorage` | Le mode capture garde les données enregistrées dans la base locale de l'extension avant l'assemblage ; une longue vidéo dépasse le quota par défaut. Tout est effacé dès que le fichier est enregistré ou la capture annulée. |
| Scripts dans les pages | `scanner.js` liste les `<video>`, le titre et la miniature de la page et les fichiers vidéo qu'elle cite (12 au plus) ; il affiche aussi la bulle « Téléchargement terminé ». `hook.js` repère l'usage d'un DRM et suit les tampons Media Source pour pouvoir enregistrer la lecture quand — et seulement quand — tu le demandes. |
| `capture-sink.html` accessible aux pages | Cadre invisible de l'extension qui reçoit les données d'un enregistrement sans les recopier par messages (`use_dynamic_url: true`). |
| CSP `'wasm-unsafe-eval'` | Nécessaire pour lancer le module WebAssembly de ffmpeg inclus dans l'extension. Aucun code n'est chargé depuis Internet, et aucune chaîne n'est évaluée. |

**Code distant** : aucun. Tout le JavaScript et le WebAssembly sont dans l'extension, et le
code n'est pas minifié.

**Données** : rien n'est collecté ni envoyé (voir [PRIVACY.md](PRIVACY.md)).
