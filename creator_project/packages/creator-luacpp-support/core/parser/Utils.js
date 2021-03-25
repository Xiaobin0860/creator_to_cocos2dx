const path = require('path');
const fs = require('fs');
const state = require('./Global').state;
const Utils = require('../Utils');
const Constants = require('../Constants');
const plist = require('../plist');
let exportAtlas = Editor.remote.Profile.load('profile://project/creator-luacpp-support.json', Constants.PROFILE_DEFAULTS).data.exportSpriteSheet;

/**
 * Get resource path by uuid.
 * The return value:
 * @fullpath: full path of the resource
 * @relative_path: relative path to assets folder or creator default asset path
 */
let get_relative_full_path_by_uuid = function (uuid) {
    if (uuid in state._uuid)
        return state._uuid[uuid];

    let fullpath = Editor.remote.assetdb.uuidToFspath(uuid);
    let mountInfo = Editor.remote.assetdb.mountInfoByUuid(uuid);
    let root = mountInfo.path;
    let relative_path = fullpath.substring(root.length + 1);

    let result = {
        fullpath: fullpath,
        relative_path: relative_path
    };
    //needn't export dynamic texture
    if (relative_path.split(path.sep)[0] == 'dynamic') {
        return null
    }
    state._uuid[uuid] = result;

    return result;
}

let get_sprite_frame_json_by_uuid = function (uuid) {
    let jsonfile = uuidinfos[uuid];
    if (jsonfile) {
        let contents = fs.readFileSync(jsonfile);
        let contents_json = JSON.parse(contents);
        return contents_json;
    }
    else
        return null;
}

let is_sprite_frame_from_texture_packer = function (uuid) {
    let json = get_sprite_frame_json_by_uuid(uuid);
    if (json)
        return json.content.atlas !== '';
    else
        return false;
}


/**
 * The sprite frame name will include path information if it is not a texture packer
 */
let get_sprite_frame_name_by_uuid = function (uuid) {
    if (uuid in state._sprite_frames) {
        let uuid_info = state._sprite_frames[uuid];
        if (uuid_info.is_texture_packer)
            return uuid_info.name;
        else
            return uuid_info.texture_path;
    }
    else {
        let contents_json = get_sprite_frame_json_by_uuid(uuid);
        if (contents_json) {
            let metauuid;
            let texture_uuid = contents_json.content.texture;
            let is_texture_packer = false;
            if (contents_json.content.atlas !== '') {
                // texture packer
                metauuid = contents_json.content.atlas;
                is_texture_packer = true;
            }
            else
                // a single picture
                metauuid = texture_uuid;

            // handle texture path

            let path_info = get_relative_full_path_by_uuid(texture_uuid);
            // dynamic
            if (!path_info) {
                return null
            }
            let found_sprite_frame_name = null;
            let meta = null;
            for (var i = 0; i < 5; i++) {
                try {
                    // get texture frames information
                    meta = Editor.remote.assetdb._uuid2meta[metauuid].__subMetas__;
                    break;
                } catch (e) {
                    if (i == 4) {
                        let jsonfile = uuidinfos[uuid];
                        Utils.log('can not get sprite frame name of uuid ' + uuid);
                        Utils.log('jsonfile: ' + jsonfile);
                        Utils.log('metauuid: ' + metauuid);
                        let contents = fs.readFileSync(jsonfile);
                        Utils.log('contents: ' + contents);
                        throw (e);
                    } else {
                        console.log('retry ' + metauuid, i);
                    }
                }
            }

            let match = path_info.relative_path.match(/[\\/]image[\\/]/)

            if (!is_texture_packer && exportAtlas && match != null) {
                Object.keys(meta).forEach(sprite_frame_name => {
                    let data = meta[sprite_frame_name];
                    let folder_name = path_info.relative_path.substring(0, match.index)
                    let sprite_frame_info = new Object();
                    Object.keys(data).forEach(key => {
                        sprite_frame_info[key] = data[key];
                    })
                    sprite_frame_info.name = folder_name + "/" + sprite_frame_name + '.png';
                    sprite_frame_info.texture_path = path_info.relative_path;
                    sprite_frame_info.is_texture_packer = true;

                    if (!(folder_name in state._atlases)) {
                        //依赖项，未打包，需要先打包
                        state._dependence.unshift(folder_name)
                        buildAtlasesSync(path.join(Constants.ASSETS_PATH,sprite_frame_info.name))
                    }

                    if (folder_name in state._atlases) {
                        let sprite_png = sprite_frame_name + '.png'

                        let atlas_info = state._atlases[folder_name][sprite_png]

                        if (atlas_info && folder_name != state._currentFireFolder) {
                            //如果依赖项是非自身文件夹，添加记录
                            state._dependencePath.unshift(sprite_frame_info.texture_path)
                        }

                        atlas_info = atlas_info || state._atlases['Share'][sprite_png];
                        if (atlas_info) {

                            let reg = /-?\d+,-?\d+/
                            let rect_origin = atlas_info.textureRect.match(reg)[0].split(',');
                            sprite_frame_info.trimX = parseInt(rect_origin[0]);
                            sprite_frame_info.trimY = parseInt(rect_origin[1]);
                            let size = atlas_info.spriteSize.match(reg)[0].split(',');
                            sprite_frame_info.width = parseInt(size[0]);
                            sprite_frame_info.height = parseInt(size[1]);
                            sprite_frame_info.rotated = atlas_info.textureRotated;
                            let offset = atlas_info.spriteOffset.match(reg)[0].split(',');
                            sprite_frame_info.offsetX = parseInt(offset[0]);
                            sprite_frame_info.offsetY = parseInt(offset[1]);
                            let plist_png = folder_name + '.png'
                            sprite_frame_info.texture_path = path.join(folder_name, plist_png)
                            let uuid_data = state._uuid[texture_uuid]

                            if (uuid_data.ofullpath == null) {
                                uuid_data.ofullpath = uuid_data.fullpath
                            }

                            if (uuid_data.orelative_path == null) {
                                uuid_data.orelative_path = uuid_data.relative_path
                            }

                            uuid_data.fullpath = uuid_data.fullpath.replace(/image\S+/, plist_png);
                            uuid_data.fullpath = uuid_data.fullpath.replace(Constants.ASSETS_PATH, Constants.ATLASES_PATH);
                            uuid_data.relative_path = uuid_data.fullpath.substr(Constants.ASSETS_PATH.length + 1);
                        } else {
                            Utils.log(folder_name + '\\image\\' + sprite_frame_name + '.png not find')
                        }
                    }else {
                        Utils.log('no atlases: ' + folder_name);
                    }

                    let sprite_frame_uuid = sprite_frame_info.uuid;
                    state._sprite_frames[sprite_frame_uuid] = sprite_frame_info;

                    if (sprite_frame_uuid == uuid) {
                        found_sprite_frame_name = sprite_frame_info.name;
                    }
                });
            } else {
                Object.keys(meta).forEach(sprite_frame_name => {
                    //Utils.log('sprite_frame_name: ' + sprite_frame_name)
                    let sprite_frame_info = meta[sprite_frame_name];
                    sprite_frame_info.name = sprite_frame_name;
                    sprite_frame_info.texture_path = path_info.relative_path;
                    sprite_frame_info.is_texture_packer = is_texture_packer;

                    let sprite_frame_uuid = sprite_frame_info.uuid;
                    state._sprite_frames[sprite_frame_uuid] = sprite_frame_info;
                    if (sprite_frame_uuid == uuid) {
                        if (is_texture_packer)
                            found_sprite_frame_name = sprite_frame_name;
                        else
                            found_sprite_frame_name = sprite_frame_info.texture_path;
                    }
                });
            }
            return found_sprite_frame_name;
        }
        else {
            module.exports.log('can not get sprite frame name of uuid ' + uuid);
            return null;
        }
    }
}

let get_font_path_by_uuid = function (uuid) {
    if (uuid in state._uuid)
        return state._uuid[uuid].relative_path;
    else {
        let jsonfile = uuidinfos[uuid];
        if (jsonfile) {
            let current_dir = path.basename(jsonfile, '.json');
            let contents = fs.readFileSync(jsonfile);
            let contents_json = JSON.parse(contents);
            let type = contents_json.__type__;
            // creator copy resources into the uuid folder
            let res_dir = path.join(path.dirname(jsonfile), uuid);

            if (type === 'cc.BitmapFont') {
                // png path
                let png_uuid = contents_json.spriteFrame.__uuid__;
                let json_png = JSON.parse(fs.readFileSync(uuidinfos[png_uuid]));
                let png_path_info = get_relative_full_path_by_uuid(json_png.content.texture);
                state._uuid[png_uuid] = png_path_info;

                // fnt path
                state._uuid[uuid] = {
                    fullpath: Utils.replaceExt(png_path_info.fullpath, '.fnt'),
                    relative_path: Utils.replaceExt(png_path_info.relative_path, '.fnt')
                }

                return state._uuid[uuid].relative_path;
            }
            else if (type === 'cc.TTFFont') {
                state._uuid[uuid] = {
                    fullpath: path.join(res_dir, contents_json._native),
                    relative_path: current_dir + '/' + contents_json._native
                }

                return state._uuid[uuid].relative_path;
            }
            else {
                return 'xxx';
            }
        }
        else {
            module.exports.log('can not get bmfont path of uuid ' + uuid);
            return 'xxx';
        }
    }
}

/**
 * return json file path and atlas path
 */
let get_spine_info_by_uuid = function (uuid) {
    if (uuid in state._uuid)
        return state._uuid[uuid];

    let jsonfile = uuidinfos[uuid];
    if (jsonfile) {
        let contents = fs.readFileSync(jsonfile);
        let contents_json = JSON.parse(contents);
        let current_dir = path.basename(jsonfile, '.json');

        let res_dir = path.join(path.dirname(jsonfile), uuid);

        let files = fs.readdirSync(res_dir);
        files.forEach(function (file) {
            let fullpath = path.join(res_dir, file);
            //FIXME: have more than one json file?
            state._uuid[uuid] = { fullpath: fullpath, relative_path: current_dir + '/' + file };
        });

        // get atlas path
        state._uuid[uuid].atlas_url = get_relative_full_path_by_uuid(contents_json.atlasUrl.__uuid__);
        // add to _uuid to copy resources
        state._uuid[uuid + '-atlas'] = state._uuid[uuid].atlas_url;

        // get textures path
        for (let i = 0, len = contents_json.textures.length; i < len; ++i) {
            let texture = contents_json.textures[i];
            // just create a unique key
            let new_key = uuid + '-texture-' + i;
            state._uuid[new_key] = get_relative_full_path_by_uuid(texture.__uuid__);
        }

        return state._uuid[uuid];
    }
}

let get_tiledmap_path_by_uuid = function (uuid) {
    if (uuid in state._uuid)
        return state._uuid.relative_path;

    // from the json file, we can only get texture path
    // so should use the texture path to get tmx path
    let jsonfile = uuidinfos[uuid];
    if (jsonfile) {
        let contents = fs.readFileSync(jsonfile);
        let contents_json = JSON.parse(contents);

        // record texture path
        let tmx_texture_info = {};
        contents_json.textures.forEach(function (texture_info) {
            tmx_texture_info = get_relative_full_path_by_uuid(texture_info.__uuid__);
        });

        // get tmx path
        let tmx_relative_path = Utils.replaceExt(tmx_texture_info.relative_path, '.tmx');
        let tmx_fullpath = Utils.replaceExt(tmx_texture_info.fullpath, '.tmx');
        state._uuid[uuid] = {
            relative_path: tmx_relative_path,
            fullpath: tmx_fullpath
        };

        return tmx_relative_path;
    }
}

let DEBUG = false;
log = function (s) {
    if (DEBUG)
        Utils.log(s);
}

let create_node = function (node_type, node_data) {
    const Node = require('./Node');
    const Button = require('./Button');
    const Canvas = require('./Canvas');
    const EditBox = require('./EditBox');
    const Label = require('./Label');
    const ParticleSystem = require('./ParticleSystem');
    const ProgressBar = require('./ProgressBar');
    const RichText = require('./RichText');
    const ScrollView = require('./ScrollView');
    const SpineSkeleton = require('./SpineSkeleton');
    const Sprite = require('./Sprite');
    const TiledMap = require('./TiledMap');
    const VideoPlayer = require('./VideoPlayer');
    const WebView = require('./WebView');
    const Slider = require('./Slider');
    const Toggle = require('./Toggle');
    const ToggleGroup = require('./ToggleGroup');
    const PageView = require('./PageView');
    const Mask = require('./Mask');
    const Prefab = require('./Prefab');
    const DragonBones = require('./DragonBones');
    const MotionStreak = require('./MotionStreak');

    let n = null;
    if (node_type === 'cc.Node')
        n = new Node(node_data);
    else if (node_type === 'cc.Sprite')
        n = new Sprite(node_data);
    else if (node_type === 'cc.Canvas')
        n = new Canvas(node_data);
    else if (node_type === 'cc.Label')
        n = new Label(node_data);
    else if (node_type === 'cc.RichText')
        n = new RichText(node_data);
    else if (node_type === 'cc.Button')
        n = new Button(node_data);
    else if (node_type === 'cc.ProgressBar')
        n = new ProgressBar(node_data);
    else if (node_type === 'cc.ScrollView')
        n = new ScrollView(node_data);
    else if (node_type === 'cc.EditBox')
        n = new EditBox(node_data);
    else if (node_type === 'cc.TiledMap')
        n = new TiledMap(node_data);
    else if (node_type === 'cc.ParticleSystem')
        n = new ParticleSystem(node_data);
    else if (node_type === 'sp.Skeleton')
        n = new SpineSkeleton(node_data);
    else if (node_type === 'cc.VideoPlayer')
        n = new VideoPlayer(node_data);
    else if (node_type === 'cc.WebView')
        n = new WebView(node_data);
    else if (node_type === 'cc.Slider')
        n = new Slider(node_data);
    else if (node_type === 'cc.Toggle')
        n = new Toggle(node_data);
    else if (node_type === 'cc.ToggleGroup')
        n = new ToggleGroup(node_data);
    else if (node_type === 'cc.PageView')
        n = new PageView(node_data);
    else if (node_type === 'cc.Mask')
        n = new Mask(node_data);
    else if (node_type === 'cc.Prefab')
        n = new Prefab(node_data);
    else if (node_type === 'dragonBones.ArmatureDisplay')
        n = new DragonBones(node_data);
    else if (node_type === 'cc.MotionStreak')
        n = new MotionStreak(node_data);

    if (n != null)
        n.parse_properties();

    return n;
}

/**
 * remove a child from node's children by child's id
 * @param {node} the Node that to be applied to 
 * @param {id} child's id
 */
let remove_child_by_id = function (node, id) {
    let children = node._node_data._children;
    for (let i = 0, len = children.length; i < len; ++i) {
        let child = children[i];
        if (child.__id__ === id) {
            children.splice(i, 1);
            break;
        }
    }
}


let buildAtlasesSync = function(filename) {
    let sub_folder = path.dirname(filename).substr(Constants.ASSETS_PATH.length + 1);

    let out_path = path.join(Constants.ATLASES_PATH, sub_folder, sub_folder);
    let file_plist = out_path + '.plist'
    let imagePath = path.join(Constants.ASSETS_PATH, sub_folder, 'image');
    let rt = 0;
    if (fs.existsSync(imagePath)){
        //let params = [Path.join(Constants.ASSETS_PATH, sub_folder, 'image'), '--sheet', out_path + '.png', '--data', file_plist, '--texture-format', 'png8',
        //    '--dither-type', 'PngQuantHigh', '--format', 'cocos2d-x'];
        let params = [imagePath, '--sheet', out_path + '.png', '--data', file_plist, '--format', 'cocos2d-x', '--shape-padding', '2', '--quiet'];
        rt = Utils.runcommandSync('TexturePacker', params);
        if (rt === 0) {
            Utils.log("export atlases success")
        }
        else {
            throw new Error("buildAtlasesSync error!!!");
        }
        if (fs.existsSync(file_plist)) {
            let file_data = fs.readFileSync(file_plist, 'utf8')
            let contents = plist.parse(file_data);
            state._atlases[sub_folder] = contents['frames'];
        }
    }
    
    return rt
}


let buildAtlases = function(filenames, cb) {
    let builded = {}
    let i = 0
    filenames.forEach(function (filename) {
        let sub_folder = path.dirname(filename).substr(Constants.ASSETS_PATH.length + 1);
        let imagePath = path.join(Constants.ASSETS_PATH, sub_folder, 'image');
        
        let hasPNG = false;
        if (fs.existsSync(imagePath)) {
            let files = fs.readdirSync(imagePath);//需要用到同步读取
            for (let i = 0, len = files.length; i < len; ++i) {
                let file = files[i];
                if(/\.png$/.test(file)) {
                    hasPNG = true;
                    break;
                }
            }
        }

        if (!builded[sub_folder] && hasPNG ) {
            builded[sub_folder] = true;
            let out_path = path.join(Constants.ATLASES_PATH, sub_folder, sub_folder);
            let file_plist = out_path + '.plist'
            //let params = [Path.join(Constants.ASSETS_PATH, sub_folder, 'image'), '--sheet', out_path + '.png', '--data', file_plist, '--texture-format', 'png8',
            //    '--dither-type', 'PngQuantHigh', '--format', 'cocos2d-x'];
            
            let params = [imagePath, '--sheet', out_path + '.png', '--data', file_plist, '--format', 'cocos2d-x', '--shape-padding', '2', '--quiet'];
            Utils.runcommand('TexturePacker', params, (st) => {
                if (st !== 0) {
                    console.warn(imagePath)
                    throw new Error("buildAtlases error!!!");
                }
                if (fs.existsSync(file_plist)) {
                    let file_data = fs.readFileSync(file_plist, 'utf8')
                    let contents = plist.parse(file_data);
                    state._atlases[sub_folder] = contents['frames'];
                }else {

                }
                ++i;
                if (i === filenames.length) {
                    Utils.log('export atlases success');
                    cb();
                }
            })
            
        } else {
            ++i;
            if (i === filenames.length)
                cb();
        }
    });
}

module.exports = {
    get_relative_full_path_by_uuid: get_relative_full_path_by_uuid,
    get_sprite_frame_name_by_uuid: get_sprite_frame_name_by_uuid,
    get_font_path_by_uuid: get_font_path_by_uuid,
    get_spine_info_by_uuid: get_spine_info_by_uuid,
    get_tiledmap_path_by_uuid: get_tiledmap_path_by_uuid,
    create_node: create_node,
    log: log,
    buildAtlases: buildAtlases,
    remove_child_by_id: remove_child_by_id,
    get_sprite_frame_json_by_uuid: get_sprite_frame_json_by_uuid,
    is_sprite_frame_from_texture_packer: is_sprite_frame_from_texture_packer,
}
