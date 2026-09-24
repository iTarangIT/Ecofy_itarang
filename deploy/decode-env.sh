#!/usr/bin/env bash
# Prints the server .env given the STAGING_ENV_FILE secret, which may be either the plain file or its
# base64 encoding (as produced by `base64 -w0 staging.env`; line-wrapped base64 from a terminal copy is
# accepted too). Usage: decode-env.sh "$SECRET"
set -euo pipefail
raw="${1:?env file contents}"

# Base64 form (possibly wrapped, quoted or CRLF): only base64 characters once whitespace/quotes are
# stripped, decodes cleanly, and the decoded text has KEY=value lines.
compact="$(printf '%s' "$raw" | tr -d "[:space:]\"'")"
if printf '%s' "$compact" | grep -qE '^[A-Za-z0-9+/]+={0,2}$' \
  && decoded="$(printf '%s' "$compact" | base64 -d 2>/dev/null)" \
  && printf '%s\n' "$decoded" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*='; then
  printf '%s\n' "$decoded" | tr -d '\r'
elif printf '%s\n' "$raw" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*='; then
  printf '%s\n' "$raw" | tr -d '\r'
else
  echo "decode-env: STAGING_ENV_FILE is neither a KEY=value .env nor valid base64 of one" >&2
  exit 1
fi
