#!/bin/bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Cloud Run deployment script for LFX PCC

set -e

# Configuration
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"lfx-pcc-e44d1"}
SERVICE_NAME="lfx-pcc"
REGION=${GOOGLE_CLOUD_REGION:-"us-central1"}
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
BUILD_ENV=${BUILD_ENV:-"production"}

echo "🚀 Deploying LFX PCC to Cloud Run..."
echo "Project: ${PROJECT_ID}"
echo "Service: ${SERVICE_NAME}"
echo "Region: ${REGION}"
echo "Build Environment: ${BUILD_ENV}"

# Build and push the Docker image
echo "📦 Building Docker image..."
docker build \
  --platform linux/amd64 \
  --build-arg BUILD_ENV=${BUILD_ENV} \
  -t ${IMAGE_NAME}:latest \
  .

echo "⬆️ Pushing image to Google Container Registry..."
docker push ${IMAGE_NAME}:latest

# Use custom domain
SERVICE_URL="https://poc.lfx.dev"

# Deploy to Cloud Run
echo "🚢 Deploying to Cloud Run..."
echo "Service URL will be: ${SERVICE_URL}"
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --port 4000 \
  --memory 2Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 1 \
  --timeout 300 \
  --set-env-vars NODE_ENV=production,PCC_BASE_URL=${SERVICE_URL},PCC_AUTH0_ISSUER_BASE_URL=https://linuxfoundation-dev.auth0.com/,PCC_AUTH0_AUDIENCE=https://api-gw.dev.platform.linuxfoundation.org/ \
  --set-secrets PCC_AUTH0_CLIENT_ID=auth0-client-id:latest,PCC_AUTH0_CLIENT_SECRET=auth0-client-secret:latest,PCC_RANDOM_STRING=session-secret:latest,SUPABASE_URL=supabase-url:latest,POSTGRES_API_KEY=supabase-anon-key:latest

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format="value(status.url)")

echo "✅ Deployment complete!"
echo "🌐 Service URL: ${SERVICE_URL}"
echo "🩺 Health check: ${SERVICE_URL}/health"