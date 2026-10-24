# Backbar

Inventory for bars. Staff scan bottles in (deliveries), out (to the bar) and as waste; sales from the POS take the poured liquor out of stock using recipes; inventory mode counts the shelves and shows whether sales match what was used.

Stock is the total on the premises. With a POS, "Out" records a move from storage to the bar but doesn't lower stock, because POS sales already take the poured liquor out. Bars without a POS turn off "This bar uses a POS system" on the POS tab; then "Out" counts the bottle as used, and inventory reports compare counts with Out scans instead of sales.

Built with Expo (React Native) for iOS and Android. Data is stored on the device in SQLite.

## Run it

```sh
npm install
npx expo start          # scan the QR code with a development build
npm test                # inventory math tests
npm run typecheck
```

The camera needs a development build or a store build (`npx expo run:ios`, `npx expo run:android`, or `eas build --profile development`).

## What's in it

| Tab   | What it does |
| ----- | ------------ |
| Scan  | Camera barcode scanning (UPC/EAN), or type a code / use a Bluetooth scanner. Choose In, Out or Waste, and set bottles per scan (1, 6, 12, 24 or any number) so a case is one scan. "Log right away" skips the confirm step. Unknown barcodes open an "add product" form. |
| Stock | Bottles on hand against par, low and out flags, stock value, bottles to reorder, and waste by bartender (spill, comp, broken) for this shift, 7 or 30 days. Staff pick their name in the header. |
| Inventory | Monthly stock take: scan every bottle (Full, ¾, ½, ¼ or tenths for open bottles, ×6/×12 for cases), adjust by hand, then finish. Stock is set to the count, and a report shows missing liquor in dollars and **sales accuracy**: how much of what left the shelves since the last inventory is explained by POS sales plus logged waste. |
| POS   | Square and Toast connections, pull sales, map unmatched drinks to recipes. Recipes match by drink name, so they carry over if a bar switches POS. Clover and Lightspeed are listed as coming soon. A switch turns POS mode off for bars without one. |

## Code layout

- `src/domain/inventory.ts`: pure inventory math (tested).
- `src/db/`: SQLite schema, migrations and queries. Every stock change is a row in `movements`.
- `src/pos/`: one adapter per POS behind the `PosProvider` interface; the rest of the app only sees normalized sales.
- `src/screens/`: the four tabs.

## POS integrations

| POS | Status | What's needed |
| --- | ------ | ------------- |
| Square | Working (pull sales with an access token) | Production: OAuth through a small backend, plus `order.updated` webhooks |
| Toast | Working (Standard API access credentials: client ID, secret, restaurant GUID) | Not yet tested against a live Toast account |
| Clover | Planned | Clover App Market app with inventory/orders permissions |
| Lightspeed | Planned | Lightspeed Restaurant (K-Series) API access, OAuth |

Each sale is applied once (`processed_sales`), so pulling the same window twice is safe.

## Known limits of this first version

- Square uses a pasted access token stored in the device keychain. Before release this should move to OAuth with tokens held on a server.
- Data lives on one device. Multi-device sync (several staff phones) needs a backend.
- A sale whose drinks had no recipe is still marked processed, so mapping the recipe later doesn't backfill that sale.

## Releasing to the stores

Needs an Apple Developer account and a Google Play developer account. Then `eas build --platform all --profile production` and `eas submit`.
