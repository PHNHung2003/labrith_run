(function () {
  class ItemSync {
    constructor(networkManager) {
      this.networkManager = networkManager;
    }

    useItem(type, payload = {}) {
      const sabotage = window.LabyrinthOnline.SABOTAGE_ITEMS;
      if (!Object.values(sabotage).includes(type)) return false;
      this.networkManager.emit(window.LabyrinthOnline.CLIENT_EVENTS.ITEM_USED, {
        type,
        payload,
        clientTime: Date.now(),
      });
      return true;
    }
  }

  window.LabyrinthOnline = window.LabyrinthOnline || {};
  window.LabyrinthOnline.ItemSync = ItemSync;
})();
