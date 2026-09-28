#!/bin/sh
set -a
. ./.env
set +a

npx prisma migrate deploy
npx prisma db seed
exec node dist/main
