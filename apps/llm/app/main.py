from fastapi import FastAPI
from app.routes import health, llm

app = FastAPI(title="languageapp-llm", version="0.1.0")

app.include_router(health.router)
app.include_router(llm.router, prefix="/llm")
