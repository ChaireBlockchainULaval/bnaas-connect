# Passer de bnaas-connect 0.3.x à 1.0.0

À l'intention des équipes qui intègrent déjà `@chaireblockchainulaval/bnaas-connect` 0.3.x.

## Pourquoi migrer

BNAAS passe à l'authentification V2 : le notaire consent à **chaque opération notariale**,
sur un écran servi par BNAAS, et le jeton obtenu ne vaut que pour cette opération.

À la **bascule du Gateway** (date communiquée par BNAAS), le chemin V1 utilisé par 0.3.x
est retiré : `connect()` en 0.3.x cessera de fonctionner (`410 v1-retired`). La migration
doit donc être déployée **avant** cette date.

Une installation existante ne passe pas seule en 1.0.0 : `^0.3.5` dans `package.json`
n'accepte pas une version majeure. La mise à jour est volontaire.

## Étapes

### 1. Mettre à jour le paquet

```bash
npm install @chaireblockchainulaval/bnaas-connect@^1.0.0
```

### 2. Faire confirmer l'enregistrement par BNAAS

Demander à BNAAS d'activer le flux `connect` pour votre `client_id` et de lier
l'**application Entra** qui appellera l'API. Sans cela, l'écran de consentement refuse la
demande.

### 3. Appeler `connect()` au moment de chaque opération, avec `operation`

Avant (0.3.x) — un jeton obtenu à l'avance, réutilisé pendant 15 min :

```ts
const { token } = await connect({
  clientId, redirectUri,
  portalUrl: 'https://app.test.bnaas.ca',
});
```

Après (1.0.0) — un jeton par opération, demandé juste avant l'action :

```ts
const { token } = await connect({
  clientId, redirectUri,
  operation: { type: 'certify_document', document: { name: fichier.name, sha256 } },
  // authUrl : 'https://auth.bnaas.ca' en production (défaut : test)
});
await certifier(token, sha256);   // la requête doit correspondre exactement à l'opération
```

- `operation` est **obligatoire**. Types et champs : table du README.
- `portalUrl` n'existe plus ; l'écran est sur `authUrl` (`auth.test.bnaas.ca` / `auth.bnaas.ca`).
- Le jeton dure **5 min**, sert **une seule fois** et seulement pour l'opération consentie.
  Une requête différente (autre empreinte, autre dossier…) répond
  `403 operation-not-consented` et consomme le jeton. Supprimer tout cache de jeton.
- Une action qui en enchaîne plusieurs (ex. consigner 4 événements) utilise `count` sur un
  seul type d'opération (`record_event`, 1 à 10), pas plusieurs jetons.

### 4. Adapter la gestion des erreurs

```ts
import { BnaasConnectError } from '@chaireblockchainulaval/bnaas-connect';

try { /* connect(...) */ }
catch (e) {
  if (e instanceof BnaasConnectError && e.code === 'access_denied') {
    // e.description : consent_refused, invalid_preparation, notary_status_inactive…
  }
}
```

`e.message === 'access_denied'` fonctionne toujours. `popup_closed` n'a jamais été émis :
un abandon donne `timeout`. Nouveau : `invalid_operation` (opération mal formée, aucune
fenêtre ouverte).

### 5. Vérifier la page de callback

Inchangée (`handleRedirectCallback()`), mais elle doit être servie depuis la **même
origine** que la page qui appelle `connect()`.

### 6. Vérifier les appels à l'API

```http
Authorization: Bearer <jeton Entra de l'application>
X-Notarial-Identity-Token: <token>
```

Le jeton Bearer est celui de l'application Entra liée au `client_id` (étape 2).

### 7. (Si applicable) Préparation par un collaborateur

Un collaborateur d'étude prépare l'opération côté serveur
(`POST /api/v1/connect/preparations`) ; le notaire consent ensuite avec la même opération et
`preparationId`. Voir le README.

## Ce qui ne change pas

- `sub` : identifiant stable du notaire, à continuer d'indexer.
- PKCE, `state`, popup avec repli en redirection, `apiUrl`.

## Liste de contrôle

- [ ] paquet en `^1.0.0`
- [ ] flux `connect` et application Entra liée confirmés par BNAAS
- [ ] `operation` fournie à chaque appel, `portalUrl` retiré
- [ ] plus aucun jeton mis en cache ni réutilisé
- [ ] erreurs `access_denied` / `timeout` / `invalid_operation` gérées
- [ ] parcours testé sur l'environnement de test (`auth.test.bnaas.ca`)
- [ ] déploiement en production **avant** la date de bascule
