import os

import redis
from fastapi import FastAPI
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CHROMA_HOST = os.environ.get("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.environ.get("CHROMA_PORT", "8000"))

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

app = FastAPI(title="Verity API")


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
