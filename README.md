# PhotoShare — Cloud-Native Photo Sharing Platform

A scalable, Azure-native media distribution web application built for CW2. Conceptually similar to Instagram, with separate Creator and Consumer roles.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Azure Cloud                              │
│                                                                 │
│  ┌─────────────────┐        ┌────────────────────────────────┐ │
│  │  Azure Static   │ REST   │   Azure App Service (Node.js)  │ │
│  │  Web Apps       │◄──────►│   Express REST API             │ │
│  │  (Frontend)     │        │   Port 8080                    │ │
│  └─────────────────┘        └────────┬───────────────────────┘ │
│                                      │                          │
│             ┌────────────────────────┼────────────────────┐    │
│             ▼                        ▼                     ▼    │
│  ┌──────────────────┐  ┌────────────────────┐  ┌──────────────┐│
│  │ Azure Blob       │  │ Azure PostgreSQL    │  │ Azure Cache  ││
│  │ Storage (photos) │  │ Flexible Server     │  │ for Redis    ││
│  │ + Azure CDN      │  │ (user/photo/comment │  │ (API cache)  ││
│  └──────────────────┘  │  data)              │  └──────────────┘│
│                        └────────────────────┘                  │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  Azure Cognitive Services — Computer Vision                ││
│  │  (auto-tagging, content safety, image description)         ││
│  └────────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────────┐│
│  │  GitHub Actions CI/CD (backend + frontend auto-deploy)     ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Features

### Creator accounts
- Upload photos (JPEG, PNG, WebP, GIF — up to 20 MB)
- Set metadata: Title, Caption, Location, People Present
- Edit / delete own photos
- View stats: views, ratings, comments
- Gated registration (requires secret key — no public enrolment)

### Consumer accounts
- Browse/search photos (by title, caption, location, tag)
- Filter by AI-generated tags
- Sort by newest / top-rated / most-viewed
- Rate photos 1–5 stars
- Leave comments (with sentiment analysis)

### Advanced Features
| Feature | Implementation |
|---------|---------------|
| AI Image Tagging | Azure Cognitive Services — Computer Vision |
| Content Safety | Adult content detection before storage |
| Sentiment Analysis | Comment sentiment (positive/neutral/negative) |
| Caching | Azure Cache for Redis (60-second TTL on photo lists) |
| CDN | Azure CDN fronting Blob Storage |
| CI/CD Pipeline | GitHub Actions auto-deploy on push to `main` |
| Auth & Roles | JWT tokens + role-based access control |

## Project Structure

```
photo-share/
├── backend/                  Node.js/Express REST API
│   ├── server.js             Entry point
│   ├── routes/               auth, photos, comments, users
│   ├── middleware/auth.js    JWT verification + RBAC
│   ├── config/               db, azure blob, redis cache
│   ├── sql/init.sql          PostgreSQL schema
│   └── Dockerfile
├── frontend/                 Static HTML/CSS/JS
│   ├── index.html            Login / Register
│   ├── creator.html          Creator dashboard
│   ├── consumer.html         Browse & discover
│   ├── css/styles.css        Design system
│   ├── js/config.js          Shared helpers + API client
│   └── staticwebapp.config.json
├── .github/workflows/        CI/CD pipelines
└── infra/setup-azure.sh      One-shot provisioning script
```

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- PostgreSQL (local or Docker)
- Azure account (for Blob Storage, Cognitive Services, Redis)

### 1. Clone & install
```bash
cd backend && npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your Azure credentials
```

### 3. Initialise database
```bash
psql -d photoshare -f sql/init.sql
```

### 4. Start the API
```bash
npm run dev
# API running at http://localhost:3000
```

### 5. Open the frontend
Open `frontend/index.html` in your browser, or serve it:
```bash
cd frontend && npx serve .
```

## Azure Deployment

### Option A — Automated (recommended)
```bash
# Login to Azure
az login

# Run the provisioning script (takes ~10 minutes)
chmod +x infra/setup-azure.sh
./infra/setup-azure.sh

# Update your API URL
# Edit frontend/js/config.js and replace YOUR-APP-SERVICE with your actual name

# Push to GitHub — CI/CD auto-deploys
git add . && git commit -m "feat: initial deployment" && git push
```

### Option B — Manual (Azure Portal)
See the step-by-step guide in the deployment section below.

## Manual Azure Portal Deployment

### Step 1: Create Resource Group
- Portal → Resource Groups → Create
- Name: `photoshare-rg`, Region: `UK South`

### Step 2: Azure Blob Storage
- Create Storage Account → `Standard LRS`
- Create container `photos` with **Blob (anonymous read)** access

### Step 3: Azure PostgreSQL Flexible Server
- Create → `Burstable B1ms` tier
- Enable `Allow public access from any Azure service`
- Run `backend/sql/init.sql` via pgAdmin or Cloud Shell

### Step 4: Azure Cache for Redis
- Create → `Basic C0`
- Note the hostname and primary access key

### Step 5: Cognitive Services
- Create → **Computer Vision** → Free (F0) tier
- Note endpoint URL and Key 1

### Step 6: App Service (Backend)
- Create → Linux, Node 20 LTS, Free F1 plan
- Settings → Configuration → Add all environment variables from `.env.example`
- Deployment Center → GitHub → select repo + `main` branch

### Step 7: Static Web Apps (Frontend)
- Create → Free tier
- Connect to GitHub → select repo
- App location: `frontend`, API location: leave blank
- Add secret `AZURE_STATIC_WEB_APPS_API_TOKEN` to GitHub repo secrets

### Step 8: Update frontend config
Edit `frontend/js/config.js`:
```js
API_BASE_URL: 'https://YOUR-ACTUAL-APP-SERVICE.azurewebsites.net'
```

## Verification Checklist

### Backend health
```bash
curl https://YOUR-APP.azurewebsites.net/health
# Should return: {"status":"healthy", ...}
```

### Register a consumer
```bash
curl -X POST https://YOUR-APP.azurewebsites.net/api/auth/register/consumer \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"Test1234"}'
```

### Register a creator (requires secret from App Service settings)
```bash
curl -X POST https://YOUR-APP.azurewebsites.net/api/auth/register/creator \
  -H "Content-Type: application/json" \
  -d '{"username":"creator1","email":"creator@example.com","password":"Test1234","creatorSecret":"YOUR_CREATOR_SECRET"}'
```

### Login
```bash
curl -X POST https://YOUR-APP.azurewebsites.net/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234"}'
```

### List photos
```bash
curl https://YOUR-APP.azurewebsites.net/api/photos
```

## Default Accounts (seeded by init.sql)
| Username | Email | Password | Role |
|---------|-------|----------|------|
| admin | admin@photoshare.local | Admin@1234 | admin |
| demo_creator | creator@photoshare.local | Admin@1234 | creator |

**⚠️ Change these passwords immediately after first deployment.**

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register/consumer | — | Register consumer |
| POST | /api/auth/register/creator | — + secret | Register creator |
| POST | /api/auth/login | — | Login |
| GET | /api/auth/me | JWT | Current user |
| GET | /api/photos | — | List/search photos |
| POST | /api/photos | creator | Upload photo |
| GET | /api/photos/:id | — | Get single photo |
| PATCH | /api/photos/:id | creator (own) | Update metadata |
| DELETE | /api/photos/:id | creator (own) | Delete photo |
| POST | /api/photos/:id/rate | JWT | Rate photo |
| GET | /api/photos/:id/comments | — | List comments |
| POST | /api/photos/:id/comments | JWT | Post comment |
| DELETE | /api/photos/:id/comments/:cid | JWT (own) | Delete comment |
| GET | /api/users/creators | — | List creators |
| GET | /api/users/:username | — | Public profile |

## Scalability Notes
- **Horizontal scaling**: App Service auto-scale rules on CPU > 70%
- **Read caching**: Redis reduces PostgreSQL load for photo list queries
- **Static assets**: CDN distributes media globally with edge caching
- **Connection pooling**: pg Pool (max 20 connections) prevents DB exhaustion
- **Rate limiting**: 200 req/15 min (API), 20 req/15 min (auth) per IP

## References
- Azure App Service documentation: https://docs.microsoft.com/azure/app-service/
- Azure Blob Storage: https://docs.microsoft.com/azure/storage/blobs/
- Azure Cognitive Services: https://docs.microsoft.com/azure/cognitive-services/
- Azure Cache for Redis: https://docs.microsoft.com/azure/azure-cache-for-redis/
- IEEE Citation Style: https://www.ieee.org/documents/ieeecitationref.pdf
