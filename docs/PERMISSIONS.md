# À quoi sert chaque autorisation

Grabby a un seul but : repérer les vidéos non chiffrées de la page que tu regardes et les
enregistrer en fichier, dans la qualité et le format choisis. Il ne contourne jamais un
DRM ni un chiffrement : un HLS chiffré (`EXT-X-KEY` autre que `NONE`), un DASH avec
`ContentProtection` ou toute utilisation des Encrypted Media Extensions marquent la vidéo
comme protégée, et aucun téléchargement n'est proposé.

| Autorisation | Pourquoi |
|---|---|
| Accès à tous les sites (`<all_urls>`) | Les vidéos viennent de n'importe quel site ou CDN. Il faut observer les réponses réseau des onglets, lire les manifestes HLS/DASH et récupérer les morceaux demandés. |
| `webRequest` | Lecture seule des en-têtes de réponse (`Content-Type`, `Content-Length`) pour reconnaître les vidéos et les manifestes. Aucune requête n'est bloquée ni modifiée. Pour un fichier repéré, Grabby lit ses 256 premiers Ko pour vérifier que c'est bien une vidéo, sa durée et s'il est chiffré. Les fichiers de sous-titres qu'un lecteur charge (WebVTT, SubRip, TTML) sont reconnus de la même façon, pour être proposés avec sa vidéo. |
| `declarativeNetRequestWithHostAccess` | Beaucoup de serveurs refusent une requête sans le `Referer`/`Origin` de la page. Des règles **temporaires** remettent ces deux en-têtes **uniquement sur les requêtes de Grabby lui-même** pendant un téléchargement que tu as lancé, puis sont retirées. Ta navigation n'est jamais modifiée. |
| `notifications` | Une notification système quand un téléchargement se termine ou échoue (désactivable dans les réglages). Un clic ouvre le fichier ; ses boutons l'ouvrent ou le montrent dans son dossier. |
| `downloads` | Enregistrer le fichier par le gestionnaire de téléchargements du navigateur, le montrer dans son dossier, suivre la progression. |
| `downloads.open` | **Ouvrir le fichier** depuis l'historique ou la notification de fin. Seulement un fichier que Grabby a enregistré, et seulement quand tu cliques. |
| `nativeMessaging` (**facultative**) | Demandée la première fois que tu cliques sur **Mettre à jour**, jamais avant. Elle permet à Grabby de parler à l'assistant de mise à jour (`com.grabby.updater`) que tu as installé toi-même avec `installer-mises-a-jour.cmd`. Grabby lui envoie seulement « mettre à jour » ; l'assistant ne connaît que deux ordres (dire bonjour, installer la dernière version publiée de Grabby) et refuse tout le reste. |
| `offscreen` | Une page invisible de l'extension télécharge les morceaux des flux et lance ffmpeg.wasm (inclus dans l'extension) pour produire le format choisi, réduire l'image si une qualité plus petite est demandée, et héberger le lecteur YouTube caché. |
| `storage` | Réglages, historique (500 entrées au plus, effaçable), vidéos repérées par onglet (mémoire de session) et téléchargements en cours, pour les reprendre après un redémarrage. La popup garde aussi le thème choisi pour s'ouvrir sans clignoter. |
| `unlimitedStorage` | Les morceaux d'un téléchargement sont rangés dans la base locale de l'extension au fur et à mesure (c'est ce qui permet la pause et la reprise), comme les données du mode capture avant l'assemblage ; une longue vidéo dépasse le quota par défaut. Tout est effacé dès que le fichier est enregistré ou le téléchargement annulé. |
| `alarms` | Réveiller Grabby pour retenter un téléchargement coupé par une perte de connexion (après 3 s, 6 s… jusqu'à 2 min), même si le navigateur a mis l'extension en veille entre-temps ; lancer les téléchargements en attente quand s'ouvre la plage horaire choisie ; et, seulement si tu as activé « Prévenir des nouvelles versions », vérifier une fois par jour la dernière version publiée. |
| `contextMenus` | Les entrées du clic droit : « Télécharger cette vidéo avec Grabby » sur une vidéo, « Télécharger la vidéo de la page avec Grabby » ailleurs sur la page. |
| Raccourcis clavier (`commands`, sans autorisation) | Alt+Maj+G ouvre Grabby, Alt+Maj+D télécharge la vidéo principale de la page (ou son son seul, au choix). Modifiables dans `chrome://extensions/shortcuts` (le bouton Changer des réglages l'ouvre). |
| Clé `key` du manifeste | Donne à Grabby le même identifiant sur tous les ordinateurs : l'assistant de mise à jour n'accepte de parler qu'à cet identifiant. Ce n'est pas une autorisation. |
| Scripts dans les pages | `scanner.js` liste les `<video>` (et leurs fichiers de sous-titres `<track>`), le titre et la miniature de la page et les fichiers vidéo qu'elle cite (12 au plus) ; il affiche aussi la bulle « Téléchargement terminé ». `hook.js` repère l'usage d'un DRM et suit les tampons Media Source pour pouvoir enregistrer la lecture quand — et seulement quand — tu le demandes. Dans le lecteur YouTube caché, il active les sous-titres que tu as choisis et garde ce que le lecteur charge, sans autre requête. |
| Onglets | Pour finir un enregistrement interrompu (navigateur fermé, page fermée pendant la pause), Grabby rouvre la page **en arrière-plan** si elle n'est plus ouverte, puis referme cet onglet une fois l'enregistrement terminé. Aucune autorisation supplémentaire. |
| `capture-sink.html` accessible aux pages | Cadre invisible de l'extension qui reçoit les données d'un enregistrement sans les recopier par messages (`use_dynamic_url: true`). |
| CSP `'wasm-unsafe-eval'` | Nécessaire pour lancer le module WebAssembly de ffmpeg inclus dans l'extension. Aucun code n'est chargé depuis Internet, et aucune chaîne n'est évaluée. |

**Code distant** : aucun. Tout le JavaScript et le WebAssembly sont dans l'extension, et le
code n'est pas minifié.

**Requêtes de Grabby lui-même** : aucune par défaut.

- Si tu actives « Prévenir des nouvelles versions », une requête par jour vers
  `https://api.github.com/repos/titilyonnais/grabby/releases/latest` (sans cookie ni
  identifiant), pour connaître le numéro de la dernière version.
- Si tu cliques sur **Mettre à jour**, l'assistant (et non l'extension) refait cette
  requête puis télécharge le zip de la version sur
  `https://github.com/titilyonnais/grabby/releases/download/…`, vérifie son empreinte
  SHA-256 et remplace les fichiers. Ce sont les fichiers publiés de Grabby, comme si tu les
  téléchargeais toi-même : aucun code n'est chargé par l'extension.
- Si tu actives « Retirer les passages sponsorisés », une requête vers
  `https://sponsor.ajay.app/api/skipSegments/<4 caractères>` par vidéo YouTube
  téléchargée : seulement le début de l'empreinte de son identifiant, partagé par des
  milliers de vidéos.
- Si tu enregistres une **miniature** YouTube, une requête vers `https://i.ytimg.com`
  pour trouver sa plus grande taille.

**Données** : rien n'est collecté ni envoyé (voir [PRIVACY.md](PRIVACY.md)).
