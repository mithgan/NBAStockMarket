import type { DividendEvent, Player } from './types';

// Sources: output/opening-prices-2026-27.csv ranks 1-30 and the three
// output/backtest-2026.json examples. The final three events are calculated
// from committed ESPN game logs + Dunks & Threes projections using the same
// backtest rule: (actual NP - expected NP) * $40,000 per holder.
export const players: Player[] = [
  { id: '3112335', name: 'Nikola Jokic', tier: 'star', listing_price: 57_985_817, actual_salary: 59_033_114 },
  { id: '4278073', name: 'Shai Gilgeous-Alexander', tier: 'star', listing_price: 49_453_999, actual_salary: 40_806_150 },
  { id: '4432166', name: 'Cade Cunningham', tier: 'star', listing_price: 46_606_618, actual_salary: 50_105_628 },
  { id: '5104157', name: 'Victor Wembanyama', tier: 'star', listing_price: 45_741_439, actual_salary: 16_868_246 },
  { id: '3945274', name: 'Luka Doncic', tier: 'star', listing_price: 45_513_838, actual_salary: 48_967_380 },
  { id: '3032977', name: 'Giannis Antetokounmpo', tier: 'star', listing_price: 45_453_513, actual_salary: 58_456_490 },
  { id: '6450', name: 'Kawhi Leonard', tier: 'star', listing_price: 45_081_675, actual_salary: 50_300_000 },
  { id: '3975', name: 'Stephen Curry', tier: 'star', listing_price: 39_741_850, actual_salary: 62_587_158 },
  { id: '4066261', name: 'Bam Adebayo', tier: 'star', listing_price: 38_867_737, actual_salary: 51_033_600 },
  { id: '3136195', name: 'Karl-Anthony Towns', tier: 'star', listing_price: 38_732_968, actual_salary: 57_078_728 },
  { id: '3908809', name: 'Donovan Mitchell', tier: 'star', listing_price: 38_313_835, actual_salary: 50_105_628 },
  { id: '3078576', name: 'Derrick White', tier: 'star', listing_price: 37_706_830, actual_salary: 30_348_000 },
  { id: '4432158', name: 'Evan Mobley', tier: 'star', listing_price: 36_561_619, actual_salary: 50_105_628 },
  { id: '3136193', name: 'Devin Booker', tier: 'star', listing_price: 36_223_145, actual_salary: 57_078_728 },
  { id: '3202', name: 'Kevin Durant', tier: 'star', listing_price: 35_346_797, actual_salary: 54_708_609 },
  { id: '1966', name: 'LeBron James', tier: 'star', listing_price: 34_794_662, actual_salary: 52_627_153 },
  { id: '4433255', name: 'Chet Holmgren', tier: 'star', listing_price: 34_257_506, actual_salary: 13_731_368 },
  { id: '4433134', name: 'Scottie Barnes', tier: 'star', listing_price: 34_124_439, actual_salary: 41_754_636 },
  { id: '4431678', name: 'Tyrese Maxey', tier: 'star', listing_price: 33_545_954, actual_salary: 40_770_520 },
  { id: '3059318', name: 'Joel Embiid', tier: 'star', listing_price: 33_067_075, actual_salary: 59_539_200 },
  { id: '4432816', name: 'LaMelo Ball', tier: 'star', listing_price: 32_467_073, actual_salary: 40_770_520 },
  { id: '3917376', name: 'Jaylen Brown', tier: 'star', listing_price: 32_133_208, actual_salary: 57_078_728 },
  { id: '4251', name: 'Paul George', tier: 'star', listing_price: 31_405_068, actual_salary: 54_126_380 },
  { id: '4066336', name: 'Lauri Markkanen', tier: 'star', listing_price: 31_294_235, actual_salary: 46_113_154 },
  { id: '4222252', name: 'Isaiah Hartenstein', tier: 'star', listing_price: 30_728_973, actual_salary: 28_500_000 },
  { id: '4566434', name: 'Franz Wagner', tier: 'mid', listing_price: 29_619_843, actual_salary: 41_754_690 },
  { id: '3936299', name: 'Jamal Murray', tier: 'mid', listing_price: 29_545_167, actual_salary: 50_105_628 },
  { id: '6430', name: 'Jimmy Butler III', tier: 'mid', listing_price: 29_387_986, actual_salary: 0 },
  { id: '3934719', name: 'OG Anunoby', tier: 'mid', listing_price: 29_011_672, actual_salary: 42_500_000 },
  { id: '3934672', name: 'Jalen Brunson', tier: 'mid', listing_price: 28_843_043, actual_salary: 37_739_521 },
];

export const dividendEvents: DividendEvent[] = [
  { player_id: '4278073', game_date: '2025-10-23', actual_net_points: 43.6, expected_net_points: 22.8129, dividend_per_holder: 831_484.4 },
  { player_id: '3112335', game_date: '2025-12-25', actual_net_points: 59.35, expected_net_points: 25.5473, dividend_per_holder: 1_352_109.8 },
  { player_id: '3945274', game_date: '2026-03-19', actual_net_points: 54.45, expected_net_points: 24.6271, dividend_per_holder: 1_192_915.4 },
  { player_id: '4278073', game_date: '2025-10-21', actual_net_points: 23.2, expected_net_points: 20.03567, dividend_per_holder: 126_573.2 },
  { player_id: '3112335', game_date: '2025-10-23', actual_net_points: 15.3, expected_net_points: 18.98454, dividend_per_holder: -147_381.6 },
  { player_id: '3945274', game_date: '2025-10-24', actual_net_points: 42.45, expected_net_points: 20.39128, dividend_per_holder: 882_348.8 },
];

export const leaderboard = [
  { rank: 1, name: 'portfolio-048', value: 168_604_261, returnPct: 20.43 },
  { rank: 2, name: 'Buckets & Bonds', value: 161_280_440, returnPct: 15.2 },
  { rank: 3, name: 'The Sixth Trader', value: 156_890_020, returnPct: 12.06 },
  { rank: 4, name: 'Midrange Capital', value: 151_422_700, returnPct: 8.16 },
  { rank: 5, name: 'You', value: 140_000_000, returnPct: 0 },
];
