// ── AI Player for Setback ───────────────────────────────
// Three difficulties:
//   easy   — timid bidder, plays mostly random legal cards
//   medium — decent decisions but not perfect (the original AI)
//   hard   — bids accurately, strips trump, saves winners, dumps junk
//   expert — "Nanny": everything hard does, plus she counts every card
//            played, detects when you're out of trump, protects her low
//            trump for the Low point, and never feeds you her Jacks

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
function aiBid(hand, highBid, isDealer, allPassed, difficulty) {
  var eval_ = evaluateHand(hand);

  // If dealer and everyone passed, stuck with 3
  if (isDealer && allPassed) return 3;

  if (difficulty === 'easy') {
    // Timid: only bids 3 on a clearly good hand, and not always even then
    var bid = 0;
    if (eval_.estimatedPoints >= 4 && Math.random() < 0.5) bid = 3;
    if (bid <= highBid) bid = 0;
    return bid;
  }

  if (difficulty === 'hard') {
    // Bid what the hand is worth, minimally outbidding the opponent
    var worth = Math.floor(eval_.estimatedPoints);
    if (worth > 6) worth = 6;
    if (worth < 3) return 0;                 // hand not worth a bid
    if (worth <= highBid) return 0;          // can't profitably outbid
    var bid = Math.max(3, highBid + 1);      // bid just enough to win it
    return Math.min(bid, worth);
  }

  if (difficulty === 'expert') {
    // Count near-certain points in the best suit. In this variant the
    // Joker is both the highest trump and its own point, so it's worth 2.
    var best = eval_.bestSuit;
    var sure = 0;
    var trumpCount = 0, hasJoker = false, hasAce = false, hasJack = false, hasOffJack = false, hasDeuce = false;
    for (var i = 0; i < hand.length; i++) {
      var c = hand[i];
      if (c.rank === 'Joker') { hasJoker = true; trumpCount++; continue; }
      if (c.suit === best) {
        trumpCount++;
        if (c.rank === 'A') hasAce = true;
        if (c.rank === 'J') hasJack = true;
        if (c.rank === '2') hasDeuce = true;
      } else if (c.rank === 'J' && suitColor(c.suit) === suitColor(best)) {
        hasOffJack = true; trumpCount++;
      }
    }
    if (hasJoker) sure += 2;                       // High + Joker
    else if (hasAce) sure += 0.9;                  // High unless the Joker is out against us
    if (hasJack) sure += trumpCount >= 3 ? 0.8 : 0.5;
    if (hasOffJack) sure += trumpCount >= 3 ? 0.8 : 0.5;
    if (hasDeuce) sure += 0.6;                     // Low, if we can capture it ourselves
    if (trumpCount >= 4) sure += 1;                // trump control usually means Game
    else if (trumpCount >= 3) sure += 0.5;
    // Nanny bids aggressively: full value rounded up, never the minimum,
    // and with a big hand she goes straight for 6 — she loved 6 and out.
    var worth = Math.min(6, Math.ceil(sure));
    if (sure >= 4.5) worth = 6;
    if (worth < 3 || worth <= highBid) return 0;
    return worth;
  }

  // Medium (default): decide based on estimated points with some randomness
  var bid = 0;
  if (eval_.estimatedPoints >= 5) bid = 5;
  else if (eval_.estimatedPoints >= 4) bid = 4;
  else if (eval_.estimatedPoints >= 3) bid = 3;

  if (Math.random() < 0.15 && bid > 0) bid = Math.min(6, bid + 1); // aggressive sometimes
  if (Math.random() < 0.1 && bid > 3) bid = bid - 1; // cautious sometimes

  // Must beat current high bid
  if (bid <= highBid) bid = 0; // pass

  return bid;
}

// ── AI: Pick trump suit ─────────────────────────────────
function aiPickTrump(hand, difficulty) {
  var eval_ = evaluateHand(hand);
  if (difficulty === 'easy' && Math.random() < 0.25) {
    // Occasionally picks a suit on a whim
    var suitsInHand = [];
    for (var i = 0; i < hand.length; i++) {
      if (hand[i].rank !== 'Joker' && suitsInHand.indexOf(hand[i].suit) === -1) suitsInHand.push(hand[i].suit);
    }
    if (suitsInHand.length > 0) return suitsInHand[Math.floor(Math.random() * suitsInHand.length)];
  }
  return eval_.bestSuit || SUITS[Math.floor(Math.random() * SUITS.length)];
}

// ── AI: Pick cards to keep during discard ────────────────
function aiDiscard(hand, trumpSuit, isBidWinner, difficulty) {
  if (difficulty === 'easy') {
    // Keeps trump but fills the rest of the hand at random
    var trump = [], rest = [];
    for (var i = 0; i < hand.length; i++) {
      (isTrump(hand[i], trumpSuit) ? trump : rest).push(hand[i]);
    }
    rest.sort(function() { return Math.random() - 0.5; });
    var keep = trump.concat(rest).slice(0, 6);
    return keep.map(cardId);
  }

  // Medium & hard: score each card for how useful it is
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
function aiPlayCard(hand, trickPlays, trumpSuit, isLeading, difficulty, context) {
  if (hand.length === 0) return null;
  if (hand.length === 1) return cardId(hand[0]);

  // Separate trump and non-trump
  var trumpCards = [];
  var nonTrumpCards = [];
  for (var i = 0; i < hand.length; i++) {
    if (isTrump(hand[i], trumpSuit)) trumpCards.push(hand[i]);
    else nonTrumpCards.push(hand[i]);
  }

  if (difficulty === 'easy') {
    // Plays a random legal card
    if (isLeading) return cardId(hand[Math.floor(Math.random() * hand.length)]);
    var leadSuitEasy = effectiveSuit(trickPlays[0].card, trumpSuit);
    var followEasy = [];
    for (var i = 0; i < hand.length; i++) {
      if (effectiveSuit(hand[i], trumpSuit) === leadSuitEasy) followEasy.push(hand[i]);
    }
    var pool = followEasy.length > 0 ? followEasy : hand;
    return cardId(pool[Math.floor(Math.random() * pool.length)]);
  }

  if (difficulty === 'hard') {
    return aiPlayCardHard(hand, trickPlays, trumpSuit, isLeading, trumpCards, nonTrumpCards);
  }

  if (difficulty === 'expert') {
    return aiPlayCardExpert(hand, trickPlays, trumpSuit, isLeading, trumpCards, nonTrumpCards, context || {});
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

// ── Hard AI card play ───────────────────────────────────
function aiPlayCardHard(hand, trickPlays, trumpSuit, isLeading, trumpCards, nonTrumpCards) {
  var byTrumpAsc = function(a, b) { return trumpPower(a, trumpSuit) - trumpPower(b, trumpSuit); };
  var byPlainAsc = function(a, b) { return plainPower(a) - plainPower(b); };

  // Game-point value of a card (10s are the big prize)
  function gamePoints(card) {
    var r = card.rank;
    if (r === '10') return 10;
    if (r === 'A') return 4;
    if (r === 'K') return 3;
    if (r === 'Q') return 2;
    if (r === 'J') return 1;
    return 0;
  }

  if (isLeading) {
    trumpCards.sort(byTrumpAsc);
    nonTrumpCards.sort(byPlainAsc);

    // With a commanding trump (Joker/Ace) and depth, lead it to strip
    // the opponent's trump and protect our point cards
    if (trumpCards.length >= 2 && trumpPower(trumpCards[trumpCards.length - 1], trumpSuit) >= 13) {
      return cardId(trumpCards[trumpCards.length - 1]);
    }
    // Lead a boss side-suit card (ace) to bank game points
    if (nonTrumpCards.length > 0 && nonTrumpCards[nonTrumpCards.length - 1].rank === 'A') {
      return cardId(nonTrumpCards[nonTrumpCards.length - 1]);
    }
    // Lead low junk from a side suit; keep trump and point cards home
    if (nonTrumpCards.length > 0) {
      for (var i = 0; i < nonTrumpCards.length; i++) {
        if (gamePoints(nonTrumpCards[i]) === 0) return cardId(nonTrumpCards[i]);
      }
      return cardId(nonTrumpCards[0]);
    }
    // Only trump left: lead lowest to keep control cards
    return cardId(trumpCards[0]);
  }

  // Following
  var leadSuit = effectiveSuit(trickPlays[0].card, trumpSuit);
  var followCards = [];
  for (var i = 0; i < hand.length; i++) {
    if (effectiveSuit(hand[i], trumpSuit) === leadSuit) followCards.push(hand[i]);
  }

  // What's the trick worth in game points, and what power is winning?
  var trickValue = 0;
  var bestPower = -1;
  for (var i = 0; i < trickPlays.length; i++) {
    trickValue += gamePoints(trickPlays[i].card);
    var tp;
    if (isTrump(trickPlays[i].card, trumpSuit)) tp = 100 + trumpPower(trickPlays[i].card, trumpSuit);
    else if (effectiveSuit(trickPlays[i].card, trumpSuit) === leadSuit) tp = plainPower(trickPlays[i].card);
    else tp = -1;
    if (tp > bestPower) bestPower = tp;
  }

  if (followCards.length > 0) {
    var isTrumpLead = (leadSuit === trumpSuit);
    followCards.sort(isTrumpLead ? byTrumpAsc : byPlainAsc);
    var powerOf = function(c) {
      return isTrumpLead ? 100 + trumpPower(c, trumpSuit) : plainPower(c);
    };
    // Win with the cheapest card that wins
    for (var i = 0; i < followCards.length; i++) {
      if (powerOf(followCards[i]) > bestPower) return cardId(followCards[i]);
    }
    // Can't win — throw the lowest card that gives away the fewest game points
    var cheapest = followCards[0];
    for (var i = 0; i < followCards.length; i++) {
      if (gamePoints(followCards[i]) < gamePoints(cheapest)) cheapest = followCards[i];
    }
    return cardId(cheapest);
  }

  // Can't follow suit — trump whenever the trick carries game points
  if (trumpCards.length > 0 && trickValue >= 1) {
    trumpCards.sort(byTrumpAsc);
    for (var i = 0; i < trumpCards.length; i++) {
      if (100 + trumpPower(trumpCards[i], trumpSuit) > bestPower) return cardId(trumpCards[i]);
    }
  }

  // Throw off the most worthless non-trump card
  var throwables = nonTrumpCards.length > 0 ? nonTrumpCards.slice() : hand.slice();
  throwables.sort(byPlainAsc);
  var junk = throwables[0];
  for (var i = 0; i < throwables.length; i++) {
    if (gamePoints(throwables[i]) === 0) { junk = throwables[i]; break; }
  }
  return cardId(junk);
}

// ── Expert AI card play ("Nanny") ───────────────────────
// Builds on the hard AI with a memory of every card played this hand.
function aiPlayCardExpert(hand, trickPlays, trumpSuit, isLeading, trumpCards, nonTrumpCards, context) {
  var playedTricks = context.playedTricks || [];
  var myIndex = context.myIndex;

  var byTrumpAsc = function(a, b) { return trumpPower(a, trumpSuit) - trumpPower(b, trumpSuit); };
  var byPlainAsc = function(a, b) { return plainPower(a) - plainPower(b); };

  function gamePoints(card) {
    var r = card.rank;
    if (r === '10') return 10;
    if (r === 'A') return 4;
    if (r === 'K') return 3;
    if (r === 'Q') return 2;
    if (r === 'J') return 1;
    return 0;
  }

  // ── Memory: everything seen so far ──
  var played = [];
  var oppVoidTrump = false;
  var oppVoidSuit = {};
  for (var t = 0; t < playedTricks.length; t++) {
    var plays = playedTricks[t].plays;
    var leadES = effectiveSuit(plays[0].card, trumpSuit);
    for (var p = 0; p < plays.length; p++) {
      played.push(plays[p].card);
      if (plays[p].playerIndex !== myIndex) {
        var es = effectiveSuit(plays[p].card, trumpSuit);
        if (es !== leadES) {
          // Playing trump is always legal, so only a non-trump off-suit
          // card proves a void in the led suit. On a trump lead, any
          // non-trump card proves they're out of trump.
          if (leadES === trumpSuit) oppVoidTrump = true;
          else if (!isTrump(plays[p].card, trumpSuit)) oppVoidSuit[leadES] = true;
        }
      }
    }
  }
  for (var i = 0; i < trickPlays.length; i++) played.push(trickPlays[i].card);

  function seen(rank, suit) {
    for (var i = 0; i < played.length; i++) {
      if (played[i].rank === rank && played[i].suit === suit) return true;
    }
    for (var i = 0; i < hand.length; i++) {
      if (hand[i].rank === rank && hand[i].suit === suit) return true;
    }
    return false;
  }

  // All 15 trump: 13 of the suit, the off-jack, and the Joker
  function unseenTrumpPowers() {
    var out = [];
    if (!seen('Joker', 'joker')) out.push(14);
    for (var r = 0; r < RANKS.length; r++) {
      if (!seen(RANKS[r], trumpSuit)) out.push(trumpPower({ rank: RANKS[r], suit: trumpSuit }, trumpSuit));
    }
    for (var s = 0; s < SUITS.length; s++) {
      if (SUITS[s] !== trumpSuit && suitColor(SUITS[s]) === suitColor(trumpSuit) && !seen('J', SUITS[s])) {
        out.push(9); // off-jack
      }
    }
    return out;
  }
  var unseenTrump = unseenTrumpPowers();
  if (unseenTrump.length === 0) oppVoidTrump = true;

  // Is this side-suit card unbeatable by anything unseen in its suit?
  function isBossSideCard(c) {
    for (var r = RANKS.indexOf(c.rank) + 1; r < RANKS.length; r++) {
      if (RANKS[r] === 'J' && suitColor(c.suit) === suitColor(trumpSuit) && c.suit !== trumpSuit) continue; // that J is trump
      if (!seen(RANKS[r], c.suit)) return false;
    }
    return true;
  }

  // How much does losing this card to the opponent's trick hurt?
  function surrenderCost(c) {
    var cost = gamePoints(c);
    if (c.rank === 'J' && isTrump(c, trumpSuit)) cost += 8;      // Jack / Off-Jack point walks away
    if (isTrump(c, trumpSuit) && isMyLowestUnseenTrump(c)) cost += 5; // hands them the Low point
    return cost;
  }
  function isMyLowestUnseenTrump(c) {
    if (!isTrump(c, trumpSuit) || c.rank === 'Joker') return false;
    var myPower = trumpPower(c, trumpSuit);
    for (var i = 0; i < unseenTrump.length; i++) {
      if (unseenTrump[i] < myPower) return false;
    }
    return true;
  }

  trumpCards.sort(byTrumpAsc);
  nonTrumpCards.sort(byPlainAsc);

  if (isLeading) {
    // Opponent out of trump: bank the Low with our lowest trump, then
    // cash boss cards — nothing can stop any of it.
    if (oppVoidTrump) {
      if (trumpCards.length > 0) return cardId(trumpCards[0]);
      for (var i = nonTrumpCards.length - 1; i >= 0; i--) {
        if (isBossSideCard(nonTrumpCards[i])) return cardId(nonTrumpCards[i]);
      }
      return cardId(nonTrumpCards[nonTrumpCards.length - 1]);
    }
    // Holding the boss trump with depth: lead it to strip their trump
    if (trumpCards.length >= 2) {
      var top = trumpCards[trumpCards.length - 1];
      var topPower = trumpPower(top, trumpSuit);
      var beatsAllUnseen = true;
      for (var i = 0; i < unseenTrump.length; i++) {
        if (unseenTrump[i] > topPower) { beatsAllUnseen = false; break; }
      }
      if (beatsAllUnseen) return cardId(top);
    }
    // Cash a boss side card in a suit they can still follow
    for (var i = nonTrumpCards.length - 1; i >= 0; i--) {
      var c = nonTrumpCards[i];
      if (isBossSideCard(c) && !oppVoidSuit[c.suit]) return cardId(c);
    }
    // Lead junk, preferring cards that cost nothing if captured
    if (nonTrumpCards.length > 0) {
      var junk = nonTrumpCards[0];
      for (var i = 0; i < nonTrumpCards.length; i++) {
        if (surrenderCost(nonTrumpCards[i]) < surrenderCost(junk)) junk = nonTrumpCards[i];
      }
      return cardId(junk);
    }
    // Only trump left and none are boss: lead our highest to fight for
    // control, never the one that would be the Low
    for (var i = trumpCards.length - 1; i >= 0; i--) {
      if (!isMyLowestUnseenTrump(trumpCards[i]) || i === 0) return cardId(trumpCards[i]);
    }
    return cardId(trumpCards[trumpCards.length - 1]);
  }

  // ── Following ──
  var leadSuit = effectiveSuit(trickPlays[0].card, trumpSuit);
  var followCards = [];
  for (var i = 0; i < hand.length; i++) {
    if (effectiveSuit(hand[i], trumpSuit) === leadSuit) followCards.push(hand[i]);
  }

  var trickValue = 0;
  var bestPower = -1;
  for (var i = 0; i < trickPlays.length; i++) {
    trickValue += gamePoints(trickPlays[i].card);
    var tp;
    if (isTrump(trickPlays[i].card, trumpSuit)) tp = 100 + trumpPower(trickPlays[i].card, trumpSuit);
    else if (effectiveSuit(trickPlays[i].card, trumpSuit) === leadSuit) tp = plainPower(trickPlays[i].card);
    else tp = -1;
    if (tp > bestPower) bestPower = tp;
  }

  if (followCards.length > 0) {
    var isTrumpLead = (leadSuit === trumpSuit);
    followCards.sort(isTrumpLead ? byTrumpAsc : byPlainAsc);
    var powerOf = function(c) {
      return isTrumpLead ? 100 + trumpPower(c, trumpSuit) : plainPower(c);
    };
    // Win with the cheapest winner
    for (var i = 0; i < followCards.length; i++) {
      if (powerOf(followCards[i]) > bestPower) return cardId(followCards[i]);
    }
    // Forced to lose: surrender the card that costs the least
    var cheapest = followCards[0];
    for (var i = 0; i < followCards.length; i++) {
      if (surrenderCost(followCards[i]) < surrenderCost(cheapest)) cheapest = followCards[i];
    }
    return cardId(cheapest);
  }

  // Can't follow suit. If our lowest trump can take the trick outright
  // (no trump in it yet), grab it — that locks up the Low point.
  if (trumpCards.length > 0 && bestPower < 100) {
    if (isMyLowestUnseenTrump(trumpCards[0])) return cardId(trumpCards[0]);
  }
  // Trump whenever the trick carries game points
  if (trumpCards.length > 0 && trickValue >= 1) {
    for (var i = 0; i < trumpCards.length; i++) {
      if (100 + trumpPower(trumpCards[i], trumpSuit) > bestPower) return cardId(trumpCards[i]);
    }
  }
  // Sluff the cheapest surrender
  var throwables = nonTrumpCards.length > 0 ? nonTrumpCards : trumpCards;
  var junk = throwables[0];
  for (var i = 0; i < throwables.length; i++) {
    if (surrenderCost(throwables[i]) < surrenderCost(junk)) junk = throwables[i];
  }
  return cardId(junk);
}

module.exports = {
  aiBid: aiBid,
  aiPickTrump: aiPickTrump,
  aiDiscard: aiDiscard,
  aiPlayCard: aiPlayCard,
  evaluateHand: evaluateHand
};
