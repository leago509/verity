# Verity frontend

React 18 + TypeScript + Tailwind CSS + Vitest (as specified in the project report).

```bash
npm install
npm run dev     # http://localhost:5173
npm test
```

`.env.local` controls the data source:
- `VITE_USE_MOCK=true`  -> fake data, no backend needed (log in with any email/password)
- `VITE_USE_MOCK=false` -> real FastAPI backend at `VITE_API_URL`

See `docs/api-contract.md` for the endpoints the UI expects.
