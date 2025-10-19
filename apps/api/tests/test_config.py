from app.core.config import Settings
from app.services.cache import CacheService


def test_cors_origin_parsing(monkeypatch):
    monkeypatch.setenv("BACKEND_CORS_ORIGINS", "chrome-extension://*, http://localhost:5173")

    settings = Settings()

    assert settings.cors_origins == ["http://localhost:5173"]
    assert settings.cors_origin_regex == r"^chrome\-extension://.*$"


def test_cache_key_is_deterministic():
    payload_a = {"question": "hello", "history": [{"role": "user", "content": "hello"}]}
    payload_b = {"history": [{"content": "hello", "role": "user"}], "question": "hello"}

    key_a = CacheService.build_key("two-sum", payload_a)
    key_b = CacheService.build_key("two-sum", payload_b)

    assert key_a == key_b
