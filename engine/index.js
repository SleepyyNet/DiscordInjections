const { app } = require('electron').remote
const path = require('path')
const fs = require('fs-extra')
const buble = require('buble')

const postcss = require('postcss')
const postcssImport = require('postcss-import')
const postcssUrl = require('postcss-url')

const conf = fs.existsSync(path.join(__dirname, '..', 'config.json'))
  ? require(path.join(__dirname, '..', 'config.json'))
  : {}

// register custom extension compilation support
require.extensions['.jsx'] = (module, filename) => {
  if (conf.debug) console.debug('[JSX] converting', filename)

  const raw = fs.readFileSync(filename, 'utf8')

  const transformed = buble.transform(raw, {
    jsx: 'React.createElement',
    objectAssign: 'Object.assign',
    target: { chrome: 52 }
  })
  return module._compile(transformed.code, filename)
}

const fname = path.join(__dirname, '..', 'console.log')
fs.remove(fname)
if (conf.debug) {
  for (let key of ['log', 'debug', 'info', 'warn', 'error']) {
    console['_' + key] = console[key].bind(console)
    console[key] = (...args) => {
      console['_' + key](...args)
      fs.appendFile(
        fname,
        `[${new Date().toISOString()}] {${key.toUpperCase()}} ${args.join(
          ' '
        )}\n`,
        'utf8'
      )
    }

    process.on('uncaughtException', ev => {
      fs.appendFile(
        fname,
        `[${new Date().toISOString()}] {EEXCEPTION} ${ev.error}\n`,
        'utf8'
      )
    })

    process.on('unhandledRejection', ev => {
      fs.appendFile(
        fname,
        `[${new Date().toISOString()}] {EREJECTION} ${ev.reason}\n`,
        'utf8'
      )
    })
  }
}

// stage zero
// load original preload script if there is one
try {
  const buildInfo = require(path.join(
    process.resourcesPath,
    'app.asar',
    'build_info.json'
  ))
  if (buildInfo.releaseChannel === 'stable') {
    buildInfo.releaseChannel = ''
  }
  const appData = app.getPath('appData')

  require(path.join(
    appData,
    'discord' + buildInfo.releaseChannel,
    buildInfo.version,
    'modules',
    'discord_desktop_core',
    'core.asar',
    'app',
    'mainScreenPreload.js'
  ))
} catch (err) {
  // ignore if not existant
  console.error('Failed to inject native preloader!', err)
}

// stage one
// prelaunch adjustments
const DI = {
  get conf () {
    return conf
  },

  get package () {
    return require('../package.json')
  },

  get version () {
    return this.package.version
  },

  get contributors () {
    if (!this._contributors) {
      this._contributors = {}

      fs
        .readFileSync(path.join(__dirname, '..', 'CONTRIBUTORS.md'), 'utf-8')
        .split('\n')
        .filter(line => line.startsWith('*'))
        .map(line => line.match(/\*\*(.+)\*\* <!-- (\d+) -->/))
        .forEach(([_, name, id]) => (this._contributors[id] = name))
    }

    return this._contributors
  }
}

Object.defineProperty(DI, 'localStorage', {
  writable: false,
  value: window.localStorage
})

Object.defineProperty(DI, 'sessionStorage', {
  writable: false,
  value: window.sessionStorage
})

Object.defineProperty(DI, 'pluginManager', {
  writable: false,
  value: new (require('./pluginManager'))(DI)
})

Object.defineProperty(DI, 'postcss', {
  writable: false,
  value: postcss([
    postcssImport(),
    postcssUrl({
      url: 'inline'
    })
  ])
})

// stage two
// post launch patching
process.once('loaded', async () => {
  window.addEventListener('error', ev => {
    fs.appendFile(
      fname,
      `[${new Date().toISOString()}] {EXCEPTION} ${ev.error}\n`,
      'utf8'
    )
  })

  window.addEventListener('unhandledrejection', ev => {
    fs.appendFile(
      fname,
      `[${new Date().toISOString()}] {REJECTION} ${ev.reason}\n`,
      'utf8'
    )
  })

  // make sure process and require are available in the global scope
  // discord may have nodeintegration disabled which borks literally everything
  if (!global.process) {
    global.process = process
  }
  if (!global.require) {
    global.require = require
  }

  // lets boot our plugin manager
  DI.pluginManager.initialize()
})
