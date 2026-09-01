function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    var output = {
        status: 'error',
        message: 'Invalid request'
    };

    try {
        // Determine if it's GET (list) or POST (action)
        var action = 'list';
        var data = {};

        if (e.postData && e.postData.contents) {
            data = JSON.parse(e.postData.contents);
            action = data.action || 'list';
        } else if (e.parameter.action) {
            action = e.parameter.action;
        }

        if (action === 'list') {
            output = listFiles(e.parameter.folderId);
        } else if (action === 'listAll') {
            output = listAllFiles();
        } else if (action === 'search') {
            output = searchFiles(e.parameter.q || data.q);
        } else if (action === 'upload') {
            output = uploadFile(data);
        } else if (action === 'delete') {
            output = deleteFile(data);
        } else if (action === 'createFolder') {
            output = createFolder(data);
        } else if (action === 'logMqtt') {
            output = logMqtt(data);
        } else if (action === 'prepareSheet') {
            output = prepareSheet();
        }

    } catch (err) {
        output = {
            status: 'error',
            message: err.toString()
        };
    }

    return ContentService.createTextOutput(JSON.stringify(output))
        .setMimeType(ContentService.MimeType.JSON);
}

function listFiles(folderId) {
    var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
    var files = folder.getFiles();
    var folders = folder.getFolders();

    var result = {
        status: 'success',
        currentFolder: {
            id: folder.getId(),
            name: folder.getName(),
            parentId: folder.getParents().hasNext() ? folder.getParents().next().getId() : null
        },
        items: []
    };

    // Get Folders
    var fCount = 0;
    while (folders.hasNext() && fCount < 20) {
        var f = folders.next();
        result.items.push({
            id: f.getId(),
            name: f.getName(),
            type: 'folder',
            url: f.getUrl()
        });
        fCount++;
    }

    // Get Files
    var count = 0;
    while (files.hasNext() && count < 20) {
        var file = files.next();
        result.items.push({
            id: file.getId(),
            name: file.getName(),
            type: 'file',
            mimeType: file.getMimeType(),
            url: file.getUrl()
        });
        count++;
    }

    return result;
}

function uploadFile(data) {
    var folder = data.folderId ? DriveApp.getFolderById(data.folderId) : DriveApp.getRootFolder();

    // Data.content expects base64 string
    var contentType = data.mimeType || 'application/octet-stream';
    var blob = Utilities.newBlob(Utilities.base64Decode(data.content), contentType, data.name);

    var file = folder.createFile(blob);

    return {
        status: 'success',
        message: 'File uploaded successfully',
        file: {
            id: file.getId(),
            name: file.getName(),
            url: file.getUrl()
        }
    };
}

function deleteFile(data) {
    var file = DriveApp.getFileById(data.id);
    file.setTrashed(true);

    return {
        status: 'success',
        message: 'File moved to trash'
    };
}

function createFolder(data) {
    var parent = data.parentId ? DriveApp.getFolderById(data.parentId) : DriveApp.getRootFolder();
    var newFolder = parent.createFolder(data.name);

    return {
        status: 'success',
        message: 'Folder created',
        folder: {
            id: newFolder.getId(),
            name: newFolder.getName()
        }
    };
}

function listAllFiles() {
    var files = DriveApp.getFiles();
    var folders = DriveApp.getFolders();
    var result = {
        status: 'success',
        items: []
    };

    var count = 0;
    while (folders.hasNext() && count < 100) {
        var f = folders.next();
        var parents = f.getParents();
        var parentId = parents.hasNext() ? parents.next().getId() : null;
        result.items.push({
            id: f.getId(),
            name: f.getName(),
            type: 'folder',
            parentId: parentId
        });
        count++;
    }

    count = 0;
    while (files.hasNext() && count < 200) {
        var file = files.next();
        var parents = file.getParents();
        var parentId = parents.hasNext() ? parents.next().getId() : null;
        result.items.push({
            id: file.getId(),
            name: file.getName(),
            type: 'file',
            parentId: parentId
        });
        count++;
    }

    return result;
}

function searchFiles(query) {
    if (!query) return { status: 'error', message: 'No query provided' };

    var files = DriveApp.searchFiles('title contains "' + query + '"');
    var folders = DriveApp.searchFolders('title contains "' + query + '"');
    var result = {
        status: 'success',
        items: []
    };

    while (folders.hasNext() && result.items.length < 20) {
        var f = folders.next();
        result.items.push({ id: f.getId(), name: f.getName(), type: 'folder' });
    }

    while (files.hasNext() && result.items.length < 50) {
        var f = files.next();
        result.items.push({ id: f.getId(), name: f.getName(), type: 'file' });
    }

    return result;
}

function logMqtt(data) {
    // ID Spreadsheet yang Anda berikan
    var ss = SpreadsheetApp.openById("1WPMMNO323cSdg5ZQjtX5HXZP8Grv1z1V-qfjlbeEers");
    var sheet = ss.getSheets()[0]; // Ambil sheet pertama

    // --- CEK APAKAH TOPIK SUDAH ADA ---
    var lastRow = sheet.getLastRow();
    if (lastRow > 0) {
        var topics = sheet.getRange(1, 2, lastRow, 1).getValues(); // Ambil kolom B (Topic)
        for (var i = 0; i < topics.length; i++) {
            if (topics[i][0] === data.topic) {
                // Jika topik ditemukan, jangan simpan dan keluar
                return {
                    status: 'success',
                    message: 'Topic already exists, skipping log.'
                };
            }
        }
    }

    // --- JIKA TOPIK BARU, LANJUTKAN SIMPAN ---

    // Tambah baris baru
    sheet.appendRow([
        data.timestamp,
        data.topic,
        data.message
    ]);

    // Setel baris terbaru ke warna MERAH
    var newLastRow = sheet.getLastRow();
    sheet.getRange(newLastRow, 1, 1, sheet.getLastColumn()).setFontColor("#FF0000");

    return {
        status: 'success',
        message: 'MQTT data logged to spreadsheet'
    };
}

function prepareSheet() {
    var ss = SpreadsheetApp.openById("1WPMMNO323cSdg5ZQjtX5HXZP8Grv1z1V-qfjlbeEers");
    var sheet = ss.getSheets()[0];
    var lastRow = sheet.getLastRow();

    if (lastRow > 0) {
        sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).setFontColor("#000000");
    }

    return {
        status: 'success',
        message: 'Sheet prepared (all text set to black)'
    };
}
