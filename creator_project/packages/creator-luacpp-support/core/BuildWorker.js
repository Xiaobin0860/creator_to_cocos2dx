
/* jslint node: true, sub: true, esversion: 6, browser: true */
/* globals Editor */

"use strict";
const Path = require('path');
const clipboard = require('electron').clipboard
const Utils = require('./Utils');
const Constants = require('./Constants');
const Fs = require('fire-fs');
const crypto = require('crypto');
const fs = require('fs');
const Del = require('del')
const globalstate = require('./parser/Global').state;
const parse_fire = require('./parser/ConvertFireToJson');
const parse_utils = require('./parser/Utils')
const { WorkerBase, registerWorker } = require('./WorkerBase');

const plugin_profile = 'profile://project/creator-luacpp-support.json';

class BuildWorker extends WorkerBase {
    run(state, callback) {
        // Utils.recordBuild();
        window.onerror = (msg, url, lineNum, colNum, err) => {
            Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'error', 0);
            this._callback(err);
            return false;
        };
        
        try {
            Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'start', 0);
            Utils.log('[creator-luacpp-support] build start');

            this._callback = callback;
            this._state = state;

            // clean old json or ccreator files
            Fs.emptyDirSync(Constants.JSON_PATH);
            Fs.emptyDirSync(Constants.CCREATOR_PATH);

            let fireFiles = this._getFireList();
            let profile = Editor.remote.Profile.load(plugin_profile, Constants.PROFILE_DEFAULTS);
            if (profile.data.exportSpriteSheet) {
                fireFiles.unshift(Path.join(Constants.ASSETS_PATH, 'Share', '*'));
                parse_utils.buildAtlases(fireFiles, () => {
                    Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'convert fire to json', 10);
                    Utils.getAssetsInfo(function (uuidmap) {
                        let copyReourceInfos = this._convertFireToJson(uuidmap);
                        let dynamicLoadRes = this._getDynamicLoadRes(uuidmap);
                        Object.assign(copyReourceInfos, dynamicLoadRes);
                        Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'compile json', 30);
                        this._compileJsonToBinary(function () {
                            Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'copy resources', 50);
                            this._copyResources(copyReourceInfos);
                            this._checkRepeatImage(copyReourceInfos);
                            this._checkUnuseImage(copyReourceInfos);
                            Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'finish', 100);
                            this._showDependences()
                            this._callback(null);
                            Utils.log('[creator-luacpp-support] build end');
                        }.bind(this));
                    }.bind(this));
                })
            } else {
                Utils.getAssetsInfo(function (uuidmap) {
                    Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'convert fire to json', 10);
                    let copyReourceInfos = this._convertFireToJson(uuidmap);
                    let dynamicLoadRes = this._getDynamicLoadRes(uuidmap);
                    Object.assign(copyReourceInfos, dynamicLoadRes);
                    Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'compile json', 30);
                    this._compileJsonToBinary(function () {
                        this._copyResources(copyReourceInfos);
                        this._checkRepeatImage(copyReourceInfos);
                        this._checkUnuseImage(copyReourceInfos);
                        Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'finish', 100);
                        this._callback(null);
                        Utils.log('[creator-luacpp-support] build end');
                    }.bind(this));
                }.bind(this));
            }
        }catch(e){
            console.log(e);
            Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'error', 0);
            callback(e);
        }

    }

    _convertFireToJson(uuidmap) {
        let fireFiles = this._getFireList();

        let copyReourceInfos = parse_fire(fireFiles, 'creator', Constants.JSON_PATH, uuidmap);

        globalstate._atlases = {};
        return copyReourceInfos;
    }


    // .json -> .ccreator
    _compileJsonToBinary(cb) {
        const jsonFiles = this._getJsonList();

        if(jsonFiles.length == 0){
            Utils.log('[creator-luacpp-support] nothing to compile');
            console.warn("nothing to compil");
            cb()
            return;
        }

        let i = 0;
        jsonFiles.forEach(function (file) {
            let subFolder = Path.dirname(file).substr(Constants.JSON_PATH.length + 1);
            let creatorPath = Path.join(Constants.CCREATOR_PATH, subFolder);
            let params = ['-b', '-o', creatorPath, Constants.CREATOR_READER_FBS, file];
            console.log('ToCreator: ' + file);
            Utils.runcommand(Constants.FLATC, params, function (code) {
                if (code != 0) {
                    Utils.log('[creator-luacpp-support] convert ' + file + ' to .ccreator error');
                    console.log(Constants.FLATC, params)
                    throw new Error('FLATC error')
                }

                ++i;
                if (i === jsonFiles.length)
                    cb();
            });
        });
    }

    _copyResources(copyReourceInfos) {
        // should copy these resources
        // - all .ccreator files
        // - resources in assets and folder
        // - all files in reader
        // - lua binding codes(currently is missing)
        let projectRoot = this._state.path;

        // root path of resources
        let resdst;
        let classes;
        let isLuaProject = Utils.isLuaProject(projectRoot);
        if (isLuaProject) {
            resdst = Path.join(projectRoot, 'res');

            classes = Path.join(projectRoot, 'frameworks/runtime-src/Classes');
            if (!Fs.existsSync(classes))
                classes = Path.join(projectRoot, 'project/Classes'); // cocos2d-x internal lua tests
        }
        else {
            resdst = Path.join(projectRoot, 'Resources');
            classes = Path.join(projectRoot, 'Classes');
        }

        // copy resources
        {
            // copy .ccreator
            resdst = Path.join(resdst, Constants.RESOURCE_FOLDER_NAME);
            console.log('Del ' + resdst)
            Del.sync(resdst, { force: true });
            this._copyTo(Constants.CCREATOR_PATH, resdst, ['.ccreator'], true);

            // copy other resources
            Object.keys(copyReourceInfos).forEach(function (uuid) {
                let pathInfo = copyReourceInfos[uuid];
                let src = pathInfo.fullpath;
                let dst = Path.join(resdst, pathInfo.relative_path);
                Fs.ensureDirSync(Path.dirname(dst));
                if(Path.extname(src) == ".ttf") {
                    let fileName = Path.basename(src);
                    let nSrc = Path.join(Constants.PROJECT_PATH,fileName);
                    if (Fs.existsSync(nSrc)){
                        src = nSrc
                    }
                }
                Fs.copySync(src, dst);
            });
        }

        let state = Editor.remote.Profile.load(plugin_profile, Constants.PROFILE_DEFAULTS);

        if (state.data.exportResourceOnly)
            return;

        // copy reader
        {
            let codeFilesDist = Path.join(classes, 'reader')
            Del.sync(codeFilesDist, { force: true });
            Fs.copySync(Constants.READER_PATH, codeFilesDist);

            // should exclude binding codes for c++ project
            if (!isLuaProject) {
                let bindingCodesPath = Path.join(classes, 'reader/lua-bindings');
                Del.sync(bindingCodesPath, { force: true });
            }
        }
    }

    // copy all files with ext in src to dst
    // @exts array of ext, such as ['.json', '.ccreator']
    // @recursive whether recursively to copy the subfolder
    _copyTo(src, dst, exts, recursive) {
        let files = Utils._getFilesWithExt(src, exts, recursive);

        let dstpath;
        let subpath;
        files.forEach((f) => {
            subpath = f.slice(src.length, f.length);
            dstpath = Path.join(dst, subpath);
            Fs.ensureDirSync(Path.dirname(dstpath));
            Fs.copySync(f, dstpath);
        });
    }


    _createFileMD5Sync(file) {
        //读取一个Buffer
        const buffer = fs.readFileSync(file);
        const fsHash = crypto.createHash('md5');
        fsHash.update(buffer);
        const md5 = fsHash.digest('hex');
        return md5
    }

    // check repeat image
    _checkRepeatImage(resources) {
        let hashinfo = {}
        let profile = Editor.remote.Profile.load(plugin_profile, Constants.PROFILE_DEFAULTS);
        if (profile.data.imageRepeatCheck){
            console.log('Repeat Image Checking ...');
            Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'image repeat checking', 70);

            Object.keys(resources).forEach(uuid => {
                let pathInfo = resources[uuid];
                let fullpath = pathInfo.ofullpath || pathInfo.fullpath;
                let relative_path = pathInfo.orelative_path || pathInfo.relative_path;
                if (Path.extname(relative_path) == ".png") {
                    let md5 = this._createFileMD5Sync(fullpath);
                    let size = fs.statSync(fullpath).size;
                    size = size/1024;
                    let key = md5 + "-" + Math.floor(size) + "kb";
                    if (hashinfo[key]) {
                        if (hashinfo[key].indexOf(relative_path)==-1){
                            hashinfo[key].unshift(relative_path);
                        }
                    }else {
                        hashinfo[key] = [relative_path];
                    }
                }
            });
        }

        let msg = '';
        Object.keys(hashinfo).forEach( (key) => {
            if (hashinfo[key].length>1) {
                let size = key.split("-")[1];
                msg = msg + "----------------------"+ size +"-------------------------\n"+ hashinfo[key].join(",\n") +"\n"
            }
        });
        
        if (msg.length>0) {
            console.log('Repeat Image List: ' + msg);
            let index = Editor.Dialog.messageBox({
                type: 'info',
                buttons: [Editor.T('MESSAGE.ok')],
                title: '发现重复图片',
                message: '重复图片信息:',
                detail: msg,
                buttons: ['关闭','拷贝到粘贴板'],
                noLink: true,
            });

            if (index === 1) {
                clipboard.writeText(msg);
            }
        }else{
            console.log('No Repeat Image');
        }
    }

    // check unuse image
    _checkUnuseImage(resources) {
        let unuseImages = [];
        let profile = Editor.remote.Profile.load(plugin_profile, Constants.PROFILE_DEFAULTS);
        if (profile.data.unuseImageCheck){
            console.log('Check Unuse Image ...');
            Editor.Ipc.sendToAll('creator-luacpp-support:state-changed', 'unuse image checking', 80);

            let allResource = []
            Object.keys(resources).forEach(uuid => {
                let pathInfo = resources[uuid];
                let fullpath = pathInfo.ofullpath || pathInfo.fullpath;
                if (Path.extname(fullpath) == ".png" ) {
                    allResource.push(fullpath);
                }
            });

            let exclude = Path.join(Constants.ASSETS_PATH,"dynamic")
            let files = Utils._getFilesWithExt(Constants.ASSETS_PATH, ['.png'], true);
            files.forEach(path => {
                if (allResource.indexOf(path) == -1 && path.indexOf(exclude) == -1) {
                    unuseImages.push(path.replace(Constants.ASSETS_PATH, ''));
                }
            })
            console.log('Unuse Image List: ' + unuseImages);

            let msg = '';
            unuseImages.forEach( (path) => {
                msg = msg + path +"\n"
            });
            
            if (msg.length>0) {
                console.log('Unuse Image List: ' + msg);
                let index = Editor.Dialog.messageBox({
                    type: 'info',
                    buttons: [Editor.T('MESSAGE.ok')],
                    title: '发现未使用的图片',
                    message: '未使用的图片:',
                    detail: msg,
                    buttons: ['关闭','拷贝到粘贴板'],
                    noLink: true,
                });
    
                if (index === 1) {
                    clipboard.writeText(msg);
                }
            }else{
                console.log('No Unuse Image');
            }
        }
    }

    // show dependence detail
    _showDependences() {
        if(globalstate._alldependence.length>0){
            globalstate._alldependence.sort();
            let msg = '相关依赖场景：\n' + globalstate._alldependence.join('\n') 
            let detail = '依赖项详情：\n';
            let inDependence = function(str) {
                for(let i = 0;i<globalstate._alldependence.length; i++) {
                    if (str.indexOf(globalstate._alldependence[i])>-1){
                        return true;
                    }
                }
                return false;
            }
            let keys = Object.keys(globalstate._alldependenceDetail).sort(function(a,b) {
                if (!inDependence(a)) {
                    return (!inDependence(b) && a>b);
                }

                if (!inDependence(b)) {
                    return inDependence(a) || a>b;
                }
                return a>b;
            })

            keys.forEach(function(key){
                let dependence = globalstate._alldependenceDetail[key]
                if (dependence.length>0) {
                    detail = detail + key + ":\n"
                    detail = detail + "    " + dependence.join('\n    ')
                    detail = detail + "\n\n"
                }
           });

            Editor.Dialog.messageBox({
                type: 'info',
                buttons: [Editor.T('MESSAGE.ok')],
                title: '导出完毕',
                message: msg,
                detail: detail,
                noLink: true,
              });
        }

        this._showBeDependence()
    }

    _showBeDependence() {
        let files = Utils._getFilesWithExt(Constants.ASSETS_PATH, ['.fire'], true);
        files = files.filter((item, index)=> {
            for (let i=0;this._state.selectedAsserts&&i<this._state.selectedAsserts.length;i++) {
                if(item.indexOf(Constants.ASSETS_PATH+"\\"+this._state.selectedAsserts[i].name+"\\")>-1 || item.indexOf(Constants.ASSETS_PATH+"/"+this._state.selectedAsserts[i].name+"/")>-1){
                    let select = this._state.selectedAsserts[i].select;
                    if (select) {
                        return false;
                    }
                }
            }

            for (let i=0;this._state._alldependence&&i<this._state._alldependence.length;i++) {
                if(item.indexOf(Constants.ASSETS_PATH+"\\"+this._state._alldependence[i]+"\\")>-1 || item.indexOf(Constants.ASSETS_PATH+"/"+this._state._alldependence[i].name+"/")>-1){
                    return false;
                }
            }
            return true;
        });

        if (files.length>0&&this._state.selectedAsserts) {
            //获取已导出的
            let allExport = this._state.selectedAsserts.filter((item,index)=>{
                if (item.select){
                    return true;
                }
                    
                for (let i=0;this._state._alldependence&&i<this._state._alldependence.length;i++) {
                    if(item == this._state._alldependence[i]){
                        return true;
                    }
                }
                return false;
            });

            let allUUID = {};
            for (let i=0;i<allExport.length;i++){
                let folder = allExport[i].name;
                let path = Path.join(Constants.ASSETS_PATH,folder,"image")
                if (fs.existsSync(path)){
                    //遍历所有.png.meta
                    let metas = Utils._getFilesWithExt(path, ['.meta'], true);
                    metas.forEach((key)=>{
                        if(key.indexOf('.png.meta')>-1){
                            let jsonData = JSON.parse(fs.readFileSync(key));
                            if (jsonData){
                                let subMetas = jsonData["subMetas"];
                                let keys = Object.keys(subMetas);
                                keys.forEach((k)=>{
                                    let uuid = subMetas[k].uuid;
                                    allUUID[uuid] = key.replace(Constants.ASSETS_PATH, '').replace(/.png.meta/i, ".png");
                                });
                            }
                        }
                    });
                }
            }

            //查找fire中包含uuid依赖的部分
            let beDependences = {}
            let keys = Object.keys(allUUID);
            if (keys.length>0){
                files.forEach((path)=>{
                    const buffer = fs.readFileSync(path);
                    let buffString = buffer.toString();
                    for(let k in allUUID){
                        if(buffString.indexOf(k)>-1){
                            if (beDependences[path]) {
                                beDependences[path].push(allUUID[k])
                            }
                            else{
                                beDependences[path] = [allUUID[k]]
                            }
                        }
                    }
                });
            }
            console.log(beDependences);

            if(Object.keys(beDependences).length>0){
                let msg = '有图片资源被其他场景使用：';
                let detail = '!!!若不处理依赖，请添加勾选以下场景并重新导出!!!\n\n';
                let keys = Object.keys(beDependences).sort(function(a,b) {
                    return a>b;
                })
    
                keys.forEach(function(key){
                    let dependence = beDependences[key]
                    if (dependence.length>0) {
                        detail = detail + key.replace(Constants.ASSETS_PATH, '') + ":\n"
                        detail = detail + "    " + dependence.join('\n    ')
                        detail = detail + "\n\n"
                    }
               });
    
                Editor.Dialog.messageBox({
                    type: 'info',
                    buttons: [Editor.T('MESSAGE.ok')],
                    title: '图片依赖',
                    message: msg,
                    detail: detail,
                    noLink: true,
                  });
            }
        }
    }

    // get all .fire file in assets folder
    _getFireList() {
        let files = Utils._getFilesWithExt(Constants.ASSETS_PATH, ['.fire'], true);

        if (this._state.selectedAsserts) {
            files = files.filter((item, index)=> {
                let hasthis = false;
                for (let i=0;i<this._state.selectedAsserts.length;i++) {
                    if(item.indexOf(Constants.ASSETS_PATH+"\\"+this._state.selectedAsserts[i].name+"\\")>-1 || item.indexOf(Constants.ASSETS_PATH+"/"+this._state.selectedAsserts[i].name+"/")>-1){
                        hasthis = this._state.selectedAsserts[i].select;
                        break;
                    }
                }
                return hasthis;
            });
        }
        
        return files;
    }

    _getJsonList() {
        return Utils._getFilesWithExt(Constants.JSON_PATH, ['.json'], true);
    }

    

    // dynamically load resources located at assets/resources folder
    _getDynamicLoadRes(uuidmap, collectedResources) {
        let state = Editor.remote.Profile.load(plugin_profile, Constants.PROFILE_DEFAULTS);
        if (!state.data.exportResourceDynamicallyLoaded)
            return;

        let dynamicLoadRes = {};
        let resourcesPath = Path.join(Constants.ASSETS_PATH, 'resources');

        Object.keys(uuidmap).forEach(function (uuid) {
            if (uuidmap[uuid].indexOf(resourcesPath) < 0)
                return true;

            dynamicLoadRes[uuid] = parse_utils.get_relative_full_path_by_uuid(uuid);
        });

        return dynamicLoadRes;
    }

    
}

registerWorker(BuildWorker, 'run-build-worker');
