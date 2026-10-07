# PaperSheet – client (web app)

React + Vite. Users choose a format, upload question images, and then preview, print, edit and download the Excel file.

```bash
npm install
npm run dev        # http://localhost:5173 – forwards /api to http://localhost:5000
npm run build      # production build in dist/
```

Optional settings go in `.env` (copy `.env.example`):

| Variable | Use |
|---|---|
| `VITE_PROXY_TARGET` | API address during development (default `http://localhost:5000`) |
| `VITE_API_URL` | API address for a production build hosted on another domain |
| `PORT` | Dev server port (default `5173`) |

Start the API in [`../server`](../server) first.
