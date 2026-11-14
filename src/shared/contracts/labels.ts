// Packaging labels and certificates as they appear in the catalog (Synkka `packagingMarkedLabel`
// ids), with readable names. Plain constants only (shared zone).

export const LABEL_NAMES: Readonly<Record<string, string>> = {
  GOODS_FROM_FINLAND_BLUE_SWAN: "Hyvää Suomesta (Blue Swan)",
  MADE_IN_FINLAND_FLAG_WITH_KEY: "Avainlippu (Made in Finland)",
  FINNISH_HEART_SYMBOL: "Sydänmerkki (Finnish Heart Symbol)",
  PUHTAASTI_KOTIMAINEN: "Puhtaasti kotimainen",
  EU_ORGANIC_FARMING: "EU organic",
  SOIL_ASSOCIATION_ORGANIC_SYMBOL: "Soil Association organic",
  KRAV_MARK: "KRAV",
  OFFICIAL_ECO_LABEL_SUN: "Luomu sun label (organic)",
  SVANEN: "Nordic Swan Ecolabel",
  EU_ECO_LABEL: "EU Ecolabel",
  RAINFOREST_ALLIANCE: "Rainforest Alliance",
  UTZ_CERTIFIED: "UTZ certified",
  FAIR_TRADE_MARK: "Fairtrade",
  MARINE_STEWARDSHIP_COUNCIL_LABEL: "MSC (sustainable fishing)",
  AQUACULTURE_STEWARDSHIP_COUNCIL: "ASC (responsible aquaculture)",
  DOLPHIN_SAFE: "Dolphin safe",
};

/** Sustainability and organic labels (not origin marks): used by ranking as a plus. */
export const SUSTAINABILITY_LABELS: ReadonlySet<string> = new Set([
  "EU_ORGANIC_FARMING",
  "SOIL_ASSOCIATION_ORGANIC_SYMBOL",
  "KRAV_MARK",
  "OFFICIAL_ECO_LABEL_SUN",
  "SVANEN",
  "EU_ECO_LABEL",
  "RAINFOREST_ALLIANCE",
  "UTZ_CERTIFIED",
  "FAIR_TRADE_MARK",
  "MARINE_STEWARDSHIP_COUNCIL_LABEL",
  "AQUACULTURE_STEWARDSHIP_COUNCIL",
  "DOLPHIN_SAFE",
]);

export const labelName = (id: string) => LABEL_NAMES[id] ?? id;
