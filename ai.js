// ── AI Player for Setback (Medium difficulty) ───────────
// Makes decent decisions but not perfect — beatable by a good player

var SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
var RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function suitColor(suit) {
  return (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
}

function cardId(card) {
  return card.rank + '_' + card.suit;
}

function isTrump(card, trumpSuit) {
  if (card.rank === 'Joker') return true;
  if (card.suit === trumpSuit) return true;
  if (card.rank === 'J' && suitColor(card.suit) === suitColor(trumpSuit) && card.suit !== trumpSuit) return true;
  return false;
}

function trumpPower(card, trumpSuit) {
  if (card.rank === 'Joker') return 14;
  if (card.suit === trumpSuit) {
    if (card.rank === 'A') return 13;
    if (card.rank === 'K') return 12;
    if (card.rank === 'Q') return 11;
    if (card.rank === 'J') return 10;
    return parseInt(card.rank) - 2;
  }
  if (card.rank === 'J' && suitColor(card.suit) === suitColor(trumpSuit) && card.suit !== trumpSuit) {
    return 9;
  }
  return -1;
}

function effectiveSuit(card, trumpSuit) {
  if (isTrump(card, trumpSuit)) return trumpSuit;
  return card.suit;
}

function plainPower(card) {
  return RANKS.indexOf(card.rank);
}

// ── Evaluate hand strength for bidding ──────────────────
function evaluateHand(hand) {
  // Count cards per suit and evaluate strength
  var suitCounts = {};
  var suitStrength = {};
  var hasJoker = false;

  for (var i = 0; i < hand.length; i++) {
    var c = hand[i];
    if (c.rank === 'Joker') { hasJoker = true; continue; }
    if (!suitCounts[c.suit]) { suitCounts[c.suit] = 0; suitStrength[c.suit] = 0; }
    suitCounts[c.suit]++;
    // Weight high cards more
    if (c.rank === 'A') suitStrength[c.suit] += 4;
    else if (c.rank === 'K') suitStrength[c.suit] += 3;
    else if (c.rank === 'Q') suitStrength[c.suit] += 2;
    else if (c.rank === 'J') suitStrength[c.suit] += 3; // Jacks are worth points
    else if (c.rank === '10') suitStrength[c.suit] += 1;
  }

  // Find best suit
  var bestSuit = null;
  var bestScore = -1;
  for (var suit in suitStrength) {
    var score = suitStrength[suit] + suitCounts[suit]; // strength + count
    if (hasJoker) score += 2; // joker always helps
    if (score > bestScore) {
      bestScore = score;
      bestSuit = suit;
    }
  }

  // Estimate how many points we could take
  var estimatedPoints = 0;
  if (bestSuit && suitCounts[bestSuit]) {
    // Check for high cards in best suit
    for (var i = 0; i < hand.length; i++) {
      if (hand[i].suit === bestSuit) {
        if (hand[i].rank === 'A') estimatedPoints += 1.5; // likely high
        if (hand[i].rank === 'J') estimatedPoints += 1;   // jack point
        if (hand[i].rank === '2' || hand[i].rank === '3') estimatedPoints += 0.5; // could be low
      }
      // Off-jack
      if (hand[i].rank === 'J' && hand[i].suit !== bestSuit && suitColor(hand[i].suit) === suitColor(bestSuit)) {
        estimatedPoints += 1;
      }
    }
    if (hasJoker) estimatedPoints += 1;
    // Game point for having strong cards
    if (suitCounts[bestSuit] >= 3) estimatedPoints += 0.5;
  }

  return { bestSuit: bestSuit, strength: bestScore, estimatedPoints: estimatedPoints };
}

// ── AI: Decide bid ──────────────────────────────────────
function aiBid(hand, highBid, isDealer, allPassed) {
  var eval_ = evaluateHand(hand);

  // If dealer and everyone passed, stuck with 3
  if (isDealer && allPassed) return 3;

  // Decide based on estimated points
  var bid = 0;
  if (eval_.estimatedPoints >= 5) bid = 5;
  else if (eval_.estimatedPoints >= 4) bid = 4;
  else if (eval_.estimatedPoints >= 3) bid = 3;

  // Add some randomness — occasionally bump up or down
  if (Math.random() < 0.15 && bid > 0) bid = Math.min(6, bid + 1); // aggressive sometimes
  if (Math.random() < 0.1 && bid > 3) bid = bid - 1; // cautious sometimes

  // Must beat current high bid
  if (bid <= highBid) bid = 0; // pass

  return bid;
}

// ── AI: Pick trump suit ─────────────────────────────────
function aiPickTrump(hand) {
  var eval_ = evaluateHand(hand);
  return eval_.bestSuit || SUITS[Math.floor(Math.random() * SUITS.length)];
}

// ── AI: Pick cards to keep during discard ────────────────
function aiDiscard(hand, trumpSuit, isBidWinner) {
  // Score each card for how useful it is
  var scored = [];
  for (var i = 0; i < hand.length; i++) {
    var c = hand[i];
    var score = 0;

    if (isTrump(c, trumpSuit)) {
      score = 100 + trumpPower(c, trumpSuit); // always keep trump
    } else {
      // Non-trump: prefer aces and high cards for game point
      if (c.rank === 'A') score = 20;
      else if (c.rank === 'K') score = 15;
      else if (c.rank === 'Q') score = 10;
      else if (c.rank === '10') score = 18; // 10 is worth 10 game points!
      else if (c.rank === 'J') score = 8;
      else score = parseInt(c.rank) || 1;
    }

    scored.push({ card: c, score: score, id: cardId(c) });
  }

  // Sort by score descending, keep top 6
  scored.sort(function(a, b) { return b.score - a.score; });
  var keepIds = [];
  for (var i = 0; i < Math.min(6, scored.length); i++) {
    keepIds.push(scored[i].id);
  }
  return keepIds;
}

// ── AI: Play a card ─────────────────────────────────────
function aiPlayCard(hand, trickPlays, trumpSuit, isLeading) {
  if (hand.length === 0) return null;
  if (hand.length === 1) return cardId(hand[0]);

  // Separate trump and non-trump
  var trumpCards = [];
  var nonTrumpCards = [];
  for (var i = 0; i < hand.length; i++) {
    if (isTrump(hand[i], trumpSuit)) trumpCards.push(hand[i]);
    else nonTrumpCards.push(hand[i]);
  }

  if (isLeading) {
    // Leading the trick
    if (trumpCards.length > 0 && Math.random() < 0.5) {
      // Lead with highest trump sometimes to pull out opponent's trump
      trumpCards.sort(function(a, b) { return trumpPower(b, trumpSuit) - trumpPower(a, trumpSuit); });
      return cardId(trumpCards[0]);
    }
    // Lead with a strong non-trump card (ace or king)
    if (nonTrumpCards.length > 0) {
      nonTrumpCards.sort(function(a, b) { return plainPower(b) - plainPower(a); });
      // Lead high to try to win game points
      if (plainPower(nonTrumpCards[0]) >= 12) { // Ace
        return cardId(nonTrumpCards[0]);
      }
      // Sometimes lead low to throw off
      if (Math.random() < 0.3) {
        return cardId(nonTrumpCards[nonTrumpCards.length - 1]);
      }
      return cardId(nonTrumpCards[0]);
    }
    // Only have trump
    trumpCards.sort(function(a, b) { return trumpPower(b, trumpSuit) - trumpPower(a, trumpSuit); });
    return cardId(trumpCards[0]);
  }

  // Following — figure out lead suit
  var leadCard = trickPlays[0].card;
  var leadSuit = effectiveSuit(leadCard, trumpSuit);

  // Find cards that can follow suit
  var followCards = [];
  for (var i = 0; i < hand.length; i++) {
    if (effectiveSuit(hand[i], trumpSuit) === leadSuit) followCards.push(hand[i]);
  }

  if (followCards.length > 0) {
    // Must follow suit — find the best play
    // Check what's currently winning
    var bestPower = -1;
    for (var i = 0; i < trickPlays.length; i++) {
      var tp;
      if (isTrump(trickPlays[i].card, trumpSuit)) {
        tp = trumpPower(trickPlays[i].card, trumpSuit);
      } else if (effectiveSuit(trickPlays[i].card, trumpSuit) === leadSuit) {
        tp = plainPower(trickPlays[i].card);
      } else {
        tp = -1;
      }
      if (tp > bestPower) bestPower = tp;
    }

    // Try to win with lowest winning card
    followCards.sort(function(a, b) {
      var ap = (leadSuit === trumpSuit) ? trumpPower(a, trumpSuit) : plainPower(a);
      var bp = (leadSuit === trumpSuit) ? trumpPower(b, trumpSuit) : plainPower(b);
      return ap - bp;
    });

    for (var i = 0; i < followCards.length; i++) {
      var fp = (leadSuit === trumpSuit) ? trumpPower(followCards[i], trumpSuit) : plainPower(followCards[i]);
      if (fp > bestPower) return cardId(followCards[i]); // win with lowest winner
    }

    // Can't win — play lowest card
    return cardId(followCards[0]);
  }

  // Can't follow suit
  if (trumpCards.length > 0) {
    // Check if trick has high-value cards worth trumping for
    var trickValue = 0;
    for (var i = 0; i < trickPlays.length; i++) {
      var r = trickPlays[i].card.rank;
      if (r === 'A') trickValue += 4;
      else if (r === 'K') trickValue += 3;
      else if (r === 'Q') trickValue += 2;
      else if (r === 'J') trickValue += 1;
      else if (r === '10') trickValue += 10;
    }

    // Trump if trick is valuable enough
    if (trickValue >= 3 || Math.random() < 0.3) {
      // Play lowest trump that wins
      trumpCards.sort(function(a, b) { return trumpPower(a, trumpSuit) - trumpPower(b, trumpSuit); });
      return cardId(trumpCards[0]);
    }
  }

  // Throw off lowest card
  var allCards = hand.slice().sort(function(a, b) { return plainPower(a) - plainPower(b); });
  // Avoid throwing away point cards if possible
  for (var i = 0; i < allCards.length; i++) {
    if (!isTrump(allCards[i], trumpSuit) && allCards[i].rank !== 'A' && allCards[i].rank !== '10' && allCards[i].rank !== 'K') {
      return cardId(allCards[i]);
    }
  }
  return cardId(allCards[0]);
}

module.exports = {
  aiBid: aiBid,
  aiPickTrump: aiPickTrump,
  aiDiscard: aiDiscard,
  aiPlayCard: aiPlayCard,
  evaluateHand: evaluateHand
};
