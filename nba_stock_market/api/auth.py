from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Event, Lock
from time import monotonic
from typing import Protocol, runtime_checkable

import httpx
import jwt
from jwt import PyJWKClient

from nba_stock_market.api.settings import ApiSettings


MAX_DISPLAY_NAME_LENGTH = 80
MAX_JWT_KID_LENGTH = 256
JWKS_REFRESH_COOLDOWN_SECONDS = 30.0
NEGATIVE_KID_CACHE_SIZE = 256
JWKS_CACHE_LIFESPAN_SECONDS = 600.0


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
        self._jwks_lock = Lock()
        self._last_forced_refresh_at = float("-inf")
        self._keys_loaded_at = float("-inf")
        self._signing_keys: dict[str, object] = {}
        self._negative_kids: OrderedDict[str, float] = OrderedDict()
        self._refresh_event: Event | None = None
        self.jwks = PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json",
            cache_keys=False,
            lifespan=600,
            timeout=timeout_seconds,
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
                kid = jwt.get_unverified_header(token).get("kid")
                if (
                    not isinstance(kid, str)
                    or not kid
                    or len(kid) > MAX_JWT_KID_LENGTH
                ):
                    raise AuthenticationError("invalid bearer token")
                signing_key = self._get_signing_key(kid)
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
                display_name = normalize_display_name(candidate)
        return Principal(id=subject, display_name=display_name or f"Trader {subject[:6]}")

    def _get_signing_key(self, kid: str):
        with self._jwks_lock:
            now = monotonic()
            self._prune_negative_kids(now)
            cached_key = self._signing_keys.get(kid)
            cache_is_fresh = (
                now - self._keys_loaded_at < JWKS_CACHE_LIFESPAN_SECONDS
            )
            if cached_key is not None and (cache_is_fresh or self._refresh_event):
                return cached_key
            if kid in self._negative_kids:
                raise AuthenticationError("invalid bearer token")

            if self._refresh_event is not None:
                refresh_event = self._refresh_event
                should_refresh = False
            elif (
                now - self._last_forced_refresh_at
                >= JWKS_REFRESH_COOLDOWN_SECONDS
            ):
                refresh_event = Event()
                self._refresh_event = refresh_event
                self._last_forced_refresh_at = now
                should_refresh = True
                force_refresh = bool(self._signing_keys)
            else:
                self._cache_negative_kid(kid, now)
                raise AuthenticationError("invalid bearer token")

        if should_refresh:
            try:
                signing_keys = self.jwks.get_signing_keys(refresh=force_refresh)
            except Exception:
                with self._jwks_lock:
                    self._refresh_event = None
                    refresh_event.set()
                raise
            with self._jwks_lock:
                self._signing_keys = {
                    key.key_id: key.key for key in signing_keys if key.key_id
                }
                self._keys_loaded_at = monotonic()
                self._refresh_event = None
                refresh_event.set()
        else:
            refresh_event.wait(timeout=self.timeout_seconds + 1.0)

        with self._jwks_lock:
            signing_key = self._signing_keys.get(kid)
            if signing_key is not None:
                self._negative_kids.pop(kid, None)
                return signing_key
            now = monotonic()
            self._cache_negative_kid(kid, now)
        raise AuthenticationError("invalid bearer token")

    def _cache_negative_kid(self, kid: str, now: float) -> None:
        self._negative_kids[kid] = now + JWKS_REFRESH_COOLDOWN_SECONDS
        self._negative_kids.move_to_end(kid)
        while len(self._negative_kids) > NEGATIVE_KID_CACHE_SIZE:
            self._negative_kids.popitem(last=False)

    def _prune_negative_kids(self, now: float) -> None:
        expired = [
            kid for kid, expires_at in self._negative_kids.items() if expires_at <= now
        ]
        for kid in expired:
            del self._negative_kids[kid]

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


def normalize_display_name(value: str) -> str:
    printable = "".join(character if character.isprintable() else " " for character in value)
    return " ".join(printable.split())[:MAX_DISPLAY_NAME_LENGTH]
