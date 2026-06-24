#!/bin/sh

echo "Running database seeds..."
npm run seed-users

echo "Starting the application..."
# The 'exec "$@"' passes control to the CMD in your Dockerfile
exec "$@"