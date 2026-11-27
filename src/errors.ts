/**
 * Erreur levée par le SDK. `code` est stable et sert au traitement côté application ;
 * `message` reprend `code` (compatibilité avec `e.message === 'access_denied'`).
 *
 * Codes :
 *  - `invalid_operation`      : opération refusée par la validation locale (avant toute popup) ;
 *  - `invalid_config`         : `clientId` / `redirectUri` manquants ou URL invalide ;
 *  - `access_denied`          : refus du notaire ou de BNAAS (voir `description` :
 *                               `consent_refused`, `invalid_preparation`, `notary_status_inactive`…) ;
 *  - `invalid_request`        : demande rejetée par l'écran BNAAS (`description` donne la raison) ;
 *  - `state_mismatch`         : `state` reçu ≠ `state` émis (CSRF ou flux mélangés) ;
 *  - `timeout`                : aucune réponse dans le délai (popup fermée ou abandonnée) ;
 *  - `token_exchange_failed`  : `POST /api/v1/oauth/token` en échec (`status` HTTP renseigné) ;
 *  - tout autre `error` OAuth renvoyé sur le `redirect_uri` est repris tel quel.
 */
export class BnaasConnectError extends Error {
  readonly code: string;
  readonly description?: string;
  readonly status?: number;

  constructor(code: string, description?: string, status?: number) {
    super(code);
    this.name = 'BnaasConnectError';
    this.code = code;
    if (description !== undefined) this.description = description;
    if (status !== undefined) this.status = status;
  }
}
