const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("odesseusDesktop", {
  getState: () => ipcRenderer.invoke("odesseus:get-state"),
  exchangeTicket: () => ipcRenderer.invoke("odesseus:exchange-ticket"),
  api: (path, options) => ipcRenderer.invoke("odesseus:api", path, options),
  setOpacity: (value) => ipcRenderer.invoke("odesseus:set-opacity", value),
  setClickThrough: (value) => ipcRenderer.invoke("odesseus:set-click-through", value),
  openWebPath: (path) => ipcRenderer.invoke("odesseus:open-web-path", path),
  hide: () => ipcRenderer.invoke("odesseus:hide"),
  quit: () => ipcRenderer.invoke("odesseus:quit"),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("odesseus:state", handler);
    return () => ipcRenderer.removeListener("odesseus:state", handler);
  },
  onShortcut: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on("odesseus:shortcut", handler);
    return () => ipcRenderer.removeListener("odesseus:shortcut", handler);
  },
});
