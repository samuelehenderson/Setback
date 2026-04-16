const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const ai = require('./ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, 'public')));

// ── Card constants ─────────────────────────────────────────
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const GAME_VALUES = { 'A': 4, 'K': 3, 'Q': 2, 'J': 1, '10': 10 };

function suitColor(suit) {
  return (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
}

function createDeck() {
  var deck = [];
  for (var s = 0; s < SUITS.length; s++) {
    for (var r = 0; r < RANKS.length; r++) {
      deck.push({ rank: RANKS[r], suit: SUITS[s] });
    }
  }
  deck.push({ rank: 'Joker', suit: 'joker' });
  return deck;
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function cardId(card) {
  return card.rank + '_' + card.suit;
}

// ── Trump power ──────────────────────────────────────────
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

function plainPower(card) {
  return RANKS.indexOf(card.rank);
}

function isTrump(card, trumpSuit) {
  if (card.rank === 'Joker') return true;
  if (card.suit === trumpSuit) return true;
  if (card.rank === 'J' && suitColor(card.suit) === suitColor(trumpSuit) && card.suit !== trumpSuit) return true;
  return false;
}

function effectiveSuit(card, trumpSuit) {
  if (isTrump(card, trumpSuit)) return trumpSuit;
  return card.suit;
}

// ── Trick winner ─────────────────────────────────────────
function trickWinner(plays, trumpSuit) {
  var leadSuit = effectiveSuit(plays[0].card, trumpSuit);
  var best = 0;

  for (var i = 1; i < plays.length; i++) {
    var card = plays[i].card;
    var bestCard = plays[best].card;
    var cardIsT = isTrump(card, trumpSuit);
    var bestIsT = isTrump(bestCard, trumpSuit);

    if (cardIsT && bestIsT) {
      if (trumpPower(card, trumpSuit) > trumpPower(bestCard, trumpSuit)) best = i;
    } else if (cardIsT && !bestIsT) {
      best = i;
    } else if (!cardIsT && !bestIsT) {
      var cardSuit = effectiveSuit(card, trumpSuit);
      var bestSuit = effectiveSuit(bestCard, trumpSuit);
      if (cardSuit === leadSuit && bestSuit === leadSuit) {
        if (plainPower(card) > plainPower(bestCard)) best = i;
      } else if (cardSuit === leadSuit) {
        best = i;
      }
    }
  }
  return plays[best].playerIndex;
}

// ── Can play card? ───────────────────────────────────────
function canPlay(card, hand, leadSuit, trumpSuit) {
  // Leading the trick — can play anything
  if (!leadSuit) return true;

  var cardEffSuit = effectiveSuit(card, trumpSuit);

  // Check if player has ANY card that follows lead suit (excluding the card being played)
  var hasLeadSuit = false;
  for (var i = 0; i < hand.length; i++) {
    if (cardId(hand[i]) === cardId(card)) continue; // skip the card being checked
    if (effectiveSuit(hand[i], trumpSuit) === leadSuit) {
      hasLeadSuit = true;
      break;
    }
  }

  // Also check if the card itself follows lead
  var cardFollowsLead = (cardEffSuit === leadSuit);

  // If player has lead suit cards (other than this one), they must play lead suit or trump
  if (hasLeadSuit) {
    return cardFollowsLead || isTrump(card, trumpSuit);
  }

  // Player has no lead suit — they can play anything (trump, off-suit, whatever)
  return true;
}

// Detailed validation info for debugging
function explainPlay(card, hand, leadSuit, trumpSuit) {
  var cardEffSuit = effectiveSuit(card, trumpSuit);
  var hasLead = false;
  var hasTrump = false;
  for (var i = 0; i < hand.length; i++) {
    if (effectiveSuit(hand[i], trumpSuit) === leadSuit) hasLead = true;
    if (isTrump(hand[i], trumpSuit)) hasTrump = true;
  }
  return 'Card: ' + card.rank + ' of ' + card.suit +
    ' | CardEffSuit: ' + cardEffSuit +
    ' | LeadSuit: ' + leadSuit +
    ' | Trump: ' + trumpSuit +
    ' | HasLead: ' + hasLead +
    ' | HasTrump: ' + hasTrump +
    ' | HandSize: ' + hand.length;
}

// ── Score a hand ─────────────────────────────────────────
function scoreHand(tricksTaken, trumpSuit, bidder, bidAmount, numPlayers) {
  var numTeams = numPlayers === 4 ? 2 : numPlayers;
  var points = {};
  for (var t = 0; t < numTeams; t++) points[t] = 0;

  // Track who got each specific point
  var breakdown = {
    high: { team: -1, card: null },
    low: { team: -1, card: null },
    jack: { team: -1, card: null },
    offJack: { team: -1, card: null },
    joker: { team: -1, card: null },
    game: { team: -1, points: {} }
  };

  var allTrumpPlayed = [];
  for (var team = 0; team < numTeams; team++) {
    var cards = tricksTaken[team] || [];
    for (var c = 0; c < cards.length; c++) {
      if (isTrump(cards[c], trumpSuit)) {
        allTrumpPlayed.push({ card: cards[c], team: team });
      }
    }
  }

  // HIGH
  var highCard = null, highTeam = -1;
  for (var i = 0; i < allTrumpPlayed.length; i++) {
    var tp = trumpPower(allTrumpPlayed[i].card, trumpSuit);
    if (!highCard || tp > trumpPower(highCard, trumpSuit)) {
      highCard = allTrumpPlayed[i].card;
      highTeam = allTrumpPlayed[i].team;
    }
  }
  if (highTeam >= 0) {
    points[highTeam]++;
    breakdown.high = { team: highTeam, card: highCard };
  }

  // LOW (skip joker)
  var lowCard = null, lowTeam = -1;
  for (var i = 0; i < allTrumpPlayed.length; i++) {
    if (allTrumpPlayed[i].card.rank === 'Joker') continue;
    var tp = trumpPower(allTrumpPlayed[i].card, trumpSuit);
    if (!lowCard || tp < trumpPower(lowCard, trumpSuit)) {
      lowCard = allTrumpPlayed[i].card;
      lowTeam = allTrumpPlayed[i].team;
    }
  }
  if (lowTeam >= 0) {
    points[lowTeam]++;
    breakdown.low = { team: lowTeam, card: lowCard };
  }

  // JACK
  for (var i = 0; i < allTrumpPlayed.length; i++) {
    if (allTrumpPlayed[i].card.rank === 'J' && allTrumpPlayed[i].card.suit === trumpSuit) {
      points[allTrumpPlayed[i].team]++;
      breakdown.jack = { team: allTrumpPlayed[i].team, card: allTrumpPlayed[i].card };
      break;
    }
  }

  // OFF JACK
  for (var i = 0; i < allTrumpPlayed.length; i++) {
    var c = allTrumpPlayed[i].card;
    if (c.rank === 'J' && c.suit !== trumpSuit && suitColor(c.suit) === suitColor(trumpSuit)) {
      points[allTrumpPlayed[i].team]++;
      breakdown.offJack = { team: allTrumpPlayed[i].team, card: c };
      break;
    }
  }

  // JOKER
  for (var i = 0; i < allTrumpPlayed.length; i++) {
    if (allTrumpPlayed[i].card.rank === 'Joker') {
      points[allTrumpPlayed[i].team]++;
      breakdown.joker = { team: allTrumpPlayed[i].team, card: allTrumpPlayed[i].card };
      break;
    }
  }

  // GAME
  var gamePoints = {};
  for (var t = 0; t < numTeams; t++) gamePoints[t] = 0;
  for (var team = 0; team < numTeams; team++) {
    var cards = tricksTaken[team] || [];
    for (var c = 0; c < cards.length; c++) {
      gamePoints[team] += (GAME_VALUES[cards[c].rank] || 0);
    }
  }
  var maxGame = -1, gameWinner = -1, gameTied = false;
  for (var t = 0; t < numTeams; t++) {
    if (gamePoints[t] > maxGame) { maxGame = gamePoints[t]; gameWinner = t; gameTied = false; }
    else if (gamePoints[t] === maxGame) { gameTied = true; }
  }
  var gameAwardedTo = -1;
  if (gameTied) {
    // Tie: no one gets game point (standard rule)
    gameAwardedTo = -1;
  } else if (gameWinner >= 0) {
    points[gameWinner]++;
    gameAwardedTo = gameWinner;
  }
  breakdown.game = { team: gameAwardedTo, points: gamePoints, tied: gameTied };

  return { points: points, gamePoints: gamePoints, breakdown: breakdown };
}

// ── Room code ────────────────────────────────────────────
function generateRoomCode() {
  var words = ['ACE','BET','CUT','DEAL','FOLD','HAND','JACK','KING','PAIR','SUIT',
    'WILD','DRAW','PLAY','TRUMP','HIGH','CLUB','CHIP','ANTE','CALL','PASS'];
  var a = words[Math.floor(Math.random() * words.length)];
  var b = words[Math.floor(Math.random() * words.length)];
  return a + '-' + b;
}

// ── Rooms ────────────────────────────────────────────────
var rooms = {};

io.on('connection', function(socket) {
  console.log('Connected: ' + socket.id);

  socket.on('create-room', function(data, cb) {
    var code = generateRoomCode();
    while (rooms[code]) code = generateRoomCode();
    var maxPlayers = parseInt(data.maxPlayers) || 2;
    var vsComputer = data.vsComputer || false;

    rooms[code] = {
      code: code,
      maxPlayers: maxPlayers,
      vsComputer: vsComputer,
      players: [{ id: socket.id, name: data.name || 'Player 1' }],
      scores: maxPlayers === 4 ? { 0: 0, 1: 0 } : {},
      phase: 'waiting',
      dealer: 0,
      currentBidder: -1,
      bids: {},
      highBid: 0,
      highBidder: -1,
      trumpSuit: null,
      hands: {},
      kitty: [],
      remainingDeck: [],
      trickPlays: [],
      trickLeader: -1,
      currentPlayer: -1,
      tricksWon: {},
      discardsDone: {},
      deadPile: []
    };

    // If vs computer, add AI player immediately
    if (vsComputer) {
      rooms[code].players.push({ id: 'AI_PLAYER', name: '🤖 Computer', isAI: true });
      if (maxPlayers === 2) rooms[code].scores = { 0: 0, 1: 0 };
    }

    socket.join(code);
    cb({ success: true, code: code, vsComputer: vsComputer });
    console.log('Room ' + code + ' created (' + maxPlayers + 'p' + (vsComputer ? ', vs CPU' : '') + ') by ' + data.name);
  });

  socket.on('join-room', function(data, cb) {
    var code = data.code.toUpperCase();
    var room = rooms[code];
    if (!room) return cb({ success: false, error: 'Room not found!' });
    if (room.players.length >= room.maxPlayers) return cb({ success: false, error: 'Room is full!' });
    if (room.phase !== 'waiting') return cb({ success: false, error: 'Game in progress!' });

    room.players.push({ id: socket.id, name: data.name || ('Player ' + (room.players.length + 1)) });
    socket.join(code);
    cb({ success: true, code: code, playerIndex: room.players.length - 1 });

    if (room.maxPlayers === 2 && room.players.length === 2) {
      room.scores = { 0: 0, 1: 0 };
    }

    io.to(code).emit('lobby-update', {
      players: room.players.map(function(p) { return p.name; }),
      maxPlayers: room.maxPlayers
    });
    console.log(data.name + ' joined ' + code);
  });

  socket.on('start-game', function(data) {
    var room = rooms[data.code];
    if (!room || room.players.length < room.maxPlayers) return;
    console.log('Starting game in ' + data.code);
    startNewHand(room);
  });

  // ── Bidding ──────────────────────────────
  socket.on('place-bid', function(data) {
    var room = rooms[data.code];
    if (!room || room.phase !== 'bidding') return;
    var pIdx = room.players.findIndex(function(p) { return p.id === socket.id; });
    if (pIdx !== room.currentBidder) return;

    var bid = parseInt(data.bid);
    if (bid !== 0) {
      if (bid < 3 || bid > 6) return;
      if (bid <= room.highBid) return;
      room.bids[pIdx] = bid;
      room.highBid = bid;
      room.highBidder = pIdx;
      console.log(room.players[pIdx].name + ' bids ' + bid);
    } else {
      room.bids[pIdx] = 0;
      console.log(room.players[pIdx].name + ' passes');
    }

    io.to(data.code).emit('bid-placed', {
      player: pIdx,
      playerName: room.players[pIdx].name,
      bid: bid
    });
    advanceBidding(room);
  });

  // ── Trump selection ──────────────────────
  socket.on('select-trump', function(data) {
    var room = rooms[data.code];
    if (!room || room.phase !== 'select-trump') return;
    var pIdx = room.players.findIndex(function(p) { return p.id === socket.id; });
    if (pIdx !== room.highBidder) return;
    if (SUITS.indexOf(data.suit) === -1) return;

    room.trumpSuit = data.suit;
    console.log('Trump is ' + data.suit + ' in room ' + data.code);

    // Start discard phase (kitty already given at trump selection start)
    room.phase = 'discarding';
    room.discardsDone = {};

    console.log(room.players[pIdx].name + ' now has ' + room.hands[pIdx].length + ' cards. Must discard to 6.');

    // Tell bid winner to discard down to 6
    io.to(room.players[pIdx].id).emit('discard-phase', {
      hand: room.hands[pIdx],
      trumpSuit: room.trumpSuit,
      mustKeep: 6,
      isBidWinner: true,
      message: 'Now discard down to 6 cards.'
    });

    // Tell other players to wait
    for (var p = 0; p < room.maxPlayers; p++) {
      if (p !== pIdx) {
        io.to(room.players[p].id).emit('wait-discard', {
          message: room.players[pIdx].name + ' is picking cards to keep...',
          trumpSuit: room.trumpSuit
        });
      }
    }
  });

  // ── Discard submission (bid winner) ──────
  socket.on('submit-discards', function(data) {
    var room = rooms[data.code];
    if (!room || room.phase !== 'discarding') return;
    var pIdx = room.players.findIndex(function(p) { return p.id === socket.id; });

    var keepIds = data.keepCardIds || [];

    // Bid winner can keep 0-6 cards from their 12, drawing the rest
    if (keepIds.length > 6) {
      socket.emit('discard-error', { message: 'You can only keep up to 6 cards!' });
      return;
    }

    // Build new hand from kept cards
    var newHand = [];
    for (var i = 0; i < keepIds.length; i++) {
      for (var j = 0; j < room.hands[pIdx].length; j++) {
        if (cardId(room.hands[pIdx][j]) === keepIds[i]) {
          newHand.push(room.hands[pIdx][j]);
          break;
        }
      }
    }

    // Discarded cards go into the dead pile (not back into the deck)
    if (!room.deadPile) room.deadPile = [];
    for (var j = 0; j < room.hands[pIdx].length; j++) {
      var wasKept = false;
      for (var k = 0; k < newHand.length; k++) {
        if (cardId(newHand[k]) === cardId(room.hands[pIdx][j])) { wasKept = true; break; }
      }
      if (!wasKept) {
        room.deadPile.push(room.hands[pIdx][j]);
      }
    }

    // Draw from remaining deck to fill to 6
    var cardsNeeded = 6 - newHand.length;
    for (var d = 0; d < cardsNeeded; d++) {
      // If deck is empty, reshuffle dead pile into deck
      if (room.remainingDeck.length === 0 && room.deadPile.length > 0) {
        console.log('Deck ran out, reshuffling dead pile (' + room.deadPile.length + ' cards)');
        room.remainingDeck = shuffle(room.deadPile);
        room.deadPile = [];
      }
      if (room.remainingDeck.length === 0) break;
      newHand.push(room.remainingDeck.pop());
    }

    room.hands[pIdx] = newHand;
    room.discardsDone[pIdx] = true;

    console.log(room.players[pIdx].name + ' (bid winner) kept ' + keepIds.length + ', drew ' + cardsNeeded + ', now has ' + newHand.length + ' | deck: ' + room.remainingDeck.length + ' | dead: ' + room.deadPile.length);

    // Check if bid winner just finished — let other players discard next
    if (pIdx === room.highBidder) {
      startOtherPlayersDiscard(room);
    } else {
      checkAllDiscardsDone(room);
    }
  });

  // ── Other player discard (auto or manual) ─
  socket.on('submit-other-discards', function(data) {
    var room = rooms[data.code];
    if (!room || room.phase !== 'discarding') return;
    var pIdx = room.players.findIndex(function(p) { return p.id === socket.id; });
    if (pIdx === room.highBidder) return; // bid winner uses different flow

    var keepIds = data.keepCardIds || [];

    // Build kept cards
    var keptCards = [];
    for (var i = 0; i < keepIds.length; i++) {
      for (var j = 0; j < room.hands[pIdx].length; j++) {
        if (cardId(room.hands[pIdx][j]) === keepIds[i]) {
          keptCards.push(room.hands[pIdx][j]);
          break;
        }
      }
    }

    // Discarded cards go to dead pile
    if (!room.deadPile) room.deadPile = [];
    for (var j = 0; j < room.hands[pIdx].length; j++) {
      var wasKept = false;
      for (var k = 0; k < keptCards.length; k++) {
        if (cardId(keptCards[k]) === cardId(room.hands[pIdx][j])) { wasKept = true; break; }
      }
      if (!wasKept) {
        room.deadPile.push(room.hands[pIdx][j]);
      }
    }

    // Draw from remaining deck to fill to 6
    var cardsNeeded = 6 - keptCards.length;
    for (var d = 0; d < cardsNeeded; d++) {
      // If deck is empty, reshuffle dead pile into deck
      if (room.remainingDeck.length === 0 && room.deadPile.length > 0) {
        console.log('Deck ran out, reshuffling dead pile (' + room.deadPile.length + ' cards)');
        room.remainingDeck = shuffle(room.deadPile);
        room.deadPile = [];
      }
      if (room.remainingDeck.length === 0) break;
      keptCards.push(room.remainingDeck.pop());
    }

    room.hands[pIdx] = keptCards;
    room.discardsDone[pIdx] = true;

    console.log(room.players[pIdx].name + ' kept ' + keepIds.length + ', drew ' + cardsNeeded + ', now has ' + keptCards.length + ' | deck: ' + room.remainingDeck.length + ' | dead: ' + room.deadPile.length);

    checkAllDiscardsDone(room);
  });

  // ── Play card ────────────────────────────
  socket.on('play-card', function(data) {
    var room = rooms[data.code];
    if (!room || room.phase !== 'playing') return;
    var pIdx = room.players.findIndex(function(p) { return p.id === socket.id; });
    if (pIdx !== room.currentPlayer) return;

    var hand = room.hands[pIdx];
    var cardIndex = -1;
    for (var i = 0; i < hand.length; i++) {
      if (cardId(hand[i]) === data.cardId) { cardIndex = i; break; }
    }
    if (cardIndex === -1) return;

    var card = hand[cardIndex];
    var leadSuit = room.trickPlays.length > 0 ? effectiveSuit(room.trickPlays[0].card, room.trumpSuit) : null;
    if (!canPlay(card, hand, leadSuit, room.trumpSuit)) {
      var info = explainPlay(card, hand, leadSuit, room.trumpSuit);
      console.log('INVALID PLAY: ' + info);
      socket.emit('invalid-play', { message: 'Must follow lead suit (' + leadSuit + ') if you have it, or play trump (' + room.trumpSuit + ').' });
      return;
    }

    hand.splice(cardIndex, 1);
    room.trickPlays.push({ playerIndex: pIdx, card: card });
    console.log(room.players[pIdx].name + ' plays ' + card.rank + ' of ' + card.suit);

    io.to(data.code).emit('card-played', {
      player: pIdx,
      playerName: room.players[pIdx].name,
      card: card
    });

    if (room.trickPlays.length === room.maxPlayers) {
      var winner = trickWinner(room.trickPlays, room.trumpSuit);
      var winnerTeam = room.maxPlayers === 4 ? (winner % 2) : winner;

      if (!room.tricksWon[winnerTeam]) room.tricksWon[winnerTeam] = [];
      for (var i = 0; i < room.trickPlays.length; i++) {
        room.tricksWon[winnerTeam].push(room.trickPlays[i].card);
      }

      console.log(room.players[winner].name + ' wins trick');

      io.to(data.code).emit('trick-result', {
        winner: winner,
        winnerName: room.players[winner].name,
        winnerTeam: winnerTeam,
        cards: room.trickPlays.map(function(p) { return { player: p.playerIndex, card: p.card }; })
      });

      var handOver = true;
      for (var p = 0; p < room.maxPlayers; p++) {
        if (room.hands[p] && room.hands[p].length > 0) { handOver = false; break; }
      }

      if (handOver) {
        setTimeout(function() { scoreAndReport(room); }, 2000);
      } else {
        room.trickPlays = [];
        room.trickLeader = winner;
        room.currentPlayer = winner;
        setTimeout(function() {
          broadcastGameState(room);
          handleAIPlayCard(room);
        }, 2000);
      }
    } else {
      room.currentPlayer = (room.currentPlayer + 1) % room.maxPlayers;
      broadcastGameState(room);
      handleAIPlayCard(room);
    }
  });

  socket.on('next-hand', function(data) {
    var room = rooms[data.code];
    if (!room) return;
    startNewHand(room);
  });

  socket.on('disconnect', function() {
    console.log('Disconnected: ' + socket.id);
    for (var code in rooms) {
      var room = rooms[code];
      var idx = room.players.findIndex(function(p) { return p.id === socket.id; });
      if (idx !== -1) {
        var name = room.players[idx].name;
        io.to(code).emit('player-left', { name: name });
        if (room.phase === 'waiting') {
          room.players.splice(idx, 1);
          if (room.players.length === 0) delete rooms[code];
        }
      }
    }
  });
});

// ── AI helper: check if it's AI's turn and act ──────────
function isAIPlayer(room, playerIndex) {
  return room.vsComputer && room.players[playerIndex] && room.players[playerIndex].isAI;
}

function handleAIBid(room) {
  if (!room.vsComputer) return;
  var aiIdx = room.currentBidder;
  if (!isAIPlayer(room, aiIdx)) return;

  setTimeout(function() {
    var hand = room.hands[aiIdx];
    var isDealer = (aiIdx === room.dealer);
    var allPassed = room.highBid === 0;
    var bid = ai.aiBid(hand, room.highBid, isDealer, allPassed);

    if (bid > 0) {
      room.bids[aiIdx] = bid;
      room.highBid = bid;
      room.highBidder = aiIdx;
      console.log('AI bids ' + bid);
    } else {
      room.bids[aiIdx] = 0;
      console.log('AI passes');
    }

    io.to(room.code).emit('bid-placed', {
      player: aiIdx,
      playerName: room.players[aiIdx].name,
      bid: bid
    });

    advanceBidding(room);
  }, 1200);
}

function handleAITrumpSelection(room) {
  if (!room.vsComputer) return;
  if (!isAIPlayer(room, room.highBidder)) return;

  setTimeout(function() {
    var suit = ai.aiPickTrump(room.hands[room.highBidder]);
    room.trumpSuit = suit;
    console.log('AI picks trump: ' + suit);

    room.phase = 'discarding';
    room.discardsDone = {};

    // AI discards
    handleAIDiscard(room, room.highBidder, true);
  }, 1500);
}

function handleAIDiscard(room, pIdx, isBidWinner) {
  if (!isAIPlayer(room, pIdx)) return;

  setTimeout(function() {
    var hand = room.hands[pIdx];
    var keepIds = ai.aiDiscard(hand, room.trumpSuit, isBidWinner);

    var newHand = [];
    for (var i = 0; i < keepIds.length; i++) {
      for (var j = 0; j < hand.length; j++) {
        if (cardId(hand[j]) === keepIds[i]) {
          newHand.push(hand[j]);
          break;
        }
      }
    }

    if (!room.deadPile) room.deadPile = [];
    for (var j = 0; j < hand.length; j++) {
      var wasKept = false;
      for (var k = 0; k < newHand.length; k++) {
        if (cardId(newHand[k]) === cardId(hand[j])) { wasKept = true; break; }
      }
      if (!wasKept) room.deadPile.push(hand[j]);
    }

    var cardsNeeded = 6 - newHand.length;
    for (var d = 0; d < cardsNeeded; d++) {
      if (room.remainingDeck.length === 0 && room.deadPile.length > 0) {
        room.remainingDeck = shuffle(room.deadPile);
        room.deadPile = [];
      }
      if (room.remainingDeck.length === 0) break;
      newHand.push(room.remainingDeck.pop());
    }

    room.hands[pIdx] = newHand;
    room.discardsDone[pIdx] = true;
    console.log('AI kept ' + keepIds.length + ', drew ' + cardsNeeded);

    if (isBidWinner) {
      startOtherPlayersDiscard(room);
    } else {
      checkAllDiscardsDone(room);
    }
  }, 1000);
}

function handleAIPlayCard(room) {
  if (!room.vsComputer) return;
  var pIdx = room.currentPlayer;
  if (!isAIPlayer(room, pIdx)) return;

  setTimeout(function() {
    var hand = room.hands[pIdx];
    var isLeading = (room.trickPlays.length === 0);
    var chosenId = ai.aiPlayCard(hand, room.trickPlays, room.trumpSuit, isLeading);

    if (!chosenId && hand.length > 0) chosenId = cardId(hand[0]);
    if (!chosenId) return;

    var cardIndex = -1;
    for (var i = 0; i < hand.length; i++) {
      if (cardId(hand[i]) === chosenId) { cardIndex = i; break; }
    }
    if (cardIndex === -1) cardIndex = 0;

    var card = hand[cardIndex];
    hand.splice(cardIndex, 1);
    room.trickPlays.push({ playerIndex: pIdx, card: card });
    console.log('AI plays ' + card.rank + ' of ' + card.suit);

    io.to(room.code).emit('card-played', {
      player: pIdx,
      playerName: room.players[pIdx].name,
      card: card
    });

    if (room.trickPlays.length === room.maxPlayers) {
      var winner = trickWinner(room.trickPlays, room.trumpSuit);
      var winnerTeam = room.maxPlayers === 4 ? (winner % 2) : winner;
      if (!room.tricksWon[winnerTeam]) room.tricksWon[winnerTeam] = [];
      for (var i = 0; i < room.trickPlays.length; i++) {
        room.tricksWon[winnerTeam].push(room.trickPlays[i].card);
      }

      io.to(room.code).emit('trick-result', {
        winner: winner,
        winnerName: room.players[winner].name,
        winnerTeam: winnerTeam,
        cards: room.trickPlays.map(function(p) { return { player: p.playerIndex, card: p.card }; })
      });

      var handOver = true;
      for (var p = 0; p < room.maxPlayers; p++) {
        if (room.hands[p] && room.hands[p].length > 0) { handOver = false; break; }
      }

      if (handOver) {
        setTimeout(function() { scoreAndReport(room); }, 2000);
      } else {
        room.trickPlays = [];
        room.trickLeader = winner;
        room.currentPlayer = winner;
        setTimeout(function() {
          broadcastGameState(room);
          handleAIPlayCard(room);
        }, 2000);
      }
    } else {
      room.currentPlayer = (room.currentPlayer + 1) % room.maxPlayers;
      broadcastGameState(room);
      handleAIPlayCard(room);
    }
  }, 1200);
}
function startNewHand(room) {
  var deck = shuffle(createDeck());

  // Deal 6 cards to each player
  room.hands = {};
  for (var p = 0; p < room.maxPlayers; p++) {
    room.hands[p] = deck.splice(0, 6);
  }

  // Deal 6 to kitty (middle pile)
  room.kitty = deck.splice(0, 6);

  // Keep remaining cards for other players to draw from
  room.remainingDeck = deck;
  room.deadPile = []; // Discards go here; reshuffled into deck only if deck empties

  room.phase = 'bidding';
  room.bids = {};
  room.highBid = 0;
  room.highBidder = -1;
  room.trumpSuit = null;
  room.trickPlays = [];
  room.tricksWon = {};
  room.discardsDone = {};

  room.currentBidder = (room.dealer + 1) % room.maxPlayers;

  console.log('Dealt hand. Dealer: ' + room.players[room.dealer].name +
    ', kitty: ' + room.kitty.length + ' cards, remaining deck: ' + room.remainingDeck.length);

  for (var p = 0; p < room.maxPlayers; p++) {
    io.to(room.players[p].id).emit('new-hand', {
      hand: room.hands[p],
      dealer: room.dealer,
      dealerName: room.players[room.dealer].name,
      currentBidder: room.currentBidder,
      playerIndex: p,
      players: room.players.map(function(pl) { return pl.name; }),
      scores: room.scores,
      maxPlayers: room.maxPlayers,
      kittySize: room.kitty.length
    });
  }

  // If AI is first bidder, trigger AI bid
  handleAIBid(room);
}
function advanceBidding(room) {
  var next = (room.currentBidder + 1) % room.maxPlayers;
  var checked = 0;

  while (checked < room.maxPlayers) {
    if (room.bids[next] === undefined) {
      var everyoneElseBid = true;
      for (var p = 0; p < room.maxPlayers; p++) {
        if (p !== next && room.bids[p] === undefined) {
          everyoneElseBid = false;
          break;
        }
      }

      room.currentBidder = next;

      if (next === room.dealer && everyoneElseBid && room.highBid === 0) {
        // Dealer is stuck — must bid at least 3
        // If AI dealer, auto-bid 3
        if (isAIPlayer(room, next)) {
          room.bids[next] = 3;
          room.highBid = 3;
          room.highBidder = next;
          io.to(room.code).emit('bid-placed', {
            player: next,
            playerName: room.players[next].name,
            bid: 3,
            forced: true
          });
          console.log(room.players[next].name + ' (AI) forced to bid 3 (dealer stuck)');
          startTrumpSelection(room);
          return;
        }

        // Human dealer: show bid controls with forced minimum of 3 (no pass option)
        io.to(room.code).emit('bidding-turn', {
          currentBidder: next,
          highBid: 0,
          highBidder: -1,
          highBidderName: null,
          dealerStuck: true
        });
        return;
      }

      io.to(room.code).emit('bidding-turn', {
        currentBidder: next,
        highBid: room.highBid,
        highBidder: room.highBidder,
        highBidderName: room.highBidder >= 0 ? room.players[room.highBidder].name : null
      });
      // If AI is next bidder, trigger AI bid
      handleAIBid(room);
      return;
    }
    next = (next + 1) % room.maxPlayers;
    checked++;
  }

  if (room.highBidder >= 0) {
    startTrumpSelection(room);
  }
}

function startTrumpSelection(room) {
  room.phase = 'select-trump';

  // Give the kitty to the bid winner BEFORE they pick trump
  room.hands[room.highBidder] = room.hands[room.highBidder].concat(room.kitty);
  room.kitty = [];

  console.log(room.players[room.highBidder].name + ' got kitty, now has ' + room.hands[room.highBidder].length + ' cards. Picking trump...');

  io.to(room.players[room.highBidder].id).emit('select-trump', {
    bid: room.highBid,
    hand: room.hands[room.highBidder]
  });
  for (var p = 0; p < room.maxPlayers; p++) {
    if (p !== room.highBidder) {
      io.to(room.players[p].id).emit('waiting-for-trump', {
        bidder: room.highBidder,
        bidderName: room.players[room.highBidder].name,
        bid: room.highBid
      });
    }
  }

  // If AI won the bid, handle trump selection
  handleAITrumpSelection(room);
}

// ── After bid winner discards, let other players discard & draw ──
function startOtherPlayersDiscard(room) {
  for (var p = 0; p < room.maxPlayers; p++) {
    if (p === room.highBidder) continue;

    // If AI, handle automatically
    if (isAIPlayer(room, p)) {
      handleAIDiscard(room, p, false);
      continue;
    }

    // Send their hand and let them choose which trump to keep
    io.to(room.players[p].id).emit('discard-phase', {
      hand: room.hands[p],
      trumpSuit: room.trumpSuit,
      mustKeep: 6,
      isBidWinner: false,
      remainingDeckSize: room.remainingDeck.length,
      message: 'Discard non-trump cards. You\'ll draw back to 6.'
    });
  }
}

function checkAllDiscardsDone(room) {
  var allDone = true;
  for (var p = 0; p < room.maxPlayers; p++) {
    if (!room.discardsDone[p]) { allDone = false; break; }
  }

  if (allDone) {
    console.log('All players discarded. Starting play.');
    room.phase = 'playing';
    room.trickLeader = room.highBidder;
    room.currentPlayer = room.highBidder;
    room.trickPlays = [];

    // Send updated hands to all players
    broadcastGameState(room);

    // If AI plays first, trigger it
    handleAIPlayCard(room);
  }
}

// ── Broadcast game state ─────────────────────────────────
function broadcastGameState(room) {
  for (var p = 0; p < room.maxPlayers; p++) {
    io.to(room.players[p].id).emit('game-state', {
      phase: room.phase,
      trumpSuit: room.trumpSuit,
      currentPlayer: room.currentPlayer,
      currentPlayerName: room.players[room.currentPlayer].name,
      hand: room.hands[p],
      playerIndex: p,
      trickPlays: room.trickPlays.map(function(tp) { return { player: tp.playerIndex, card: tp.card }; }),
      scores: room.scores,
      highBidder: room.highBidder,
      highBidderName: room.players[room.highBidder].name,
      highBid: room.highBid,
      players: room.players.map(function(pl) { return pl.name; }),
      maxPlayers: room.maxPlayers
    });
  }
}

// ── Score and report ─────────────────────────────────────
function scoreAndReport(room) {
  var numTeams = room.maxPlayers === 4 ? 2 : room.maxPlayers;
  var bidderTeam = room.maxPlayers === 4 ? (room.highBidder % 2) : room.highBidder;

  var result = scoreHand(room.tricksWon, room.trumpSuit, room.highBidder, room.highBid, room.maxPlayers);

  var bidderPoints = result.points[bidderTeam] || 0;
  var madeIt = bidderPoints >= room.highBid;

  for (var t = 0; t < numTeams; t++) {
    if (t === bidderTeam) {
      if (madeIt) {
        room.scores[t] = (room.scores[t] || 0) + bidderPoints;
      } else {
        room.scores[t] = (room.scores[t] || 0) - room.highBid;
      }
    } else {
      room.scores[t] = (room.scores[t] || 0) + (result.points[t] || 0);
    }
  }

  var winner = -1;
  for (var t = 0; t < numTeams; t++) {
    if (room.scores[t] >= 21) {
      if (t === bidderTeam) { winner = t; break; }
      else if (winner === -1) { winner = t; }
    }
  }

  io.to(room.code).emit('hand-result', {
    points: result.points,
    gamePoints: result.gamePoints,
    breakdown: result.breakdown,
    bidder: room.highBidder,
    bidderName: room.players[room.highBidder].name,
    bidderTeam: bidderTeam,
    bid: room.highBid,
    madeIt: madeIt,
    scores: JSON.parse(JSON.stringify(room.scores)),
    winner: winner,
    players: room.players.map(function(pl) { return pl.name; }),
    maxPlayers: room.maxPlayers,
    trumpSuit: room.trumpSuit
  });

  if (winner >= 0) {
    room.phase = 'gameover';
  } else {
    room.dealer = (room.dealer + 1) % room.maxPlayers;
    room.phase = 'between-hands';
  }
}

// ── Server ───────────────────────────────────────────────
var PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
  console.log('');
  console.log('🃏 Setback is running on port ' + PORT + '!');
  console.log('');
  var interfaces = os.networkInterfaces();
  for (var name in interfaces) {
    var addrs = interfaces[name];
    for (var i = 0; i < addrs.length; i++) {
      if (addrs[i].family === 'IPv4' && !addrs[i].internal) {
        console.log('📱 On your phones, go to: http://' + addrs[i].address + ':' + PORT);
      }
    }
  }
  console.log('');
  console.log('Press Ctrl+C to stop the server.');
});
