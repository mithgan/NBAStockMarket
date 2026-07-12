"""Season-start opening listing prices from an impact metric + salary blend.

The model implements the team-plan "initial pricing" deliverable: a
transparent, linear impact-to-dollars mapping anchored to the real NBA salary
scale, blended with the player's actual contract, with reliability shrinkage
for small minute samples.

    impact_implied = BASELINE_PRICE_AT_ZERO
                   + DOLLARS_PER_IMPACT_POINT * rating * minutes / (minutes + SHRINKAGE_MINUTES)
    opening_price  = clamp(w * impact_implied + (1 - w) * actual_salary)

The metric column is configurable so LEBRON (available today in the
gabriel1200/site_Data repository) can be swapped for DARKO or EPM without
code changes.  The community-census adjustment described in
docs/opening-price-model.md happens after this CSV is produced and is bounded
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

DEFAULT_IMPACT_FILE = Path("data/raw/opening/lebron.csv")
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
        return float(str(raw).replace("$", "").replace(",", ""))
    except ValueError:
        return 0.0


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
        writer = csv.writer(handle)
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Build season-start opening listing prices.")
    parser.add_argument("--impact-file", type=Path, default=DEFAULT_IMPACT_FILE)
    parser.add_argument("--salary-file", type=Path, default=DEFAULT_SALARY_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_FILE)
    parser.add_argument("--season-year", type=int, default=2026)
    parser.add_argument("--metric-column", default="LEBRON")
    parser.add_argument("--universe-size", type=int, default=UNIVERSE_SIZE)
    args = parser.parse_args()

    impact_rows = load_impact_rows(
        args.impact_file, season_year=args.season_year, metric_column=args.metric_column
    )
    salaries = load_salaries(args.salary_file)
    listings = build_opening_listings(
        impact_rows, salaries, universe_size=args.universe_size
    )
    write_listings_csv(listings, args.output)
    priced_from_salary = sum(1 for listing in listings if listing.actual_salary > 0)
    print(
        f"wrote {len(listings)} listings to {args.output} "
        f"({priced_from_salary} blended with actual salary, "
        f"{len(listings) - priced_from_salary} impact-only)"
    )


if __name__ == "__main__":
    main()
