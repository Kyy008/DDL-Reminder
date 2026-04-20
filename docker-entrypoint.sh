#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  npm run db:migrate
fi

exec "$@"
