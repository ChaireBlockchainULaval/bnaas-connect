# Devenir une application partenaire BNAAS

Guide destiné aux **développeurs d'applications tierces** (logiciels notariaux)
qui veulent intégrer le bouton **« Se connecter avec BNAAS »** et obtenir des
**jetons d'identité notariale** au nom du notaire, sans copier-coller.

Le flux est un **OAuth 2.0 Authorization Code + PKCE** en popup ; le SDK
`@chaireblockchainulaval/bnaas-connect` l'encapsule pour toi.

---

## Vue d'ensemble

```
[Ton appli]  ──clic──▶  popup portail BNAAS  ──▶  le notaire s'authentifie + consent
     ▲                                                      │
     └──────────  jeton d'identité notariale  ◀─────────────┘
                  (15 min, usage unique)
```

Tu obtiens un jeton `bnaas_nit_…` que tu places dans l'en-tête
`X-Notarial-Identity-Token` de tes appels aux endpoints notariaux du Gateway.

---

## Étape 1 — Prérequis Entra (Azure AD)

1. Crée une **app registration** dans ton tenant (ou demande à BNAAS selon l'entente).
2. Fais **assigner les app roles** BNAAS dont tu as besoin, selon les opérations visées :
   - `CertifyDocuments` — certification de documents ;
   - `NotarialProcess` — dossiers notariaux ;
   - `VaultAnchor` — coffre-fort numérique ;
   - (autres selon les services souscrits).
   > Ce sont **ces rôles**, portés par le jeton d'accès Entra, qui autorisent réellement
   > tes appels. Ils sont accordés dans Entra, pas dans une base BNAAS.
3. Note ton **Application (client) ID** — c'est l'identifiant pivot (ton `client_id`).

## Étape 2 — Demande d'enregistrement auprès de BNAAS

Transmets à l'équipe BNAAS :
- ton **Application (client) ID** Entra ;
- le **nom** affiché de ton application (vu par le notaire à l'écran de consentement) ;
- la (les) **origine(s)** d'où le flux sera lancé (ex. `https://mon-appli.example`) ;
- le (les) **redirect_uri** de callback (ex. `https://mon-appli.example/callback`).

BNAAS enregistre ton application (allowlist stricte d'origines / redirect_uri) et te
confirme que tu peux lancer le flux. **Sans cet enregistrement, le flux est refusé.**

## Étape 3 — Installer le SDK

Le SDK est publié sur **GitHub Packages** sous le scope `@chaireblockchainulaval`.
Ajoute un `.npmrc` à la racine de ton projet :

```
@chaireblockchainulaval:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```
(`GITHUB_TOKEN` = un token avec le scope `read:packages`.)

```bash
npm install @chaireblockchainulaval/bnaas-connect
```

## Étape 4 — Intégrer le bouton

```ts
import { connect } from '@chaireblockchainulaval/bnaas-connect';

async function obtenirJeton() {
  const { token, expires_at } = await connect({
    clientId:    'TON_APPLICATION_CLIENT_ID',
    redirectUri: 'https://mon-appli.example/callback',
    // portalUrl / apiUrl : optionnels (par défaut environnement de test)
  });
  // → token : jeton d'identité notariale à utiliser immédiatement
}
```

**Important — page de callback.** Ajoute une ligne sur la page servie à ton
`redirect_uri`, pour couvrir le cas où le notaire n'a pas de session BNAAS active
(la popup fait alors un login interactif et retombe en redirection) :

```ts
import { handleRedirectCallback } from '@chaireblockchainulaval/bnaas-connect';

// au chargement de la page redirect_uri :
handleRedirectCallback().then((result) => {
  if (result) {
    // Cas redirection pleine page : result = { token, expires_at }.
  }
  // Cas popup : le code est relayé automatiquement à la fenêtre d'origine ;
  // cette page se referme seule, rien d'autre à faire.
});
```

## Étape 5 — Utiliser le jeton

```
POST https://api.test.bnaas.ca/api/v1/certifications
Authorization: Bearer <ton jeton d'accès Entra>
X-Notarial-Identity-Token: bnaas_nit_…
Content-Type: application/json
{ "documentHash": "…", "depositMode": "controlled" }
```

- Le jeton est **valable 15 minutes** et **à usage unique** : obtiens-en un juste avant
  l'opération, ne le stocke pas durablement.
- Il faut **aussi** ton jeton d'accès Entra (`Authorization: Bearer …`) avec les rôles :
  le jeton notarial prouve *l'identité du notaire*, le Bearer prouve *ton application*.

## Sécurité & bonnes pratiques

- Le SDK gère **PKCE (S256)** et l'anti-CSRF (`state`) : ne réimplémente pas le flux à la main.
- N'expose jamais le jeton dans une URL, un log, ou un stockage persistant.
- Demande un jeton **au moment** de l'opération, pas à l'avance.
- Le notaire peut **révoquer** l'accès de ton application à tout moment (portail BNAAS,
  « Applications connectées ») : gère proprement un refus/È échec et redemande le consentement.

## Support

- Référence complète du SDK : voir le `README.md` du paquet.
- Contact / demande d'enregistrement : équipe BNAAS.
