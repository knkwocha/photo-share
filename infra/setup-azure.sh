#!/usr/bin/env bash
# =============================================================================
# PhotoShare — Azure Infrastructure Provisioning Script
# =============================================================================
# Usage:
#   chmod +x setup-azure.sh
#   ./setup-azure.sh
#
# Prerequisites:
#   - Azure CLI installed  (brew install azure-cli  /  winget install Azure.AzureCLI)
#   - Logged in:  az login
# =============================================================================

set -euo pipefail

# ─── CONFIGURATION — edit these ──────────────────────────────────────────────
RESOURCE_GROUP="photoshare-rg"
LOCATION="francecentral"                        # closest Azure region to Ulster/Belfast
APP_NAME="photoshare-api"                 # App Service name (must be globally unique)
STORAGE_ACCOUNT="photosharestorage$RANDOM"
DB_SERVER="photoshare-db-$RANDOM"
DB_NAME="photoshare"
DB_USER="psadmin"
DB_PASSWORD="PhotoShare@$(openssl rand -base64 6 | tr -dc A-Za-z0-9)1!"
REDIS_NAME="photoshare-redis-$RANDOM"
VISION_NAME="photoshare-vision"
STATIC_APP_NAME="photoshare-frontend"
APP_SERVICE_PLAN="photoshare-plan"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   PhotoShare — Azure Setup               ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Resource Group : $RESOURCE_GROUP"
echo "Location       : $LOCATION"
echo "App Service    : $APP_NAME"
echo ""

# ─── 1. Resource Group ────────────────────────────────────────────────────────
echo "→ Creating resource group..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# ─── 2. Azure Blob Storage ────────────────────────────────────────────────────
echo "→ Creating Storage Account: $STORAGE_ACCOUNT"
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --output none

az storage container create \
  --name photos \
  --account-name "$STORAGE_ACCOUNT" \
  --public-access blob \
  --output none

STORAGE_KEY=$(az storage account keys list \
  --resource-group "$RESOURCE_GROUP" \
  --account-name "$STORAGE_ACCOUNT" \
  --query '[0].value' --output tsv)

echo "   ✓ Storage Account: $STORAGE_ACCOUNT"

# ─── 3. Azure CDN (for blob storage) ──────────────────────────────────────────
echo "→ Creating Azure CDN profile and endpoint..."
az cdn profile create \
  --name "photoshare-cdn" \
  --resource-group "$RESOURCE_GROUP" \
  --sku Standard_Microsoft \
  --output none 2>/dev/null || echo "   (CDN profile may already exist)"

CDN_ENDPOINT_HOSTNAME="${STORAGE_ACCOUNT}.blob.core.windows.net"
az cdn endpoint create \
  --name "photoshare-cdn-endpoint" \
  --profile-name "photoshare-cdn" \
  --resource-group "$RESOURCE_GROUP" \
  --origin "$CDN_ENDPOINT_HOSTNAME" \
  --output none 2>/dev/null || echo "   (CDN endpoint already exists)"

echo "   ✓ CDN configured"

# ─── 4. Azure PostgreSQL Flexible Server ──────────────────────────────────────
echo "→ Creating PostgreSQL Flexible Server: $DB_SERVER (this takes ~3 minutes...)"
az postgres flexible-server create \
  --name "$DB_SERVER" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --admin-user "$DB_USER" \
  --admin-password "$DB_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 15 \
  --public-access All \
  --output none

az postgres flexible-server db create \
 --resource-group "$RESOURCE_GROUP" \
 --server-name "$DB_SERVER" \
 --database-name "$DB_NAME" \
 --output none


DB_HOST="${DB_SERVER}.postgres.database.azure.com"
echo "   ✓ PostgreSQL: $DB_HOST"

# ─── 5. Azure Cache for Redis ─────────────────────────────────────────────────
echo "→ Creating Redis Cache: $REDIS_NAME (this takes ~5 minutes...)"
az redis create \
  --name "$REDIS_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Basic \
  --vm-size C0 \
  --output none

REDIS_HOST="${REDIS_NAME}.redis.cache.windows.net"
REDIS_KEY=$(az redis list-keys \
  --name "$REDIS_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query primaryKey --output tsv)

echo "   ✓ Redis: $REDIS_HOST"

# ─── 6. Azure Cognitive Services (Computer Vision) ────────────────────────────
echo "→ Creating Computer Vision service: $VISION_NAME"
az cognitiveservices account create \
  --name "$VISION_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --kind ComputerVision \
  --sku F0 \
  --location "$LOCATION" \
  --yes \
  --output none 2>/dev/null || echo "   (F0 tier may already be in use — use S1 if needed)"

VISION_ENDPOINT=$(az cognitiveservices account show \
  --name "$VISION_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.endpoint --output tsv 2>/dev/null || echo "")

VISION_KEY=$(az cognitiveservices account keys list \
  --name "$VISION_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query key1 --output tsv 2>/dev/null || echo "")

echo "   ✓ Vision endpoint: $VISION_ENDPOINT"

# ─── 7. App Service Plan + Web App (Backend) ──────────────────────────────────
echo "→ Creating App Service Plan: $APP_SERVICE_PLAN"
az appservice plan create \
  --name "$APP_SERVICE_PLAN" \
  --resource-group "$RESOURCE_GROUP" \
  --sku F1 \
  --is-linux \
  --output none

echo "→ Creating Web App: $APP_NAME"
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$APP_SERVICE_PLAN" \
  --runtime "NODE:20-lts" \
  --output none

# Set environment variables on App Service
echo "→ Configuring App Service environment..."
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV="production" \
    PORT="8080" \
    JWT_SECRET="$(openssl rand -base64 48)" \
    JWT_EXPIRES_IN="7d" \
    DB_HOST="$DB_HOST" \
    DB_PORT="5432" \
    DB_NAME="$DB_NAME" \
    DB_USER="$DB_USER" \
    DB_PASSWORD="$DB_PASSWORD" \
    DB_SSL="true" \
    AZURE_STORAGE_ACCOUNT_NAME="$STORAGE_ACCOUNT" \
    AZURE_STORAGE_ACCOUNT_KEY="$STORAGE_KEY" \
    AZURE_STORAGE_CONTAINER_NAME="photos" \
    AZURE_VISION_ENDPOINT="$VISION_ENDPOINT" \
    AZURE_VISION_KEY="$VISION_KEY" \
    REDIS_HOST="$REDIS_HOST" \
    REDIS_PORT="6380" \
    REDIS_PASSWORD="$REDIS_KEY" \
    REDIS_TLS="true" \
    CREATOR_REGISTRATION_SECRET="$(openssl rand -base64 24)" \
    CORS_ORIGIN="https://${STATIC_APP_NAME}.azurestaticapps.net" \
  --output none

az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "node server.js" \
  --output none

echo "   ✓ App Service configured: https://${APP_NAME}.azurewebsites.net"

# ─── 8. Azure Static Web Apps (Frontend) ──────────────────────────────────────
echo "→ Creating Static Web App: $STATIC_APP_NAME"
az staticwebapp create \
  --name "$STATIC_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "westeurope" \
  --source "." \
  --branch "main" \
  --app-location "frontend" \
  --output none 2>/dev/null || echo "   (Static Web App — link GitHub repo manually in Azure Portal)"

echo "   ✓ Static Web App: https://${STATIC_APP_NAME}.azurestaticapps.net"

# ─── 9. Run DB Schema ─────────────────────────────────────────────────────────
echo ""
echo "→ NOTE: Run the following command to initialise the database schema:"
echo "   psql \"host=${DB_HOST} port=5432 dbname=${DB_NAME} user=${DB_USER} password=${DB_PASSWORD} sslmode=require\" -f backend/sql/init.sql"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  ✅  PhotoShare Azure infrastructure provisioned!                   ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  Backend API   : https://${APP_NAME}.azurewebsites.net             "
echo "║  Frontend      : https://${STATIC_APP_NAME}.azurestaticapps.net   "
echo "║  Storage       : $STORAGE_ACCOUNT                                  "
echo "║  Database      : $DB_HOST                                           "
echo "║  Redis         : $REDIS_HOST                                        "
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  NEXT STEPS:                                                         "
echo "║  1. Update frontend/js/config.js with your App Service URL           "
echo "║  2. Push to GitHub — CI/CD pipelines will deploy automatically       "
echo "║  3. Run the DB init SQL (command shown above)                         "
echo "║  4. Note the CREATOR_REGISTRATION_SECRET from App Service settings   "
echo "╚══════════════════════════════════════════════════════════════════════╝"
