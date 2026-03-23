# Deployment Guide

## 1. Deployable Units
- web
- api
- worker
- metadata-db
- redis
- object-storage
- sandbox-runtime

## 2. Required Environment Variables
- APP_BASE_URL
- DATABASE_URL
- REDIS_URL
- OBJECT_STORAGE_BUCKET
- SANDBOX_PROVIDER
- SANDBOX_NETWORK
- JWT_SECRET
- AUTH_PROVIDER_CONFIG

## 3. Deployment Steps
1. provision metadata DB and Redis
2. apply DB migrations
3. configure object storage bucket
4. deploy API and worker
5. deploy web app
6. validate sandbox runtime connectivity
7. run smoke tests

## 4. Post-Deploy Checks
- can login
- can load tracks
- can start session
- can create sandbox
- can run sample query
- cleanup jobs visible
