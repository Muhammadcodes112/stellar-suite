// ============================================================
// src/extension.ts
// Extension entry point — activates commands, sidebar, and watchers.
// ============================================================

import * as vscode from "vscode";
import { simulateTransaction } from "./commands/simulateTransaction";
import { deployContract } from "./commands/deployContract";
import { buildContract } from "./commands/buildContract";
import { registerGroupCommands } from "./commands/groupCommands";
import { manageCliConfiguration } from "./commands/manageCliConfiguration";
import { registerSyncCommands } from "./commands/syncCommands";
import { registerHealthCommands } from "./commands/healthCommands";
import { registerSimulationHistoryCommands } from "./commands/simulationHistoryCommands";
import { registerBackupCommands } from "./commands/backupCommands";
import { registerReplayCommands } from "./commands/replayCommands";
import { registerRetryCommands } from "./commands/retryCommands";
import { registerCliHistoryCommands } from "./commands/cliHistoryCommands";
import { SidebarViewProvider } from "./ui/sidebarView";
import { ContractGroupService } from "./services/contractGroupService";
import { ContractVersionTracker } from "./services/contractVersionTracker";
import { ContractMetadataService } from "./services/contractMetadataService";
import { WorkspaceStateSyncService } from "./services/workspaceStateSyncService";
import { SyncStatusProvider } from "./ui/syncStatusProvider";
import { WorkspaceStateEncryptionService } from "./services/workspaceStateEncryptionService";
import { RpcHealthMonitor } from "./services/rpcHealthMonitor";
import { RpcHealthStatusBar } from "./ui/rpcHealthStatusBar";
import { SimulationHistoryService } from "./services/simulationHistoryService";
import { CompilationStatusMonitor } from "./services/compilationStatusMonitor";
import { CompilationStatusProvider } from "./ui/compilationStatusProvider";
import { StateBackupService } from "./services/stateBackupService";
import { SimulationReplayService } from "./services/simulationReplayService";
import { RpcRetryService } from "./services/rpcRetryService";
import { RetryStatusBarItem } from "./ui/retryStatusBar";
import { CliHistoryService } from "./services/cliHistoryService";
import { CliReplayService } from "./services/cliReplayService";

let sidebarProvider: SidebarViewProvider | undefined;
let groupService: ContractGroupService | undefined;
let versionTracker: ContractVersionTracker | undefined;
let metadataService: ContractMetadataService | undefined;
let syncService: WorkspaceStateSyncService | undefined;
let syncStatusProvider: SyncStatusProvider | undefined;
let encryptionService: WorkspaceStateEncryptionService | undefined;
let healthMonitor: RpcHealthMonitor | undefined;
let healthStatusBar: RpcHealthStatusBar | undefined;
let simulationHistoryService: SimulationHistoryService | undefined;
let compilationMonitor: CompilationStatusMonitor | undefined;
let compilationStatusProvider: CompilationStatusProvider | undefined;
let backupService: StateBackupService | undefined;
let simulationReplayService: SimulationReplayService | undefined;
let retryService: RpcRetryService | undefined;
let retryStatusBar: RetryStatusBarItem | undefined;
let cliHistoryService: CliHistoryService | undefined;
let cliReplayService: CliReplayService | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Stellar Suite");
  outputChannel.appendLine("[Extension] Activating Stellar Suite extension...");

  // 1. Initialize core services
  try {
    // Initialize RPC retry service
    retryService = new RpcRetryService(
      { resetTimeout: 60000, consecutiveFailuresThreshold: 3 },
      { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 5000 },
      false
    );
    retryStatusBar = new RetryStatusBarItem(retryService, 5000);
    registerRetryCommands(context, retryService);
    outputChannel.appendLine('[Extension] RPC retry service initialized');

    // Initialize sync service
    syncService = new WorkspaceStateSyncService(context);
    syncStatusProvider = new SyncStatusProvider(syncService);
    registerSyncCommands(context, syncService);
    outputChannel.appendLine('[Extension] Workspace state sync initialized');

    // Initialize health monitor
    healthMonitor = new RpcHealthMonitor(context);
    healthStatusBar = new RpcHealthStatusBar(healthMonitor);
    registerHealthCommands(context, healthMonitor);
    outputChannel.appendLine('[Extension] RPC health monitor initialized');

    // Initialize metadata service
    metadataService = new ContractMetadataService(vscode.workspace as any, outputChannel);
    metadataService.startWatching();
    metadataService.scanWorkspace().then(result => {
      outputChannel.appendLine(`[Extension] Initial scan: ${result.contracts.length} contracts found`);
    });
    outputChannel.appendLine('[Extension] Metadata service initialized');

    // Initialize simulation & CLI history services
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

    // Initialize other services
    groupService = new ContractGroupService(context);
    registerGroupCommands(context, groupService);

    versionTracker = new ContractVersionTracker(context, outputChannel);
    compilationMonitor = new CompilationStatusMonitor(context);
    compilationStatusProvider = new CompilationStatusProvider(compilationMonitor);
    backupService = new StateBackupService(context, outputChannel);
    registerBackupCommands(context, backupService);

    // 2. Initialize Sidebar
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

    // 3. Register Sidebar-linked commands
    const simulateCommand = vscode.commands.registerCommand(
      "stellarSuite.simulateTransaction",
      () => simulateTransaction(context, sidebarProvider, simulationHistoryService, cliHistoryService)
    );

    const deployCommand = vscode.commands.registerCommand(
      "stellarSuite.deployContract",
      () => deployContract(context, sidebarProvider)
    );

    const buildCommand = vscode.commands.registerCommand(
      "stellarSuite.buildContract",
      () => buildContract(context, sidebarProvider, compilationMonitor)
    );

    const configureCliCommand = vscode.commands.registerCommand(
      "stellarSuite.configureCli",
      () => manageCliConfiguration(context)
    );

    const refreshCommand = vscode.commands.registerCommand(
      "stellarSuite.refreshContracts",
      () => sidebarProvider?.refresh()
    );

    const copyContractIdCommand = vscode.commands.registerCommand(
      "stellarSuite.copyContractId",
      async () => {
        const id = await vscode.window.showInputBox({
          title: "Copy Contract ID",
          prompt: "Enter the contract ID to copy"
        });
        if (id) {
          await vscode.env.clipboard.writeText(id);
          vscode.window.showInformationMessage("Contract ID copied to clipboard.");
        }
      }
    );

    const showVersionMismatchesCommand = vscode.commands.registerCommand(
      "stellarSuite.showVersionMismatches",
      () => versionTracker?.notifyMismatches()
    );

    const showCompilationStatusCommand = vscode.commands.registerCommand(
      "stellarSuite.showCompilationStatus",
      () => compilationStatusProvider?.showCompilationStatus()
    );

    // ── File watcher ──────────────────────────────────────
    const watcher = vscode.workspace.createFileSystemWatcher('**/{Cargo.toml,*.wasm}');
    const refreshOnChange = () => sidebarProvider?.refresh();
    watcher.onDidChange(refreshOnChange);
    watcher.onDidCreate(refreshOnChange);
    watcher.onDidDelete(refreshOnChange);

    // 4. Push subscriptions
    context.subscriptions.push(
      simulateCommand,
      deployCommand,
      buildCommand,
      configureCliCommand,
      refreshCommand,
      copyContractIdCommand,
      showVersionMismatchesCommand,
      showCompilationStatusCommand,
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
}
