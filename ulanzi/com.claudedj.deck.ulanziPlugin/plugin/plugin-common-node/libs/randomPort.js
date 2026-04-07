import crypto from 'crypto';
import fs from 'fs';

export default class RandomPort {
  constructor(minPort = 49152, maxPort = 65535) {
    this.minPort = minPort;
    this.maxPort = maxPort;
    this.randomPort = null;
  }

  getPort() {
    this.randomPort = this.minPort + crypto.randomInt(this.maxPort - this.minPort + 1);
    this._writePort();
    return this.randomPort;
  }

  _writePort() {
    const currentFilePath = process.argv[1];
    const splitTag = currentFilePath.indexOf('\\') > -1 ? '\\' : '/';
    const pathArr = currentFilePath.split(splitTag);
    const idx = pathArr.findIndex((f) => f.endsWith('ulanziPlugin'));
    const pluginRoot = pathArr.slice(0, idx + 1).join('/');
    const filePath = `${pluginRoot}/ws-port.js`;
    try {
      fs.writeFileSync(filePath, `window.__port = ${this.randomPort};`, 'utf8');
    } catch (err) {
      console.error('[RandomPort] write failed:', err.message);
    }
  }
}
