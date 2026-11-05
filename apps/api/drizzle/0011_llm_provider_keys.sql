-- Provider keys were stored as Python class names; use the short key (ollama, groq, deepseek).
UPDATE "llm_calls" SET "provider" = lower(regexp_replace("provider", 'Provider$', '')) WHERE "provider" LIKE '%Provider';
