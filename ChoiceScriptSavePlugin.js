// Ext function toggle (set true/false to enable/disable)
var btn_delete_all = true;
var btn_export = true;
var btn_export_all = true;
var btn_import = true;

// set length (in ms) to delay before executing
var timeoutLength = 100; // default value: 3000

/* ----- New ChoiceScript Commands ----- */
Scene.prototype.sm_save = function(line) {
    var stack = this.tokenizeExpr(line);
    if (stack.length > 2)
        throw new Error("sm_save: Invalid number of arguments, expected 0, 1 (save name) or 2 (id).");
    ChoiceScriptSavePlugin._save(new Date().getTime(), stack.length === 1 ? this.evaluateExpr(stack) : null);
}

Scene.prototype.sm_load = function(line) {
    var stack = this.tokenizeExpr(line);
    var variable = this.evaluateExpr(stack);
    this.finished = true;
    this.skipFooter = true;
    this.screenEmpty = true;
    ChoiceScriptSavePlugin._load(variable);
}

Scene.prototype.sm_delete = function(line) {
    var stack = this.tokenizeExpr(line);
    if (stack.length !== 1) {
        throw new Error("sm_delete: Invalid number of arguments, expected 1.");
    }
    ChoiceScriptSavePlugin._delete(this.evaluateExpr(stack));
}

Scene.prototype.sm_update = function() {
    if (typeof this.stats._sm_save_count === "undefined")
        this.stats._sm_save_count = 0;
    ChoiceScriptSavePlugin._getSaveList(function(saveList) {
        if (!saveList)
            return;
        ChoiceScriptSavePlugin._syncHelperVariables(saveList, function() {});
    });
}

Scene.prototype.sm_menu = function(data) {
    data = data || "";
    data = data.toLowerCase();
    var selectEle = document.getElementById("quickSaveMenu");
    if (!selectEle)
        return;
    var active = false;
    if (data === "false") {
        active = false;
    } else if (data === "true") {
        active = true;
    } else if (!data) { // toggle
        active = selectEle.style.display === 'none';
    } else {
        throw new Error("*sm_menu: expected true, false (or nothing) as an argument!");
    }
    selectEle.style.display = active ? "inline" : "none";
    var btns = document.getElementsByClassName("savePluginBtn");
    for (var i = 0; i < btns.length; i++) {
        btns[i].style.display = active ? "inline" : "none";
    }
}

Scene.validCommands["sm_save"] = 1;
Scene.validCommands["sm_load"] = 1;
Scene.validCommands["sm_delete"] = 1;
Scene.validCommands["sm_update"] = 1;
Scene.validCommands["sm_menu"] = 1;

/* ----- FrameWork Functionality (Internal) ----- */

var ChoiceScriptSavePlugin = {}

ChoiceScriptSavePlugin._CSS =
    "#quickSaveMenu {\
        margin: 5px;\
        width: 100px;\
    }";

/* Saving once a page has finished loading causes a lot of problems.
   However, ChoiceScript already stores a working save at the top of every page,
   so we can just copy that save over to the specified slot. */
ChoiceScriptSavePlugin._save = function(saveId, saveName) {
    restoreObject(initStore(), "state", null, function(baseSave) {
        if (baseSave) {
            baseSave.stats["_smSaveName"] = saveName || "";
            baseSave.stats["_smSaveDateId"] = saveId;
            saveCookie(function() {
                recordSave(saveId, function() {
                    ChoiceScriptSavePlugin._populateSaveMenu();
                });
            }, ChoiceScriptSavePlugin._formatSlotName(saveId), baseSave.stats, baseSave.temps, baseSave.lineNum, baseSave.indent, this.debugMode, this.nav);
        } else {
            alertify.error('Could not create save');
        }
    });
}

/* Utility function to grab a slots (near) full name:
     Save data is stored in the form:
        'state' + STORE_NAME + '_SAVE_' + dateId
    Where 'state' is something ChoiceScript uses internally,
    STORE_NAME is provided in the game's index.html,
    and dateId is the unique handle/key stored in the save list.

    Note that 'state' is not included here, as we use some internal
    CS functions that already add it. Instead we hard-code it in the
    few places we rely directly on the persist.js API.
*/
ChoiceScriptSavePlugin._formatSlotName = function(saveId){
    return (window.storeName + '_SAVE_' + saveId);
}

ChoiceScriptSavePlugin._load = function(saveId) {
    clearScreen(loadAndRestoreGame.bind(stats.scene, ChoiceScriptSavePlugin._formatSlotName(saveId)));
}

ChoiceScriptSavePlugin._delete = function(saveId) {
    ChoiceScriptSavePlugin._removeFromSaveList(saveId, function(success) {
        if (!success) {
            return;
        }
        var select = document.getElementById("quickSaveMenu");
        if (select) {
            var deletedOption = select.options[select.selectedIndex];
            if (deletedOption)
                deletedOption.parentElement.removeChild(deletedOption);
        }
        initStore().remove("state" + ChoiceScriptSavePlugin._formatSlotName(saveId), function(success, val) {
            // Likely there's nothing to delete
        });
    });
}

ChoiceScriptSavePlugin._delete_all = function () {
    ChoiceScriptSavePlugin._getSaveList(function (saveList) {
        if (!saveList)
            return;
        saveList.forEach(function (saveId) {
            initStore().remove('state' + ChoiceScriptSavePlugin._formatSlotName(saveId), function () {});
        });
        initStore().set('save_list', toJson([]), function() {
            setTimeout(function () {
                ChoiceScriptSavePlugin._populateSaveMenu();
            }, timeoutLength);
        });
    });
}

ChoiceScriptSavePlugin._export = function (exportName, saveId) {
    initStore().get('state' + ChoiceScriptSavePlugin._formatSlotName(saveId), function (ok, value) {
        if (ok) {
            var saveItem = 'PS' + window.storeName.replace(/_/g, '__') + 'PSstate' + ChoiceScriptSavePlugin._formatSlotName(saveId) + ':"';
            saveItem += value + '"';
            ChoiceScriptSavePlugin._export_file(exportName, saveItem);
        }
    });
}

ChoiceScriptSavePlugin._export_all = function (exportName) {
    ChoiceScriptSavePlugin._getSaveList(function (saveList) {
        if (!saveList)
            return;
        var saveItem = '';
        var promises = [];
        saveList.forEach(function (saveId) {
            promises.push(new Promise((resolve, reject) => {
                initStore().get('state' + ChoiceScriptSavePlugin._formatSlotName(saveId), function (ok, value) {
                    if (ok) {
                        if (saveItem !== '') {
                            saveItem += "\n";
                        }
                        saveItem += 'PS' + window.storeName.replace(/_/g, '__') + 'PSstate' + ChoiceScriptSavePlugin._formatSlotName(saveId) + ':"';
                        saveItem += value + '"';
                    }
                    resolve();
                });
            }));
        });

        Promise.all(promises).then(function() {
            ChoiceScriptSavePlugin._export_file(exportName, saveItem);
        });
    });
}

ChoiceScriptSavePlugin._export_file = function (exportName, saveItem) {
    var textFile = new Blob([saveItem], { type: 'text/plain;charset=utf-8' });

    // create pseudo-hyperlink
    var exportLink = document.createElement('a');
    var textFileUrl = window.URL.createObjectURL(textFile);
    exportLink.setAttribute('id', 'exportLink');
    exportLink.setAttribute('href', textFileUrl);
    exportLink.setAttribute('download', (exportName || (window.storeName + ' - Save')) + '.txt');
    exportLink.click();

    // remove hyperlink after use
    window.URL.revokeObjectURL(textFileUrl);
    if (document.getElementById('exportLink')) {
        document.getElementById('exportLink').remove();
    }
};

ChoiceScriptSavePlugin._import = function (fileContent) {
    if (!fileContent) {
        alertify.alert('File is empty!');
        return;
    }
    var saveLines = fileContent.split(/\r*\n/);
    saveLines = saveLines.filter(function (line) {
        return line !== '';
    });
    var storeKey = 'PS' + window.storeName.replace(/_/g, '__') + 'PSstate';
    var storeKeyLength = storeKey.length;

    var errorCheck = '';

    var newSaveList = [];
    for (i = 0; i < saveLines.length; i++) {
        if (saveLines[i].substring(0, storeKeyLength) !== storeKey) {
            errorCheck = 'Save line ' + (i + 1) + ' error: Save key does not match this game\'s store key!';
            break;
        } else {
            var saveSlotName = saveLines[i].substring(storeKeyLength, saveLines[i].indexOf(":"));
            var saveSlotToken = saveLines[i].substring(saveLines[i].indexOf(':') + 2, saveLines[i].length - 1);
            saveSlotToken = saveSlotToken.replace(/^[^{]*/, '');
            saveSlotToken = saveSlotToken.replace(/[^}]*$/, '');
            var saveSlotState;
            try {
                saveSlotState = jsonParse(saveSlotToken);
            } catch (e) {
                errorCheck = 'Save line ' + (i + 1) + ' error: Cannot parse save state!'
                break;
            }
            saveCookie(function () {}, saveSlotName, saveSlotState.stats, saveSlotState.temps, saveSlotState.lineNum, saveSlotState.indent, this.debugMode, this.nav);
            newSaveList.push(saveSlotState.stats['_smSaveDateId']);
        }
    }
    // Store all imported save slots in one go, otherwise we run into async issues with multiple saves
    ChoiceScriptSavePlugin._addToSaveList(newSaveList, function () {
        setTimeout(function () {
            ChoiceScriptSavePlugin._populateSaveMenu();
        }, timeoutLength);
    });
    if (errorCheck !== '') {
        alertify.error(errorCheck);
    }
}

ChoiceScriptSavePlugin._createQuickSaveMenu = function() {

    var p = document.getElementById("restartButton").parentElement;
    if (!p) {
        alert("Error: unable to attach quick save menu");
        return;
    }

    // CSS
    var head = document.getElementsByTagName("head")[0];
    var style = document.createElement("style");
    style.innerHTML = ChoiceScriptSavePlugin._CSS;
    head.appendChild(style);

    // HTML
    var selectEle = document.createElement("select");
    selectEle.setAttribute("id", "quickSaveMenu");

    p.appendChild(selectEle);

    var buttonArr = [{
            "innerHTML": "New Save",
            "clickFunc": "ChoiceScriptSavePlugin.save();"
        },
        {
            "innerHTML": "Load",
            "clickFunc": "ChoiceScriptSavePlugin.load();"
        },
        {
            "innerHTML": "Delete",
            "clickFunc": "ChoiceScriptSavePlugin.delete();"
        }
    ];
    if (btn_delete_all) {
        buttonArr.push({
            'innerHTML': 'Delete All',
            'clickFunc': 'ChoiceScriptSavePlugin.delete_all();'
        });
    }
    if (btn_export) {
        buttonArr.push({
            'innerHTML': 'Export',
            'clickFunc': 'ChoiceScriptSavePlugin.export();'
        });
    }
    if (btn_export_all) {
        buttonArr.push({
            'innerHTML': 'Export All',
            'clickFunc': 'ChoiceScriptSavePlugin.export_all();'
        });
    }
    if (btn_import) {
        buttonArr.push({
            'innerHTML': 'Import',
            'clickFunc': 'document.getElementById("import").click();'
        });
        var input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('id', 'import');
        input.setAttribute('name', 'import');
        input.setAttribute('accept', '.txt');
        input.setAttribute('style', 'display:none;');
        input.setAttribute('onchange', 'ChoiceScriptSavePlugin.import_file(this)');
        p.appendChild(input);
    }

    for (var i = 0; i < buttonArr.length; i++) {
        var btn = document.createElement("button");
        btn.innerHTML = buttonArr[i].innerHTML;
        btn.setAttribute("class", "spacedLink savePluginBtn");
        btn.setAttribute("onclick", buttonArr[i].clickFunc);
        p.appendChild(btn);
    }
}

/* Add the 'option' elements to the given selection input */
ChoiceScriptSavePlugin._populateSaveMenu = function() {
    var selectEle = document.getElementById('quickSaveMenu');
    if (selectEle) {
        selectEle.innerHTML = "";
        ChoiceScriptSavePlugin._getSaveList(function(saveList) {
            if (!saveList)
                return;
            saveList.forEach(function(saveId) {
                /* Grab the save data, so we can give it a nice title via _saveName */
                ChoiceScriptSavePlugin._getSaveData(saveId, function(saveData) {
                    if (!saveData) {
                        return;
                    }
                    var option = document.createElement("option");
                    option.setAttribute("value", saveData.stats._smSaveDateId /* time/date */ );
                    if (!saveData) {
                        option.innerHTML = "Failed to load save.";
                    } else {
                        var slotDesc = saveData.stats.sceneName + '.txt (' + simpleDateTimeFormat(new Date(parseInt(saveData.stats._smSaveDateId))) + ')';
                        if (saveData.stats._smSaveName) {
                            slotDesc = saveData.stats._smSaveName + " &mdash; " + slotDesc;
                        }
                        option.innerHTML = slotDesc;
                    }
                    selectEle.appendChild(option);
                });
            });
        });
    }
}

ChoiceScriptSavePlugin._getSaveData = function(saveId, callback) {
    restoreObject(initStore(), "state" + ChoiceScriptSavePlugin._formatSlotName(saveId), null, function(saveData) {
        if (saveData) {
            callback(saveData);
        } else {
            /* Something went wrong. */
            callback(null);
        }
    });
}

/* The save list is a json encoded array of timestamps, e.g.
        [1581976656199,1581976297095,1581976660752]
    We use this to keep a record of stored save keys/handles.
*/
ChoiceScriptSavePlugin._addToSaveList = function(saveIds, callback) {
    ChoiceScriptSavePlugin._getSaveList(function(saveList) {
        if (!saveList) {
            return;
        }
        saveIds.forEach(function(saveId) {
            // Prevent duplicates
            const index = saveList.indexOf(saveId);
            if (index === -1) {
                saveList.push(saveId);
            }
        });
        initStore().set('save_list', toJson(saveList), function(success) {
            ChoiceScriptSavePlugin._syncHelperVariables(saveList, function() {
                callback(success);
            })
        });
    });
}

ChoiceScriptSavePlugin._removeFromSaveList = function(saveId, callback) {
    ChoiceScriptSavePlugin._getSaveList(function(saveList) {
        if (!saveList) {
            return;
        }
        const index = saveList.indexOf(saveId);
        if (index > -1) {
            saveList.splice(index, 1);
        }
        initStore().set('save_list', toJson(saveList), function(success) {
            ChoiceScriptSavePlugin._syncHelperVariables(saveList, function() {
                callback(success);
            })
        });
    });
}

ChoiceScriptSavePlugin._syncHelperVariables = function(saveList, callback) {
    self.stats._sm_save_count = saveList.length;
    saveList.forEach(function(save, index) {
        ChoiceScriptSavePlugin._getSaveData(save, function(saveData) {
            if (saveData) {
                self.stats["_sm_save_id_" + index] = save;
                self.stats["_sm_save_name_" + index] = saveData.stats._smSaveName || "";
                self.stats["_sm_save_date_" + index] = simpleDateTimeFormat(new Date(parseInt(save)));
            }
        });
    });
    callback();
}

/* Pull the list of stored 'saves' from the store by store name */
ChoiceScriptSavePlugin._getSaveList = function(callback) {
    initStore().get('save_list', function(success, saveList) {
        if (!success) {
            callback(null);
        } else {
            // Upgrade old save_list from string to json
            var isJson = true;
            try {
                var parsedList = jsonParse(saveList);
                if (typeof parsedList !== 'object') {
                    isJson = false;
                }
            } catch (e) {
                saveList = [];
                isJson = false;
            }
            if (!isJson) {
                parsedList = saveList.split(' ').map((saveId) => parseInt(saveId));
                // Write back converted value to storage
                initStore().set('save_list', toJson(parsedList), function() {});
            }

            parsedList = parsedList.sort(function(a, b) {
                return b - a;
            });
            callback(parsedList);
        }
    });
}

ChoiceScriptSavePlugin._init = function() {
    // don't initialize until save system has been initialized
    if (!Persist._init) {
        setTimeout(ChoiceScriptSavePlugin._init, timeoutLength);
        return;
    }
    if (!window.storeName) {
        // disallow sm_ commands as they depend on a store
        Scene.validCommands["sm_save"] = 0;
        Scene.validCommands["sm_load"] = 0;
        Scene.validCommands["sm_delete"] = 0;
        Scene.validCommands["sm_menu"] = 0;
        Scene.validCommands["sm_menu"] = 0;
        return alertify.error("Disabling ChoiceScript Save Plugin as there is no storeName detected. Please check your index.html.");
    }
    ChoiceScriptSavePlugin._createQuickSaveMenu();
    ChoiceScriptSavePlugin._populateSaveMenu();
}

/* ----- FrameWork Functionality (External) ----- */

ChoiceScriptSavePlugin.save = function() {
    if (stats.sceneName === "choicescript_stats") {
        alert("Error: Unable to save at this point.");
        return;
    }
    var date = new Date();
    var message = "What would you like to call this save?<br>Leaving this blank will result in a scene and date identifier.";

    alertify.prompt(message, function(e, saveName) {
        if (e) {
            ChoiceScriptSavePlugin._save(date.getTime(), saveName);
        } else {
            // user cancelled
        }
    }, '' /* default value */);
}

ChoiceScriptSavePlugin.delete = function() {
    var select = document.getElementById("quickSaveMenu");
    if (select.value <= 0)
        return;
    var message = "Delete save '" + select.options[select.selectedIndex].text + '\'?<br>This cannot be undone!';
    alertify.confirm(message, function(result) {
        if (!result) {
            return;
        } else {
            ChoiceScriptSavePlugin._delete(parseInt(select.value));
        }
    });
}

ChoiceScriptSavePlugin.load = function() {
    var select = document.getElementById("quickSaveMenu");
    if (select.value <= 0)
        return;
    alertify.confirm("Are you sure you wish to load this save?<br>Current progress will be lost!", function(result) {
        if (!result) {
            return;
        } else {
            ChoiceScriptSavePlugin._load(select.value);
        }
    });
}

ChoiceScriptSavePlugin.delete_all = function () {
    var message = 'Delete all saves?<br>This cannot be undone!';
    alertify.confirm(message, function (result) {
        if (!result) {
            return;
        } else {
            ChoiceScriptSavePlugin._delete_all();
        }
    });
}

ChoiceScriptSavePlugin.export = function () {
    if (!window.Blob) {
        alertify.alert('Unable to export saves on this browser!');
        return;
    }
    var select = document.getElementById('quickSaveMenu');
    if (select.value <= 0)
        return;
    var date = new Date();
    var message = 'What would you like to call this export file?<br>Leaving this blank will result in a game identifier.';

    alertify.prompt(message, function (e, exportName) {
        if (e) {
            ChoiceScriptSavePlugin._export(exportName, select.value);
        } else {
            // user cancelled
        }
    }, '' /* default value */);
}

ChoiceScriptSavePlugin.export_all = function () {
    if (!window.Blob) {
        alertify.alert('Unable to export saves on this browser!');
        return;
    }
    var date = new Date();
    var message = 'What would you like to call this export file?<br>Leaving this blank will result in a game identifier.';

    alertify.prompt(message, function (e, exportName) {
        if (e) {
            ChoiceScriptSavePlugin._export_all(exportName);
        } else {
            // user cancelled
        }
    }, '' /* default value */);
}

ChoiceScriptSavePlugin.import_file = function (event) {
    if (!event.files) {
        return;
    }

    if (event.files[0].type && event.files[0].type !== 'text/plain') {
        alertify.alert('That is not a text file!');
        return;
    }

    var reader = new FileReader();
    reader.addEventListener('load', function(event) {
        ChoiceScriptSavePlugin._import(event.target.result);
    });
    reader.readAsText(event.files[0]);
}

// initialize after a small delay, so everything else can catch up.
setTimeout(ChoiceScriptSavePlugin._init, timeoutLength);
