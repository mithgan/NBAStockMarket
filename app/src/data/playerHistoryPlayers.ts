/**
 * Explicit ESPN stock-market ID → NBA ID crosswalk.
 * Verified against Databallr search and player-info on 2026-09-28.
 * Names must also match after normalization; see docs/player-history-identity.md.
 * Keep rookies mapped even when their prior-season gamelog is empty.
 */
export const HISTORY_PLAYERS: Record<string, { nbaId: number; name: string }> = {
  '3112335': { nbaId: 203999, name: "Nikola Jokic" },
  '4278073': { nbaId: 1628983, name: "Shai Gilgeous-Alexander" },
  '5104157': { nbaId: 1641705, name: "Victor Wembanyama" },
  '3945274': { nbaId: 1629029, name: "Luka Doncic" },
  '6450': { nbaId: 202695, name: "Kawhi Leonard" },
  '4432166': { nbaId: 1630595, name: "Cade Cunningham" },
  '3078576': { nbaId: 1628401, name: "Derrick White" },
  '3908809': { nbaId: 1628378, name: "Donovan Mitchell" },
  '4066261': { nbaId: 1628389, name: "Bam Adebayo" },
  '4433255': { nbaId: 1631096, name: "Chet Holmgren" },
  '4431678': { nbaId: 1630178, name: "Tyrese Maxey" },
  '4433134': { nbaId: 1630567, name: "Scottie Barnes" },
  '3136195': { nbaId: 1626157, name: "Karl-Anthony Towns" },
  '4432816': { nbaId: 1630163, name: "LaMelo Ball" },
  '4684740': { nbaId: 1641708, name: "Amen Thompson" },
  '3202': { nbaId: 201142, name: "Kevin Durant" },
  '3136193': { nbaId: 1626164, name: "Devin Booker" },
  '3032977': { nbaId: 203507, name: "Giannis Antetokounmpo" },
  '4869342': { nbaId: 1630700, name: "Dyson Daniels" },
  '4432158': { nbaId: 1630596, name: "Evan Mobley" },
  '3936299': { nbaId: 1627750, name: "Jamal Murray" },
  '4433621': { nbaId: 1631105, name: "Jalen Duren" },
  '3934672': { nbaId: 1628973, name: "Jalen Brunson" },
  '4066320': { nbaId: 1630217, name: "Desmond Bane" },
  '5105565': { nbaId: 1642270, name: "Donovan Clingan" },
  '3917376': { nbaId: 1627759, name: "Jaylen Brown" },
  '5061575': { nbaId: 1642851, name: "Kon Knueppel" },
  '4066259': { nbaId: 1628368, name: "De'Aaron Fox" },
  '3934719': { nbaId: 1628384, name: "OG Anunoby" },
  '4278585': { nbaId: 1631221, name: "Collin Gillespie" },
};
