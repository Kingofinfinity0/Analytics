## 2026-03-30 - Prevent Raw OAuth Response Payload Leaks in User Error Pages
**Vulnerability:** OAuth error handling in `instagram_oauth_callback` dumped full JSON API response payloads (`JSON.stringify(shortJson)` and `JSON.stringify(longJson)`) into HTML error responses rendered directly to end users.
**Learning:** During OAuth token exchanges, failed response payloads can contain partial credential information, application secrets, internal server fields, or sensitive error metadata. Returning `JSON.stringify(...)` in public HTML responses leaks internal system state and sensitive OAuth details.
**Prevention:** Extract specific, sanitized error messages (e.g. `json.error_message || json.error?.message`) or return generic failure descriptions instead of stringifying complete API response bodies in web endpoints.

## 2026-03-30 - Avoid Bearer Tokens in Query Strings and Secure Vault Authentication Errors
**Vulnerability:** `check_token_health` passed `access_token` in Graph API URL query parameters and returned raw database error messages in a 500 response when Vault secret verification failed.
**Learning:** Placing access tokens in URL query strings exposes sensitive credentials to HTTP access logs, proxy logs, and referer headers. Furthermore, returning database exception messages on Vault secret mismatch exposes internal system details and masks authentication failures as server errors.
**Prevention:** Pass API access tokens via the `Authorization: Bearer <token>` HTTP header and map internal secret mismatch exceptions directly to 401 Unauthorized responses without exposing database internals.
