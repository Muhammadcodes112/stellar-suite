// ============================================================
// src/test/compilationStatus.test.ts
// Unit tests for compilation status monitoring.
// ============================================================

declare function require(name: string): any;
declare const process: { exitCode?: number };

const assert = require('assert');
import { CompilationStatusMonitor } from '../services/compilationStatusMonitor';
import {
    CompilationStatus,
    CompilationDiagnosticSeverity,
    CompilationEvent,
    CompilationRecord,
    ContractCompilationHistory,
    CompilationMonitorConfig
} from '../types/compilationStatus';

// ============================================================
// Mock Extension Context
// ============================================================

class MockExtensionContext {
    private storage: Map<string, any> = new Map();

    workspaceState = {
        get: <T>(key: string, defaultValue?: T): T | undefined => {
            return this.storage.get(key) ?? defaultValue;
        },
        update: (key: string, value: any): Thenable<void> => {
            this.storage.set(key, value);
            return Promise.resolve();
        }
    };

    globalState = {
        get: <T>(key: string, defaultValue?: T): T | undefined => {
            return this.storage.get(key) ?? defaultValue;
        },
        update: (key: string, value: any): Thenable<void> => {
            this.storage.set(key, value);
            return Promise.resolve();
        }
    };

    extensionUri = { fsPath: '/test/extension' } as any;
    subscriptions: any[] = [];
}

// ============================================================
// Test Functions
// ============================================================

const testContractPath = '/test/contracts/test-contract';
const testContractName = 'test-contract';

async function testStartCompilation() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const event = monitor.startCompilation(testContractPath);

        assert.strictEqual(event.contractPath, testContractPath);
        assert.strictEqual(event.contractName, testContractName);
        assert.strictEqual(event.status, CompilationStatus.IN_PROGRESS);
        assert.strictEqual(event.progress, 0);
        assert.ok(event.timestamp > 0);
        console.log('  [ok] should start compilation and set status to IN_PROGRESS');
    } finally {
        monitor.dispose();
    }
}

async function testUpdateProgress() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        monitor.updateProgress(testContractPath, 50, 'Halfway done');

        const status = monitor.getCurrentStatus(testContractPath);
        assert.ok(status);
        assert.strictEqual(status?.status, CompilationStatus.IN_PROGRESS);
        assert.strictEqual(status?.progress, 50);
        assert.strictEqual(status?.message, 'Halfway done');
        console.log('  [ok] should update progress during compilation');
    } finally {
        monitor.dispose();
    }
}

async function testReportSuccess() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        const record = monitor.reportSuccess(testContractPath, '/test/output.wasm');

        assert.strictEqual(record.status, CompilationStatus.SUCCESS);
        assert.strictEqual(record.wasmPath, '/test/output.wasm');
        assert.ok(record.duration >= 0);
        assert.ok(record.completedAt >= record.startedAt);
        console.log('  [ok] should report successful compilation');
    } finally {
        monitor.dispose();
    }
}

async function testReportFailure() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        const diagnostics = [{
            severity: CompilationDiagnosticSeverity.ERROR,
            message: 'Syntax error',
            code: 'E0001',
            file: testContractPath
        }];

        const record = monitor.reportFailure(testContractPath, 'Build failed', diagnostics);

        assert.strictEqual(record.status, CompilationStatus.FAILED);
        assert.strictEqual(record.errorCount, 1);
        assert.strictEqual(record.warningCount, 0);
        assert.ok(record.duration >= 0);
        console.log('  [ok] should report failed compilation');
    } finally {
        monitor.dispose();
    }
}

async function testReportCancellation() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        const record = monitor.reportCancellation(testContractPath);

        assert.strictEqual(record.status, CompilationStatus.CANCELLED);
        assert.strictEqual(record.errorCount, 0);
        assert.strictEqual(record.warningCount, 0);
        console.log('  [ok] should report cancelled compilation');
    } finally {
        monitor.dispose();
    }
}

async function testTrackMultipleContracts() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const contract1 = '/test/contracts/contract1';
        const contract2 = '/test/contracts/contract2';

        monitor.startCompilation(contract1);
        monitor.startCompilation(contract2);
        monitor.reportSuccess(contract1, '/test/contract1.wasm');

        const allStatuses = monitor.getAllStatuses();
        assert.strictEqual(allStatuses.length, 2);

        const status1 = monitor.getCurrentStatus(contract1);
        const status2 = monitor.getCurrentStatus(contract2);

        assert.strictEqual(status1?.status, CompilationStatus.SUCCESS);
        assert.strictEqual(status2?.status, CompilationStatus.IN_PROGRESS);
        console.log('  [ok] should track current status for multiple contracts');
    } finally {
        monitor.dispose();
    }
}

async function testGetInProgressContracts() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const contract1 = '/test/contracts/contract1';
        const contract2 = '/test/contracts/contract2';

        monitor.startCompilation(contract1);
        monitor.startCompilation(contract2);
        monitor.reportSuccess(contract1, '/test/contract1.wasm');

        const inProgress = monitor.getInProgressContracts();
        assert.strictEqual(inProgress.length, 1);
        assert.strictEqual(inProgress[0].contractPath, contract2);
        console.log('  [ok] should get in-progress contracts');
    } finally {
        monitor.dispose();
    }
}

async function testIsAnyCompilationInProgress() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        assert.strictEqual(monitor.isAnyCompilationInProgress(), false);

        monitor.startCompilation(testContractPath);
        assert.strictEqual(monitor.isAnyCompilationInProgress(), true);

        monitor.reportSuccess(testContractPath, '/test/output.wasm');
        assert.strictEqual(monitor.isAnyCompilationInProgress(), false);
        console.log('  [ok] should check if any compilation is in progress');
    } finally {
        monitor.dispose();
    }
}

async function testStoreCompilationHistory() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        monitor.reportSuccess(testContractPath, '/test/output.wasm');

        const history = monitor.getContractHistory(testContractPath);
        assert.ok(history);
        assert.strictEqual(history?.contractPath, testContractPath);
        assert.strictEqual(history?.records.length, 1);
        assert.strictEqual(history?.successCount, 1);
        assert.strictEqual(history?.failureCount, 0);
        console.log('  [ok] should store compilation history');
    } finally {
        monitor.dispose();
    }
}

async function testTrackMultipleCompilations() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        monitor.reportSuccess(testContractPath, '/test/output1.wasm');

        monitor.startCompilation(testContractPath);
        monitor.reportFailure(testContractPath, 'Build failed', []);

        monitor.startCompilation(testContractPath);
        monitor.reportSuccess(testContractPath, '/test/output2.wasm');

        const history = monitor.getContractHistory(testContractPath);
        assert.strictEqual(history?.records.length, 3);
        assert.strictEqual(history?.successCount, 2);
        assert.strictEqual(history?.failureCount, 1);
        console.log('  [ok] should track multiple compilations in history');
    } finally {
        monitor.dispose();
    }
}

async function testLimitHistorySize() {
    const mockContext = new MockExtensionContext();
    const config: CompilationMonitorConfig = {
        maxHistoryPerContract: 3,
        enableRealTimeUpdates: false,
        enableLogging: false,
        showProgressNotifications: false
    };
    const monitor = new CompilationStatusMonitor(mockContext as any, config);
    
    try {
        for (let i = 0; i < 5; i++) {
            monitor.startCompilation(testContractPath);
            monitor.reportSuccess(testContractPath, `/test/output${i}.wasm`);
        }

        const history = monitor.getContractHistory(testContractPath);
        assert.strictEqual(history?.records.length, 3);
        console.log('  [ok] should limit history size');
    } finally {
        monitor.dispose();
    }
}

async function testClearHistory() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        monitor.reportSuccess(testContractPath, '/test/output.wasm');

        monitor.clearHistory(testContractPath);

        const history = monitor.getContractHistory(testContractPath);
        assert.strictEqual(history, undefined);
        console.log('  [ok] should clear history for a contract');
    } finally {
        monitor.dispose();
    }
}

async function testClearAllHistory() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const contract1 = '/test/contracts/contract1';
        const contract2 = '/test/contracts/contract2';

        monitor.startCompilation(contract1);
        monitor.reportSuccess(contract1, '/test/contract1.wasm');
        monitor.startCompilation(contract2);
        monitor.reportSuccess(contract2, '/test/contract2.wasm');

        monitor.clearAllHistory();

        assert.strictEqual(monitor.getContractHistory(contract1), undefined);
        assert.strictEqual(monitor.getContractHistory(contract2), undefined);
        console.log('  [ok] should clear all history');
    } finally {
        monitor.dispose();
    }
}

async function testWorkspaceSummary() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const contract1 = '/test/contracts/contract1';
        const contract2 = '/test/contracts/contract2';
        const contract3 = '/test/contracts/contract3';

        monitor.startCompilation(contract1);
        monitor.reportSuccess(contract1, '/test/contract1.wasm');

        monitor.startCompilation(contract2);
        monitor.reportFailure(contract2, 'Build failed', []);

        monitor.startCompilation(contract3);

        const summary = monitor.getWorkspaceSummary();
        assert.strictEqual(summary.totalContracts, 3);
        assert.strictEqual(summary.successful, 1);
        assert.strictEqual(summary.failed, 1);
        assert.strictEqual(summary.inProgress, 1);
        console.log('  [ok] should provide workspace summary');
    } finally {
        monitor.dispose();
    }
}

async function testDefaultConfiguration() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const config = monitor.getConfig();
        assert.strictEqual(config.maxHistoryPerContract, 50);
        assert.strictEqual(config.enableRealTimeUpdates, true);
        assert.strictEqual(config.enableLogging, true);
        assert.strictEqual(config.showProgressNotifications, false);
        console.log('  [ok] should use default configuration');
    } finally {
        monitor.dispose();
    }
}

async function testUpdateConfiguration() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.updateConfig({
            maxHistoryPerContract: 10,
            enableLogging: false
        });

        const config = monitor.getConfig();
        assert.strictEqual(config.maxHistoryPerContract, 10);
        assert.strictEqual(config.enableLogging, false);
        assert.strictEqual(config.enableRealTimeUpdates, true);
        console.log('  [ok] should update configuration');
    } finally {
        monitor.dispose();
    }
}

async function testResetStatus() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.startCompilation(testContractPath);
        monitor.reportSuccess(testContractPath, '/test/output.wasm');

        monitor.resetStatus(testContractPath);

        const status = monitor.getCurrentStatus(testContractPath);
        assert.strictEqual(status?.status, CompilationStatus.IDLE);
        assert.strictEqual(status?.progress, 0);
        console.log('  [ok] should reset status to idle');
    } finally {
        monitor.dispose();
    }
}

async function testHandleNonExistentContract() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const status = monitor.getCurrentStatus('/non/existent/path');
        assert.strictEqual(status, undefined);
        console.log('  [ok] should handle non-existent contract status');
    } finally {
        monitor.dispose();
    }
}

async function testHandleProgressUpdateNonExistent() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        monitor.updateProgress('/non/existent/path', 50, 'Halfway');

        const status = monitor.getCurrentStatus('/non/existent/path');
        assert.strictEqual(status, undefined);
        console.log('  [ok] should handle progress update for non-existent compilation');
    } finally {
        monitor.dispose();
    }
}

async function testMultipleStartCalls() {
    const mockContext = new MockExtensionContext();
    const monitor = new CompilationStatusMonitor(mockContext as any);
    
    try {
        const event1 = monitor.startCompilation(testContractPath);
        const event2 = monitor.startCompilation(testContractPath);

        const status = monitor.getCurrentStatus(testContractPath);
        assert.strictEqual(status?.timestamp, event2.timestamp);
        console.log('  [ok] should handle multiple start calls for same contract');
    } finally {
        monitor.dispose();
    }
}

// ============================================================
// Test Runner
// ============================================================

async function run() {
    const tests: Array<() => Promise<void>> = [
        testStartCompilation,
        testUpdateProgress,
        testReportSuccess,
        testReportFailure,
        testReportCancellation,
        testTrackMultipleContracts,
        testGetInProgressContracts,
        testIsAnyCompilationInProgress,
        testStoreCompilationHistory,
        testTrackMultipleCompilations,
        testLimitHistorySize,
        testClearHistory,
        testClearAllHistory,
        testWorkspaceSummary,
        testDefaultConfiguration,
        testUpdateConfiguration,
        testResetStatus,
        testHandleNonExistentContract,
        testHandleProgressUpdateNonExistent,
        testMultipleStartCalls,
    ];

    let passed = 0;
    let failed = 0;

    console.log('\nCompilationStatusMonitor unit tests');
    for (const test of tests) {
        try {
            await test();
            passed += 1;
        } catch (err) {
            failed += 1;
            console.error(`  [fail] ${test.name}`);
            console.error(`         ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

run().catch(err => {
    console.error('Test runner error:', err);
    process.exitCode = 1;
});

