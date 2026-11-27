# Contribution & publication — @chaireblockchainulaval/bnaas-connect

Document destiné aux **mainteneurs BNAAS**. Les intégrateurs tiers n'ont pas besoin de
cette page (voir le `README.md` et `docs/GUIDE-PARTENAIRE.md`).

## Développement

```bash
npm install
npm run typecheck  # tsc --noEmit
npm test           # Vitest (test/*.test.ts) : opération, PKCE, state, échange, flux simulés
npm run build      # génère dist/ (ESM + CJS + types) via tsup
```

Le code source est en TypeScript dans `src/` (`index.ts` : API publique et flux navigateur ;
`operation.ts`, `protocol.ts`, `encoding.ts` : briques testables sans DOM). Le contrat de
référence est `docs/oauth-connect.md` du dépôt `bnaas-gateway`. Tenir `CHANGELOG.md` à jour. Le build produit trois cibles :
`dist/index.js` (ESM), `dist/index.cjs` (CJS) et `dist/index.d.ts` (types).

## Publication

### CI — Trusted Publishing (recommandé)

Créer une **Release GitHub** déclenche `.github/workflows/publish.yml`, qui publie sur npm
**sans aucun token stocké** (authentification par OIDC, provenance automatique).

Prérequis (à faire une fois) : déclarer ce dépôt + le workflow comme *Trusted Publisher*
sur la page npm du paquet (Settings → Trusted Publisher : owner `ChaireBlockchainULaval`,
repo `bnaas-connect`, workflow `publish.yml`).

Flux d'une nouvelle version :

```bash
npm version patch          # bump + commit + tag (ex. 1.0.0 → 1.0.1 ; `npm version major` pour un changement incompatible)
git push --follow-tags
```
Puis créer la **Release GitHub** sur ce tag → le workflow publie automatiquement.

### Manuel (dépannage)

```bash
npm run build
npm publish                # registre + accès public définis dans publishConfig
```
Nécessite d'être connecté à npm (`npm login`) avec un compte membre de l'organisation npm
`chaireblockchainulaval`. Comme le compte impose la 2FA, utiliser soit `npm publish --otp=…`,
soit un token granulaire avec l'option *bypass 2FA*.

## Copie de test locale

Une copie du SDK vit dans le dépôt `bnaas-portal` (`sdk/`) uniquement pour tester le flux
en local (`test.html`). Elle **n'est pas la source de vérité** et doit être resynchronisée
manuellement depuis `src/index.ts` si le SDK change.
