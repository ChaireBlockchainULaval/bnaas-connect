# @chaireblockchainulaval/bnaas-connect

SDK « Se connecter avec BNAAS » pour applications tierces. Obtient un **jeton
d'identité notariale** via OAuth 2.0 (Authorization Code + PKCE), sans copier-coller.

- TypeScript, **aucune dépendance runtime** (`crypto.subtle` natif). Navigateur uniquement.
- Popup par défaut, **repli automatique en redirection** si la popup est bloquée.

## Prérequis (fournis par BNAAS)

Ton application doit être **enregistrée** :
- app registration Entra avec les rôles requis ;
- entrée côté BNAAS (`client_id` = app id Entra) avec l'**allowlist** des origines et
  des `redirect_uri`.

BNAAS te communique : ton `client_id`, l'URL du portail et l'URL du Gateway.

## Installation (GitHub Packages)

Le paquet est publié sur **GitHub Packages** sous le scope `@chaireblockchainulaval`.
Configure `.npmrc` à la racine du projet consommateur :

```
@chaireblockchainulaval:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Puis :

```bash
npm install @chaireblockchainulaval/bnaas-connect
```

## Usage — popup (recommandé)

```ts
import { connect } from '@chaireblockchainulaval/bnaas-connect';

async function onObtenirJeton() {
  try {
    const { token, expires_at } = await connect({
      clientId:    'APP_ID_ENTRA_DU_TIERS',
      redirectUri: 'https://mon-appli.example/callback', // dans l'allowlist
      portalUrl:   'https://app.test.bnaas.ca',          // optionnel (défaut test)
      apiUrl:      'https://api.test.bnaas.ca',           // optionnel (défaut test)
    });
    // token : jeton d'identité notariale (15 min, usage unique)
    // À placer dans l'en-tête X-Notarial-Identity-Token des appels notariaux.
  } catch (e) {
    if ((e as Error).message === 'access_denied') { /* refusé par le notaire */ }
    else if ((e as Error).message === 'popup_closed') { /* fenêtre fermée */ }
    else { /* autre erreur */ }
  }
}
```

## Usage — redirection (repli / sans popup)

En cas de popup bloquée, `connect()` bascule seul en redirection. Sur la page de
callback (`redirectUri`), appeler `handleRedirectCallback()` au chargement :

```ts
import { connect, handleRedirectCallback } from '@chaireblockchainulaval/bnaas-connect';

const result = await handleRedirectCallback();
if (result) {
  const { token, expires_at } = result;
}

// Pour forcer le mode redirection dès le départ :
await connect({ clientId, redirectUri, preferRedirect: true });
```

## Sécurité

- **PKCE (S256)** : le `code_verifier` ne quitte jamais l'application.
- **`state`** anti-CSRF vérifié à la réception.
- **Origine vérifiée** : en popup, seuls les messages du portail sont acceptés.
- Le **jeton ne transite jamais** dans le `postMessage` — uniquement le code court, à
  usage unique, échangé ensuite contre le jeton.

## Développement

```bash
npm install
npm run build      # génère dist/ (ESM + CJS + types) via tsup
```

## Publication (mainteneurs BNAAS)

```bash
npm run build
npm publish        # registre défini dans publishConfig (GitHub Packages)
```
Nécessite un `GITHUB_TOKEN` avec le scope `write:packages` configuré dans `.npmrc`.

## API

- `connect(options): Promise<{ token, expires_at }>`
- `handleRedirectCallback(): Promise<{ token, expires_at } | null>`

Options : `clientId`, `redirectUri` (requis) ; `portalUrl`, `apiUrl`, `preferRedirect` (optionnels).
