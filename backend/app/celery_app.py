import os

from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery("verity", broker=REDIS_URL, include=["app.tasks"])
celery_app.conf.update(
    task_acks_late=True,  # a job is only removed from the queue once it finished
    worker_prefetch_multiplier=1,  # long AI jobs: take one at a time
    task_track_started=True,
)
