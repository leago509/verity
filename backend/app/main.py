import os

import redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .auth import router as auth_router
from .db import engine
from .integrations import router as integrations_router
from .meetings import router as meetings_router

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CHROMA_HOST = os.environ.get("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.environ.get("CHROMA_PORT", "8000"))

# Origins the browser frontend may call from. Vite uses 5173, Create React App uses 3000.
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if o.strip()
]

app = FastAPI(title="Verity API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(meetings_router)
app.include_router(integrations_router)


@app.get("/")
def hello():
    return {"message": "Hello from Verity"}


@app.get("/health")
def health():
    """Checks that the API can reach Postgres, Redis and ChromaDB."""
    status = {}

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        status["postgres"] = "ok"
    except Exception as exc:
        status["postgres"] = f"error: {exc}"

    try:
        redis.Redis.from_url(REDIS_URL).ping()
        status["redis"] = "ok"
    except Exception as exc:
        status["redis"] = f"error: {exc}"

    try:
        import chromadb

        chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT).heartbeat()
        status["chroma"] = "ok"
    except Exception as exc:
        status["chroma"] = f"error: {exc}"

    return status
