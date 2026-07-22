from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from nba_stock_market.api.auth import (
    AuthenticationError,
    Principal,
    TokenVerifier,
    verifier_from_settings,
)
from nba_stock_market.api.database import Database
from nba_stock_market.api.service import ApiProblem, MarketService
from nba_stock_market.api.settings import ApiSettings


class TradeRequest(BaseModel):
    player_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    side: Literal["buy", "sell"]


def create_app(
    *,
    settings: ApiSettings | None = None,
    database: Database | None = None,
    token_verifier: TokenVerifier | None = None,
) -> FastAPI:
    settings = settings or ApiSettings()
    settings.validate_runtime()
    database = database or Database(settings.database_url.get_secret_value())
    token_verifier = token_verifier or verifier_from_settings(settings)
    service = MarketService(database)
    security = HTTPBearer(auto_error=False)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        del application
        if settings.environment == "production":
            database.assert_ready()
        yield

    app = FastAPI(
        title="NBA Stock Market API",
        version="0.1.0",
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.database = database
    app.state.settings = settings
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
        )

    if settings.auto_create_schema:
        database.create_schema()
        if settings.seed_file is not None:
            database.seed_from_file(settings.seed_file)

    @app.exception_handler(ApiProblem)
    async def api_problem_handler(request: Request, exc: ApiProblem) -> JSONResponse:
        del request
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        del request
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Request validation failed.",
                    "details": public_validation_errors(exc),
                }
            },
        )

    def current_principal(
        credentials: HTTPAuthorizationCredentials | None = Depends(security),
    ) -> Principal:
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise ApiProblem(
                status_code=401,
                code="unauthorized",
                message="A valid bearer token is required.",
            )
        try:
            return token_verifier.verify(credentials.credentials)
        except (AuthenticationError, ValueError) as exc:
            raise ApiProblem(
                status_code=401,
                code="unauthorized",
                message="A valid bearer token is required.",
            ) from exc

    @app.get("/healthz")
    def health() -> dict[str, dict[str, str]]:
        return {"data": {"status": "ok", "service": "nba-stock-market-api"}}

    @app.get("/readyz")
    def readiness(response: Response) -> dict[str, dict[str, str]]:
        try:
            database.assert_ready()
        except RuntimeError:
            response.status_code = 503
            return {"data": {"status": "unavailable"}}
        return {"data": {"status": "ready"}}

    @app.get("/api/v1/market")
    def market(
        principal: Principal = Depends(current_principal),
    ) -> dict[str, list[dict[str, object]]]:
        return {"data": service.market(principal)}

    @app.get("/api/v1/portfolio")
    def portfolio(
        principal: Principal = Depends(current_principal),
    ) -> dict[str, dict[str, object]]:
        return {"data": service.portfolio(principal)}

    @app.post("/api/v1/trades", status_code=201)
    def trade(
        body: TradeRequest,
        response: Response,
        principal: Principal = Depends(current_principal),
        idempotency_key: str = Header(
            alias="Idempotency-Key",
            min_length=8,
            max_length=128,
        ),
    ) -> dict[str, dict[str, object]]:
        result = service.execute_trade(
            principal,
            player_id=body.player_id,
            side=body.side,
            idempotency_key=idempotency_key,
        )
        if result["replayed"]:
            response.status_code = 200
        return {"data": result}

    @app.get("/api/v1/leaderboard")
    def leaderboard(
        principal: Principal = Depends(current_principal),
        limit: int = Query(default=50, ge=1, le=100),
    ) -> dict[str, list[dict[str, object]]]:
        return {"data": service.leaderboard(principal, limit=limit)}

    return app


def public_validation_errors(exc: RequestValidationError) -> list[dict[str, object]]:
    return [
        {
            "type": str(error.get("type", "validation_error")),
            "loc": list(error.get("loc", ())),
            "msg": str(error.get("msg", "Invalid request.")),
        }
        for error in exc.errors()
    ]
