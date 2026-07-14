# Guide d'intégration — bnaas-connect (Authorization Code + PKCE)

Ce guide décrit l'intégration du mécanisme de délégation **« Se connecter avec BNAAS »**,
qui permet à une application tierce (logiciel notarial) d'obtenir des **jetons d'identité
notariale** au nom du notaire, sans que celui-ci ait à les copier-coller manuellement.

Le flux repose sur **OAuth 2.0 Authorization Code + PKCE**, exécuté dans une popup. Le SDK
`@chaireblockchainulaval/bnaas-connect` encapsule ce flux et expose une interface simple
côté application cliente.

> Ce guide s'adresse à l'équipe de développement d'une application tierce intégrant le
> SDK. Pour la procédure d'enregistrement côté administrateur BNAAS, voir le
> [Runbook — Onboarder une application cliente BNAAS](https://chaire-blockchain-ulaval.atlassian.net/wiki/spaces/BNAAS/pages/21528612).
> Pour la référence technique complète du mécanisme, voir le
> [guide de référence OAuth 2.0 + PKCE](https://chaire-blockchain-ulaval.atlassian.net/wiki/spaces/BNAAS/pages/21528583).

---

## Vue d'ensemble

```
[Application cliente]  ──clic──▶  popup portail BNAAS  ──▶  authentification + consentement du notaire
        ▲                                                              │
        └──────────────  jeton d'identité notariale  ◀─────────────────┘
                          (15 min, usage unique)
```

Le jeton obtenu, au format `bnaas_nit_…`, est transmis dans l'en-tête
`X-Notarial-Identity-Token` des appels adressés aux endpoints notariaux du Gateway.

---

## Étape 1 — Transmission des informations à BNAAS

L'organisation intégratrice transmet à l'équipe BNAAS :

* le nom affiché de l'application (celui présenté au notaire à l'écran de consentement) ;
* la ou les origines depuis lesquelles le flux sera lancé (ex. `https://application.example`) ;
* le ou les redirect_uri de callback (ex. `https://application.example/callback`) ;
* les opérations visées par l'application (ex. certification de documents, dossiers
  notariaux, coffre-fort numérique), afin que BNAAS détermine les app roles à assigner.

## Étape 2 — Réception des identifiants

L'organisation intégratrice reçoit en retour :

* l'**Application (client) ID** — il s'agit du `client_id` à utiliser dans le SDK ;
* la confirmation que le flux est actif pour l'application concernée.

Sans cette étape d'enregistrement préalable, le flux est refusé : toute origine ou
redirect_uri non enregistrée est rejetée par le Gateway.

## Étape 3 — Installation du SDK

Le SDK est publié sur **GitHub Packages** sous le scope `@chaireblockchainulaval`.
Un fichier `.npmrc` doit être ajouté à la racine du projet :

```
@chaireblockchainulaval:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

(`GITHUB_TOKEN` : un jeton GitHub avec le scope `read:packages`.)

```shell
npm install @chaireblockchainulaval/bnaas-connect
```

Référence complète du SDK : voir le `README.md` du dépôt
[ChaireBlockchainULaval/bnaas-connect](https://github.com/ChaireBlockchainULaval/bnaas-connect).

## Étape 4 — Intégration du bouton

```ts
import { connect } from '@chaireblockchainulaval/bnaas-connect';

async function obtenirJeton() {
  const { token, expires_at } = await connect({
    clientId:    'APPLICATION_CLIENT_ID',
    redirectUri: 'https://application.example/callback',
    // portalUrl / apiUrl : optionnels (environnement de test par défaut)
  });
  // token : jeton d'identité notariale, à utiliser immédiatement
}
```

**Page de callback.** La page servie sur le `redirect_uri` doit gérer le cas où le
notaire n'a pas de session BNAAS active (la popup effectue alors une authentification
interactive et retombe en redirection pleine page) :

```ts
import { handleRedirectCallback } from '@chaireblockchainulaval/bnaas-connect';

// Au chargement de la page redirect_uri :
handleRedirectCallback().then((result) => {
  if (result) {
    // Cas redirection pleine page : result = { token, expires_at }.
  }
  // Cas popup : le code est relayé automatiquement à la fenêtre d'origine ;
  // cette page se referme d'elle-même, aucune action supplémentaire requise.
});
```

## Étape 5 — Utilisation du jeton

```
POST https://api.test.bnaas.ca/api/v1/certifications
Authorization: Bearer <jeton d'accès Entra de l'application>
X-Notarial-Identity-Token: bnaas_nit_…
Content-Type: application/json
{ "documentHash": "…", "depositMode": "controlled" }
```

* Le jeton est valable 15 minutes et à usage unique : il doit être obtenu immédiatement
  avant l'opération, et ne doit pas être stocké durablement.
* Le jeton d'accès Entra de l'application (`Authorization: Bearer …`) demeure requis en
  parallèle : le jeton notarial atteste l'identité du notaire, le jeton Bearer atteste
  l'identité de l'application.

## Sécurité et bonnes pratiques

* Le SDK gère PKCE (S256) et la protection anti-CSRF (`state`) ; le flux ne doit pas être
  réimplémenté manuellement.
* Le jeton ne doit jamais apparaître dans une URL, un journal applicatif, ou un stockage
  persistant.
* Le jeton doit être demandé au moment de l'opération, non par anticipation.
* Le notaire peut révoquer l'accès de l'application à tout moment depuis le portail BNAAS
  (« Applications connectées »). L'application doit gérer proprement un refus ou un échec
  et redemander le consentement le cas échéant.

## Support

* Référence complète du SDK : `README.md` du dépôt
  [ChaireBlockchainULaval/bnaas-connect](https://github.com/ChaireBlockchainULaval/bnaas-connect).
* Demande d'enregistrement ou contact : équipe BNAAS (voir modalités transmises lors de
  l'onboarding du projet).