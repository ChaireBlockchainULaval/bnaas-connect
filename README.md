# @chaireblockchainulaval/bnaas-connect

SDK « Se connecter avec BNAAS » pour les applications partenaires. **Version 2 : le notaire
consent à chaque opération notariale**, sur un écran servi par BNAAS. L'application reçoit
un **jeton d'identité notariale** (`bnaas_nit_…`) **lié à cette seule opération**.

- TypeScript, **aucune dépendance runtime** (`crypto.subtle` natif). Navigateur uniquement.
- OAuth 2.0 Authorization Code + **PKCE (S256)**, `state` vérifié.
- Popup par défaut, **repli en redirection pleine page** si la popup est bloquée.

> Passage de 0.3.x à 1.0.0 : voir **[CHANGELOG.md](CHANGELOG.md)** (changement incompatible).
> Guide d'intégration : **[docs/GUIDE-PARTENAIRE.md](docs/GUIDE-PARTENAIRE.md)**.
> Mainteneurs : **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Principe

```
Application (SDK)                    BNAAS auth.*                        BNAAS api.*
1. connect({ operation }) ── popup ▶ /connect/authorize
                                       connexion du notaire au besoin
                                       écran de consentement (application, opération, document)
2. redirect_uri?code&state ◀───────── Autoriser   (Refuser → ?error=access_denied&state)
3. échange du code ─────────────────────────────────────────────────▶ POST /api/v1/oauth/token
   ◀──────────────────────────────── { token, expires_at, sub, consent_id, operation }
4. appel de l'API : Authorization: Bearer <jeton Entra de l'application>
                    X-Notarial-Identity-Token: <token> ──────────────▶ action conforme à l'opération
```

- L'écran de consentement est **toujours** affiché, même si le notaire a une session BNAAS
  active : aucun consentement n'est mémorisé.
- Le nit dure **5 minutes** et sert **une seule fois**. Une action qui ne correspond pas à
  l'opération consentie (autre empreinte, autre dossier, autre nombre…) répond
  `403 operation-not-consented` et consomme le nit.

## Prérequis (fournis par BNAAS)

L'application est enregistrée auprès de BNAAS : `client_id`, liste des `redirect_uri`,
flux `connect` activé et **application Entra liée** (celle qui présentera les nits avec son
propre jeton). BNAAS communique le `client_id` et les URL d'environnement.

| Environnement | Écran de consentement (`authUrl`) | Gateway (`apiUrl`) |
|---|---|---|
| Test (défaut) | `https://auth.test.bnaas.ca` | `https://api.test.bnaas.ca` |
| Production | `https://auth.bnaas.ca` | communiquée par BNAAS |

## Installation

```bash
npm install @chaireblockchainulaval/bnaas-connect
```

## Demander le consentement pour une opération

```ts
import { connect, BnaasConnectError } from '@chaireblockchainulaval/bnaas-connect';

async function certifier(fichier: File, dossierId: string) {
  const sha256 = await empreinteSha256(fichier);        // 64 caractères hexadécimaux

  try {
    const { token, sub, consent_id } = await connect({
      clientId:    'VOTRE_CLIENT_ID',
      redirectUri: 'https://votre-application.example/callback',
      operation: {
        type: 'certify_document',
        document: { name: fichier.name, sha256 },
        dossierId,
      },
      // forceReauth: true,                              // ressaisie du mot de passe CNQ
      // authUrl / apiUrl : défaut = environnement de test
    });
    // token : nit, 5 min, usage unique, valable pour CETTE certification seulement.
    // sub   : identifiant stable du notaire — à indexer pour lier les comptes (jamais le token).
    await appelerApiCertification(token, sha256);
  } catch (e) {
    if (e instanceof BnaasConnectError) {
      switch (e.code) {
        case 'access_denied':     /* e.description : consent_refused, invalid_preparation, notary_status_inactive… */ break;
        case 'invalid_operation': /* opération mal formée (validation locale, aucune fenêtre ouverte) */ break;
        case 'timeout':           /* popup fermée ou abandonnée */ break;
        default:                  /* state_mismatch, token_exchange_failed (e.status), invalid_request… */
      }
    }
  }
}

async function empreinteSha256(f: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

Le SDK valide l'opération **avant** d'ouvrir la popup (type connu, champs requis ou non
attendus, empreinte de 64 hexadécimaux, `count` entier de 1 à 10, `preparationId` UUID), puis
l'encode en JSON **base64url sans remplissage** dans le paramètre `operation`.

### Types d'opération

| `type` | Action API autorisée | `document` | `dossierId` | `certId` | `count` |
|---|---|---|---|---|---|
| `certify_document` | `POST /certifications` (plateforme ou externe) | requis | facultatif | — | — |
| `revoke_certification` | révocation d'une certification | — | — | requis | — |
| `upload_notarial_document` | dépôt d'un document notarial | requis (empreinte du fichier) | — | — | — |
| `open_dossier` | ouverture d'un dossier | facultatif | — | — | 1 à 10 événements initiaux |
| `record_event` | consignation (unitaire ou groupée) | facultatif | requis | — | 1 à 10 |
| `close_dossier` | clôture | — | requis | — | — |
| `sign_document` | *à préciser* : aucune action pour l'instant (`403`) | requis, **nom compris** | — | — | — |

`document` = `{ name?, sha256 }`. Le nom est affiché au notaire comme « déclaré par
l'application » ; **l'empreinte fait foi**. Tous les types acceptent `preparationId`
(voir plus bas).

## Page de callback (obligatoire)

La page servie sur `redirectUri` (même origine que la page qui appelle `connect()`) appelle
`handleRedirectCallback()` au chargement. En popup, elle relaie le retour à la fenêtre
d'origine puis se referme ; en redirection pleine page, elle vérifie `state`, échange le code
et renvoie le résultat.

```ts
import { handleRedirectCallback } from '@chaireblockchainulaval/bnaas-connect';

const result = await handleRedirectCallback();
if (result) {
  // Redirection pleine page : result = { token, expires_at, sub, consent_id, operation }.
}
```

Pour imposer la redirection : `connect({ …, preferRedirect: true })` (la promesse ne se
résout pas ; le résultat arrive sur la page de callback).

## Appeler l'API avec le nit

Deux en-têtes, toujours ensemble :

```http
POST https://api.test.bnaas.ca/api/v1/certifications
Authorization: Bearer <jeton Entra de l'application>
X-Notarial-Identity-Token: bnaas_nit_…
Content-Type: application/json
```

- `Authorization` : jeton **applicatif Entra** de l'application liée au `client_id` (il
  porte les rôles d'application). Un jeton d'accès BNAAS du notaire ne porte aucun rôle :
  une action avec lui répond `403`.
- `X-Notarial-Identity-Token` : le `token` renvoyé par `connect()`. Un nit présenté par une
  autre application est refusé.
- La requête doit correspondre **exactement** à l'opération consentie. Obtenir le nit
  juste avant l'action ; ne jamais le stocker, le journaliser ni le placer dans une URL.

## Préparation par un collaborateur d'étude

Un collaborateur ne peut pas lancer `connect()` : il **prépare**, le notaire de la même
étude **consent**.

1. **Côté serveur**, l'application enregistre la préparation :

   ```http
   POST https://api.test.bnaas.ca/api/v1/connect/preparations
   Authorization: Bearer <jeton applicatif Entra>
   X-Acting-User-Token: <jeton d'accès BNAAS du collaborateur>
   Content-Type: application/json

   { "operation": { "type": "certify_document", "document": { "name": "…", "sha256": "…" } } }
   ```

   Réponse `201 { "preparation_id": "…", "expires_at": "…" }` — usage unique, 72 h.

2. Le notaire, connecté pour sa propre étude, lance `connect()` avec **la même opération**
   et `preparationId` :

   ```ts
   await connect({ clientId, redirectUri, operation: { ...operationPreparee, preparationId } });
   ```

   L'écran affiche « Préparé par … », vérifié par BNAAS. En cas d'écart (application,
   opération ou étude), `connect()` rejette avec `code = 'access_denied'` et
   `description = 'invalid_preparation'`.

## API

- `connect(options): Promise<TokenResult>`
- `handleRedirectCallback(): Promise<TokenResult | null>`
- `encodeOperation(operation): string` — validation + encodage base64url (utile côté tests).
- `BnaasConnectError` — `code`, `description?`, `status?`.

**Options de `connect`** : `clientId`, `redirectUri`, `operation` (requis) ; `forceReauth`,
`authUrl`, `apiUrl`, `preferRedirect`, `timeoutMs` (défaut 5 min).

**`TokenResult`** : `token` (nit, 5 min, usage unique), `expires_at` (ISO 8601), `sub`
(identifiant stable du notaire), `consent_id`, `operation` (résumé de l'opération consentie).

## Sécurité

- **PKCE (S256)** : le `code_verifier` ne quitte jamais la fenêtre de l'application.
- **`state`** aléatoire, vérifié avant de considérer le code ou l'erreur reçus.
- Le retour ne transporte qu'un **code** (60 s, usage unique), jamais le jeton.
- L'échange `POST /api/v1/oauth/token` se fait **sans** en-tête `Authorization`.
