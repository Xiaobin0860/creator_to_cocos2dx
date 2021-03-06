
/* jslint node: true, sub: true, esversion: 6 */
/* globals Editor */

"use strict";

const Fs = require('fs');
const Path = require('path');

const Electron = require('electron');

const TIMEOUT = -1;
const DEBUG_WORKER = true;
let PACKAGE_VERSION = '';

const Project = require('./core/Project');

let _buildState = 'sleep';
// let _module_loaded = false;

function _fetchVersion() {
    const Constants = require('./core/Constants');
    Constants.WORK_PATH = Editor.Package.packagePath(Constants.PACKAGE_NAME);
    let info = Editor.Package.packageInfo(Constants.WORK_PATH);
    PACKAGE_VERSION = info.version;
}

function _runWorker(url, message, project) {
    let buildWorker;
    
    Editor.App.spawnWorker(url, (worker) => {
        buildWorker = worker;
        
        let opts = {version: PACKAGE_VERSION, debug: DEBUG_WORKER};
        let state = project.dumpState(project);
        buildWorker.send(message, state, opts, (err) => {
            if (err) {
                Editor.error(err);
                return;
            }

            if (buildWorker) {
                buildWorker.close();
            }
            buildWorker = null;
        }, TIMEOUT);
    }, DEBUG_WORKER);
}

function _checkProject(opt) {
    let project = new Project(opt.profile);

    if (project.validate()) {
        project.selectedAsserts = opt.selectedAsserts;
        return project;
    } else {
        if (opt.reason !== 'scene:saved') {
            Editor.Dialog.messageBox({
              type: 'warning',
              buttons: [Editor.T('MESSAGE.ok')],
              title: 'Warning - LuaCpp Support',
              message: 'Please setup Target Project first',
              noLink: true,
            });
        } else {
            Editor.warn('[LuaCpp Support] Please setup Target Project first');
        }
    }

    return null;
}

// opt = { reason: xxx, profile: yyy}
// 'profile' may be null
function _build(opt) {
    // if (!_module_loaded) {
    //     Editor.warn('[LuaCpp Support] not loaded!');
    //     return;
    // }
    if (_buildState !== 'sleep' && _buildState !== 'finish' && _buildState !== 'error') {
        Editor.warn('[LuaCpp Support] Building in progress');
        return;
    }

    // called by `Build Now`
    if (opt === undefined) {
        const Constants = require('./core/Constants');
        let state = Editor.Profile.load('profile://project/creator-luacpp-support.json', Constants.PROFILE_DEFAULTS);
        opt = {
            profile: state.data
        }
    }

    let project = _checkProject(opt);
    if (!project) return;

    Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'start', 0);

    let workerUrl = 'packages://creator-luacpp-support/core/BuildWorker';
    _runWorker(workerUrl, 'creator-luacpp-support:run-build-worker', project);
}

module.exports = {
    load() {
        _fetchVersion();
        Editor.log('[LuaCPP Support] load version ' + PACKAGE_VERSION);
        Editor.log('[LuaCPP Support] path: ' + Constants.WORK_PATH);
        // _module_loaded = true;
    },

    unload() {
        // _module_loaded = false;
        Editor.log('[LuaCPP Support] unload version ' + PACKAGE_VERSION);
    },

    messages: {
        'setup-target-project'() {
            const Constants = require('./core/Constants');
            Editor.Panel.open(Constants.PACKAGE_NAME, {version: PACKAGE_VERSION});
        },

        'build'(event, opt) {
            _build(opt);
        },

        // can not recognize if the scene is modified
        'scene:saved'(event) {
            const Constants = require('./core/Constants');
            let state = Editor.Profile.load('profile://project/creator-luacpp-support.json', Constants.PROFILE_DEFAULTS);
            if (state.data.autoBuild) {
                _build({
                    reason: 'scene:saved',
                    profile: state.data});
            }
        },

        'creator-luacpp-support:state-changed'(event, state, progress) {
            _buildState = state;
            Editor.Ipc.sendToWins('creator-luacpp-support:state-changed', state, progress);
        },
    }
};

