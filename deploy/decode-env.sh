#!/usr/bin/env bash
# Prints the server .env given the STAGING_ENV_FILE secret, which may be either the plain file or its
# base64 encoding (single line, as produced by `base64 -w0 staging.env`). Usage: decode-env.sh "$SECRET"
set -euo pipefail
raw="${1:?env file contents}"

# Base64 form: one line, decodes cleanly, and the decoded text has KEY=value lines.
compact="$(printf '%s' "$raw" | tr -d '[:space:]')"
if [ "$(printf '%s' "$raw" | grep -c '')" -le 1 ] \
  && decoded="$(printf '%s' "$compact" | base64 -d 2>/dev/null)" \
  && printf '%s\n' "$decoded" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*='; then
  printf '%s\n' "$decoded"
else
  printf '%s\n' "$raw"
fi
