const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateBidAmount } = require("../server/game");

test("opening multipliers count the base price as the first bid step", () => {
  const lot = { basePrice: 2, currentBid: 2, currentBidderId: null };
  assert.equal(calculateBidAmount(lot, 1), 2);
  assert.equal(calculateBidAmount(lot, 2), 2.2);
  assert.equal(calculateBidAmount(lot, 5), 2.8);
  assert.equal(calculateBidAmount(lot, 10), 3.8);
});

test("opening and later multipliers follow price-ladder thresholds", () => {
  assert.equal(
    calculateBidAmount({ basePrice: 0.95, currentBidderId: null }, 3),
    1.1,
  );
  assert.equal(
    calculateBidAmount(
      { basePrice: 2, currentBid: 4.9, currentBidderId: "user" },
      2,
    ),
    5.35,
  );
});
