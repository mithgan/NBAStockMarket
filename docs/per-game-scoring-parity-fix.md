# Current-engine comparison correction

Updated September 10, 2026. The comparison scripts now include the same inputs as the existing game engine. No game-scoring coefficient or economy rule changed.

- Blend and plus-minus comparisons include the engine's minutes coefficient of -0.15. A 30-minute game previously avoided a 4.5-NetPoints deduction.
- The margin CSV loader keeps three-point attempts and passes the actual value to its engine comparison. Six attempts previously missed a 0.30-NetPoints deduction.

The regression suite passes box scores through each actual CSV loader and scoring function, then compares with `NetPointsModel`. Six cases failed before the correction; all nine pass afterward. Independent full-data verification now covers all 79,036 player-game records in each of the three comparisons, including blend endpoint and halfway interpolation checks.

The initial patch could only refresh the available 2025–26 input. The broader review recovered 2023–24 and 2024–25 and regenerated the full [margin](../output/per-game-margin-study.md), [plus-minus](../output/per-game-plusminus-study.md) and [blend](../output/per-game-blend-sweep.md) reports. The separately named 2025–26 subset file remains an explicitly labeled historical artifact; it is not the current three-season evidence.

The actual engine's 2025–26 odd/even player-mean correlation is 0.944801, displayed as 0.945, rather than the previously reported 0.954. Team-margin correlation displays 0.963. These descriptive measurements do not determine a dollar rate, cap, individual causal impact or trading advantage.

Run the regression from the repository root:

```sh
python -m pytest -q tests/test_per_game_study_scoring.py
```

With all raw inputs present, run each script from a working directory containing `data/raw`, with this repository on `PYTHONPATH`:

```sh
python /absolute/path/to/repository/scripts/per_game_margin_study.py
python /absolute/path/to/repository/scripts/per_game_plusminus_study.py
python /absolute/path/to/repository/scripts/per_game_blend_sweep.py
```

See the [full review record](per-game-research-review.md) for the subsequent chronology, accounting, identity and reporting corrections.
