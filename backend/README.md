# JobPortal API

Express and MongoDB backend for `eX2.html`.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI` to a local MongoDB database or MongoDB Atlas connection string.
3. Set a long random `JWT_SECRET`.
4. Install and start:

```powershell
npm install
npm run dev
```

The API serves the frontend at `http://localhost:5000/` and exposes JSON routes under `/api`.

## Routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/jobs?search=react&type=Full-time&level=Mid`
- `GET /api/jobs/:id`
- `POST /api/jobs` (employer JWT required)
- `POST /api/applications/:jobId` (JWT required)
- `GET /api/applications/me` (JWT required)
- `GET /api/health`

Send authenticated requests with `Authorization: Bearer <token>`.
