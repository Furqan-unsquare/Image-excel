# PaperSheet – question images → print‑ready Excel

A MERN app (MongoDB, Express, React, Node) for schools. Users:

1. **Pick a format**, or upload a sample question paper made in Excel. The app learns its layout and saves it in MongoDB.
2. **Upload photos or screenshots of questions**. Printed and handwritten pages both work, and you can upload several pages at once.
3. **Get the Excel file** laid out exactly like the format: same header, fonts, columns, question style, marks column and spacing. They can preview it (zoom, gridlines, A4 pages), print it, edit any question, and download it.

There is no login. Everything is saved, so past papers can be opened and downloaded again from **History**.

The project is two separate apps, each with its own `package.json`, `node_modules` and `.env`:

```
Imag to excel/
├── server/   Express + MongoDB + Groq API     → http://localhost:5000
└── client/   React (Vite) web app             → http://localhost:5173
```

---

## Quick start

Requirements: **Node.js 20+** and **MongoDB** (local, or a MongoDB Atlas connection string).

**Terminal 1 – API**

```bash
cd server
npm install
copy .env.example .env     # Windows   (macOS/Linux: cp .env.example .env)
# edit .env: MONGODB_URI and GROQ_API_KEY
npm run check-db           # optional: tests the database connection
npm run dev
```

**Terminal 2 – web app**

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173. The client forwards `/api` calls to the server. If the API runs somewhere other than `http://localhost:5000`, set `VITE_PROXY_TARGET` in `client/.env` (see `client/.env.example`).

On first start, the sample format in `server/seed/` (`Unit 1 History Paper.xlsx`) is added automatically, so you can try it right away.

### Production

There are two ways to deploy:

- **Two deployments (recommended).**
  1. **API:** deploy `server/` (Render, Railway, a VPS…) with the start command `npm start`. Put the values from `server/.env` into the host's environment variables, and set `CORS_ORIGIN` to the app's URL, e.g. `https://papersheet.netlify.app`.
  2. **App:** deploy `client/` as a static site with build command `npm run build` and publish folder `dist`. Set **`VITE_API_URL`** to the API address, e.g. `https://papersheet-api.onrender.com` (no `/api` at the end). Put it in the host's environment variables if the host builds from GitHub, or in `client/.env.production` if you build on your PC. It is baked in at build time, so rebuild after changing it.
  3. Page refreshes on deep links like `/papers/123` already work on Netlify (`client/public/_redirects`) and Vercel (`client/vercel.json`). On other static hosts, add a rewrite of all paths to `/index.html`.

  If the app can't reach the API, it shows the exact problem at the top of the page: either `VITE_API_URL` is missing, or the API is down or blocked by CORS.
- **One deployment.** Build the client, then set `CLIENT_DIST_DIR=../client/dist` in `server/.env`. `npm start` in `server/` then serves both the API and the app on `PORT`.

---

## Environment (`server/.env`)

| Variable | Default | What it does |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/image_to_excel` | Database (local or Atlas `mongodb+srv://…`) |
| `DNS_SERVERS` | `8.8.8.8,1.1.1.1` | Used automatically if this PC can't resolve the Atlas address (see Troubleshooting) |
| `GROQ_API_KEY` | – | **Recommended.** From https://console.groq.com/keys. Needed to read handwriting and to understand the question structure reliably. |
| `GROQ_VISION_MODEL` | `qwen/qwen3.8-27b` | Groq model that reads the images |
| `GROQ_TEXT_MODEL` | `openai/gpt-oss-120b` | Groq model that turns the text into questions, sub‑questions and marks |
| `OCR_FALLBACK` | `tesseract` | Free local OCR used when Groq is missing or fails. It handles clear printed text only. `none` turns it off. |
| `PORT` | `5000` | API port |
| `MAX_IMAGES` / `MAX_IMAGE_MB` / `MAX_TEMPLATE_MB` | `10` / `15` / `5` | Upload limits |
| `CORS_ORIGIN` | `*` | Allowed origins if the app and API are on different domains |
| `SEED_SAMPLE_TEMPLATES` | `true` | Add the `server/seed/*.xlsx` formats when the database has none |
| `CLIENT_DIST_DIR` | – | Optional: serve the built client from the API server |

The client's own settings (`client/.env`, all optional) are `VITE_PROXY_TARGET` (development), `VITE_API_URL` (production) and `PORT`.

The app runs without `GROQ_API_KEY`. It then falls back to Tesseract and built‑in rules, which work for clean printed papers but not for handwriting. The header shows **AI reading on** or **Basic OCR** so you always know which mode you're in. If the key was added later, use **Run again** on an old paper to read its stored images again.

**Groq free tier:** the vision model allows about 7,000 image tokens per minute, which is roughly 3–4 photos. When the limit is reached, the app waits the time Groq asks for and shows *"Groq free-tier limit reached – waiting 14s"* in the progress, then continues. A paper with several photos can therefore take a minute or two. Upgrading the Groq plan removes the wait.

If Groq renames or retires a model, change the two model variables. No code changes are needed: https://console.groq.com/docs/models

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `querySrv ECONNREFUSED _mongodb._tcp.cluster0…` | Node on this PC is asking a DNS server that doesn't answer (often `127.0.0.1`, caused by a VPN, ad-blocker or adapter setting). The server now detects this, switches to `DNS_SERVERS` automatically and logs `using 8.8.8.8, 1.1.1.1 instead`. If your network blocks public DNS, use Atlas's *standard* connection string (`mongodb://…`, not `mongodb+srv://`). |
| `bad auth` / `authentication failed` | The user or password in `MONGODB_URI` is wrong. URL-encode special characters in the password (`@` → `%40`, `#` → `%23`). |
| `Server selection timed out` | In Atlas → **Network Access**, add your IP address (or `0.0.0.0/0` for testing), and check that the cluster isn't paused. |
| Server keeps saying `Failed running 'src/index.js'` | Run `npm run check-db` in `server/`; it prints the exact database problem and a hint. `npm run dev` restarts by itself after you fix `.env` and save any file (or just restart it). |
| "Cannot reach the API server" banner in the app | The server isn't running, or it's on another port. Start `server/` first, or set `VITE_PROXY_TARGET` in `client/.env`. |

---

## How it works

```
 Excel format (.xlsx) ──► templateAnalyzer ──► "profile" saved in MongoDB
                                               (header rows, columns, fonts, Q-number
                                                format "Q{n}.", marks "[ {m} M]",
                                                sub-question style, blank rows, print setup)

 Photos ──► sharp (rotate, resize, split tall images at blank rows)
        ──► OCR: Groq vision model  (fallback: Tesseract)
            Hindi/Marathi: Tesseract reads printed pages first and its draft
            guides the vision model; words it can't confirm are flagged
        ──► Structure: Groq text model → JSON  (fallback: rule-based parser)
            { sections: [{ title, questions: [{ number, text, marks, note,
                                               items: [{ label, text, options, answer }],
                                               table }] }] }
        ──► excelGenerator: opens the saved format, keeps its header,
            writes the questions with the learned styles → .xlsx (A4, fit to width)
        ──► preview (HTML A4 pages) · print · download · edit & regenerate
```

### Format detection

**Built‑in rules** handle the common layout:

- **Header:** the rows above the first section or question are kept as they are. "Subject:‑", "Std/Class", "Marks", "Time" and "Date" values are filled from the photo when found.
- **Questions:** headings like `Q1.`, `Que 2)` or `Question 3`. Their column, font (bold/italic) and indent are learned, as is the ending after the text (e.g. ` :-`).
- **Marks:** cells like `[ 2 M]` or `(5 Marks)`. The app learns which column they sit in and their format.
- **Sub‑questions:** `1.`, `a)`, `(i)`, … plus wrapped lines that continue in another column.
- **Section titles:** short bold or underlined titles such as `HISTORY` or `CIVICS`.
- **Tables:** bordered tables, with their header and cell borders.
- **Blank rows:** the gaps between all of the above.
- **Marks when the photo has none:** whether the format gives every question the same marks (e.g. `[ 2 M]` everywhere) or one per sub-question. If some questions on the photo do have marks, the most common of those is used for the rest.
- **Answer space:** `______` is added where students write: fill in the blanks, true/false, one word answers, full forms (`CUI = ______`), and short answers that were written in notes, when answers are not printed.

For unusual layouts, tick **"Use AI to detect the layout"** when uploading, or use **Detect with AI** on the format page.

Everything that was detected can be changed on the **Formats → (format)** page. The **Sample output** view shows the effect immediately, and changes are saved once and used for every paper.

### Hindi and Marathi papers

Every format has a language: **English**, **हिंदी Hindi** or **मराठी Marathi**. It is detected from the file when you upload it, and you can change it in the upload dialog or on the format page. Photos are read in the language of the format they're converted with, so **a Hindi paper needs a Hindi format, and a Marathi paper needs a Marathi format**. On **New paper**, choose the language first. If no format exists for that language yet, the page says so and offers the upload button.

- **Headings, labels and marks:** `प्रश्न 1.`, `प्र. १.`, `प्र. १ ला)`; `(अ) (ब) (स)`, `अ) आ) इ)`, `(क) (ख) (ग)`, `१)`; `(2 अंक)`, `(५ गुण)`. The format's own style is reused, including १२३ digits.
- **Header values:** `विषय`, `कक्षा` / `इयत्ता`, `पूर्णांक` / `गुण`, `समय` / `वेळ` and `दिनांक` are filled in from the photo.
- **Answer blanks:** added for रिक्त स्थान / रिकाम्या जागा / गाळलेल्या जागा, सही या गलत / चूक की बरोबर, and एक शब्द / एका शब्दात questions.
- **Reading accuracy:**
  - On printed pages, the free local OCR (Tesseract) reads the page first and its draft guides the AI. In tests on printed pages, about 99% of words came out exactly right.
  - Without the draft, the AI sometimes swaps a Marathi word for a similar one (e.g. करावा → करतो).
  - Words the two readers disagree on are highlighted in **Edit questions**.
  - Handwriting is read by the AI alone and is less accurate, so check it against the photo.
- **Fonts:** use a Unicode font (Nirmala UI, Mangal, Kokila) in the format. Formats typed in old fonts like Kruti Dev or Shree-Lipi still work: new text is written in Nirmala UI, but their header lines can't be filled in automatically.

### Maths papers

- **Notation:** fractions (`3/4`), powers (`5²`, `10³`), roots (`√49`), `×`, `÷`, `π`, `°`, `△` and units are copied exactly as plain text. Nothing is ever solved.
- **Vertical sums:** become one line, e.g. `345 + 127 = ______`.
- **Answer blanks:** sums ending in `=` get a blank.
- **Match the following** becomes a two-column table.
- **Diagrams and figures are left out for now.** A warning names the questions that had one, so you can add the figure in Excel.

---

## Tips for good results

- Use well‑lit photos taken straight on, or screenshots. One page per image is best, but long stitched screenshots work too: they are split automatically.
- Add pages in order. Questions that continue onto the next page are joined.
- Diagrams and pictures aren't copied into Excel. A warning after converting names the questions that had one.
- HEIC photos (iPhone) aren't supported, so share them as JPG. Old `.xls` formats must be saved as `.xlsx`.
- Notebook pages with answers: tick **"print answers"** to get an answer key, or leave it off for a clean question paper with answer blanks.
- On a phone, use **Take photo** to open the camera directly. The app works on phones and tablets, with navigation at the bottom of the screen.

---

## Project structure

```
server/
  src/
    index.js                  Express app, error handling (optionally serves the built client)
    config.js                 env settings (reads server/.env)
    db.js                     MongoDB connection (with Atlas DNS fallback)
    scripts/checkDb.js        npm run check-db
    models/                   Template, Paper, PaperImage (Mongoose)
    routes/templates.js       upload / list / preview / settings / re-detect / delete formats
    routes/papers.js          create (upload images) / status / preview / edit / download / run again
    services/templateAnalyzer.js   learns the layout of an uploaded Excel
    services/excelGenerator.js     writes questions into the format (exceljs)
    services/ocr.js                image prep + Groq vision OCR + Tesseract fallback / Hindi-Marathi letter check
    utils/lang.js                  languages, Devanagari digits, Hindi vs Marathi detection
    services/paperParser.js        Groq JSON structuring + rule-based fallback + header filling
    services/paperProcessor.js     background job with progress (incl. Groq rate-limit waits)
    services/sheetRender.js        worksheet → JSON for the browser preview
  seed/                       sample format(s) added on first start
client/
  src/pages/                  New paper, Paper (preview/edit/source), Formats, Format settings, History
  src/components/             SheetPreview (A4 renderer), PaperEditor, ImageDropzone, …
```

### API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | status, whether Groq is configured |
| GET / POST | `/api/templates` | list / upload (`multipart: file, name, useAi, language` = `en`/`hi`/`mr`, omit to detect) |
| GET / PATCH / DELETE | `/api/templates/:id` | get / rename + change settings / delete |
| GET | `/api/templates/:id/preview` · `/sample-preview` · `/file` | uploaded sheet · demo output · original file |
| POST | `/api/templates/:id/reanalyze` | detect layout again (`{ useAi }`) |
| GET / POST | `/api/papers` | list / create (`multipart: templateId, images[], includeAnswers`; read in the format's language) |
| GET / DELETE | `/api/papers/:id` | status, progress, content, OCR text / delete |
| GET | `/api/papers/:id/preview` · `/download` · `/images/:n` | preview model · .xlsx · source image |
| PUT | `/api/papers/:id/content` | save edited questions and rebuild the Excel |
| POST | `/api/papers/:id/retry` | read the stored images again (optionally with another `templateId`) |
