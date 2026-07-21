from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx
import jwt
from jwt import PyJWKClient

from nba_stock_market.api.settings import ApiSettings


MAX_DISPLAY_NAME_LENGTH = 80


class AuthenticationError(ValueError):
    """Raised when a bearer token cannot be trusted."""


@dataclass(frozen=True)
class Principal:
    id: str
    display_name: str


@runtime_checkable
class TokenVerifier(Protocol):
    def verify(self, token: str) -> Principal:
        ...


class RejectAllTokenVerifier:
    def verify(self, token: str) -> Principal:
        del token
        raise AuthenticationError("authentication is not configured")


class SupabaseTokenVerifier:
    """Verify asymmetric JWTs locally and legacy HS256 tokens with Auth."""

    _ASYMMETRIC_ALGORITHMS = {"ES256", "RS256"}

    def __init__(
        self,
        *,
        supabase_url: str,
        publishable_key: str | None,
        audience: str = "authenticated",
        timeout_seconds: float = 5.0,
    ) -> None:
        self.supabase_url = supabase_url.rstrip("/")
        self.publishable_key = publishable_key
        self.audience = audience
        self.timeout_seconds = timeout_seconds
        self.issuer = f"{self.supabase_url}/auth/v1"
        self.jwks = PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json",
            cache_keys=False,
            lifespan=600,
        )

    def verify(self, token: str) -> Principal:
        if not token:
            raise AuthenticationError("missing bearer token")
        try:
            algorithm = jwt.get_unverified_header(token).get("alg")
        except jwt.PyJWTError as exc:
            raise AuthenticationError("invalid bearer token") from exc
        if not isinstance(algorithm, str):
            raise AuthenticationError("invalid bearer token")

        try:
            if algorithm in self._ASYMMETRIC_ALGORITHMS:
                signing_key = self.jwks.get_signing_key_from_jwt(token).key
                claims = jwt.decode(
                    token,
                    signing_key,
                    algorithms=[algorithm],
                    audience=self.audience,
                    issuer=self.issuer,
                )
            elif algorithm == "HS256":
                claims = self._verify_legacy_token(token)
            else:
                raise AuthenticationError("unsupported token algorithm")
        except (jwt.PyJWTError, httpx.HTTPError, KeyError, ValueError) as exc:
            if isinstance(exc, AuthenticationError):
                raise
            raise AuthenticationError("invalid bearer token") from exc

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise AuthenticationError("token has no subject")
        metadata = claims.get("user_metadata")
        display_name = ""
        if isinstance(metadata, dict):
            candidate = metadata.get("full_name") or metadata.get("name")
            if isinstance(candidate, str):
                display_name = " ".join(candidate.split())[:MAX_DISPLAY_NAME_LENGTH]
        return Principal(id=subject, display_name=display_name or f"Trader {subject[:6]}")

    def _verify_legacy_token(self, token: str) -> dict[str, object]:
        if not self.publishable_key:
            raise AuthenticationError(
                "legacy token verification requires a Supabase publishable key"
            )
        response = httpx.get(
            f"{self.issuer}/user",
            headers={
                "apikey": self.publishable_key,
                "Authorization": f"Bearer {token}",
            },
            timeout=self.timeout_seconds,
        )
        if response.status_code != 200:
            raise AuthenticationError("invalid bearer token")
        user = response.json()
        return {
            "sub": user.get("id"),
            "email": user.get("email"),
            "user_metadata": user.get("user_metadata", {}),
        }


def verifier_from_settings(settings: ApiSettings) -> TokenVerifier:
    if not settings.supabase_url:
        return RejectAllTokenVerifier()
    key = (
        settings.supabase_publishable_key.get_secret_value()
        if settings.supabase_publishable_key
        else None
    )
    return SupabaseTokenVerifier(
        supabase_url=settings.supabase_url,
        publishable_key=key,
        audience=settings.supabase_jwt_audience,
    )
