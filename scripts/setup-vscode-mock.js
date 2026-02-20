const fs = require('fs');
fs.mkdirSync('out-test/node_modules/vscode', { recursive: true });

// Enhanced VS Code mock for testing
const vscodeMock = `
class EventEmitter {
    constructor() {
        this.listeners = [];
    }
    get event() {
        return (listener) => {
            this.listeners.push(listener);
            return { dispose: () => {} };
        };
    }
    fire(event) {
        this.listeners.forEach(listener => listener(event));
    }
    dispose() {
        this.listeners = [];
    }
}

class OutputChannel {
    appendLine(message) {}
    append(message) {}
    clear() {}
    show() {}
    hide() {}
    dispose() {}
}

module.exports = {
    workspace: {
        createFileSystemWatcher: () => ({
            onDidCreate: function(){},
            onDidChange: function(){},
            onDidDelete: function(){},
            dispose: function(){}
        }),
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} })
    },
    window: {
        createOutputChannel: (name) => new OutputChannel()
    },
    EventEmitter: EventEmitter,
    Disposable: class Disposable {
        constructor(callback) {
            this.callback = callback;
        }
        dispose() {
            if (this.callback) {
                this.callback();
            }
        }
    }
};
`;

fs.writeFileSync('out-test/node_modules/vscode/index.js', vscodeMock);