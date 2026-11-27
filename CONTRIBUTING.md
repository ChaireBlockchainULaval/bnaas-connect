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
référence est `docs/oauth-connect.md` du dépôt `bnaas-gateway`. Tenir `CHANGELOG.md` à jour.
Le build produit trois cibles : `dist/index.js` (ESM), `dist/index.cjs` (CJS) et
`dist/index.d.ts` (types).

**CI** (`.github/workflows/ci.yml`) : typecheck, tests et build sur chaque pull request et
chaque push sur `main`. Pour la lancer à la demande : onglet *Actions* → *CI* →
*Run workflow* (ou `gh workflow run ci.yml --ref <branche>`).

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
Puis créer la **Release GitHub** sur ce tag → le workflow publie automatiquement. Il refuse
de publier si le tag (`vX.Y.Z`) ne correspond pas à `version` dans `package.json`, et relance
typecheck + tests avant le build.

### Sortie de la 1.0.0 (V2) — à faire une fois

`package.json` est déjà en `1.0.0` sur `main` : **ne pas** relancer `npm version`.

1. **Prérequis** : `/connect/authorize` et l'échange V2 en service sur le Gateway de test ;
   flux testé de bout en bout dans un vrai navigateur (popup → consentement → nit → appel
   d'API) avec un client de test. La V1 reste active jusqu'à la bascule, donc 0.3.x et
   1.0.0 coexistent pendant la migration.
2. Remplacer « non publiée » par la date dans `CHANGELOG.md` (PR), puis sur `main` à jour :
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   gh release create v1.0.0 --title "v1.0.0 — consentement par opération" --notes-file docs/MIGRATION-1.0.md
   ```
   → publication sur npm, `latest` = 1.0.0. Les installations en `^0.3.x` ne bougent pas
   (version majeure).
3. **Signaler 0.3.x comme obsolète** (manuel, compte npm avec 2FA ; Trusted Publishing ne
   couvre que `publish`). Le message s'affiche à chaque `npm install` d'une 0.3.x :
   ```bash
   npm deprecate "@chaireblockchainulaval/bnaas-connect@<1.0.0" "V1 retirée à la bascule BNAAS : migrer vers 1.x — https://github.com/ChaireBlockchainULaval/bnaas-connect/blob/main/docs/MIGRATION-1.0.md" --otp=<code>
   ```
   Ne **pas** dépublier (`npm unpublish`) : cela casserait les builds des partenaires.
4. **Prévenir les partenaires** avec le lien vers `docs/MIGRATION-1.0.md` et la **date de
   bascule** (`AUTH_V1_ENABLED=false`) ; leur rappeler de faire activer le flux `connect` et
   lier leur application Entra (`admin-clients.js flows` / `entra-app`).
5. Mettre à jour les pages Confluence citées par `docs/GUIDE-PARTENAIRE.md` (runbook
   d'onboarding, référence OAuth) : elles décrivent encore la V1.
6. Après la bascule : vérifier dans les journaux du Gateway qu'aucun client n'appelle plus
   les routes V1 (`410 v1-retired`).

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
manuellement depuis `src/` si le SDK change (en 1.0.0, le code est réparti sur plusieurs
fichiers : préférer `dist/index.js` après `npm run build`).
