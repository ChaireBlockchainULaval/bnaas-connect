# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions
[SemVer](https://semver.org/lang/fr/).

## [1.0.0] — non publiée

**Changement incompatible.** Authentification V2 du Gateway BNAAS : consentement du notaire
à **chaque opération notariale**. Le chemin V1 est retiré ; il cesse de fonctionner à la
bascule du Gateway (`AUTH_V1_ENABLED=false` : `410 v1-retired`).

### Migrer depuis 0.3.x

1. **`operation` devient obligatoire** dans `connect()` : décrire l'opération à faire
   consentir (`type`, `document.{name,sha256}`, `dossierId`, `certId`, `count`,
   `preparationId` selon le type ; voir le README). Appeler `connect()` **juste avant
   chaque action** : un nit ne sert qu'une fois et seulement pour cette opération.
2. **`portalUrl` est retiré** ; l'écran de consentement est servi par BNAAS sur `authUrl`
   (défaut `https://auth.test.bnaas.ca`, production `https://auth.bnaas.ca`). `apiUrl` est
   inchangé.
3. **Nit : 5 min au lieu de 15**, usage unique, lié à l'opération. Une action non conforme
   répond `403 operation-not-consented` et consomme le nit. Ne plus réutiliser un nit
   d'une opération à l'autre ; ne plus compter sur un consentement mémorisé (90 jours en
   V1) : l'écran s'affiche à chaque fois.
4. **Erreurs** : `connect()` rejette désormais avec une `BnaasConnectError`
   (`code`, `description`, `status`). `e.message` vaut toujours `code`, donc
   `e.message === 'access_denied'` fonctionne encore ; la raison précise est dans
   `e.description` (`consent_refused`, `invalid_preparation`, `notary_status_inactive`…).
   Le code `popup_closed`, documenté en 0.3.x mais jamais émis, n'existe pas : l'abandon
   donne `timeout`.
5. **Résultat enrichi** : `consent_id` et `operation` s'ajoutent à `token`, `expires_at`,
   `sub` (`sub` inchangé : continuer à l'indexer pour lier les comptes).
6. **Côté BNAAS** : le client doit avoir le flux `connect` et une **application Entra
   liée** ; l'API s'appelle avec `Authorization: Bearer <jeton Entra de l'application>` +
   `X-Notarial-Identity-Token`.
7. La page de callback reste la même (`handleRedirectCallback()`), mais doit être servie
   depuis la **même origine** que la page qui appelle `connect()`.

### Ajouté

- `connect({ operation, forceReauth? })` : popup sur `/connect/authorize` (`response_type=code`,
  `state`, PKCE S256, `operation` en base64url sans remplissage, `force_reauth=1`).
- Validation locale de l'opération avant ouverture de la popup (`invalid_operation`).
- Préparation par un collaborateur d'étude (`operation.preparationId`).
- `encodeOperation`, `normalizeOperation`, `OPERATION_RULES`, `BnaasConnectError`,
  types `Operation`, `OperationType`, `ConsentedOperation`.
- Option `timeoutMs`.
- Tests unitaires (Vitest) : encodage de `operation`, PKCE, vérification de `state`,
  échange du code, flux popup et redirection simulés. CI sur les pull requests.

### Retiré

- Popup du Portal (`/connect`) et option `portalUrl`.
- Consentement mémorisé de 90 jours (côté Gateway) et nit de 15 min.
- Relais `postMessage` depuis l'origine du Portal.

## [0.3.5]

Dernière version V1 : `connect()` ouvre la page `/connect` du Portal, consentement mémorisé,
nit de 15 min ; résultat `{ token, expires_at, sub }`.
