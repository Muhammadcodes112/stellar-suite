import * as vscode from "vscode";

// Commands
import { buildContract } from "./commands/buildContract";
import { deployContract } from "./commands/deployContract";
import { deployBatch } from "./commands/deployBatch";
import { simulateTransaction } from "./commands/simulateTransaction";
import { manageCliConfiguration } from "./commands/manageCliConfiguration";
import { registerGroupCommands } from "./commands/groupCommands";
import { registerHealthCommands } from "./commands/healthCommands";
import { registerSyncCommands } from "./commands/syncCommands";
import { registerSimulationHistoryCommands } from "./commands/simulationHistoryCommands";
import { registerBackupCommands } from "./commands/backupCommands";
import { registerReplayCommands } from "./commands/replayCommands";
import { registerRetryCommands } from "./commands/retryCommands";
import { registerCliHistoryCommands } from "./commands/cliHistoryCommands";
import { registerResourceProfilingCommands } from "./commands/resourceProfilingCommands";
import { registerEnvVariableCommands } from "./commands/envVariableCommands";
import { registerRpcLoggingCommands } from "./commands/rpcLoggingCommands";

// Services
import { ContractGroupService } from "./services/contractGroupService";
import { ContractMetadataService } from "./services/contractMetadataService";
import { ContractVersionTracker } from "./services/contractVersionTracker";
import { WorkspaceStateSyncService } from "./services/workspaceStateSyncService";
import { WorkspaceStateEncryptionService } from "./services/workspaceStateEncryptionService";
import { RpcHealthMonitor } from "./services/rpcHealthMonitor";
import { SimulationHistoryService } from "./services/simulationHistoryService";
import { CompilationStatusMonitor } from "./services/compilationStatusMonitor";
import { StateBackupService } from "./services/stateBackupService";
import { SimulationReplayService } from "./services/simulationReplayService";
import { ResourceProfilingService } from "./services/resourceProfilingService";
import { createEnvVariableService } from "./services/envVariableVscode";
import { EnvVariableService } from "./services/envVariableService";
import { RpcRetryService } from "./services/rpcRetryService";
import { CliHistoryService } from "./services/cliHistoryService";
import { CliReplayService } from "./services/cliReplayService";
import { RpcLogger } from "./services/rpcLogger";

// UI
import { SidebarViewProvider } from "./ui/sidebarView";
import { SyncStatusProvider } from "./ui/syncStatusProvider";
import { RpcHealthStatusBar } from "./ui/rpcHealthStatusBar";
import { CompilationStatusProvider } from "./ui/compilationStatusProvider";
import { RetryStatusBarItem } from "./ui/retryStatusBar";

// Global service instances
let sidebarProvider: SidebarViewProvider | undefined;
let metadataService: ContractMetadataService | undefined;
let versionTracker: ContractVersionTracker | undefined;
let syncService: WorkspaceStateSyncService | undefined;
let syncStatusProvider: SyncStatusProvider | undefined;
let healthMonitor: RpcHealthMonitor | undefined;
let healthStatusBar: RpcHealthStatusBar | undefined;
let rpcLogger: RpcLogger | undefined;
let simulationHistoryService: SimulationHistoryService | undefined;
let compilationMonitor: CompilationStatusMonitor | undefined;
let compilationStatusProvider: CompilationStatusProvider | undefined;
let backupService: StateBackupService | undefined;
let simulationReplayService: SimulationReplayService | undefined;
let retryService: RpcRetryService | undefined;
let retryStatusBar: RetryStatusBarItem | undefined;
let cliHistoryService: CliHistoryService | undefined;
let cliReplayService: CliReplayService | undefined;
let resourceProfilingService: ResourceProfilingService | undefined;
let envVariableService: EnvVariableService | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Stellar Suite");
  outputChannel.appendLine("[Extension] Activating Stellar Suite extension...");

  try {
    // ── 1. Initialize Core Services ──────────────────────────────

    // RPC Retry & Health
    retryService = new RpcRetryService(
      { resetTimeout: 60000, consecutiveFailuresThreshold: 3 },
      { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 5000 },
      false
    );
    retryStatusBar = new RetryStatusBarItem(retryService, 5000);
    registerRetryCommands(context, retryService);
    outputChannel.appendLine('[Extension] RPC retry service initialized');

    try {
      const config = vscode.workspace.getConfiguration('stellarSuite');
      const rpcUrl = config.get<string>('rpcUrl', 'https://soroban-testnet.stellar.org:443');
      healthMonitor = new RpcHealthMonitor(context, { enableLogging: false });
      healthMonitor.addEndpoint(rpcUrl, 0, true);
      healthMonitor.startMonitoring();
      healthStatusBar = new RpcHealthStatusBar(healthMonitor);
      registerHealthCommands(context, healthMonitor);
      outputChannel.appendLine('[Extension] RPC health monitor initialized');
    } catch (err) {
      outputChannel.appendLine(`[Extension] WARNING: health monitor init failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Workspace Sync
    syncService = new WorkspaceStateSyncService(context);
    syncStatusProvider = new SyncStatusProvider(syncService);
    registerSyncCommands(context, syncService);
    outputChannel.appendLine('[Extension] Workspace state sync initialized');

    // Metadata & Version Tracking
    metadataService = new ContractMetadataService(vscode.workspace as any, outputChannel);
    metadataService.startWatching();
    metadataService.scanWorkspace().then(result => {
      outputChannel.appendLine(`[Extension] Initial scan: ${result.contracts.length} contracts found`);
    });
    outputChannel.appendLine('[Extension] Metadata service initialized');

    versionTracker = new ContractVersionTracker(context, outputChannel);

    // Group Management
    const groupService = new ContractGroupService(context);
    groupService.loadGroups().catch(() => {
      outputChannel.appendLine('[Extension] WARNING: could not load contract groups');
    });
    registerGroupCommands(context, groupService);

    // Logging
    rpcLogger = new RpcLogger({ context, enableConsoleOutput: true });
    rpcLogger.loadLogs().catch(() => {
      outputChannel.appendLine('[Extension] WARNING: could not load RPC logs');
    });
    registerRpcLoggingCommands(context, rpcLogger);

    // Simulation & CLI History
    simulationHistoryService = new SimulationHistoryService(context, outputChannel);
    registerSimulationHistoryCommands(context, simulationHistoryService);
    outputChannel.appendLine('[Extension] Simulation history initialized');

    cliHistoryService = new CliHistoryService(context);
    cliReplayService = new CliReplayService(cliHistoryService);
    registerCliHistoryCommands(context, cliHistoryService, cliReplayService);
    outputChannel.appendLine('[Extension] CLI history and replay initialized');

    simulationReplayService = new SimulationReplayService(simulationHistoryService, outputChannel);
    registerReplayCommands(context, simulationHistoryService, simulationReplayService);
    outputChannel.appendLine('[Extension] Simulation replay initialized');

    // Resource Profiling & Env Variables
    resourceProfilingService = new ResourceProfilingService(context, outputChannel);
    registerResourceProfilingCommands(context, resourceProfilingService);
    outputChannel.appendLine('[Extension] Resource profiling service initialized');

    envVariableService = createEnvVariableService(context);
    registerEnvVariableCommands(context, envVariableService);
    outputChannel.appendLine('[Extension] Environment variable service initialized');

    // Compilation Monitoring
    compilationMonitor = new CompilationStatusMonitor(context);
    compilationStatusProvider = new CompilationStatusProvider(compilationMonitor);

    // Backup
    backupService = new StateBackupService(context, outputChannel);
    registerBackupCommands(context, backupService);

    // ── 2. Initialize Sidebar ─────────────────────────────────────
    sidebarProvider = new SidebarViewProvider(
      context.extensionUri,
      context,
      cliHistoryService,
      cliReplayService
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        SidebarViewProvider.viewType,
        sidebarProvider
      )
    );
    outputChannel.appendLine('[Extension] Sidebar provider registered');

    // ── 3. Register Commands ───────────────────────────────────────

    context.subscriptions.push(
      vscode.commands.registerCommand("stellarSuite.simulateTransaction", () =>
        simulateTransaction(context, sidebarProvider, simulationHistoryService, cliHistoryService, resourceProfilingService)
      ),
      vscode.commands.registerCommand("stellarSuite.simulateFromSidebar", () =>
        simulateTransaction(context, sidebarProvider, simulationHistoryService, cliHistoryService, resourceProfilingService)
      ),
      vscode.commands.registerCommand("stellarSuite.deployContract", () =>
        deployContract(context, sidebarProvider)
      ),
      vscode.commands.registerCommand("stellarSuite.deployFromSidebar", () =>
        deployContract(context, sidebarProvider)
      ),
      vscode.commands.registerCommand("stellarSuite.buildContract", () =>
        buildContract(context, sidebarProvider, compilationMonitor)
      ),
      vscode.commands.registerCommand("stellarSuite.configureCli", () =>
        manageCliConfiguration(context)
      ),
      vscode.commands.registerCommand("stellarSuite.refreshContracts", () =>
        sidebarProvider?.refresh()
      ),
      vscode.commands.registerCommand("stellarSuite.deployBatch", () =>
        deployBatch(context)
      ),
      vscode.commands.registerCommand("stellarSuite.showCompilationStatus", () =>
        compilationStatusProvider?.showCompilationStatus()
      ),
      vscode.commands.registerCommand("stellarSuite.showVersionMismatches", async () => {
        if (!versionTracker) return;
        const mismatches = versionTracker.getMismatches();
        if (!mismatches.length) {
          vscode.window.showInformationMessage('Stellar Suite: No version mismatches detected.');
          return;
        }
        await versionTracker.notifyMismatches();
      }),
      vscode.commands.registerCommand("stellarSuite.copyContractId", async () => {
        const id = await vscode.window.showInputBox({
          title: 'Copy Contract ID',
          prompt: 'Enter the contract ID to copy to clipboard',
        });
        if (!id) return;
        await vscode.env.clipboard.writeText(id);
        vscode.window.showInformationMessage('Contract ID copied to clipboard.');
      })
    );

    // ── 4. File Watchers ──────────────────────────────────────────
    const watcher = vscode.workspace.createFileSystemWatcher('**/{Cargo.toml,*.wasm}');
    watcher.onDidChange(() => sidebarProvider?.refresh());
    watcher.onDidCreate(() => sidebarProvider?.refresh());
    watcher.onDidDelete(() => sidebarProvider?.refresh());

    // ── 5. Push Subscriptions ─────────────────────────────────────
    context.subscriptions.push(
      watcher,
      retryStatusBar,
      syncStatusProvider || { dispose: () => { } },
      compilationStatusProvider || { dispose: () => { } },
      { dispose: () => metadataService?.dispose() },
      { dispose: () => compilationMonitor?.dispose() },
      { dispose: () => healthMonitor?.dispose() },
      { dispose: () => healthStatusBar?.dispose() }
    );

    outputChannel.appendLine("[Extension] Activation complete");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[Extension] ERROR during activation: ${errorMsg}`);
    if (error instanceof Error && error.stack) {
      outputChannel.appendLine(`[Extension] Stack: ${error.stack}`);
    }
    console.error("[Stellar Suite] Activation error:", error);
    vscode.window.showErrorMessage(`Stellar Suite activation failed: ${errorMsg}`);
  }
}

export function deactivate() {
  healthMonitor?.dispose();
  healthStatusBar?.dispose();
  syncStatusProvider?.dispose();
  compilationStatusProvider?.dispose();
  compilationMonitor?.dispose();
  metadataService?.dispose();
}
