# Test du SDK dans un vrai navigateur (environnement de test BNAAS)

Vérifie de bout en bout ce que les tests unitaires ne couvrent pas : popup vers
`auth.test.bnaas.ca`, connexion du notaire, écran de consentement, retour sur le
`redirect_uri`, relais à la fenêtre d'origine et échange du code contre un nit.

Le jeton obtenu **n'est pas utilisé** : rien n'est écrit sur la chaîne. L'usage du nit
contre l'API (conformité à l'opération, `403 operation-not-consented`, réemploi refusé) est
couvert côté Gateway par `scripts/connect-smoke.js` du dépôt `bnaas-gateway`.

## Prérequis

- Node 20+ et `npm install` fait dans ce dépôt.
- Un **compte notaire de test** (identifiants CNQ de l'environnement de test).
- Le client `bnaas-smoke` est déjà enregistré sur le Gateway de test avec
  `redirect_uri = http://localhost:8765/callback` et le flux `connect` : rien à configurer.
  Le port **8765** doit être libre.
- Un navigateur qui autorise les popups pour `localhost:8765`.

## Lancer

```bash
npm run test:navigateur
```

Ouvrir <http://localhost:8765/>. `Ctrl+C` pour arrêter.

## Scénarios

Pour chacun : régler la page, cliquer **Lancer connect()**, comparer au résultat attendu
dans le **Journal**. Faire le n° 1 dans une **fenêtre privée** (aucune session BNAAS).

| # | Réglage | Dans la popup | Résultat attendu |
|---|---|---|---|
| 1 | `certify_document` | connexion CNQ, puis **Autoriser** | ✅ jeton `bnaas_nit_…`, expire dans ~300 s, `sub` = `notaire_…`, `consent_id`, `operation.type = certify_document` ; la popup se ferme seule |
| 2 | même chose, aussitôt après | **l'écran de consentement s'affiche quand même** (pas de connexion) → Autoriser | ✅ nouveau jeton, `consent_id` différent, même `sub` |
| 3 | `certify_document` | vérifier que l'écran montre l'application, « Certifier un document », le nom déclaré et l'empreinte (la même que dans la page) → **Refuser** | ❌ `access_denied`, description `consent_refused` |
| 4 | `record_event (count 3)` | l'écran mentionne le dossier et 3 événements → Autoriser | ✅ jeton, `operation` reprend le dossier et le nombre |
| 5 | « Ou empreinte d'un vrai fichier » : choisir un PDF | l'empreinte affichée correspond à celle du fichier | ✅ jeton |
| 6 | `forceReauth` coché | le mot de passe est redemandé malgré la session | ✅ jeton |
| 7 | `timeoutMs` = 20000, puis **fermer la popup** sans répondre | — | ❌ `timeout` après ~20 s |
| 8 | `preferRedirect` coché | la page entière part vers BNAAS → Autoriser | ✅ la page `/callback` affiche le jeton (« Redirection pleine page ») |
| 9 | `opération invalide` | **aucune popup** ne s'ouvre | ❌ `invalid_operation`, description sur `sha256` |
| 10 | `client_id` = `client-inexistant` | page BNAAS « Demande refusée » (pas de retour vers l'application) | fermer la popup ; ❌ `timeout` |

Facultatif, si le bloqueur de popups est actif : le SDK bascule seul en redirection pleine
page (comportement du n° 8).

## Si ça échoue

| Symptôme | Piste |
|---|---|
| `token_exchange_failed`, `status` 400 | code expiré (> 60 s) ou déjà utilisé, ou `redirect_uri` différent : refaire l'essai |
| `token_exchange_failed` sans `status` / erreur CORS dans la console | origine `http://localhost:8765` non autorisée côté Gateway (client `bnaas-smoke` modifié ?) |
| `invalid_request` + description | opération refusée par le Gateway : la description donne le champ |
| `access_denied` / `notary_status_inactive` | compte notaire de test inactif |
| La popup reste sur `localhost:8765/callback` sans se fermer, puis `timeout` | relais `localStorage` bloqué (stockage tiers / mode strict du navigateur) : noter le navigateur et sa version, réessayer avec `preferRedirect` |
| Page BNAAS « Demande refusée » | lire le message et la référence `corr_…` (à transmettre pour les journaux du Gateway) |

Noter pour chaque scénario : navigateur et version, ✅/❌, et la référence `corr_…` en cas
d'erreur BNAAS.
