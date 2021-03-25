
/* jslint node: true, sub: true, esversion: 6, browser: true */
/* globals Editor */

'use strict';

const Fs = require('fs');
const Path = require('path');
const Electron = require('electron');
const Constants = require(Editor.url('packages://creator-luacpp-support/core/Constants.js'));
const Project = require(Editor.url('packages://creator-luacpp-support/core/Project.js'));

const styleUrl = Editor.url('packages://creator-luacpp-support/panels/style.css');
const style = Fs.readFileSync(styleUrl);

const templateUrl = Editor.url('packages://creator-luacpp-support/panels/setup-project-panel.html');
const template = Fs.readFileSync(templateUrl);

Editor.Panel.extend({
    style: style,
    template: template,
    // return file list ends with `exts` in dir
    _getFilesWithExt: function(dir, exts, recursive) {
        let foundFiles = [];

        const files = Fs.readdirSync(dir);
        files.forEach((f) => {
            let fullpath = Path.join(dir, f)
            let ext = Path.extname(f);
            if (exts.includes(ext))
                foundFiles.push(fullpath);

            if (recursive) {
                let stats = Fs.lstatSync(fullpath);
                if (stats.isDirectory())
                    foundFiles = foundFiles.concat(this._getFilesWithExt(fullpath, exts, recursive));
            }
        });
        return foundFiles;
    },

    ready() {
        let opts = Editor.require('packages://creator-luacpp-support/package.json');       
        let profileProject = this.profiles.project;

        let allasserts = this._getFilesWithExt(Constants.ASSETS_PATH, ['.fire'], true).map(item=> {
            let sub = item.replace(Constants.ASSETS_PATH,"")
            return sub.match(/^[\\/](\w+)/)[1]
        });

        allasserts = allasserts.filter((item, index)=> {
            return allasserts.indexOf(item) === index
        });


        profileProject.data.asserts = [];
        allasserts.forEach((item,index,array)=>{
            profileProject.data.asserts[index] = {name:item,select:true}
        });


        let vm;
        window.vm = vm = this._vm = new window.Vue({
            el: this.shadowRoot,
            data: {
                selectedAsserts: profileProject.data.asserts,
                profileProject: profileProject,
                task: '',
                buildState: 'sleep',
                buildProgress: 0,
                version: opts.version,
                selectall: true,
            },

            watch: {
                project: {
                    handler(val) {
                        if (!profileProject.save) return;

                        profileProject.save();
                    },
                    deep: true
                }
            },

            methods: {
                _onChooseDistPathClick(event) {
                    event.stopPropagation();
                    let res = Editor.Dialog.openFile({
                        defaultPath: this.profileProject.data.path,
                        properties: ['openDirectory']
                    });
                    if (res && res[0]) {
                        this.profileProject.data.path = res[0];
                        this.profileProject.save();
                    }
                },

                _onShowInFinderClick(event) {
                    event.stopPropagation();
                    if (!Fs.existsSync(this.profileProject.data.path)) {
                        Editor.warn('%s not exists!', this.profileProject.data.path);
                        return;
                    }
                    Electron.shell.showItemInFolder(this.profileProject.data.path);
                    Electron.shell.beep();
                },

                _onBuildClick(event) {
                    event.stopPropagation();
                    Editor.Ipc.sendToMain('creator-luacpp-support:build', {
                        reason: 'ui',
                        profile: this.profileProject.data,
                        selectedAsserts: this.selectedAsserts
                    });
                },

                _onSetupClick(event) {
                    event.stopPropagation();
                    Editor.Panel.close('creator-luacpp-support');
                },

                _onChangeExportResourceOnly(event) {
                    event.stopPropagation();
                    this.profileProject.data.exportResourceOnly = event.target.value;
                    this.profileProject.save();
                },

                _onChangeExportDynamicallyLoadResource(event) {
                    event.stopPropagation();
                    this.profileProject.data.exportResourceDynamicallyLoaded = event.target.value;
                    this.profileProject.save();
                },

                _onChangeAutoBuild(event) {
                    event.stopPropagation();
                    this.profileProject.data.autoBuild = event.target.value;
                    this.profileProject.save();
                },

                _onChangeExportSpriteSheet(event) {
                    event.stopPropagation();
                    this.profileProject.data.exportSpriteSheet = event.target.value;
                    this.profileProject.save();
                },
                

                _onChangeSelectAllAssert(event) {
                    event.stopPropagation();
                    this.selectall = event.target.value;
                    this.selectedAsserts.forEach((item,index,array)=>{
                        item.select = this.selectall;
                    });

                    if (!this.selectall) {
                        this.profileProject.data.unuseImageCheck = false;
                        this.profileProject.save();
                    } 
                },

                _onChangeImageRepeatCheck(event) {
                    event.stopPropagation();
                    this.profileProject.data.imageRepeatCheck = event.target.value;
                    this.profileProject.save();
                },

                _onUnuseImageCheck(event) {
                    event.stopPropagation();
                    this.profileProject.data.unuseImageCheck = event.target.value && this.selectall;
                    this.profileProject.save();
                },

                _onChangeSelectOneAssert(event) {
                    event.stopPropagation();
                    let select = event.target.value;
                    if (!select) {
                        this.selectall = false;
                        this.profileProject.data.unuseImageCheck = false;
                        this.profileProject.save();
                    } 
                    let name = event.target.getAttribute("key");
                    this.selectedAsserts.forEach((item,index,array)=>{
                        if (item.name === name)
                            item.select = select;
                    });


                    if (select) {
                        let selall = true;
                        this.selectedAsserts.forEach((item,index,array)=>{
                            if(!item.select){
                                selall = false;
                            }
                        });
                        this.selectall = selall;
                    }
                }
            }
        });
    },

    _stateChanged: function(state, progress) {
        this._vm.buildProgress = progress;
        this._vm.buildState = state;
    },

    messages: {
        'creator-luacpp-support:state-changed'(event, state, progress) {
            this._stateChanged(state, progress);
        }
    }

});

