# Valio catalog: data anomalies

Findings from `pnpm data:analyze` on the challenge files (products.json, carbon-footprint.csv, delivery-reliability.csv; 17 546 products). The checks live in `src/server/catalog/anomalies.ts` and rerun on every analysis; full samples are in `data/valio/analysis.json` (`anomalies`).

The three files join cleanly: every CSV row matches a product, no duplicate ids, nothing fails validation. The problems are inside the product data.

## Errors: contradictory data that can mislead ordering or logistics

| Check | Count | Example | What to do |
| --- | --- | --- | --- |
| Temperature condition 8 (ambient), but Synkka storage −25..−18 °C | 89 | 460340 RF cheesecake | Treat as frozen. Prefer `storageTempC` over `temperatureCondition`. |
| Condition 1–4 (chilled), but storage up to ≥ 15 °C | 38 | 461240 Monster Energy 5..25 °C | Probably ambient; don't block on cold chain. |
| Condition 7 (frozen), but storage above 0 °C | 9 | 464297 Tamminen minced beef 18..22 °C | Ask a human before promising frozen delivery. |
| Net weight entered in grams with the kg unit (or net > gross) | 10 | 465184 Pizzatopping 2 kg = 2000 KGM | Already dropped by the parser: `netWeightKg` and CO2 per unit are null. |
| Packaging unit with size 0 | 1 | 476872 unit ZML | Never offer that unit. |
| Product listed as its own substitute | 1 | 471661 Vaasan sourdough bread | Removed from `substitutes` by the parser. |

`temperatureCondition` codes are not documented; inferred from names and storage ranges: 1–4 chilled, 7 frozen, 8 ambient (5, 6, 9 are rare).

## Warnings: likely wrong, needs a human look

| Check | Count | Note |
| --- | --- | --- |
| ERP country of origin ≠ Synkka country | 613 | E.g. Kettle chips ERP gb, Synkka nl. One of them may be the producer's country. Don't use origin for hard filters ("Finnish only") without checking both. |
| Malformed VAT code (`MEDIUM MEDIUM`, `STANDARD MEDIUM`, empty) | 164 | Map `MEDIUM MEDIUM` → MEDIUM if VAT is ever computed locally; prices from `/api/price` already include tax. |
| Delivery reliability exactly 0 | 12 | Mostly non-food (doilies, thermos). Avoid unless there is no alternative. |
| Weight-priced flag contradicts the sales unit | 12 | E.g. fresh fish sold per KG but not flagged weight-priced. Quantities may be kg or pieces: confirm before ordering. |

No two products share a sales GTIN (checked: `sales-gtin-shared` has 0 hits).

## Info: odd-looking but explained (don't "fix")

- **CO2 is a group average.** Only 177 distinct values over 11 033 products. It tells high- from low-carbon *kinds* of products; it can't rank two similar items (192 of 211 substitute pairs have identical CO2).
- **958 GTINs fail the check digit.** All start with 23/24/28: in-store codes for variable-weight fresh produce, not global GTINs.
- **804 products: Synkka GTIN is none of the product's units.** Usually the consumer item inside a multipack. **54 products share a Synkka GTIN** with another id: the same item in another pack size (sugar 1 kg as 10× and 325×), useful as alternatives.
- **156 products share name + vendor with another id** but have different GTINs and packs: separate items. Refer to them by id/GTIN and show the pack size.
- **3 068 products have no Synkka data** (no GTIN, temperatures, VAT, update date); **4 171 have no image**; **897 Synkka records are over a year old**; **783 English names are untranslated Finnish** (mostly fresh produce in uppercase, so English search may miss them).
- **50 substitutes change temperature condition** (e.g. cucumber FI ↔ NL): fine, but check before swapping chilled ↔ frozen.

## Coverage reminder

CO2 for 63 % of products, delivery reliability for 25 %, both for 18 %, neither for 30 %. Missing is not zero: rank products without a metric as "unknown", not best or worst.
