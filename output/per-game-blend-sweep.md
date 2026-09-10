# Blend dial: alpha*oldNP + (1-alpha)*marginFit (2025-26 out-of-sample)

| alpha | Team-margin r | Split-half reliability | Players <=0 EV | Top 5 |
|---|---:|---:|---:|---|
| 1.00 | 0.963 | 0.945 | 0/150 | Shai Gilgeous-Alexander, Tyrese Maxey, Donovan Mitchell, Jaylen Brown, Jamal Murray |
| 0.75 | 0.966 | 0.927 | 0/150 | Shai Gilgeous-Alexander, Jalen Duren, Jalen Johnson, Tyrese Maxey, Karl-Anthony Towns |
| 0.50 | 0.964 | 0.911 | 0/150 | Jalen Duren, Karl-Anthony Towns, Rudy Gobert, Donovan Clingan, Shai Gilgeous-Alexander |
| 0.25 | 0.955 | 0.925 | 5/150 | Rudy Gobert, Donovan Clingan, Jalen Duren, Karl-Anthony Towns, Neemias Queta |
| 0.00 | 0.939 | 0.953 | 38/150 | Rudy Gobert, Donovan Clingan, Moussa Diabate, Jalen Duren, Neemias Queta |

alpha=1 is the old formula; alpha=0 is the pure margin fit. Team-margin r for raw on-court +/- team sums is 1.000 by construction but its per-player split-half reliability is only 0.678 (see per-game-plusminus-study.md).
