class UlanziUtils {
  adaptLanguage(ln) {
    let userLanguage = ln;
    if (ln.indexOf('zh') === 0) {
      userLanguage = ln.indexOf('CN') > -1 ? 'zh_CN' : 'zh_HK';
    } else if (ln.indexOf('en') === 0) {
      userLanguage = 'en';
    } else if (userLanguage.indexOf('-') !== -1) {
      userLanguage = userLanguage.replace(/-/g, '_');
    }
    return userLanguage;
  }

  getPluginPath() {
    const currentFilePath = process.argv[1];
    const splitTag = currentFilePath.indexOf('\\') > -1 ? '\\' : '/';
    const pathArr = currentFilePath.split(splitTag);
    const idx = pathArr.findIndex((f) => f.endsWith('ulanziPlugin'));
    return pathArr.slice(0, idx + 1).join('/');
  }

  getSystemType() {
    return process.platform === 'win32' ? 'windows' : 'mac';
  }

  parseJson(jsonString) {
    if (typeof jsonString === 'object') return jsonString;
    try {
      const o = JSON.parse(jsonString);
      if (o && typeof o === 'object') return o;
    } catch (_) {}
    return false;
  }

  debounce(fn, wait = 150) {
    let timeoutId = null;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  getProperty(obj, dotSeparatedKeys, defaultValue) {
    if (typeof obj !== 'undefined' && typeof dotSeparatedKeys === 'string') {
      const pathArr = dotSeparatedKeys.split('.');
      obj = pathArr.reduce((o, key) => (o && o[key] !== undefined ? o[key] : undefined), obj);
    }
    return obj === undefined ? defaultValue : obj;
  }

  log(...msg) {
    console.log(`[${new Date().toISOString()}]`, ...msg);
  }

  warn(...msg) {
    console.warn(`[${new Date().toISOString()}]`, ...msg);
  }

  error(...msg) {
    console.error(`[${new Date().toISOString()}]`, ...msg);
  }
}

const Utils = new UlanziUtils();
export default Utils;
