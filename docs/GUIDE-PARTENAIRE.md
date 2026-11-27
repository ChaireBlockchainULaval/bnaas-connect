# Guide d'intégration — bnaas-connect V2 (consentement par opération)

Ce guide décrit l'intégration de **« Se connecter avec BNAAS »** (V2, SDK 1.x), qui permet
à une application tierce (logiciel notarial) d'obtenir un **jeton d'identité notariale**
pour **une opération précise**, après que le notaire y a consenti sur un écran servi par
BNAAS.

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
[Application cliente] ──connect({ operation })──▶ popup auth.bnaas ──▶ connexion au besoin
        ▲                                                              + consentement à CETTE opération
        └──────────── jeton d'identité notariale lié à l'opération ◀───────────┘
                          (5 min, usage unique)
```

Le jeton obtenu, au format `bnaas_nit_…`, est transmis dans l'en-tête
`X-Notarial-Identity-Token` de l'appel correspondant à l'opération consentie.

---

## Étape 1 — Transmission des informations à BNAAS

L'organisation intégratrice transmet à l'équipe BNAAS :

* le nom affiché de l'application (celui présenté au notaire à l'écran de consentement) ;
* la ou les origines depuis lesquelles le flux sera lancé (ex. `https://application.example`) ;
* le ou les redirect_uri de callback (ex. `https://application.example/callback`) ;
* les opérations visées par l'application (ex. certification de documents, dossiers
  notariaux), afin que BNAAS détermine les app roles à assigner ;
* l'application Entra qui appellera l'API (celle qui présentera les nits avec son propre
  jeton).

## Étape 2 — Réception des identifiants

L'organisation intégratrice reçoit en retour :

* le `client_id` à utiliser dans le SDK ;
* les URL d'environnement (écran de consentement `auth.*`, Gateway `api.*`) ;
* la confirmation que le flux `connect` est actif pour l'application.

Sans cet enregistrement préalable, le flux est refusé : tout `redirect_uri` non enregistré
est rejeté par BNAAS.

## Étape 3 — Installation du SDK

Le SDK est **public sur npm** — aucun token ni `.npmrc` requis :

```shell
npm install @chaireblockchainulaval/bnaas-connect
```

Référence complète du SDK : voir le `README.md` du dépôt
[ChaireBlockchainULaval/bnaas-connect](https://github.com/ChaireBlockchainULaval/bnaas-connect).

## Étape 4 — Demande de consentement, au moment de l'opération

```ts
import { connect } from '@chaireblockchainulaval/bnaas-connect';

async function certifier(nomFichier: string, sha256: string) {
  const { token, sub } = await connect({
    clientId:    'APPLICATION_CLIENT_ID',
    redirectUri: 'https://application.example/callback',
    operation:   { type: 'certify_document', document: { name: nomFichier, sha256 } },
    // authUrl / apiUrl : optionnels (environnement de test par défaut)
  });
  // token : nit valable 5 min, une seule fois, pour cette certification seulement.
}
```

Les types d'opération et leurs champs sont décrits dans le `README.md` du SDK. Le notaire
voit l'application, l'opération et le document (nom déclaré, empreinte) ; il autorise ou
refuse. **L'écran s'affiche à chaque opération**, même si le notaire est déjà connecté.

**Page de callback.** La page servie sur le `redirect_uri` (même origine que la page qui
appelle `connect()`) doit appeler `handleRedirectCallback()` au chargement : elle relaie le
retour à la fenêtre d'origine (la popup se referme d'elle-même) ou, en repli redirection
pleine page (popup bloquée), échange le code :

```ts
import { handleRedirectCallback } from '@chaireblockchainulaval/bnaas-connect';

handleRedirectCallback().then((result) => {
  if (result) {
    // Cas redirection pleine page : result = { token, expires_at, sub, consent_id, operation }.
  }
});
```

**Préparation par un collaborateur.** Un collaborateur d'étude ne lance pas `connect()` :
l'application enregistre côté serveur une préparation (`POST /api/v1/connect/preparations`),
puis le notaire consent avec la même opération et le `preparationId` obtenu (voir README).

## Étape 5 — Utilisation du jeton

```
POST https://api.test.bnaas.ca/api/v1/certifications
Authorization: Bearer <jeton d'accès Entra de l'application>
X-Notarial-Identity-Token: bnaas_nit_…
Content-Type: application/json
```

* Le jeton est valable 5 minutes, à usage unique, et **uniquement pour l'opération
  consentie** : une requête qui s'en écarte (autre empreinte, autre dossier…) répond
  `403 operation-not-consented` et consomme le jeton.
* Le jeton d'accès Entra de l'application (`Authorization: Bearer …`) demeure requis en
  parallèle : le jeton notarial atteste l'identité et le consentement du notaire, le jeton
  Bearer atteste l'identité de l'application.

**Lier le compte notaire (`sub`).** `connect()` renvoie aussi `sub`, l'identifiant
**stable et global** du notaire. C'est la valeur à stocker/indexer côté application pour
rattacher un notaire à un compte et éviter les doublons. N'utilise **jamais** le `token`
comme identifiant (il est éphémère et à usage unique) — seul `sub` est constant.

## Sécurité et bonnes pratiques

* Le SDK gère PKCE (S256) et la protection anti-CSRF (`state`) ; le flux ne doit pas être
  réimplémenté manuellement.
* Le jeton ne doit jamais apparaître dans une URL, un journal applicatif, ou un stockage
  persistant.
* Le jeton doit être demandé au moment de l'opération, non par anticipation.
* L'application doit gérer proprement un refus (`access_denied`) ou un abandon (`timeout`)
  et permettre au notaire de recommencer.

## Support

* Référence complète du SDK : `README.md` du dépôt
  [ChaireBlockchainULaval/bnaas-connect](https://github.com/ChaireBlockchainULaval/bnaas-connect).
* Demande d'enregistrement ou contact : équipe BNAAS (voir modalités transmises lors de
  l'onboarding du projet).
