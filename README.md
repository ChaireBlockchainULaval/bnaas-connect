# @chaireblockchainulaval/bnaas-connect

SDK « Se connecter avec BNAAS » pour applications tierces. Obtient un **jeton
d'identité notariale** via OAuth 2.0 (Authorization Code + PKCE), sans copier-coller.

- TypeScript, **aucune dépendance runtime** (`crypto.subtle` natif). Navigateur uniquement.
- Popup par défaut, **repli automatique en redirection** si la popup est bloquée ou si un
  login interactif est nécessaire.

> Guide d'intégration complet : **[docs/GUIDE-PARTENAIRE.md](docs/GUIDE-PARTENAIRE.md)**.
> Contribution / publication du paquet (mainteneurs BNAAS) : **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Prérequis (fournis par BNAAS)

Ton application doit être **enregistrée** auprès de BNAAS :
- app registration Entra avec les rôles requis ;
- entrée côté BNAAS (`client_id` = app id Entra) avec l'**allowlist** des origines et
  des `redirect_uri`.

BNAAS te communique alors : ton `client_id`, l'URL du portail et l'URL du Gateway.

## Installation

Paquet **public sur npm** — aucun token ni `.npmrc` requis :

```bash
npm install @chaireblockchainulaval/bnaas-connect
```

## Usage — popup (recommandé)

```ts
import { connect } from '@chaireblockchainulaval/bnaas-connect';

async function obtenirJeton() {
  try {
    const { token, expires_at, sub } = await connect({
      clientId:    'APP_ID_ENTRA_DU_TIERS',
      redirectUri: 'https://mon-appli.example/callback', // doit être dans l'allowlist
      portalUrl:   'https://app.test.bnaas.ca',          // optionnel (défaut : test)
      apiUrl:      'https://api.test.bnaas.ca',           // optionnel (défaut : test)
    });
    // token : jeton d'identité notariale (15 min, usage unique).
    //         À placer dans l'en-tête X-Notarial-Identity-Token des appels notariaux.
    // sub   : identifiant stable et global du notaire — sert à lier/dédoublonner
    //         le compte côté ton application (à indexer, jamais le token).
  } catch (e) {
    if ((e as Error).message === 'access_denied') { /* le notaire a refusé */ }
    else if ((e as Error).message === 'popup_closed') { /* fenêtre fermée */ }
    else { /* autre erreur */ }
  }
}
```

## Page de callback (à faire une fois)

Sur la page servie à ton `redirectUri`, appelle `handleRedirectCallback()` au chargement.
C'est ce qui couvre le cas où le notaire **n'a pas de session BNAAS active** (login
interactif dans la popup, puis relais du code à la fenêtre d'origine) ainsi que le repli
en redirection pleine page :

```ts
import { handleRedirectCallback } from '@chaireblockchainulaval/bnaas-connect';

// Au chargement de la page redirect_uri :
const result = await handleRedirectCallback();
if (result) {
  // Redirection pleine page : result = { token, expires_at }.
  // (Cas popup : le code est relayé automatiquement à la fenêtre d'origine,
  //  cette page se referme seule — rien de plus à faire.)
}
```

Pour forcer le mode redirection dès le départ :

```ts
await connect({ clientId, redirectUri, preferRedirect: true });
```

## Sécurité

- **PKCE (S256)** : le `code_verifier` ne quitte jamais ton application.
- **`state`** anti-CSRF, vérifié à la réception.
- **Origine vérifiée** : en popup, seuls les messages du portail sont acceptés.
- Le **jeton ne transite jamais** dans le canal de retour — uniquement un code court, à
  usage unique, échangé ensuite contre le jeton.

## API

- `connect(options): Promise<{ token, expires_at, sub }>`
- `handleRedirectCallback(): Promise<{ token, expires_at, sub } | null>`

**Options** : `clientId`, `redirectUri` (requis) ; `portalUrl`, `apiUrl`, `preferRedirect`
(optionnels).

**Résultat** :
- `token` — jeton d'identité notariale (15 min, usage unique) ;
- `expires_at` — expiration ISO 8601 ;
- `sub` — identifiant stable et global du notaire, à utiliser pour lier/dédoublonner les
  comptes côté application (à indexer, jamais le `token`).
