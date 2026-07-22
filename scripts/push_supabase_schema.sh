#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${NBA_STOCK_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF to the dedicated market project ref}"

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
    if [[ ! -r /dev/tty ]]; then
        echo "SUPABASE_DB_PASSWORD is required when no terminal is available" >&2
        exit 1
    fi
    read -r -s -p "Supabase database password: " SUPABASE_DB_PASSWORD </dev/tty
    printf '\n' >/dev/tty
fi
export SUPABASE_DB_PASSWORD
trap 'unset SUPABASE_DB_PASSWORD' EXIT

npx supabase link --project-ref "$SUPABASE_PROJECT_REF"

linked_ref="$(tr -d '\r\n' < supabase/.temp/project-ref)"
if [[ "$linked_ref" != "$SUPABASE_PROJECT_REF" ]]; then
    echo "Refusing to push: linked project is '$linked_ref', expected '$SUPABASE_PROJECT_REF'" >&2
    exit 1
fi

npx supabase db push --dry-run
npx supabase db push
