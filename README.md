# Order router

A skills test. Part A routes each order of a fictional supplement shop to one warehouse. Part B is two decisions based on its results.

## 1. The problem

Each order goes to one warehouse: the closest one that can ship the whole order. The input is in `data/`: the day's order events, the warehouses with stock and daily sales, the shipping zone from each warehouse to each ZIP prefix (1 is closest), and the catalog.

| Rule | In plain words |
|---|---|
| 1 | Outside the US: PARTNER, the international partner warehouse. |
| 2 | No ZIP, or a ZIP prefix (first 3 digits) with no zone: PARTNER. |
| 3 | A warehouse can take the order only if it is enabled and has stock for every item. No splits. |
| 4 | The lowest zone wins. |
| 5 | Tie: the most days of cover wins (stock ÷ daily sales, smallest over the order's products). |
| 6 | Still tied: WH-NJ, WH-GA, WH-NV, WH-TX. |
| 7 | No warehouse can take it: PARTNER. |

Orders are routed in creation order, and each one reserves its stock. Customers can add items for 30 minutes, so each order is routed once, with its edits.

## 2. How to run

Node `^22.18.0 || >=23.6.0` (`.nvmrc` says 24). Node runs the `.ts` files directly.

```sh
npm install         # dev dependencies only, for type checking
npm start           # writes routes.txt
npm test
npm run typecheck
```

| Flag | Effect |
|---|---|
| `--off WH-NV` | Turns warehouses off. Takes a list: `--off WH-GA,WH-NV`. |
| `--avoid WH-GA` | Routes away from one warehouse when another one that can take the order is within one zone of it. |

Example: `npm start -- --off WH-NV --avoid WH-GA`. A run with a flag prints only. `routes.txt` always comes from the files as given.

## 3. The output

```
#2033  WH-NJ    zone 3 (ZIP 2134 read as 02134)
#2034  WH-GA    zone 5 (tie: cover)
#2037  PARTNER  outside US (country CA)
```

| Destination | Reasons |
|---|---|
| A warehouse | `zone N` |
| PARTNER | `outside US (country X)`, `no ZIP`, `invalid ZIP X`, `ZIP prefix X not in zones`, `no warehouse can take the whole order` |
| HOLD (a person decides) | `unknown SKU X`, `invalid quantity`, `invalid created time`, `missing country`, `no items` |

The notes in parentheses show what a person should see: input fixes (`SKU nw-mag-90 read as NW-MAG-90`, `edit merged: +1 NW-MULTI-30`), tie-breaks (`tie: cover`, `tie: priority`), and the avoid rule (`avoided WH-GA at zone 7`, only when it changed the warehouse).

## 4. Messy data

Each problem has a general rule. No rule uses an order number.

| Problem | Example | Rule |
|---|---|---|
| ZIP lost its leading zero | `2134` | Digits only and fewer than 5: pad with zeros. |
| ZIP+4 | `07030-1834` | Use the first 3 digits. |
| Non-US postal code | `M5V 2T6` | Invalid ZIP. |
| `CA` is Canada as a country, California as a state | | Only `country` decides rule 1. |
| Lowercase SKU | `nw-mag-90` | Trim and uppercase. |
| Empty ZIP, or a prefix with no zone (Hawaii) | `""`, `968` | PARTNER (rule 2). |
| Bundle SKU that no warehouse stocks | `NW-BNDL-ESS` | Expand into its products. |
| Order edited later | `order_edited` | Merge within 30 minutes, else ignore with a note. |
| A `_note` key among the warehouses in `zones.json` | | Look up zones by warehouse code. |
| Daily sales of 0 | WH-TX | Infinite cover, not a division by zero. |

## 5. My readings of the rules

| Choice | Reason |
|---|---|
| An edited order keeps its creation place in the queue. | Every order waits the same 30 minutes, so the sequence is the same. |
| Cover uses stock before this order is reserved. | The literal reading. The other reading changes no winner today. |
| Unknown SKU: HOLD, not PARTNER. | The partner can't ship a product nobody knows. Rule 7 is about stock. |
| Invalid quantity (0, negative, not whole): HOLD. | A negative quantity would add stock and silently break later orders. |
| Missing or invalid created time: HOLD. | The queue decides who gets stock, and this order has no place in it. |
| Pad short ZIPs, numbers and strings alike. | `"2134"` lost its zero the same way `2134` did. |

## 6. Design

| File | Job |
|---|---|
| `src/normalize.ts` | Raw events to clean orders: ZIP, SKU, bundles, edits, hold reasons, notes. |
| `src/router.ts` | Rules 1 to 7, stock reservation, the ranking list. |
| `src/pipeline.ts` | The whole run, from parsed input to text. |
| `src/load.ts`, `src/main.ts` | Read `data/`; print and write `routes.txt`. |
| `src/cli.ts`, `src/format.ts`, `src/types.ts` | Flags, output lines, types. |
| `test/` | Unit tests, and an end-to-end test against `test/fixtures/expected-routes.txt`. |

Normalizing and routing are pure functions. Only `load.ts` (reading) and `main.ts` (writing) touch files. Rules 4 to 6 are an ordered list of comparators (zone, cover, priority). That list is the one place where routing policy changes: `--avoid` adds a rule in front of it.

Left out:

- No linter. Strict TypeScript and the tests cover the serious problems in eight small files. A linter is the first thing I would add when a second person works on the code.
- No Docker. There are no runtime dependencies, so Node is the only requirement.

## 7. How I checked the AI's work

I used Claude Code. I made the decisions. The AI analyzed, proposed and built.

1. Analysis came before code. The AI found the data problems without hints, and I decided each open question before any code.
2. Before any code ran, an expected route was worked out for every order, without running code. routes.txt was compared with it line by line: all 26 lines matched.
3. The end-to-end test came only after that check. It uses a separate fixture, because `npm start` rewrites `routes.txt`.
4. The git history shows the first version, then my review.
5. Before publishing, I ran npm start, the three Part B runs and an error case myself, and checked each output.

The full conversation is in `ai-conversation.txt`.

## 8. Part B, question 1: where do seven orders ship today?

I routed the whole day again with WH-NV off. It flooded over the weekend, and all of today's orders came in after that. Moving only its orders is not enough, because stock used earlier changes what later orders find. WH-GA stays on: it still ships, and the question says not to apply question 2. WH-TX stays off: no note says it is back.

| Order | Ships from | Why |
|---|---|---|
| #2033 | WH-NJ (zone 3) | ZIP `2134` read as `02134`. |
| #2037 | Partner | Canada. |
| #2040 | WH-GA (zone 5) | Bundle. WH-NJ (zone 2) has no NW-MAG-90 left. |
| #2041 | WH-GA (zone 7) | Edit merged. WH-GA is one zone closer than WH-NJ. |
| #2045 | WH-GA (zone 3) | SKU read as NW-MAG-90. WH-GA is the closest. |
| #2050 | WH-NJ (zone 5) | Needs 2 NW-VITD-60. WH-GA (zone 1) has only 1 left. |
| #2051 | WH-GA (zone 7) | Was WH-NV. WH-GA is one zone closer than WH-NJ. |

#2051 takes WH-GA's last NW-VITD-60, so #2056, a New Jersey order, goes to the international partner. The router decides one order at a time. A person could ship #2051 from WH-NJ and keep #2056 at home, but I would not change the rules for one case.

**First action, not one of the options:** turn WH-NV off in the router config now. Until someone does, orders keep going to a flooded warehouse.

## 9. Part B, question 2: stop sending orders to WH-GA until Monday?

My answer is **c: route away from WH-GA only when another warehouse is within one zone**, if:

1. WH-NV is turned off in the config first.
2. The rule sits behind a flag (`--avoid WH-GA`) that is removed on Monday.
3. Someone watches WH-NJ's stock. It is the only other warehouse.

Measured on today's orders, with WH-NV off:

| Option | At WH-GA | Left WH-GA | Came into WH-GA | Domestic orders to the partner for lack of stock |
|---|---|---|---|---|
| b: as normal | 15 | | | 1 |
| a: WH-GA off | 0 | 15 | 0 | 8 |
| c: avoid within one zone | 12 | 6 | 3 | 0 |

Days and dollars below are **estimates** from Finance's daily averages: one zone farther or less, half a day and $0.40 more; two or more zones, 2 days and $2.35 more. WH-GA adds about 2 days of picking until Monday.

- **Not a:** 8 domestic orders go to the partner, because WH-NJ runs out of NW-MAG-90. And a move of 2 or more zones adds 2 days in transit, which cancels the 2 days of picking: the order arrives no sooner and costs about $2.35 more (estimate).
- **Not b:** 15 orders wait 2 more days, when 5 could arrive about a day and a half earlier for about $0.40 each (estimate).
- **Not d:** WH-NV can't ship.
- **Side effect of c:** #2034 moved to WH-NJ and used one of its last two NW-MAG-90. So #2039, a New Jersey order that needs two, lost its zone 1 warehouse and went to WH-GA at zone 5 (about 4 days and $2.35 more, estimate). The same effect helped #2040 (zone 2 instead of 5) and #2056 (WH-GA instead of the partner).

## 10. Next steps

- Look at the whole batch, or reserve scarce stock, instead of routing one order at a time. #2056 and #2039 both lost out to an earlier order.
- Check the input JSON against a schema.
- Remove `--avoid` on Monday.
