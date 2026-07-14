"""Season-start opening listing prices.

Production model (v2, validated in docs/fv-research-log.md):

    blend         = 0.40*z(EPM) + 0.35*z(prior WAR) + 0.15*z(minutes) + 0.10*z(25 - age)
    projected_WAR = 1.4821 + 2.5605 * blend
    fair_value    = $1.2M (min salary) + projected_WAR * $5M (price of a win)
    listing       = clamp(0.9 * fair_value + 0.1 * actual_salary, $2M, $70M)

Retrospectively validated against four historical season pairs on the exact
300-player listing cohort: Spearman rho 0.66-0.77 (mean 0.737) vs realized
next-season WAR, beating the same-cohort naive carry-forward baseline (mean
0.699) in every pair. See ``ProjectedWarModel``.

The earlier linear single-metric pricer (``OpeningPriceModel``) is retained:
it is the comparison pricer used by ``fv_validation`` and the fallback when
EPM data is unavailable.  The community-census adjustment described in
docs/opening-price-model.md happens after the CSV is produced and is bounded
so the crowd can nudge but never set prices.
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from pathlib import Path

from nba_stock_market.backtest import normalize_player_name


BASELINE_PRICE_AT_ZERO = 12_000_000.0
DOLLARS_PER_IMPACT_POINT = 7_000_000.0
IMPACT_BLEND_WEIGHT = 0.7
SHRINKAGE_MINUTES = 300.0
MIN_LISTING_PRICE = 2_000_000.0
MAX_LISTING_PRICE = 70_000_000.0
UNIVERSE_SIZE = 300

STAR_PRICE = 30_000_000.0
MID_PRICE = 10_000_000.0

WAR_INTERCEPT = 1.482138268727
WAR_SLOPE = 2.560459930502
BLEND_W_EPM = 0.40
BLEND_W_PRIOR_WAR = 0.35
BLEND_W_MINUTES = 0.15
BLEND_W_YOUTH = 0.10
YOUTH_PIVOT_AGE = 25.0
MIN_SALARY = 1_200_000.0
DOLLARS_PER_WIN = 5_000_000.0
FAIR_VALUE_BLEND_WEIGHT = 0.9

DEFAULT_IMPACT_FILE = Path("data/raw/opening/lebron.csv")
DEFAULT_EPM_FILE = Path("data/raw/opening/epm_2026.csv")
DEFAULT_SALARY_FILE = Path("data/raw/opening/salary.csv")
DEFAULT_OUTPUT_FILE = Path("output/opening-prices-2026-27.csv")


@dataclass(frozen=True)
class ImpactRow:
    player: str
    team: str
    position: str
    age: float
    minutes: float
    games: float
    rating: float
    war: float


@dataclass(frozen=True)
class OpeningListing:
    rank: int
    player: str
    team: str
    position: str
    age: float
    minutes: float
    games: float
    rating: float
    war: float
    actual_salary: float
    impact_implied_price: float
    opening_price: float
    tier: str


@dataclass(frozen=True)
class OpeningPriceModel:
    baseline_price_at_zero: float = BASELINE_PRICE_AT_ZERO
    dollars_per_impact_point: float = DOLLARS_PER_IMPACT_POINT
    impact_blend_weight: float = IMPACT_BLEND_WEIGHT
    shrinkage_minutes: float = SHRINKAGE_MINUTES
    min_listing_price: float = MIN_LISTING_PRICE
    max_listing_price: float = MAX_LISTING_PRICE

    def __post_init__(self) -> None:
        for name, value in self.__dict__.items():
            if isinstance(value, bool) or not math.isfinite(float(value)):
                raise ValueError(f"opening-price parameter {name} must be finite")
        if not 0 <= self.impact_blend_weight <= 1:
            raise ValueError("impact_blend_weight must be between 0 and 1")
        if self.shrinkage_minutes < 0:
            raise ValueError("shrinkage_minutes must be non-negative")
        if self.min_listing_price > self.max_listing_price:
            raise ValueError("min_listing_price cannot exceed max_listing_price")

    def shrunk_rating(self, rating: float, minutes: float) -> float:
        """Pull small-sample ratings toward zero (a league-average prior)."""

        if not math.isfinite(rating):
            raise ValueError("rating must be finite")
        if not math.isfinite(minutes):
            raise ValueError("minutes must be finite")
        if minutes < 0:
            raise ValueError("minutes must be non-negative")
        if minutes == 0 and self.shrinkage_minutes == 0:
            return 0.0
        return rating * minutes / (minutes + self.shrinkage_minutes)

    def impact_implied_price(self, rating: float, minutes: float) -> float:
        return (
            self.baseline_price_at_zero
            + self.dollars_per_impact_point * self.shrunk_rating(rating, minutes)
        )

    def opening_price(self, rating: float, minutes: float, actual_salary: float | None) -> float:
        if not math.isfinite(rating):
            raise ValueError("rating must be finite")
        if actual_salary is not None and (
            not math.isfinite(actual_salary) or actual_salary < 0
        ):
            raise ValueError("actual_salary must be finite and non-negative")
        implied = self.impact_implied_price(rating, minutes)
        if actual_salary is None or actual_salary <= 0:
            blended = implied
        else:
            blended = (
                self.impact_blend_weight * implied
                + (1 - self.impact_blend_weight) * actual_salary
            )
        return min(self.max_listing_price, max(self.min_listing_price, blended))


def tier_for_price(price: float) -> str:
    if price >= STAR_PRICE:
        return "star"
    if price >= MID_PRICE:
        return "mid"
    return "bench"


def load_impact_rows(
    path: Path,
    *,
    season_year: int = 2026,
    metric_column: str = "LEBRON",
) -> list[ImpactRow]:
    rows: list[ImpactRow] = []
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            if raw.get("year") != str(season_year):
                continue
            metric = raw.get(metric_column)
            if metric in (None, ""):
                continue
            rows.append(
                ImpactRow(
                    player=raw["Player"].strip(),
                    team=(raw.get("team") or "").strip().upper(),
                    position=(raw.get("Pos") or "").strip(),
                    age=float(raw.get("Age") or 0.0),
                    minutes=float(raw.get("Minutes") or 0.0),
                    games=float(raw.get("Games") or 0.0),
                    rating=float(metric),
                    war=float(raw.get("WAR") or 0.0),
                )
            )
    if not rows:
        raise ValueError(f"no impact rows for season year {season_year} in {path}")
    seen: dict[str, ImpactRow] = {}
    for row in rows:
        key = normalize_player_name(row.player)
        existing = seen.get(key)
        if existing is None or row.minutes > existing.minutes:
            seen[key] = row
    return list(seen.values())


def load_salaries(
    path: Path,
    *,
    season_column: str = "2026-27",
    fallback_column: str = "2025-26",
) -> dict[str, float]:
    salaries: dict[str, float] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in csv.DictReader(handle):
            player = (raw.get("Player") or "").strip()
            if not player or player == "Dead Cap":
                continue
            salary = _salary_value(raw.get(season_column))
            if salary <= 0:
                salary = _salary_value(raw.get(fallback_column))
            if salary > 0:
                salaries.setdefault(normalize_player_name(player), salary)
    if not salaries:
        raise ValueError(f"no usable salaries in {path}")
    return salaries


def _salary_value(raw: str | float | None) -> float:
    if raw is None:
        return 0.0
    try:
        value = float(str(raw).replace("$", "").replace(",", ""))
    except ValueError:
        return 0.0
    return value if math.isfinite(value) and value >= 0 else 0.0


def build_opening_listings(
    impact_rows: list[ImpactRow],
    salaries: dict[str, float],
    *,
    model: OpeningPriceModel | None = None,
    universe_size: int = UNIVERSE_SIZE,
) -> list[OpeningListing]:
    if universe_size <= 0:
        raise ValueError("universe_size must be positive")
    model = model or OpeningPriceModel()
    universe = sorted(impact_rows, key=lambda row: (-row.minutes, row.player))[:universe_size]

    listings: list[OpeningListing] = []
    for row in universe:
        actual_salary = salaries.get(normalize_player_name(row.player))
        implied = model.impact_implied_price(row.rating, row.minutes)
        price = model.opening_price(row.rating, row.minutes, actual_salary)
        listings.append(
            OpeningListing(
                rank=0,
                player=row.player,
                team=row.team,
                position=row.position,
                age=row.age,
                minutes=row.minutes,
                games=row.games,
                rating=row.rating,
                war=row.war,
                actual_salary=actual_salary or 0.0,
                impact_implied_price=implied,
                opening_price=price,
                tier=tier_for_price(price),
            )
        )
    listings.sort(key=lambda listing: (-listing.opening_price, listing.player))
    return [
        OpeningListing(**{**listing.__dict__, "rank": index + 1})
        for index, listing in enumerate(listings)
    ]


def write_listings_csv(listings: list[OpeningListing], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "rank",
        "player",
        "team",
        "position",
        "age",
        "minutes",
        "games",
        "rating",
        "war",
        "actual_salary",
        "impact_implied_price",
        "opening_price",
        "tier",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(fields)
        for listing in listings:
            writer.writerow(
                [
                    listing.rank,
                    listing.player,
                    listing.team,
                    listing.position,
                    round(listing.age, 1),
                    round(listing.minutes, 1),
                    int(listing.games),
                    round(listing.rating, 3),
                    round(listing.war, 2),
                    round(listing.actual_salary),
                    round(listing.impact_implied_price),
                    round(listing.opening_price),
                    listing.tier,
                ]
            )


@dataclass(frozen=True)
class PlayerFeatures:
    """Joined prior-season inputs for the production model."""

    player: str
    team: str
    position: str
    age: float
    minutes: float
    games: float
    epm: float
    prior_war: float


@dataclass(frozen=True)
class ProjectedListing:
    rank: int
    player: str
    team: str
    position: str
    age: float
    minutes: float
    games: float
    epm: float
    prior_war: float
    projected_war: float
    fair_value: float
    actual_salary: float
    opening_price: float
    tier: str


def _zscores(values: list[float]) -> list[float]:
    if not values or any(not math.isfinite(value) for value in values):
        raise ValueError("z-score inputs must be non-empty and finite")
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    deviation = math.sqrt(variance) or 1.0
    return [(value - mean) / deviation for value in values]


@dataclass(frozen=True)
class ProjectedWarModel:
    """The validated production model: blend -> projected WAR -> $ per win."""

    war_intercept: float = WAR_INTERCEPT
    war_slope: float = WAR_SLOPE
    w_epm: float = BLEND_W_EPM
    w_prior_war: float = BLEND_W_PRIOR_WAR
    w_minutes: float = BLEND_W_MINUTES
    w_youth: float = BLEND_W_YOUTH
    min_salary: float = MIN_SALARY
    dollars_per_win: float = DOLLARS_PER_WIN
    fair_value_blend_weight: float = FAIR_VALUE_BLEND_WEIGHT
    min_listing_price: float = MIN_LISTING_PRICE
    max_listing_price: float = MAX_LISTING_PRICE

    def __post_init__(self) -> None:
        for name, value in self.__dict__.items():
            if isinstance(value, bool) or not math.isfinite(float(value)):
                raise ValueError(f"projected-war parameter {name} must be finite")
        weights = (self.w_epm, self.w_prior_war, self.w_minutes, self.w_youth)
        if any(weight < 0 for weight in weights):
            raise ValueError("blend weights must be non-negative")
        if not math.isclose(sum(weights), 1.0, abs_tol=1e-9):
            raise ValueError("blend weights must sum to 1.0")
        if not 0 <= self.fair_value_blend_weight <= 1:
            raise ValueError("fair_value_blend_weight must be between 0 and 1")
        if self.min_listing_price > self.max_listing_price:
            raise ValueError("min_listing_price cannot exceed max_listing_price")

    def projected_wars(self, features: list[PlayerFeatures]) -> list[float]:
        """z-score the pool, blend, and map the blend to WAR units."""

        if not features:
            raise ValueError("at least one player is required")
        for row in features:
            _validate_player_features(row)
        z_epm = _zscores([row.epm for row in features])
        z_war = _zscores([row.prior_war for row in features])
        z_minutes = _zscores([row.minutes for row in features])
        z_youth = _zscores([YOUTH_PIVOT_AGE - row.age for row in features])
        return [
            self.war_intercept
            + self.war_slope
            * (
                self.w_epm * z_epm[index]
                + self.w_prior_war * z_war[index]
                + self.w_minutes * z_minutes[index]
                + self.w_youth * z_youth[index]
            )
            for index in range(len(features))
        ]

    def fair_value(self, projected_war: float) -> float:
        return self.min_salary + projected_war * self.dollars_per_win

    def opening_price(self, fair_value: float, actual_salary: float | None) -> float:
        if not math.isfinite(fair_value):
            raise ValueError("fair_value must be finite")
        if actual_salary is not None and (
            not math.isfinite(actual_salary) or actual_salary < 0
        ):
            raise ValueError("actual_salary must be finite and non-negative")
        if actual_salary is None or actual_salary <= 0:
            blended = fair_value
        else:
            blended = (
                self.fair_value_blend_weight * fair_value
                + (1 - self.fair_value_blend_weight) * actual_salary
            )
        return min(self.max_listing_price, max(self.min_listing_price, blended))


def load_epm_by_name(path: Path) -> dict[str, float]:
    ratings: dict[str, float] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in csv.DictReader(handle):
            name = (raw.get("player_name") or "").strip()
            epm = raw.get("epm")
            if name and epm not in (None, ""):
                ratings.setdefault(normalize_player_name(name), float(epm))
    if not ratings:
        raise ValueError(f"no EPM ratings in {path}")
    return ratings


def _validate_player_features(row: PlayerFeatures) -> None:
    values = {
        "epm": row.epm,
        "prior_war": row.prior_war,
        "minutes": row.minutes,
        "games": row.games,
        "age": row.age,
    }
    for field, value in values.items():
        if not math.isfinite(value):
            raise ValueError(f"{row.player}: {field} must be finite")
    if row.minutes < 0 or row.minutes > 5_000:
        raise ValueError(f"{row.player}: minutes must be between 0 and 5000")
    if row.games < 0 or row.games > 100:
        raise ValueError(f"{row.player}: games must be between 0 and 100")
    if row.age < 15 or row.age > 60:
        raise ValueError(f"{row.player}: age must be between 15 and 60")


def build_player_features(
    impact_rows: list[ImpactRow],
    epm_by_name: dict[str, float],
) -> tuple[list[PlayerFeatures], int]:
    """Full season pool with EPM coverage; returns (features, skipped)."""

    universe = sorted(impact_rows, key=lambda row: (-row.minutes, row.player))
    features: list[PlayerFeatures] = []
    skipped = 0
    for row in universe:
        epm = epm_by_name.get(normalize_player_name(row.player))
        if epm is None:
            skipped += 1
            continue
        features_row = PlayerFeatures(
            player=row.player,
            team=row.team,
            position=row.position,
            age=row.age,
            minutes=row.minutes,
            games=row.games,
            epm=epm,
            prior_war=row.war,
        )
        _validate_player_features(features_row)
        features.append(features_row)
    if not features:
        raise ValueError("no players with both impact and EPM data")
    return features, skipped


def build_projected_listings(
    features: list[PlayerFeatures],
    salaries: dict[str, float],
    *,
    model: ProjectedWarModel | None = None,
    universe_size: int = UNIVERSE_SIZE,
) -> list[ProjectedListing]:
    if universe_size <= 0:
        raise ValueError("universe_size must be positive")
    model = model or ProjectedWarModel()
    projected = model.projected_wars(features)
    projected_by_player = {
        normalize_player_name(row.player): projected_war
        for row, projected_war in zip(features, projected)
    }
    universe = sorted(features, key=lambda row: (-row.minutes, row.player))[:universe_size]
    listings: list[ProjectedListing] = []
    for row in universe:
        projected_war = projected_by_player[normalize_player_name(row.player)]
        fair_value = model.fair_value(projected_war)
        actual_salary = salaries.get(normalize_player_name(row.player))
        price = model.opening_price(fair_value, actual_salary)
        listings.append(
            ProjectedListing(
                rank=0,
                player=row.player,
                team=row.team,
                position=row.position,
                age=row.age,
                minutes=row.minutes,
                games=row.games,
                epm=row.epm,
                prior_war=row.prior_war,
                projected_war=projected_war,
                fair_value=fair_value,
                actual_salary=actual_salary or 0.0,
                opening_price=price,
                tier=tier_for_price(price),
            )
        )
    listings.sort(key=lambda listing: (-listing.opening_price, listing.player))
    return [
        ProjectedListing(**{**listing.__dict__, "rank": index + 1})
        for index, listing in enumerate(listings)
    ]


def write_projected_listings_csv(listings: list[ProjectedListing], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "rank",
        "player",
        "team",
        "position",
        "age",
        "minutes",
        "games",
        "epm",
        "prior_war",
        "projected_war",
        "fair_value",
        "actual_salary",
        "opening_price",
        "tier",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(fields)
        for listing in listings:
            writer.writerow(
                [
                    listing.rank,
                    listing.player,
                    listing.team,
                    listing.position,
                    round(listing.age, 1),
                    round(listing.minutes, 1),
                    int(listing.games),
                    round(listing.epm, 3),
                    round(listing.prior_war, 2),
                    round(listing.projected_war, 2),
                    round(listing.fair_value),
                    round(listing.actual_salary),
                    round(listing.opening_price),
                    listing.tier,
                ]
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build season-start opening listing prices.")
    parser.add_argument("--impact-file", type=Path, default=DEFAULT_IMPACT_FILE)
    parser.add_argument("--epm-file", type=Path, default=DEFAULT_EPM_FILE)
    parser.add_argument("--salary-file", type=Path, default=DEFAULT_SALARY_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_FILE)
    parser.add_argument("--season-year", type=int, default=2026)
    parser.add_argument("--universe-size", type=int, default=UNIVERSE_SIZE)
    parser.add_argument(
        "--legacy-linear",
        action="store_true",
        help="Use the v1 single-metric linear pricer instead of the projected-WAR model",
    )
    args = parser.parse_args()

    impact_rows = load_impact_rows(args.impact_file, season_year=args.season_year)
    salaries = load_salaries(args.salary_file)

    if args.legacy_linear:
        listings = build_opening_listings(
            impact_rows, salaries, universe_size=args.universe_size
        )
        write_listings_csv(listings, args.output)
        print(f"wrote {len(listings)} legacy-linear listings to {args.output}")
        return

    epm_by_name = load_epm_by_name(args.epm_file)
    features, skipped = build_player_features(
        impact_rows, epm_by_name
    )
    listings = build_projected_listings(
        features, salaries, universe_size=args.universe_size
    )
    priced_from_salary = sum(1 for listing in listings if listing.actual_salary > 0)
    write_projected_listings_csv(listings, args.output)
    print(
        f"wrote {len(listings)} projected-WAR listings to {args.output} "
        f"({priced_from_salary} blended with actual salary, {skipped} skipped without EPM)"
    )


if __name__ == "__main__":
    main()
