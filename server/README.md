# PaperSheet – server (API)

Express + MongoDB + Groq. It stores Excel formats, reads question images (OCR), structures the questions and builds the Excel files.

```bash
npm install
copy .env.example .env      # Windows (macOS/Linux: cp .env.example .env)
# edit .env: MONGODB_URI, GROQ_API_KEY
npm run check-db            # tests the database connection and prints a hint if it fails
npm run dev                 # http://localhost:5000 (restarts on code changes)
npm start                   # production
```

- Health check: `GET /api/health`. It shows whether the database is connected and Groq is configured.
- All settings and API routes are documented in the main [README](../README.md).
- The web app lives in [`../client`](../client) and talks to this server over `/api`.
