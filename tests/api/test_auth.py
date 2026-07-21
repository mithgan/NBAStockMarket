from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
import json
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
        verifier.jwks,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=private_key.public_key()),
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
