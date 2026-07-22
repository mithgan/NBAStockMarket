from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
import json
from threading import Event, Thread
from time import monotonic
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr

from nba_stock_market.api.auth import (
    AuthenticationError,
    Principal,
    RejectAllTokenVerifier,
    SupabaseTokenVerifier,
    verifier_from_settings,
)
from nba_stock_market.api.settings import ApiSettings


def make_verifier(*, publishable_key: str | None = "publishable-test-key"):
    return SupabaseTokenVerifier(
        supabase_url="https://example.supabase.co",
        publishable_key=publishable_key,
    )


def test_unconfigured_auth_fails_closed() -> None:
    verifier = verifier_from_settings(ApiSettings(environment="test"))

    assert isinstance(verifier, RejectAllTokenVerifier)
    with pytest.raises(AuthenticationError):
        verifier.verify("anything")


def test_asymmetric_token_requires_expected_issuer_and_audience(monkeypatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = make_verifier()
    monkeypatch.setattr(
        verifier,
        "_get_signing_key",
        lambda kid: private_key.public_key(),
    )
    now = datetime.now(UTC)
    claims = {
        "sub": "user-123",
        "email": "trader@example.com",
        "user_metadata": {"full_name": "Test Trader"},
        "aud": "authenticated",
        "iss": "https://example.supabase.co/auth/v1",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    valid = jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test"})
    wrong_audience = jwt.encode(
        {**claims, "aud": "service_role"},
        private_key,
        algorithm="RS256",
        headers={"kid": "test"},
    )
    wrong_issuer = jwt.encode(
        {**claims, "iss": "https://attacker.example/auth/v1"},
        private_key,
        algorithm="RS256",
        headers={"kid": "test"},
    )

    assert verifier.verify(valid) == Principal(id="user-123", display_name="Test Trader")
    with pytest.raises(AuthenticationError):
        verifier.verify(wrong_audience)
    with pytest.raises(AuthenticationError):
        verifier.verify(wrong_issuer)


def test_jwks_signing_keys_do_not_bypass_set_cache_expiry() -> None:
    verifier = make_verifier()

    assert not hasattr(verifier.jwks.get_signing_key, "cache_info")


def test_unknown_jwks_kid_is_cached_and_refresh_is_bounded(monkeypatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = make_verifier()
    refreshes: list[bool] = []

    def no_matching_keys(*, refresh: bool = False):
        refreshes.append(refresh)
        return [SimpleNamespace(key_id="known", key=private_key.public_key())]

    monkeypatch.setattr(verifier.jwks, "get_signing_keys", no_matching_keys)
    token = jwt.encode(
        {"sub": "attacker"},
        private_key,
        algorithm="RS256",
        headers={"kid": "unknown"},
    )
    second_token = jwt.encode(
        {"sub": "attacker"},
        private_key,
        algorithm="RS256",
        headers={"kid": "another-unknown"},
    )

    with pytest.raises(AuthenticationError):
        verifier.verify(token)
    with pytest.raises(AuthenticationError):
        verifier.verify(token)
    with pytest.raises(AuthenticationError):
        verifier.verify(second_token)

    assert verifier.jwks.timeout == 5.0
    assert refreshes == [False]


def test_unknown_jwks_refresh_does_not_block_cached_key_verification(
    monkeypatch,
) -> None:
    verifier = make_verifier()
    known_key = object()
    verifier._signing_keys = {"known": known_key}
    verifier._keys_loaded_at = monotonic()
    started = Event()
    release = Event()
    refreshes: list[bool] = []
    unknown_rejected: list[bool] = []

    def slow_refresh(*, refresh: bool = False):
        refreshes.append(refresh)
        started.set()
        assert release.wait(timeout=2)
        return [SimpleNamespace(key_id="known", key=known_key)]

    def verify_unknown() -> None:
        try:
            verifier._get_signing_key("unknown")
        except AuthenticationError:
            unknown_rejected.append(True)

    monkeypatch.setattr(verifier.jwks, "get_signing_keys", slow_refresh)
    thread = Thread(target=verify_unknown)
    thread.start()
    assert started.wait(timeout=1)

    assert verifier._get_signing_key("known") is known_key

    release.set()
    thread.join(timeout=2)
    assert not thread.is_alive()
    assert unknown_rejected == [True]
    assert refreshes == [True]


def test_failed_initial_jwks_load_uses_global_refresh_backoff(monkeypatch) -> None:
    verifier = make_verifier()
    refreshes: list[bool] = []

    def failed_refresh(*, refresh: bool = False):
        refreshes.append(refresh)
        raise jwt.PyJWKClientError("JWKS unavailable")

    monkeypatch.setattr(verifier.jwks, "get_signing_keys", failed_refresh)

    with pytest.raises(jwt.PyJWKClientError):
        verifier._get_signing_key("first-unknown")
    with pytest.raises(AuthenticationError):
        verifier._get_signing_key("second-unknown")

    assert refreshes == [False]


def test_oversized_jwks_kid_is_rejected_without_fetch(monkeypatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = make_verifier()
    fetches: list[bool] = []

    def unexpected_fetch(*, refresh: bool = False):
        fetches.append(refresh)
        return []

    monkeypatch.setattr(verifier.jwks, "get_signing_keys", unexpected_fetch)
    token = jwt.encode(
        {"sub": "attacker"},
        private_key,
        algorithm="RS256",
        headers={"kid": "x" * 257},
    )

    with pytest.raises(AuthenticationError):
        verifier.verify(token)

    assert fetches == []


def test_legacy_token_is_verified_by_supabase_auth(monkeypatch) -> None:
    verifier = make_verifier()
    token = jwt.encode(
        {"sub": "untrusted"},
        "local-test-secret-that-is-at-least-32-bytes",
        algorithm="HS256",
    )
    seen: dict[str, object] = {}

    def fake_get(url: str, *, headers: dict[str, str], timeout: float):
        seen.update(url=url, headers=headers, timeout=timeout)
        return httpx.Response(
            200,
            json={
                "id": "verified-user",
                "email": "verified@example.com",
                "user_metadata": {},
            },
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    assert verifier.verify(token) == Principal(
        id="verified-user",
        display_name="Trader verifi",
    )
    assert seen["url"] == "https://example.supabase.co/auth/v1/user"
    assert seen["headers"] == {
        "apikey": "publishable-test-key",
        "Authorization": f"Bearer {token}",
    }


def test_legacy_token_requires_publishable_key() -> None:
    verifier = make_verifier(publishable_key=None)
    token = jwt.encode(
        {"sub": "untrusted"},
        "local-test-secret-that-is-at-least-32-bytes",
        algorithm="HS256",
    )

    with pytest.raises(AuthenticationError):
        verifier.verify(token)


def test_user_metadata_display_name_is_normalized_and_bounded(monkeypatch) -> None:
    verifier = make_verifier()
    token = jwt.encode(
        {"sub": "untrusted"},
        "local-test-secret-that-is-at-least-32-bytes",
        algorithm="HS256",
    )
    long_name = f"  {'A' * 50}   {'B' * 50}  "

    def fake_get(url: str, *, headers: dict[str, str], timeout: float):
        del url, headers, timeout
        return httpx.Response(
            200,
            json={
                "id": "verified-user",
                "user_metadata": {"full_name": long_name},
            },
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    principal = verifier.verify(token)
    assert principal.display_name == f"{'A' * 50} {'B' * 29}"
    assert len(principal.display_name) == 80


def test_user_metadata_display_name_removes_database_control_characters(
    monkeypatch,
) -> None:
    verifier = make_verifier()
    token = jwt.encode(
        {"sub": "untrusted"},
        "local-test-secret-that-is-at-least-32-bytes",
        algorithm="HS256",
    )

    def fake_get(url: str, *, headers: dict[str, str], timeout: float):
        del url, headers, timeout
        return httpx.Response(
            200,
            json={
                "id": "verified-user",
                "user_metadata": {"full_name": "Alice\u0000Injected"},
            },
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    assert verifier.verify(token).display_name == "Alice Injected"


def test_unsupported_jwt_algorithm_is_rejected() -> None:
    verifier = make_verifier()
    token = jwt.encode({"sub": "user-123"}, key="", algorithm="none")

    with pytest.raises(AuthenticationError):
        verifier.verify(token)


def test_non_string_jwt_algorithm_is_rejected() -> None:
    verifier = make_verifier()

    def encode_segment(value: object) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    token = f"{encode_segment({'alg': []})}.{encode_segment({'sub': 'user-123'})}."

    with pytest.raises(AuthenticationError):
        verifier.verify(token)


def test_settings_keep_publishable_key_secret() -> None:
    settings = ApiSettings(
        environment="test",
        supabase_url="https://example.supabase.co/",
        supabase_publishable_key=SecretStr("publishable-test-key"),
    )

    assert settings.supabase_url == "https://example.supabase.co"
    assert "publishable-test-key" not in repr(settings)


def test_production_settings_require_postgres_auth_and_migrations() -> None:
    empty_admin_key = ApiSettings(
        environment="test",
        settlement_admin_key=SecretStr(""),
    )
    empty_admin_key.validate_runtime()
    assert empty_admin_key.settlement_admin_key is None

    weak_admin_key = ApiSettings(
        environment="test",
        settlement_admin_key=SecretStr("too-short"),
    )
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        weak_admin_key.validate_runtime()

    settings = ApiSettings(environment="production")
    with pytest.raises(RuntimeError):
        settings.validate_runtime()

    settings = ApiSettings(
        environment="production",
        database_url="postgresql+psycopg://market:password@db.example/market",
        supabase_url="https://example.supabase.co",
        auto_create_schema=True,
    )
    with pytest.raises(RuntimeError) as exc_info:
        settings.validate_runtime()
    assert "password" not in str(exc_info.value)
    assert "password" not in repr(settings)

    for invalid_issuer in (
        "https://?project=missing-host",
        "https://example.supabase.co?project=query-not-allowed",
        "https://user:password@example.supabase.co",
        "https://example.supabase.co:bad",
    ):
        settings = ApiSettings(
            environment="production",
            database_url="postgresql+psycopg://market:password@db.example/market",
            supabase_url=invalid_issuer,
        )
        with pytest.raises(RuntimeError):
            settings.validate_runtime()

    settings = ApiSettings(
        environment="production",
        database_url="postgresql+psycopg://market:password@db.example/market",
        supabase_url="https://example.supabase.co",
    )
    with pytest.raises(RuntimeError, match="settlement admin key"):
        settings.validate_runtime()

    settings = ApiSettings(
        environment="production",
        database_url="postgresql+psycopg://market:password@db.example/market",
        supabase_url="https://example.supabase.co",
        settlement_admin_key=SecretStr("雪" * 32),
    )
    with pytest.raises(RuntimeError, match="ASCII settlement admin key"):
        settings.validate_runtime()

    settings = ApiSettings(
        environment="production",
        database_url="postgresql+psycopg://market:password@db.example/market",
        supabase_url="HTTPS://EXAMPLE.SUPABASE.CO:443/",
        settlement_admin_key=SecretStr("test-settlement-admin-key-at-least-32"),
    )
    settings.validate_runtime()

    assert settings.environment == "production"
    assert settings.supabase_url == "https://example.supabase.co"
    assert "password" not in repr(settings)
