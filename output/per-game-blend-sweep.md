# Blend diagnostics: alpha * engine NP + (1 - alpha) * uncentered margin fit (2025-26)

Final same-game box scores are inputs, not pregame predictions. The top-150 player cohort uses final-season appearance counts; it is descriptive, not an implementable selection rule. The margin component omits the fitted team intercept and does not identify a player-score baseline.

| alpha | Team-margin r | Unscaled team-diff RMSE | Margin-on-score slope | Odd/even mean r | Players with mean <=0 | Sample top 5 |
|---|---:|---:|---:|---:|---:|---|
| 1.00 | 0.963 | 16.030 | 0.508 | 0.945 | 0/150 | Shai Gilgeous-Alexander, Tyrese Maxey, Donovan Mitchell, Jaylen Brown, Jamal Murray |
| 0.75 | 0.966 | 14.582 | 0.533 | 0.927 | 0/150 | Shai Gilgeous-Alexander, Jalen Duren, Jalen Johnson, Tyrese Maxey, Karl-Anthony Towns |
| 0.50 | 0.964 | 13.456 | 0.555 | 0.911 | 0/150 | Jalen Duren, Karl-Anthony Towns, Rudy Gobert, Donovan Clingan, Shai Gilgeous-Alexander |
| 0.25 | 0.955 | 12.739 | 0.572 | 0.925 | 5/150 | Rudy Gobert, Donovan Clingan, Jalen Duren, Karl-Anthony Towns, Neemias Queta |
| 0.00 | 0.939 | 12.502 | 0.581 | 0.953 | 38/150 | Rudy Gobert, Donovan Clingan, Moussa Diabate, Jalen Duren, Neemias Queta |

A points-only control has r = 1 and RMSE = 0 by construction: the team difference of player PTS is the target itself. Positive scaling preserves correlation while changing dividends; subtracting the same total from both teams also preserves every margin difference while changing player baselines. These diagnostics therefore do not validate individual attribution, a rate, or statistical equivalence. Odd/even season means measure repeatability of aggregates, not a skill ceiling or next-game forecast accuracy.
