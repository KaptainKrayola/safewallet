// main proc for Safewallet
// this app spawns iguana in background in nontech-mode

const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const path = require('path');
const url = require('url');
const os = require('os');
const { randomBytes } = require('crypto');
const md5 = require('./routes/md5');
const exec = require('child_process').exec;
const { Menu } = require('electron');
const portscanner = require('portscanner');
const osPlatform = os.platform();
const fixPath = require('fix-path');
const express = require('express');
const bodyParser = require('body-parser');
const fsnode = require('fs');
const fs = require('fs-extra');
const Promise = require('bluebird');
const arch = require('arch');
const bip39 = require('bip39');

if (osPlatform === 'linux') {
	process.env.ELECTRON_RUN_AS_NODE = true;
}

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true;

// GUI APP settings and starting gui on address http://120.0.0.1:17777
let shepherd = require('./routes/shepherd');
let guiapp = express();

shepherd.createSafewalletDirs();

let appConfig = shepherd.loadLocalConfig(); // load app config

const nativeCoindList = shepherd.scanNativeCoindBins();
shepherd.setVar('nativeCoindList', nativeCoindList);

let localVersion;
let localVersionFile = shepherd.readVersionFile();

if (localVersionFile.indexOf('\r\n') > -1) {
  localVersion = localVersionFile.split('\r\n');
} else {
  localVersion = localVersionFile.split('\n');
}

const appBasicInfo = {
	name: 'Safewallet',
	version: localVersion[0],
};

app.setName(appBasicInfo.name);
app.setVersion(appBasicInfo.version);

shepherd.createSafewalletDirs();

const appSessionHash = randomBytes(32).toString('hex');
const _spvFees = shepherd.getSpvFees();

shepherd.writeLog(`app info: ${appBasicInfo.name} ${appBasicInfo.version}`);
shepherd.writeLog('sys info:');
shepherd.writeLog(`totalmem_readable: ${formatBytes(os.totalmem())}`);
shepherd.writeLog(`arch: ${os.arch()}`);
shepherd.writeLog(`cpu: ${os.cpus()[0].model}`);
shepherd.writeLog(`cpu_cores: ${os.cpus().length}`);
shepherd.writeLog(`platform: ${osPlatform}`);
shepherd.writeLog(`os_release: ${os.release()}`);
shepherd.writeLog(`os_type: ${os.type()}`);

if (process.argv.indexOf('devmode') > -1) {
	shepherd.log(`app init ${appSessionHash}`);
}

shepherd.log(`app info: ${appBasicInfo.name} ${appBasicInfo.version}`);
shepherd.log('sys info:');
shepherd.log(`totalmem_readable: ${formatBytes(os.totalmem())}`);
shepherd.log(`arch: ${os.arch()}`);
shepherd.log(`cpu: ${os.cpus()[0].model}`);
shepherd.log(`cpu_cores: ${os.cpus().length}`);
shepherd.log(`platform: ${osPlatform}`);
shepherd.log(`os_release: ${os.release()}`);
shepherd.log(`os_type: ${os.type()}`);

appConfig['daemonOutput'] = false; // shadow setting

let __defaultAppSettings = require('./routes/appConfig.js').config;
__defaultAppSettings['daemonOutput'] = false; // shadow setting
const _defaultAppSettings = __defaultAppSettings;

shepherd.log(`app started in ${(appConfig.dev ? 'dev mode' : ' user mode')}`);
shepherd.writeLog(`app started in ${(appConfig.dev ? 'dev mode' : ' user mode')}`);

shepherd.setConfSAFE();
// shepherd.setConfSAFE('CHIPS');

guiapp.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', appConfig.dev ? '*' : 'http://127.0.0.1:3000');
	res.header('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
	res.header('Access-Control-Allow-Credentials', 'true');
	res.header('Access-Control-Allow-Methods', 'PUT, GET, POST, DELETE, OPTIONS');
	next();
});

// preload js
const _setImmediate = setImmediate;
const _clearImmediate = clearImmediate;

process.once('loaded', () => {
	global.setImmediate = _setImmediate;
	global.clearImmediate = _clearImmediate;

	if (osPlatform === 'darwin') {
		process.setFdLimit(appConfig.maxDescriptors.darwin);
		app.setAboutPanelOptions({
			applicationName: app.getName(),
			applicationVersion: `${app.getVersion().replace('version=', '')}-beta`,
			copyright: 'Released under the MIT license',
			credits: 'SuperNET Team',
		});
	} else if (osPlatform === 'linux') {
		process.setFdLimit(appConfig.maxDescriptors.linux);
	}
});

// silent errors
if (!appConfig.dev) {
	process.on('uncaughtException', (err) => {
	  shepherd.log(`${(new Date).toUTCString()} uncaughtException: ${err.message}`);
	  shepherd.log(err.stack);
	});
}

guiapp.use(bodyParser.json({ limit: '50mb' })); // support json encoded bodies
guiapp.use(bodyParser.urlencoded({
	limit: '50mb',
	extended: true,
})); // support encoded bodies

guiapp.get('/', (req, res) => {
	res.send('Safewallet app server');
});

const guipath = path.join(__dirname, '/gui');
guiapp.use('/gui', express.static(guipath));
guiapp.use('/shepherd', shepherd);

const server = require('http').createServer(guiapp);
const io = require('socket.io').listen(server);
const _zcashParamsExist = shepherd.zcashParamsExist();
let willQuitApp = false;
let mainWindow;
let appCloseWindow;
let closeAppAfterLoading = false;
let forceQuitApp = false;

module.exports = guiapp;
let safewalletIcon;

if (os.platform() === 'linux') {
	safewalletIcon = path.join(__dirname, '/assets/icons/safewallet_icons/128x128.png');
}
if (os.platform() === 'win32') {
	safewalletIcon = path.join(__dirname, '/assets/icons/safewallet_app_icon.ico');
}

// close app
function forseCloseApp() {
	forceQuitApp = true;
	app.quit();
}

app.on('ready', () => createWindow('open', process.argv.indexOf('dexonly') > -1 ? true : null));

function createAppCloseWindow() {
	// initialise window
	appCloseWindow = new BrowserWindow({ // dirty hack to prevent main window flash on quit
		width: 500,
		height: 320,
		frame: false,
		icon: safewalletIcon,
		show: false,
	});

	appCloseWindow.setResizable(false);

	appCloseWindow.loadURL(appConfig.dev ? `http://${appConfig.host}:${appConfig.safewalletPort}/gui/startup/app-closing.html` : `file://${__dirname}/gui/startup/app-closing.html`);

  appCloseWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      appCloseWindow.show();
    }, 40);
  });
}

function createWindow(status, hideLoadingWindow) {
	if (process.argv.indexOf('spvcoins=all/add-all') > -1) {
		shepherd.startSPV('safe');
	}

	if (status === 'open') {
		require(path.join(__dirname, 'private/mainmenu'));

		if (closeAppAfterLoading) {
			mainWindow = null;
			loadingWindow = null;
		}

		const staticMenu = Menu.buildFromTemplate([ // if static
			{ role: 'copy' },
			{ type: 'separator' },
			{ role: 'selectall' },
		]);

		const editMenu = Menu.buildFromTemplate([ // if editable
			{ role: 'undo' },
			{ role: 'redo' },
			{ type: 'separator' },
			{ role: 'cut' },
			{ role: 'copy' },
			{ role: 'paste' },
			{ type: 'separator' },
			{ role: 'selectall' },
		]);

		// check if safewallet is already running
		portscanner.checkPortStatus(appConfig.safewalletPort, '127.0.0.1', (error, status) => {
			// Status is 'open' if currently in use or 'closed' if available
			if (status === 'closed') {
				server.listen(appConfig.safewalletPort, () => {
					shepherd.log(`guiapp and sockets.io are listening on port ${appConfig.safewalletPort}`);
					shepherd.writeLog(`guiapp and sockets.io are listening on port ${appConfig.safewalletPort}`);
					// start sockets.io
					io.set('origins', appConfig.dev ? 'http://127.0.0.1:3000' : null); // set origin
				});

				// initialise window
				mainWindow = new BrowserWindow({ // dirty hack to prevent main window flash on quit
					width: closeAppAfterLoading ? 1 : 1280,
					height: closeAppAfterLoading ? 1 : 850,
					icon: safewalletIcon,
					show: false,
				});

				if (appConfig.dev) {
					mainWindow.loadURL('http://127.0.0.1:3000');
				} else {
					mainWindow.loadURL(`file://${__dirname}/gui/FairExchange-GUI/react/build/index.html`);
				}

				shepherd.setIO(io); // pass sockets object to shepherd router
				shepherd.setVar('appBasicInfo', appBasicInfo);
				shepherd.setVar('appSessionHash', appSessionHash);

				// load our index.html (i.e. Safewallet GUI)
				shepherd.writeLog('show safewallet gui');
				mainWindow.appConfig = appConfig;
				mainWindow.appConfigSchema = shepherd.appConfigSchema;
				mainWindow.arch = arch();
				mainWindow.appBasicInfo = appBasicInfo;
				mainWindow.appSessionHash = appSessionHash;
				mainWindow.assetChainPorts = require('./routes/ports.js');
				mainWindow.safewalletIcon = safewalletIcon;
				mainWindow.testLocation = shepherd.testLocation;
				mainWindow.safeMainPassiveMode = shepherd.safeMainPassiveMode;
				mainWindow.getAppRuntimeLog = shepherd.getAppRuntimeLog;
				mainWindow.nativeCoindList = nativeCoindList;
				mainWindow.zcashParamsExist = _zcashParamsExist;
				mainWindow.zcashParamsExistPromise = shepherd.zcashParamsExistPromise;
				mainWindow.zcashParamsDownloadLinks = shepherd.zcashParamsDownloadLinks;
				mainWindow.isWindows = os.platform() === 'win32' ? true : false; // obsolete(?)
				mainWindow.appExit = appExit;
				mainWindow.getMaxconSAFEConf = shepherd.getMaxconSAFEConf;
				mainWindow.setMaxconSAFEConf = shepherd.setMaxconSAFEConf;
				mainWindow.getMMCacheData = shepherd.getMMCacheData;
				mainWindow.activeSection = 'wallets';
				mainWindow.argv = process.argv;
				mainWindow.getAssetChainPorts = shepherd.getAssetChainPorts;
				mainWindow.spvFees = _spvFees;
				mainWindow.startSPV = shepherd.startSPV;
				mainWindow.startSAFENative = shepherd.startSAFENative;
				mainWindow.addressVersionCheck = shepherd.addressVersionCheck;
				mainWindow.getCoinByPub = shepherd.getCoinByPub;
				mainWindow.resetSettings = () => { shepherd.saveLocalAppConf(__defaultAppSettings) };
				mainWindow.createSeed = {
					triggered: false,
					firstLoginPH: null,
					secondaryLoginPH: null,
				};
				mainWindow.checkStringEntropy = shepherd.checkStringEntropy;
				mainWindow.pinAccess = false;
				mainWindow.bip39 = bip39;
				mainWindow.isWatchOnly = shepherd.isWatchOnly;
				mainWindow.setPubkey = shepherd.setPubkey;
				mainWindow.getPubkeys = shepherd.getPubkeys;

			  for (let i = 0; i < process.argv.length; i++) {
			    if (process.argv[i].indexOf('nvote') > -1) {
			      console.log('enable notary node elections ui');
			      mainWindow.nnVoteChain = 'VOTE2018';
			    }
			  }
			} else {
				mainWindow = new BrowserWindow({
					width: 500,
					height: 355,
					frame: false,
					icon: safewalletIcon,
					show: false,
				});

				mainWindow.setResizable(false);
				mainWindow.forseCloseApp = forseCloseApp;

				willQuitApp = true;
				server.listen(appConfig.safewalletPort + 1, () => {
					shepherd.log(`guiapp and sockets.io are listening on port ${appConfig.safewalletPort + 1}`);
					shepherd.writeLog(`guiapp and sockets.io are listening on port ${appConfig.safewalletPort + 1}`);
				});
				mainWindow.loadURL(appConfig.dev ? `http://${appConfig.host}:${appConfig.safewalletPort + 1}/gui/startup/safewallet-instance-error.html` : `file://${__dirname}/gui/startup/safewallet-instance-error.html`);
				shepherd.log('another safewallet app is already running');
			}

		  mainWindow.webContents.on('did-finish-load', () => {
		    setTimeout(() => {
		      mainWindow.show();
		    }, 40);
		  });

		  /*loadingWindow.on('close', (e) => {
		  	if (!forseCloseApp) {
			    if (willQuitApp) {
			      loadingWindow = null;
			    } else {
			      closeAppAfterLoading = true;
			      e.preventDefault();
			    }
			  }
		  });*/

			mainWindow.webContents.on('context-menu', (e, params) => { // context-menu returns params
				const { selectionText, isEditable } = params; // params obj

				if (isEditable) {
					editMenu.popup(mainWindow);
				} else if (selectionText && selectionText.trim() !== '') {
					staticMenu.popup(mainWindow);
				}
			});

			// DEVTOOLS - only for dev purposes - ca333
			// mainWindow.webContents.openDevTools()

			function appExit() {
				const CloseDaemons = () => {
					return new Promise((resolve, reject) => {
						shepherd.log('Closing Main Window...');
						shepherd.writeLog('exiting app...');

						shepherd.quitSafecoind(appConfig.cliStopTimeout);

						const result = 'Closing daemons: done';

						shepherd.log(result);
						shepherd.writeLog(result);
						resolve(result);
					});
				}

				const HideMainWindow = () => {
					return new Promise((resolve, reject) => {
						const result = 'Hiding Main Window: done';

						shepherd.log('Exiting App...');
						mainWindow = null;
						shepherd.log(result);
						resolve(result);
					});
				}

				const HideAppClosingWindow = () => {
					return new Promise((resolve, reject) => {
						appCloseWindow = null;
						resolve(true);
					});
				}

				const QuitApp = () => {
					return new Promise((resolve, reject) => {
						const result = 'Quiting App: done';

						app.quit();
						shepherd.log(result);
						resolve(result);
					});
				}

				const closeApp = () => {
					CloseDaemons()
					.then(HideMainWindow)
					.then(HideAppClosingWindow)
					.then(QuitApp);
				}

				let _appClosingInterval;

				if (process.argv.indexOf('dexonly') > -1) {
					shepherd.killRogueProcess('marketmaker');
				}
				if (!Object.keys(shepherd.coindInstanceRegistry).length ||
						!appConfig.stopNativeDaemonsOnQuit) {
					closeApp();
				} else {
					createAppCloseWindow();
					shepherd.quitSafecoind(appConfig.cliStopTimeout);
					_appClosingInterval = setInterval(() => {
						if (!Object.keys(shepherd.coindInstanceRegistry).length) {
							closeApp();
						}
					}, 1000);
				}
			}

			// close app
			mainWindow.on('closed', () => {
				appExit();
			});
		});
	}
}

app.on('window-all-closed', () => {
	// if (os.platform() !== 'win32') { ig.kill(); }
	// in osx apps stay active in menu bar until explictly closed or quitted by CMD Q
	// so we do not kill the app --> for the case user clicks again on the iguana icon
	// we open just a new window and respawn iguana proc
	/*if (process.platform !== 'darwin' || process.platform !== 'linux' || process.platform !== 'win32') {
		app.quit()
	}*/
});

// Emitted before the application starts closing its windows.
// Calling event.preventDefault() will prevent the default behaviour, which is terminating the application.
app.on('before-quit', (event) => {
	shepherd.log('before-quit');
	if (process.argv.indexOf('dexonly') > -1) {
		shepherd.killRogueProcess('marketmaker');
	}
});

// Emitted when all windows have been closed and the application will quit.
// Calling event.preventDefault() will prevent the default behaviour, which is terminating the application.
app.on('will-quit', (event) => {
	if (!forceQuitApp) {
		// loading window is still open
		shepherd.log('will-quit while loading window active');
		// event.preventDefault();
	}
});

// Emitted when the application is quitting.
// Calling event.preventDefault() will prevent the default behaviour, which is terminating the application.
app.on('quit', (event) => {
	if (!forceQuitApp) {
		shepherd.log('quit while loading window active');
		// event.preventDefault();
	}
});

function formatBytes(bytes, decimals) {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const k = 1000;
	const dm = decimals + 1 || 3;
	const sizes = [
    'Bytes',
    'KB',
    'MB',
    'GB',
    'TB',
    'PB',
    'EB',
    'ZB',
    'YB'
  ];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}