interface SettlementMarkerStorage {
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Persist the replay clock without carrying a late-season marker through a
 * reset. A rewound non-null clock becomes the new baseline for future recaps.
 */
export async function writeSettlementMarker(
  storage: SettlementMarkerStorage,
  key: string,
  previousDate: string | null,
  latestDate: string | null,
): Promise<void> {
  if (latestDate === null) {
    await storage.removeItem(key);
    return;
  }
  if (previousDate !== null && latestDate < previousDate) {
    await storage.removeItem(key);
  }
  await storage.setItem(key, latestDate);
}
