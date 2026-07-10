(function () {
  window.LabyrinthOnline = window.LabyrinthOnline || {};

  window.LabyrinthOnline.CLIENT_EVENTS = Object.freeze({
    JOIN_QUEUE: 'JOIN_QUEUE',
    LEAVE_QUEUE: 'LEAVE_QUEUE',
    READY: 'READY',
    PLAYER_ESCAPED: 'PLAYER_ESCAPED',
    ITEM_USED: 'ITEM_USED',
    PING: 'PING',
  });

  window.LabyrinthOnline.SERVER_EVENTS = Object.freeze({
    QUEUE_JOINED: 'QUEUE_JOINED',
    MATCH_FOUND: 'MATCH_FOUND',
    COUNTDOWN: 'COUNTDOWN',
    MATCH_START: 'MATCH_START',
    MATCH_END: 'MATCH_END',
    OPPONENT_USED_ITEM: 'OPPONENT_USED_ITEM',
    OPPONENT_DISCONNECTED: 'OPPONENT_DISCONNECTED',
    OPPONENT_RECONNECTED: 'OPPONENT_RECONNECTED',
    ERROR: 'ERROR',
    PONG: 'PONG',
  });

  window.LabyrinthOnline.LOCAL_ITEMS = Object.freeze({
    HAMMER: 'HAMMER',
    VISION: 'VISION',
    PATH_REVEAL: 'PATH_REVEAL',
    FLAG: 'FLAG',
  });

  window.LabyrinthOnline.SABOTAGE_ITEMS = Object.freeze({
    INK_BOMB: 'INK_BOMB',
    CONFUSION: 'CONFUSION',
  });
})();
