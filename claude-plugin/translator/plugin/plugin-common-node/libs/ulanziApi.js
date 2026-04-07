import WebSocket from 'ws';
import EventEmitter from 'events';
import { Events, SocketErrors } from './constants.js';
import Utils from './utils.js';

export default class UlanziApi extends EventEmitter {
  constructor() {
    super();
    this.key = '';
    this.uuid = '';
    this.actionid = '';
    this.websocket = null;
    this.address = '127.0.0.1';
    this.port = 3906;
  }

  connect(uuid, port, address) {
    const [argv_address, argv_port, argv_language] = process.argv.slice(2);
    this.address = argv_address || address || '127.0.0.1';
    this.port = argv_port || port || 3906;
    this.language = Utils.adaptLanguage(argv_language || 'en');
    this.uuid = uuid;

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    const isMain = this.uuid.split('.').length === 4;
    this.websocket = new WebSocket(`ws://${this.address}:${this.port}`);

    this.websocket.onopen = () => {
      Utils.log(`[UlanziApi] connected: ${this.uuid}`);
      this.websocket.send(JSON.stringify({ code: 0, cmd: Events.CONNECTED, uuid: this.uuid }));
      this.emit(Events.CONNECTED, {});
    };

    this.websocket.onerror = (evt) => {
      const msg = `[UlanziApi] error: ${SocketErrors[evt?.code || 'DEFAULT']}`;
      Utils.warn(msg);
      this.emit(Events.ERROR, msg);
    };

    this.websocket.onclose = (evt) => {
      Utils.warn(`[UlanziApi] closed: ${this.uuid}, code=${evt.code}`);
      this.emit(Events.CLOSE);
    };

    this.websocket.onmessage = (evt) => {
      const data = evt?.data ? JSON.parse(evt.data) : null;
      if (!data || (typeof data.code !== 'undefined' && data.cmdType !== 'REQUEST')) return;

      if (!this.key && data.uuid === this.uuid && data.key) this.key = data.key;
      if (!this.actionid && data.uuid === this.uuid && data.actionid) this.actionid = data.actionid;

      if (isMain) {
        this.send(data.cmd, { code: 0, ...data });
      }

      if (data.cmd === 'clear') {
        if (data.param) {
          for (const item of data.param) {
            item.context = this.encodeContext(item);
          }
        }
      } else {
        data.context = this.encodeContext(data);
      }

      this.emit(data.cmd, data);
    };
  }

  encodeContext(jsn) {
    return `${jsn.uuid}___${jsn.key}___${jsn.actionid}`;
  }

  decodeContext(context) {
    const [uuid, key, actionid] = context.split('___');
    return { uuid, key, actionid };
  }

  send(cmd, params = {}) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        cmd,
        uuid: this.uuid,
        key: this.key,
        actionid: this.actionid,
        ...params,
      }));
    }
  }

  // --- Send commands ---

  setStateIcon(context, state, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this.send(Events.STATE, {
      param: { statelist: [{ uuid, key, actionid, type: 0, state, textData: text || '', showtext: !!text }] },
    });
  }

  setBaseDataIcon(context, data, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this.send(Events.STATE, {
      param: { statelist: [{ uuid, key, actionid, type: 1, data, textData: text || '', showtext: !!text }] },
    });
  }

  setPathIcon(context, path, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this.send(Events.STATE, {
      param: { statelist: [{ uuid, key, actionid, type: 2, path, textData: text || '', showtext: !!text }] },
    });
  }

  setGifDataIcon(context, gifdata, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this.send(Events.STATE, {
      param: { statelist: [{ uuid, key, actionid, type: 3, gifdata, textData: text || '', showtext: !!text }] },
    });
  }

  setGifPathIcon(context, gifpath, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this.send(Events.STATE, {
      param: { statelist: [{ uuid, key, actionid, type: 4, gifpath, textData: text || '', showtext: !!text }] },
    });
  }

  toast(msg) { this.send(Events.TOAST, { msg }); }

  hotkey(key) { this.send(Events.HOTKEY, { keylist: key }); }

  showAlert(context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this.send(Events.SHOWALERT, { uuid: uuid || this.uuid, key: key || this.key, actionid: actionid || this.actionid });
  }

  logMessage(msg, level) { this.send(Events.LOGMESSAGE, { message: msg, level: level || 'info' }); }

  openUrl(url, local, param) { this.send(Events.OPENURL, { url, local: !!local, param: param || null }); }

  openView(url, width = 200, height = 200, x, y, param) {
    const params = { url, width, height };
    if (x != null) params.x = x;
    if (y != null) params.y = y;
    if (param) params.param = param;
    this.send(Events.OPENVIEW, params);
  }

  selectFileDialog(filter) { this.send(Events.SELECTDIALOG, { type: 'file', filter }); }
  selectFolderDialog() { this.send(Events.SELECTDIALOG, { type: 'folder' }); }

  sendParamFromPlugin(settings, context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this.send(Events.PARAMFROMPLUGIN, {
      uuid: uuid || this.uuid, key: key || this.key, actionid: actionid || this.actionid, param: settings,
    });
  }

  sendToPropertyInspector(settings, context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this.send(Events.SENDTOPROPERTYINSPECTOR, { uuid, key, actionid, payload: settings });
  }

  sendToPlugin(settings) {
    this.send(Events.SENDTOPLUGIN, { uuid: this.uuid, key: this.key, actionid: this.actionid, payload: settings });
  }

  getSettings(context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this.send(Events.GETSETTINGS, { uuid: uuid || this.uuid, key: key || this.key, actionid: actionid || this.actionid });
  }

  setSettings(settings, context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this.send(Events.SETSETTINGS, {
      uuid: uuid || this.uuid, key: key || this.key, actionid: actionid || this.actionid, settings,
    });
  }

  getGlobalSettings(context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this.send(Events.GETGLOBALSETTINGS, { uuid: uuid || this.uuid, key: key || this.key, actionid: actionid || this.actionid });
  }

  setGlobalSettings(settings, context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this.send(Events.SETGLOBALSETTINGS, {
      uuid: uuid || this.uuid, key: key || this.key, actionid: actionid || this.actionid, settings,
    });
  }

  // --- Event listeners ---

  onConnected(fn)  { this.on(Events.CONNECTED, fn); return this; }
  onClose(fn)      { this.on(Events.CLOSE, fn); return this; }
  onError(fn)      { this.on(Events.ERROR, fn); return this; }
  onAdd(fn)        { this.on(Events.ADD, fn); return this; }
  onRun(fn)        { this.on(Events.RUN, fn); return this; }
  onKeyDown(fn)    { this.on(Events.KEYDOWN, fn); return this; }
  onKeyUp(fn)      { this.on(Events.KEYUP, fn); return this; }
  onSetActive(fn)  { this.on(Events.SETACTIVE, fn); return this; }
  onClear(fn)      { this.on(Events.CLEAR, fn); return this; }
  onParamFromApp(fn)    { this.on(Events.PARAMFROMAPP, fn); return this; }
  onParamFromPlugin(fn) { this.on(Events.PARAMFROMPLUGIN, fn); return this; }
  onDidReceiveSettings(fn)       { this.on(Events.DIDRECEIVESETTINGS, fn); return this; }
  onDidReceiveGlobalSettings(fn) { this.on(Events.DIDRECEIVEGLOBALSETTINGS, fn); return this; }
  onSendToPlugin(fn)             { this.on(Events.SENDTOPLUGIN, fn); return this; }
  onSendToPropertyInspector(fn)  { this.on(Events.SENDTOPROPERTYINSPECTOR, fn); return this; }
  onSelectdialog(fn)             { this.on(Events.SELECTDIALOG, fn); return this; }
  onDialDown(fn)   { this.on(Events.DIALEDOWN, fn); return this; }
  onDialUp(fn)     { this.on(Events.DIALEUP, fn); return this; }
  onDialRotate(fn) { this.on(Events.DIALROTATE, fn); return this; }
  onDialRotateLeft(fn)      { this.on(Events.DIALROTATE, (jsn) => { if (jsn.rotateEvent === 'left') fn(jsn); }); return this; }
  onDialRotateRight(fn)     { this.on(Events.DIALROTATE, (jsn) => { if (jsn.rotateEvent === 'right') fn(jsn); }); return this; }
  onDialRotateHoldLeft(fn)  { this.on(Events.DIALROTATE, (jsn) => { if (jsn.rotateEvent === 'hold-left') fn(jsn); }); return this; }
  onDialRotateHoldRight(fn) { this.on(Events.DIALROTATE, (jsn) => { if (jsn.rotateEvent === 'hold-right') fn(jsn); }); return this; }
}
